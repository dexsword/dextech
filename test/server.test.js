const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');

async function startServer(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dextech-test-'));
  fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(directory, 'server.js'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  const child = fork(path.join(__dirname, 'server-probe.cjs'), [], {
    cwd: directory,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      PORT: '0',
      DB_PATH: path.join(directory, 'test.db'),
      ...overrides,
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const forceStop = setTimeout(() => child.kill('SIGKILL'), 3000);
      try {
        await exited;
      } finally {
        clearTimeout(forceStop);
      }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Isolated server startup timed out')), 10000);
    child.once('message', message => {
      clearTimeout(timer);
      resolve(message);
    });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Isolated server exited before reporting its listener'));
    });
  });
  const response = await fetch(`http://${address.address}:${address.port}/health`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  return { address, health: await response.json() };
}

test('defaults to loopback and preserves health with integrations disabled', async t => {
  const { address, health } = await startServer(t);
  assert.equal(address.address, '127.0.0.1');
  assert.equal(health.status, 'ok');
  assert.equal(health.release_sha, 'unknown');
  assert.equal(health.email_enabled, false);
  assert.equal(health.gcal_enabled, false);
  assert.equal(health.confirmed_bookings, 0);
  assert.ok(Number.isFinite(Date.parse(health.timestamp)));
  assert.deepEqual(Object.keys(health).sort(), [
    'confirmed_bookings', 'email_enabled', 'gcal_enabled', 'release_sha', 'status', 'timestamp',
  ]);
});

test('honors an explicitly configured HOST', async t => {
  const { address, health } = await startServer(t, { HOST: '127.0.0.2' });
  assert.equal(address.address, '127.0.0.2');
  assert.equal(health.status, 'ok');
});

test('empty HOST retains the loopback default', async t => {
  const { address } = await startServer(t, { HOST: '' });
  assert.equal(address.address, '127.0.0.1');
});

test('health returns a validated, normalized full release SHA', async t => {
  const sha = 'ABCDEF0123'.repeat(4);
  const { health } = await startServer(t, { APP_RELEASE_SHA: sha });
  assert.equal(health.release_sha, sha.toLowerCase());
});

for (const [label, value] of [
  ['empty', ''],
  ['non-SHA', 'do-not-expose-this-value'],
  ['too long', 'a'.repeat(64)],
  ['newline-suffixed', `${'a'.repeat(40)}\n`],
]) {
  test(`health uses unknown for ${label} release identity`, async t => {
    const { health } = await startServer(t, { APP_RELEASE_SHA: value });
    assert.equal(health.release_sha, 'unknown');
  });
}
