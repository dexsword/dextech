#!/usr/bin/python3 -I
"""Root-installed DexTech deployer. Repository copies are never executed by sudo.

--validate SHA is root-only and never builds, backs up, prunes, switches or restarts.
It reads live health/Calendar and queries public main. deploy SHA is the SSH API.
"""
import datetime
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

BASE = Path('/var/lib/dextech-deploy')
RELEASES = Path('/var/www/dextech-releases')
CURRENT = RELEASES / 'current'
BACKUPS = Path('/var/backups/dextech/actions')
EVIDENCE = BASE / 'actions'
BUILD = Path('/var/lib/dextech-build')
ENVFILE = Path('/etc/dextech/release.env')
PROTECTED = Path('/etc/dextech/production.env')
DB = Path('/var/lib/dextech/bookings.db')
NODE = '/opt/dextech/node-v22.23.2-linux-x64/bin/node'
REPO = 'https://github.com/dexsword/dextech.git'
CLEAN_ENV = {'PATH': str(Path(NODE).parent) + ':/usr/sbin:/usr/bin:/sbin:/bin',
             'HOME': '/nonexistent', 'LANG': 'C', 'GIT_CONFIG_NOSYSTEM': '1',
             'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0'}
# Explicit source contract. New runtime assets require a reviewed operator install.
RUNTIME = frozenset('server.js package.json package-lock.json index.html support.html '
                    'privacy.html terms.html admin.html cancel.html script.js style.css '
                    'bg3.jpeg btc.jpg eth.jpg favicon.png paypal.jpg sol.jpg '
                    '.well-known/brave-rewards-verification.txt'.split())
SHA_RE = re.compile(r'[0-9a-f]{40}', re.ASCII)
ERROR_RE = re.compile(r'\berror\b|\bfatal\b|uncaught|unhandled|EACCES|EADDRINUSE|'
                      r'SQLITE_\w+|\bfailed\b|MODULE_NOT_FOUND|invalid_grant', re.I)


def require(ok):
    if not ok:
        raise RuntimeError('gate failed')


def run(args, *, cwd=None, timeout=90, binary=False):
    # Neither command failures nor their captured output are surfaced to clients.
    result = subprocess.run(args, cwd=cwd, env=CLEAN_ENV, capture_output=True,
                            text=not binary, timeout=timeout, check=False)
    require(result.returncode == 0)
    return result.stdout


def main_sha():
    rows = run(['git', 'ls-remote', REPO, 'refs/heads/main']).splitlines()
    require(len(rows) == 1)
    sha, ref = rows[0].split('\t')
    require(SHA_RE.fullmatch(sha) and ref == 'refs/heads/main')
    return sha


def properties(unit='dextech.service'):
    names = ['ActiveState', 'SubState', 'MainPID', 'NRestarts', 'InvocationID',
             'User', 'Group', 'ActiveEnterTimestampMonotonic']
    return dict(line.split('=', 1) for line in run(
        ['systemctl', 'show', unit] + [x for n in names for x in ['-p', n]]).splitlines())


def protected_snapshot():
    paths = [PROTECTED, Path('/etc/systemd/system/dextech.service'),
             Path('/etc/apache2/sites-available/dextech.conf')]
    # Internal bytes only: never serialize secrets or secret hashes.
    files = [(p, p.read_bytes(), p.stat().st_uid, stat.S_IMODE(p.stat().st_mode)) for p in paths]
    pid = properties()['MainPID']
    raw = Path('/proc/' + pid + '/environ').read_bytes()
    effective = dict(item.split(b'=', 1) for item in raw.split(b'\0') if b'=' in item)
    keys = re.findall(rb'^([A-Za-z_][A-Za-z_0-9]*)=', PROTECTED.read_bytes(), re.M)
    require(keys and all(key in effective for key in keys))
    return files + [('effective-environment', {key: effective[key] for key in keys})]


def verify_protected(snapshot):
    require(snapshot == protected_snapshot())


