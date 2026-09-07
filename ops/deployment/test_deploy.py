"""Offline tests: no live service, release, credentials or production DB mutations."""
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


d = load('deploy', 'deploy.py')
s = load('ssh_entry', 'ssh-entry.py')
SHA = 'a' * 40
OLD = 'b' * 40


class Controls(unittest.TestCase):
    def test_forced_command(self):
        self.assertEqual(s.parse(['-c', s.ENTRY], 'deploy ' + SHA), SHA)
        for bad in ['', 'bash', 'deploy', 'deploy main', 'deploy ' + 'A' * 40,
                    'deploy ' + 'a' * 39, 'deploy ' + 'a' * 41, ' deploy ' + SHA,
                    'deploy  ' + SHA, 'deploy\t' + SHA, 'deploy ' + SHA + '\n',
                    'deploy ' + SHA + ';id', 'deploy ' + SHA + ' extra',
                    'ENV=x deploy ' + SHA, 'deploy $(id)', '--validate ' + SHA,
                    'deploy ' + SHA + '\x00']:
            with self.subTest(command=bad), self.assertRaises(ValueError):
                s.parse(['-c', s.ENTRY], bad)
        for args in [[], ['-i'], ['-c', 'id'], ['-c', s.ENTRY, 'extra']]:
            with self.assertRaises(ValueError):
                s.parse(args, 'deploy ' + SHA)

    def test_archive_rejects_links_and_extra_members(self):
        for filename, kind in [('server.js', tarfile.SYMTYPE),
                               ('../escape', tarfile.REGTYPE)]:
            with tempfile.TemporaryDirectory() as tmp:
                stream = io.BytesIO()
                with tarfile.open(fileobj=stream, mode='w') as tar:
                    m = tarfile.TarInfo(filename)
                    m.type = kind
                    m.linkname = '/etc/passwd'
                    tar.addfile(m)
                with self.assertRaises(RuntimeError):
                    d.unpack_runtime(stream.getvalue(), Path(tmp))

    def test_external_symlinks_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'external').symlink_to('/etc')
            with self.assertRaises(RuntimeError):
                d.validate_tree(root)

    def test_sqlite_online_backup_and_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source.db'
            db = sqlite3.connect(source)
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE example (value TEXT)')
            db.execute("INSERT INTO example VALUES ('synthetic')")
            db.commit()
            with patch.object(d, 'DB', source):
                d.backup(root / 'backup.db')
            check = sqlite3.connect(root / 'backup.db')
            self.assertEqual(check.execute('SELECT value FROM example').fetchall(), [('synthetic',)])
            check.close()
            self.assertEqual(db.execute('SELECT value FROM example').fetchall(), [('synthetic',)])
            db.close()

    def test_postswitch_failure_restores_previous_without_db_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            record = Path(tmp) / 'record.json'
            state = {'gate_since': 0}
            with patch.object(d, 'switch') as switch, patch.object(d, 'run') as run, \
                    patch.object(d, 'gates', side_effect=[RuntimeError(), {'result': 'PASS'}]), \
                    patch.object(d, 'verify_protected'), patch.object(d, 'properties', return_value={}), \
                    patch.object(d.signal, 'signal'):
                with self.assertRaises(RuntimeError):
                    d.transaction(SHA, d.RELEASES / OLD, b'old', record, state, [], [{}, {}])
                self.assertEqual(switch.call_args_list[-1].args, (d.RELEASES / OLD, b'old'))
                self.assertEqual(run.call_count, 2)
                self.assertTrue(all(c.args == (['systemctl', 'restart', 'dextech.service'],)
                                    for c in run.call_args_list))
                self.assertEqual(json.loads(record.read_text())['outcome'], 'rolled-back')

    def test_switch_failure_still_rolls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            record = Path(tmp) / 'record.json'
            with patch.object(d, 'switch', side_effect=[RuntimeError(), None]), \
                    patch.object(d, 'run'), patch.object(d, 'gates', return_value={}), \
                    patch.object(d, 'verify_protected'), patch.object(d, 'properties', return_value={}), \
                    patch.object(d.signal, 'signal'):
                with self.assertRaises(RuntimeError):
                    d.transaction(SHA, d.RELEASES / OLD, b'old', record,
                                  {'gate_since': 0}, [], [{}, {}])
                self.assertEqual(json.loads(record.read_text())['outcome'], 'rolled-back')

    def test_evidence_failure_cannot_prevent_rollback(self):
        with tempfile.TemporaryDirectory() as tmp:
            record = Path(tmp) / 'record.json'
            writer = d.atomic_bytes
            calls = 0

            def flaky_write(path, data):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError('synthetic disk failure')
                writer(path, data)

            with patch.object(d, 'switch') as switch, patch.object(d, 'run'), \
                    patch.object(d, 'gates', side_effect=[RuntimeError(), {}]), \
                    patch.object(d, 'verify_protected'), patch.object(d, 'properties', return_value={}), \
                    patch.object(d, 'atomic_bytes', side_effect=flaky_write), \
                    patch.object(d.signal, 'signal'):
                with self.assertRaises(RuntimeError):
                    d.transaction(SHA, d.RELEASES / OLD, b'old', record,
                                  {'gate_since': 0}, [], [{}, {}])
                self.assertEqual(switch.call_args_list[-1].args, (d.RELEASES / OLD, b'old'))
                self.assertEqual(json.loads(record.read_text())['outcome'], 'rolled-back')

    def test_retention_keeps_ownership_until_release_unprotected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            evidence = root / 'evidence'
            releases = root / 'releases'
            backups = root / 'backups'
            for path in [evidence, releases, backups]:
                path.mkdir()
            shas = [format(i, '040x') for i in range(1, 9)]
            for i, sha in enumerate(shas):
                (releases / sha).mkdir()
                tag = f'2026010{i + 1}T000000Z-{sha}'
                (evidence / (tag + '.json')).write_text(json.dumps({
                    'sha': sha, 'previous': shas[max(0, i - 1)], 'created_release': True}))
                (backups / (tag + '.db')).touch()
            current = releases / 'current'
            current.symlink_to(shas[-1])
            with patch.object(d, 'EVIDENCE', evidence), patch.object(d, 'RELEASES', releases), \
                    patch.object(d, 'BACKUPS', backups), patch.object(d, 'CURRENT', current):
                d.retain()
                self.assertEqual(len(list(evidence.glob('*.json'))), 6)
                self.assertTrue((releases / shas[2]).exists())
                self.assertFalse((releases / shas[1]).exists())
                self.assertTrue(list(evidence.glob('*-' + shas[2] + '.json')))

    def test_idempotent_and_validation_never_mutate(self):
        for mode, sha in [('deploy', OLD), ('--validate', SHA)]:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / 'deploy.lock').touch()
                current = root / 'current'
                release = root / OLD
                release.mkdir()
                current.symlink_to(release)
                env = root / 'release.env'
                env.write_text('APP_RELEASE_SHA=' + OLD + '\n')
                secret = root / 'production.env'
                secret.touch(mode=0o600)
                with patch.object(d, 'BASE', root), patch.object(d, 'RELEASES', root), \
                        patch.object(d, 'CURRENT', current), patch.object(d, 'ENVFILE', env), \
                        patch.object(d, 'PROTECTED', secret), patch.object(d, 'main_sha', return_value=sha), \
                        patch.object(d, 'protected_snapshot', return_value=[]), \
                        patch.object(d, 'verify_protected'), patch.object(d, 'properties', return_value={}), \
                        patch.object(d, 'gates', return_value={}), patch.object(d, 'build') as build, \
                        patch.object(d, 'backup') as backup, patch.object(d, 'transaction') as tx, \
                        patch.object(d, 'retain') as retain:
                    d.main([mode, sha])
                    for mock in [build, backup, tx, retain]:
                        mock.assert_not_called()


if __name__ == '__main__':
    unittest.main()
