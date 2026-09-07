const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../.github/workflows/deploy-production.yml'), 'utf8');
// Inspect the checked-in contract; actionlint separately validates full YAML syntax.
const checks = source.split('\n  checks:\n')[1].split('\n  deploy:\n')[0];
const deploy = source.split('\n  deploy:\n')[1];
const transport = deploy.split('      - name: Deploy exact checked main commit with OpenSSH\n')[1];
const run = transport.split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
const sha = 'a'.repeat(40);
const publicAddress = '192.0.2.1'; // Documentation-only address; tests never connect.

function simulate(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dextech-workflow-'));
  const bin = path.join(root, 'bin');
  const record = path.join(root, 'calls.jsonl');
  fs.mkdirSync(bin);
  const mock = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const row = { name, args };
if (name === 'ssh') {
  const key = args[args.indexOf('-i') + 1];
  const known = args.find(arg => arg.startsWith('UserKnownHostsFile=')).split('=')[1];
  row.keyMode = fs.statSync(key).mode & 0o777;
  row.knownMode = fs.statSync(known).mode & 0o777;
  row.inheritedSecrets = ['DEPLOY_KEY', 'KNOWN_HOSTS'].some(k => k in process.env);
}
fs.appendFileSync(process.env.MOCK_RECORD, JSON.stringify(row) + '\\n');
if (name === 'git') process.stdout.write(process.env.REMOTE_SHA + '\\trefs/heads/main\\n');
if (name === 'ssh') {
  // Simulate diagnostics that must never escape into runner output.
  process.stdout.write('synthetic-sensitive-stdout');
  process.stderr.write('synthetic-sensitive-stderr');
  process.exit(Number(process.env.SSH_EXIT || 0));
}
`;
  for (const name of ['git', 'ssh-keygen', 'ssh']) {
    fs.writeFileSync(path.join(bin, name), mock, { mode: 0o700 });
  }
  try {
    const result = spawnSync('bash', ['--noprofile', '--norc', '-c', run], {
      encoding: 'utf8', timeout: 10000,
      // No inherited credentials, Git config or integration environment.
      env: {
        PATH: `${bin}:/usr/bin:/bin`, RUNNER_TEMP: root,
        EXPECTED_SHA: sha, REMOTE_SHA: sha,
        DEPLOY_HOST: '100.109.72.10', DEPLOY_PORT: '22', DEPLOY_USER: 'dextech-deploy',
        DEPLOY_KEY: 'synthetic-private-key-placeholder', KNOWN_HOSTS: 'synthetic-known-host-placeholder',
        MOCK_RECORD: record, ...overrides,
      },
    });
    assert.ifError(result.error);
    const calls = fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n').map(JSON.parse) : [];
    assert.deepEqual(fs.readdirSync(root).filter(name => name.startsWith('dextech-ssh.')), [], 'SSH files must be cleaned up');
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-(?:private|known|sensitive)/, 'synthetic secrets/output must remain suppressed');
    return { ...result, calls };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('every main push and manual dispatch share the protected deployment path without path filters', () => {
  assert.equal(source.split('\non:\n')[1].split('\npermissions:')[0],
    '  push:\n    branches: [main]\n  workflow_dispatch:\n');
  assert.doesNotMatch(source, /^\s*(?:paths|paths-ignore|branches-ignore):/m);
  assert.match(source, /\npermissions:\n  contents: read\n/);
  assert.match(source, /group: dextech-production\n  cancel-in-progress: false/);
  const guard = "if: github.repository == 'dexsword/dextech' && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')";
  for (const job of [checks, deploy]) assert.ok(job.includes(guard));
  assert.match(deploy, /needs: checks/);
  assert.match(deploy, /environment: production/);
  assert.doesNotMatch(source, /continue-on-error:|if:.*always\(/);
  assert.match(checks, /ref: \$\{\{ github.sha \}\}/);
  assert.match(checks, /persist-credentials: false/);
  assert.match(checks, /node-version: '22'/);
  assert.match(checks, /bash scripts\/deployment-checks.sh/);
  assert.match(checks, /npm audit --omit=dev --audit-level=high/);
  assert.match(checks, /v.high !== 0 \|\| v.critical !== 0/);
  assert.match(checks, /git ls-remote https:\/\/github.com\/dexsword\/dextech.git refs\/heads\/main/);
});

test('both job guards accept only approved events on the canonical repository main ref', () => {
  for (const job of [checks, deploy]) {
    const expression = job.match(/^    if: (.+)$/m)[1];
    for (const repository of ['dexsword/dextech', 'someone/dextech']) {
      for (const ref of ['refs/heads/main', 'refs/heads/feature', 'refs/tags/main', 'refs/pull/1/merge']) {
        for (const event_name of ['push', 'workflow_dispatch', 'pull_request', 'pull_request_target',
          'workflow_run', 'repository_dispatch', 'schedule']) {
          const github = { repository, ref, event_name };
          const expected = repository === 'dexsword/dextech' && ref === 'refs/heads/main' &&
            ['push', 'workflow_dispatch'].includes(event_name);
          // These equality/boolean expressions have the same semantics in this
          // synthetic matrix; no workflow, network or deployment is executed.
          assert.equal(runInNewContext(expression, { github }, { timeout: 100 }), expected,
            JSON.stringify(github));
        }
      }
    }
  }
});

test('only deploy receives OIDC permission and joins the single tagged ephemeral peer before SSH', () => {
  assert.equal((source.match(/id-token: write/g) || []).length, 1);
  assert.doesNotMatch(checks, /id-token:|secrets\./);
  assert.match(deploy, /permissions:\n      contents: read\n      id-token: write/);
  const join = deploy.split('      - name: Connect ephemeral runner to Tailscale\n')[1].split('      - name: Deploy exact')[0];
  assert.match(join, /uses: tailscale\/github-action@780049a30b6ff5c378a9e7b389d15ece7a204888 # v4\.1\.3/);
  assert.match(join, /oauth-client-id: \$\{\{ secrets.TS_OAUTH_CLIENT_ID \}\}/);
  assert.match(join, /audience: \$\{\{ secrets.TS_AUDIENCE \}\}/);
  assert.match(join, /tags: tag:github-dextech\n/);
  assert.match(join, /ping: 100\.109\.72\.10\n/);
  assert.match(join, /use-cache: 'false'/);
  assert.match(join, /args: --accept-dns=false\n/);
  assert.doesNotMatch(join, /DEXSERVE_SSH_PRIVATE_KEY|DEXSERVE_KNOWN_HOSTS/);
  assert.doesNotMatch(deploy, /oauth-secret:|authkey:|statedir:|actions\/checkout|upload-artifact/);
  const actions = [...source.matchAll(/uses: (\S+)/g)].map(match => match[1]);
  assert.ok(actions.every(action => /@[0-9a-f]{40}$/.test(action)), 'all actions must be immutable');
  assert.equal(actions.filter(action => action.startsWith('tailscale/')).length, 1);
});

test('SSH only accepts the exact tailnet endpoint, restricted user and lowercase full SHA', () => {
  for (const overrides of [
    { DEPLOY_HOST: publicAddress }, { DEPLOY_HOST: 'dexserve.example.invalid' },
    { DEPLOY_HOST: '100.109.72.11' }, { DEPLOY_HOST: '' },
    { DEPLOY_PORT: '2222' }, { DEPLOY_PORT: '022' }, { DEPLOY_USER: 'root' },
    { EXPECTED_SHA: 'main' }, { EXPECTED_SHA: 'A'.repeat(40) }, { EXPECTED_SHA: `${sha};id` },
  ]) {
    const result = simulate(overrides);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, [], 'reject invalid configuration before Git, keys or SSH');
  }
});

test('SSH retains pinned host verification, private files and exact-main deployment command', () => {
  const result = simulate();
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls.map(call => call.name), ['git', 'ssh-keygen', 'ssh']);
  assert.deepEqual(result.calls[0].args, ['ls-remote', 'https://github.com/dexsword/dextech.git', 'refs/heads/main']);
  const ssh = result.calls[2];
  assert.equal(ssh.keyMode, 0o600);
  assert.equal(ssh.knownMode, 0o600);
  assert.equal(ssh.inheritedSecrets, false);
  for (const option of ['StrictHostKeyChecking=yes', 'GlobalKnownHostsFile=/dev/null',
    'HostKeyAlgorithms=ssh-ed25519', 'BatchMode=yes', 'IdentitiesOnly=yes', 'IdentityAgent=none',
    'PasswordAuthentication=no', 'KbdInteractiveAuthentication=no', 'ForwardAgent=no',
    'ClearAllForwardings=yes', 'RequestTTY=no']) assert.ok(ssh.args.includes(option));
  assert.equal(ssh.args[ssh.args.indexOf('-B') + 1], 'tailscale0');
  assert.deepEqual(ssh.args.slice(-2), ['dextech-deploy@100.109.72.10', `deploy ${sha}`]);
});

test('main advancement, missing secrets and SSH failure cannot report deployment success', () => {
  const moved = simulate({ REMOTE_SHA: 'b'.repeat(40) });
  assert.notEqual(moved.status, 0);
  assert.deepEqual(moved.calls.map(call => call.name), ['git']);
  for (const overrides of [{ DEPLOY_KEY: '' }, { KNOWN_HOSTS: '' }]) {
    const missing = simulate(overrides);
    assert.notEqual(missing.status, 0);
    assert.deepEqual(missing.calls, []);
  }
  const failed = simulate({ SSH_EXIT: '255' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stdout, /Deployment transport failed; details suppressed\./);
  assert.doesNotMatch(failed.stdout, /acceptance gates passed/);
});