def atomic_bytes(path, data):
    fd, name = tempfile.mkstemp(prefix='.dextech-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        fsync_dir(path.parent)
    finally:
        Path(name).unlink(missing_ok=True)


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def switch(release, env_bytes):
    require(release.parent == RELEASES and SHA_RE.fullmatch(release.name))
    require(release.is_dir() and not release.is_symlink())
    temp = RELEASES / '.actions-next'
    require(not temp.exists() and not temp.is_symlink())
    try:
        temp.symlink_to(release.name)
        atomic_bytes(ENVFILE, env_bytes)
        os.replace(temp, CURRENT)
        fsync_dir(RELEASES)
    finally:
        temp.unlink(missing_ok=True)


def probe_public_html():
    for path in ['/', '/support.html', '/admin', '/cancel']:
        http('https://dextech.cloud' + path)


def http(url, sha=None):
    req = urllib.request.Request(url, headers={'Cache-Control': 'no-cache',
                                              'User-Agent': 'DexTech-deployment-gate'})
    with urllib.request.urlopen(req, timeout=15) as response:
        require(response.status == 200)
        body = response.read(2 * 1024 * 1024)
    if sha:
        data = json.loads(body)
        require(data.get('status') == 'ok' and data.get('release_sha') == sha)
        require(data.get('email_enabled') is True and data.get('gcal_enabled') is True)
    elif '/api/availability' in url:
        data = json.loads(body)
        require(isinstance(data, dict) and all(isinstance(v, list) for v in data.values()))
    else:
        require(b'<html' in body.lower() or b'<!doctype' in body.lower())


def journal(invocation, since):
    require(re.fullmatch('[0-9a-f]{32}', invocation))
    output = run(['journalctl', '_SYSTEMD_INVOCATION_ID=' + invocation,
                  '--since=@' + str(since), '--no-pager', '-o', 'json'])
    return [json.loads(line) for line in output.splitlines() if line]


def sandbox_args(unit, user):
    return ['systemd-run', '--quiet', '--wait', '--pipe', '--collect', '--unit=' + unit,
            '-p', 'User=' + user, '-p', 'Group=' + user,
            '-p', 'NoNewPrivileges=yes', '-p', 'ProtectSystem=strict',
            '-p', 'ProtectHome=yes', '-p', 'PrivateTmp=yes', '-p', 'PrivateDevices=yes',
            '-p', 'ProtectKernelTunables=yes', '-p', 'ProtectKernelModules=yes',
            '-p', 'ProtectControlGroups=yes', '-p', 'RestrictSUIDSGID=yes',
            '-p', 'CapabilityBoundingSet=', '-p', 'UMask=0077',
            '-p', 'KillMode=control-group', '-p', 'RuntimeMaxSec=900',
            '-p', 'MemoryMax=1G', '-p', 'TasksMax=128',
            '-p', 'StandardOutput=null', '-p', 'StandardError=null']


def calendar_read(release):
    args = sandbox_args('dextech-calendar-' + str(time.time_ns()), 'dextech')
    args += ['-p', 'EnvironmentFile=/etc/dextech/production.env',
             '-p', 'InaccessiblePaths=/var/lib/dextech /var/backups/dextech',
             NODE, '/usr/local/libexec/dextech-calendar-read.cjs', str(release)]
    run(args, timeout=65)


def gates(sha, *, since, wait_refresh=True):
    # Wait for Type=simple startup, then require a stable service identity.
    for attempt in range(30):
        try:
            http('http://127.0.0.1:3000/health', sha)
            break
        except Exception:
            if attempt == 29:
                raise
            time.sleep(1)
    props = properties()
    require(props['ActiveState'] == 'active' and props['SubState'] == 'running')
    require(props['User'] == props['Group'] == 'dextech' and props['NRestarts'] == '0')
    pid = int(props['MainPID'])
    require(os.stat('/proc/' + str(pid)).st_uid == pwd.getpwnam('dextech').pw_uid)
    require(os.readlink('/proc/' + str(pid) + '/exe') == NODE)
    require(Path('/proc/' + str(pid) + '/cwd').resolve() == RELEASES / sha)
    require(CURRENT.resolve() == RELEASES / sha)
    require(ENVFILE.read_bytes() == ('APP_RELEASE_SHA=' + sha + '\n').encode())
    sockets = run(['ss', '-H', '-ltnp', 'sport = :3000']).splitlines()
    require(len(sockets) == 1 and '127.0.0.1:3000' in sockets[0]
            and 'pid=' + str(pid) + ',' in sockets[0])
    require(str(DB) in [os.readlink(p) for p in Path('/proc/' + str(pid) + '/fd').iterdir()])
    http('https://dextech.cloud/health', sha)
    probe_public_html()
    require(properties('apache2.service')['ActiveState'] == 'active')
    run(['apache2ctl', 'configtest'])
    calendar_read(RELEASES / sha)
    # Cache TTL is 120s. Require a fresh successful refresh, not a historic message
    # or HTTP 200 with stale cache after a swallowed Calendar error.
    deadline = time.monotonic() + (140 if wait_refresh else 10)
    while True:
        http('http://127.0.0.1:3000/api/availability')
        rows = journal(props['InvocationID'], since)
        require(not any(ERROR_RE.search(str(row.get('MESSAGE', ''))) for row in rows))
        if any(re.fullmatch(r'\[info\] GCal events cache refreshed: [0-9]+ event\(s\)',
                            str(row.get('MESSAGE', ''))) for row in rows):
            break
        require(time.monotonic() < deadline)
        time.sleep(5)
    http('https://dextech.cloud/api/availability')
    require(properties() == props)
    return {'sha': sha, 'systemd': 'PASS', 'pid': pid, 'listener': 'PASS',
            'local_http': 200, 'public_http': 200, 'apache': 'PASS',
            'calendar_read': 'PASS', 'application_refresh': 'PASS', 'runtime_logs': 'PASS'}


def backup(path):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    deadline = time.monotonic() + 90

    def progress(*_):
        require(time.monotonic() < deadline)

    source = sqlite3.connect('file:' + str(DB) + '?mode=ro', uri=True, timeout=5)
    target = sqlite3.connect(path)
    try:
        source.execute('PRAGMA query_only=ON')
        source.backup(target, pages=32, progress=progress, sleep=.05)
        target.execute('PRAGMA journal_mode=DELETE')
    finally:
        target.close()
        source.close()
    with tempfile.TemporaryDirectory(prefix='.restore-', dir=path.parent) as tmp:
        source = sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True)
        target = sqlite3.connect(Path(tmp) / 'restored.db')
        try:
            source.backup(target, pages=32, progress=progress, sleep=.05)
            require(target.execute('PRAGMA integrity_check').fetchall() == [('ok',)])
        finally:
            target.close()
            source.close()
    require(not Path(str(path) + '-wal').exists())


