const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('tracked-file guard rejects runtime/dependency names and permits source files', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dextech-guard-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  // Supply filenames through a fake git executable; create no credential or data fixtures.
  fs.writeFileSync(path.join(directory, 'git'), '#!/bin/bash\nprintf "%s\\0" "$TEST_TRACKED_PATH"\n', { mode: 0o700 });
  const forbidden = [
    '.env', 'nested/.env', '.env.production', 'private.key', 'certificate.pem',
    'bookings.json', 'bookings.json.migrated', 'nested/bookings.json.backup',
    'data.db', 'data.db-wal', 'data.db-shm', 'data.sqlite', 'data.sqlite3',
    'data.sqlite3-wal', 'data-wal', 'data-shm', 'stripe-products.json',
    'credentials.json', 'google-credentials.json', 'token.json', 'tokens.json',
    'server.log', 'node_modules/a.js', 'nested/node_modules/a.js',
  ];
  const allowed = ['.env.example', 'nested/.env.example', 'server.js', 'package-lock.json', 'test/server.test.js'];
  for (const filename of [...forbidden, ...allowed]) {
    const result = spawnSync('bash', [path.join(__dirname, '../scripts/check-tracked-files.sh')], {
      env: { PATH: `${directory}:${process.env.PATH}`, TEST_TRACKED_PATH: filename },
      encoding: 'utf8',
    });
    assert.equal(result.status, forbidden.includes(filename) ? 1 : 0, filename);
  }
});