def unpack_runtime(archive, dest):
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        files = [member for member in tar.getmembers() if not member.isdir()]
        require(len(files) == len(RUNTIME) and {m.name for m in files} == RUNTIME)
        for member in files:
            require(member.isfile() and member.size < 20 * 1024 * 1024)
            path = dest / member.name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(tar.extractfile(member).read())
            path.chmod(0o644)


def validate_tree(root):
    require(root.is_dir() and not root.is_symlink())
    for path in root.rglob('*'):
        if path.is_symlink():
            require(path.resolve().is_relative_to(root.resolve()) and path.exists())
        else:
            require(path.is_dir() or (path.is_file() and path.stat().st_nlink == 1))


def sanitize_artifact(root):
    # Remove packaging-only content, environment files and generated data even in
    # production dependencies; validate every symlink before publishing as root.
    banned_dirs = {'test', 'tests', '__tests__', 'coverage', '.github', '.git', '.cache'}
    for directory, dirs, files in os.walk(root, topdown=True, followlinks=False):
        base = Path(directory)
        for name in list(dirs):
            path = base / name
            if name in banned_dirs and not path.is_symlink():
                shutil.rmtree(path)
                dirs.remove(name)
        for name in files:
            if (name.startswith('.env') or name in {'credentials.json', 'token.json',
                    'tokens.json', 'bookings.json', 'stripe-products.json'} or
                    re.search(r'\.(pem|key|log|db|sqlite|sqlite3)([-.].*)?$', name) or
                    name.endswith(('-wal', '-shm'))):
                (base / name).unlink()
    for path in [root, *root.rglob('*')]:
        if path.is_symlink():
            require(path.resolve().is_relative_to(root.resolve()) and path.exists())
            os.lchown(path, 0, 0)
        else:
            require(path.is_dir() or path.is_file())
            require(path.stat().st_nlink == 1 or path.is_dir())
            os.chown(path, 0, 0)
            path.chmod(0o755 if path.is_dir() or path.stat().st_mode & 0o111 else 0o644)


def digest(root):
    h = hashlib.sha256()
    for path in sorted(root.rglob('*')):
        h.update(str(path.relative_to(root)).encode() + b'\0')
        h.update(oct(stat.S_IMODE(path.lstat().st_mode)).encode() + b'\0')
        if path.is_symlink():
            h.update(os.readlink(path).encode())
        elif path.is_file():
            h.update(hashlib.sha256(path.read_bytes()).digest())
    return h.hexdigest()


def build(sha, work):
    repo = work / 'repo'
    run(['git', '-c', 'core.hooksPath=/dev/null', 'clone', '--bare', '--depth=1',
         '--branch=main', '--', REPO, str(repo)])
    require(run(['git', '--git-dir=' + str(repo), 'rev-parse', 'refs/heads/main']).strip() == sha)
    archive = run(['git', '--git-dir=' + str(repo), 'archive', '--format=tar', sha,
                   '--', *sorted(RUNTIME)], binary=True)
    artifact = work / 'artifact'
    artifact.mkdir(mode=0o755)
    unpack_runtime(archive, artifact)
    builder = pwd.getpwnam('dextech-build')
    # Only this isolated build subtree is writable by the package installation.
    home = work / 'home'
    home.mkdir()
    for path in [work, *work.rglob('*')]:
        os.chown(path, builder.pw_uid, builder.pw_gid)
    args = sandbox_args('dextech-build-' + str(time.time_ns()), 'dextech-build')
    args += ['-p', 'ReadWritePaths=' + str(work), '-p', 'WorkingDirectory=' + str(artifact),
             '-p', 'InaccessiblePaths=/etc/dextech /var/lib/dextech /var/backups/dextech '
                   '/var/lib/dextech-deploy /var/www/dextech /var/www/dextech-releases',
             '/usr/bin/env', '-i', 'PATH=' + CLEAN_ENV['PATH'], 'HOME=' + str(home),
             'NODE_ENV=production', '/bin/bash', '-ceu',
             'npm ci --omit=dev --no-fund; '
             'npm audit --omit=dev --audit-level=high --json > audit.json; '
             "node -e 'const a=require(\"./audit.json\");const v=a.metadata?.vulnerabilities;"
             "if(!v||v.high!==0||v.critical!==0)process.exit(1)'; "
             'npm ls --omit=dev --all; '
             "node -e 'const D=require(\"better-sqlite3\");const d=new D(\":memory:\");"
             "if(d.pragma(\"integrity_check\",{simple:true})!==\"ok\")process.exit(1);d.close()'; "
             'node --check server.js']
    run(args, timeout=930)
    validate_tree(artifact)
    # systemd --wait + KillMode=control-group closes all builder descendants.
    # Verify tracked runtime bytes remained exact after package lifecycle scripts.
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            if member.isfile():
                require((artifact / member.name).read_bytes() == tar.extractfile(member).read())
    validate_tree(artifact)
    (artifact / 'audit.json').unlink()
    require({str(p.relative_to(artifact)) for p in artifact.rglob('*')
             if not p.is_dir() and p.relative_to(artifact).parts[0] != 'node_modules'} == RUNTIME)
    sanitize_artifact(artifact)
    return artifact


def retain():
    # Only this automation's manifest-owned objects qualify. Legacy material is
    # never swept. Keep latest five records plus any active/previous references.
    records = sorted(EVIDENCE.glob('????????T??????Z-*.json'), reverse=True)
    protected = {CURRENT.resolve().name}
    for path in records[:5]:
        data = json.loads(path.read_text())
        protected.update([data['sha'], data['previous']])
    for path in records[5:]:
        data = json.loads(path.read_text())
        # Keep the ownership record until its protected release can be removed.
        if data['sha'] in protected:
            continue
        # Delete only releases explicitly created by this automation, not legacy.
        if (data.get('created_release') and SHA_RE.fullmatch(data['sha'])
                and data['sha'] not in protected):
            release = RELEASES / data['sha']
            if release.is_dir() and not release.is_symlink():
                shutil.rmtree(release)
        backup_path = BACKUPS / (path.stem + '.db')
        backup_path.unlink(missing_ok=True)
        path.unlink()


def transaction(sha, previous, old_env, record, state, snapshot, others):
    # Persist rollback intent before either half of the release switch. SIGTERM,
    # SIGHUP and SIGINT enter this handler; sudden power loss requires operator
    # recovery using the durable intent (never an automatic database restore).
    state['outcome'] = 'switching'
    atomic_bytes(record, json.dumps(state, indent=2).encode())
    try:
        switch(RELEASES / sha, ('APP_RELEASE_SHA=' + sha + '\n').encode())
        run(['systemctl', 'restart', 'dextech.service'])
        state['acceptance'] = gates(sha, since=state['gate_since'])
        verify_protected(snapshot)
        require([properties(u) for u in ['apache2.service', 'pm2-root.service']] == others)
        state['outcome'] = 'succeeded'
    except BaseException:
        # A second normal termination signal must not interrupt rollback.
        for sig in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]:
            signal.signal(sig, signal.SIG_IGN)
        state['outcome'] = 'rolling-back'
        try:
            atomic_bytes(record, json.dumps(state, indent=2).encode())
        except Exception:
            pass  # Evidence-storage failure must never prevent rollback.
        try:
            switch(previous, old_env)
            rollback_since = int(time.time())
            run(['systemctl', 'restart', 'dextech.service'])
            state['rollback'] = gates(previous.name, since=rollback_since)
            verify_protected(snapshot)
            require([properties(u) for u in ['apache2.service', 'pm2-root.service']] == others)
            state['outcome'] = 'rolled-back'
        except BaseException:
            state['outcome'] = 'rollback-needs-operator'
        atomic_bytes(record, json.dumps(state, indent=2).encode())
        raise RuntimeError('deployment failed') from None
    atomic_bytes(record, json.dumps(state, indent=2).encode())


def main(argv):
    require(os.geteuid() == 0 and len(argv) == 2)
    mode, sha = argv
    require(mode in {'deploy', '--validate'} and SHA_RE.fullmatch(sha))
    os.umask(0o077)
    # Existing lock inode, no truncation. No production writes in validate mode.
    with (BASE / 'deploy.lock').open('r') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(main_sha() == sha)
        previous = CURRENT.resolve(strict=True)
        require(previous.parent == RELEASES and SHA_RE.fullmatch(previous.name))
        require(PROTECTED.stat().st_uid == 0 and stat.S_IMODE(PROTECTED.stat().st_mode) == 0o600)
        snapshot = protected_snapshot()
        old_env = ENVFILE.read_bytes()
        require(old_env == ('APP_RELEASE_SHA=' + previous.name + '\n').encode())
        others = [properties(u) for u in ['apache2.service', 'pm2-root.service']]
        health = gates(previous.name, since=int(time.time()))
        verify_protected(snapshot)
        if mode == '--validate' or sha == previous.name:
            require([properties(u) for u in ['apache2.service', 'pm2-root.service']] == others)
            print(json.dumps({'mode': mode, 'result': 'PASS', 'active': previous.name,
                              'idempotent': sha == previous.name, 'health': health}))
            return
        # Admission limit bounds failed attempts too; no automatic failure pruning.
        require(len(list(EVIDENCE.glob('????????T??????Z-*.json'))) < 20)
        require(shutil.disk_usage(RELEASES).free > 2 * 1024**3)
        # Never reuse or overwrite an unverified candidate from a prior attempt.
        require(not (RELEASES / sha).exists())
        tag = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + sha
        record = EVIDENCE / (tag + '.json')
        require(not record.exists())
        state = {'sha': sha, 'previous': previous.name, 'outcome': 'preparing',
                 'created_release': False, 'backup': str(BACKUPS / (tag + '.db'))}
        atomic_bytes(record, json.dumps(state, indent=2).encode())
        with tempfile.TemporaryDirectory(prefix='build-', dir=BUILD) as temp:
            artifact = build(sha, Path(temp))
            state['artifact_sha256'] = digest(artifact)
            os.rename(artifact, RELEASES / sha)
            state['created_release'] = True
            atomic_bytes(record, json.dumps(state, indent=2).encode())
        backup(BACKUPS / (tag + '.db'))
        state['backup_restore_integrity'] = 'PASS'
        require(main_sha() == sha)  # Recheck immediately before the switch.
        verify_protected(snapshot)
        require(CURRENT.resolve() == previous and ENVFILE.read_bytes() == old_env)
        state['gate_since'] = int(time.time())
        transaction(sha, previous, old_env, record, state, snapshot, others)
        retain()
        print('Deployment accepted: ' + sha)


def interrupted(_signum, _frame):
    raise RuntimeError('interrupted')


if __name__ == '__main__':
    for sig in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]:
        signal.signal(sig, interrupted)
    try:
        main(sys.argv[1:])
    except BaseException:
        print('Deployment failed; consult root-only deployment evidence.', file=sys.stderr)
        sys.exit(1)
