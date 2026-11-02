const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');

async function startServer(t, overrides = {}, files = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dextech-test-'));
  fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(directory, 'server.js'));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
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
  return { address, health: await response.json(), child };
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

const inquiry = { name: 'Test Visitor', method: 'email', contact: 'test@example.invalid', message: 'Synthetic inquiry about a slow computer', website: '' };
async function postInquiry(address, data) {
  return fetch(`http://${address.address}:${address.port}/api/inquiries`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
}
const fakeMail = {
  NODE_OPTIONS: `--require=${path.join(__dirname, 'inquiry-mail-stub.cjs')}`,
  SMTP_HOST: 'success.invalid', SMTP_USER: 'synthetic', SMTP_PASS: 'synthetic',
};

test('quote requests validate input and fail honestly when email is unavailable', async t => {
  const { address } = await startServer(t);
  for (const data of [null, { ...inquiry, contact: 'bad' }, { ...inquiry, message: 'short' }, { ...inquiry, method: 'sms' }]) {
    assert.equal((await postInquiry(address, data)).status, data === null ? 400 : 422);
  }
  assert.equal((await postInquiry(address, inquiry)).status, 503);
});

test('quote mail accepts email and phone inquiries without creating bookings', async t => {
  const { address } = await startServer(t, fakeMail);
  for (const data of [inquiry, { ...inquiry, method: 'phone', contact: '(555) 555-0100' }]) {
    const response = await postInquiry(address, data);
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { success: true });
  }
  const health = await fetch(`http://${address.address}:${address.port}/health`).then(r => r.json());
  assert.equal(health.confirmed_bookings, 0);
});

for (const host of ['reject.invalid', 'unaccepted.invalid']) {
  test(`quote transport ${host} never reports success`, async t => {
    const { address } = await startServer(t, { ...fakeMail, SMTP_HOST: host });
    assert.equal((await postInquiry(address, inquiry)).status, 503);
  });
}

test('quote requests reject header injection and honeypot, and enforce rate limit', async t => {
  const { address } = await startServer(t, fakeMail);
  assert.equal((await postInquiry(address, { ...inquiry, contact: 'test@example.invalid\r\nBcc: x@example.invalid' })).status, 422);
  assert.equal((await postInquiry(address, { ...inquiry, website: 'spam.invalid' })).status, 400);
  for (let i = 0; i < 3; i++) assert.equal((await postInquiry(address, inquiry)).status, 201);
  assert.equal((await postInquiry(address, inquiry)).status, 429);
});

test('alternate homepage redirects retain queries and utility responses carry noindex', async t => {
  const { address } = await startServer(t);
  const base = `http://${address.address}:${address.port}`;
  const response = await fetch(`${base}/index.html?ref=local`, { redirect: 'manual' });
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://dextech.cloud/?ref=local');
  for (const route of ['/admin', '/cancel', '/admin.html', '/cancel.html']) {
    const utility = await fetch(base + route);
    assert.match(utility.headers.get('x-robots-tag'), /noindex/);
  }
});


test('backend files cannot be downloaded through static middleware', async t => {
  const { address } = await startServer(t);
  const base = `http://${address.address}:${address.port}`;
  for (const file of ['/server.js', '/package.json', '/package-lock.json', '/node_modules/express/package.json']) {
    const response = await fetch(base + file);
    assert.equal(response.status, 404, file);
  }
});

test('only the allowlisted dot-directory verification file is public', async t => {
  const { address } = await startServer(t, {}, {
    '.well-known/brave-rewards-verification.txt': 'synthetic verification',
    '.well-known/private.txt': 'synthetic private fixture',
    '.env': 'synthetic private fixture',
  });
  const base = `http://${address.address}:${address.port}`;
  const response = await fetch(base + '/.well-known/brave-rewards-verification.txt');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'synthetic verification');
  for (const file of ['/.env', '/.well-known/private.txt']) {
    assert.equal((await fetch(base + file)).status, 404, file);
  }
});

test('compressed JSON is rejected without decoding and the service stays healthy', async t => {
  const { brotliCompressSync } = require('node:zlib');
  const { address } = await startServer(t);
  const base = `http://${address.address}:${address.port}`;
  const response = await fetch(base + '/api/inquiries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'br' },
    body: brotliCompressSync(Buffer.from('{}')),
  });
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: 'Compressed request bodies are not supported' });
  assert.equal((await fetch(base + '/health')).status, 200);
});

test('booking persists, composes its confirmation, rejects duplicates and frees a cancelled slot', async t => {
  const token = 'synthetic-admin-token';
  const { address, child } = await startServer(t, {
    ADMIN_TOKEN: token,
    NODE_OPTIONS: `--require=${path.join(__dirname, 'booking-mail-stub.cjs')}`,
    SMTP_HOST: 'memory.invalid', SMTP_USER: 'synthetic', SMTP_PASS: 'synthetic',
  });
  const base = `http://${address.address}:${address.port}`;
  const availability = await fetch(base + '/api/availability').then(r => r.json());
  const [date, hours] = Object.entries(availability)[1];
  const booking = {
    name: 'Synthetic Customer', email: 'booking@example.invalid', phone: '5555550100',
    date, hour: hours[0], service: 'Consultation', notes: 'Synthetic isolated booking',
  };
  const mail = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Confirmation composition timed out')), 5000);
    child.once('message', message => { clearTimeout(timer); resolve(message); });
  });
  const post = (route, data) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const response = await post('/api/bookings', booking);
  assert.equal(response.status, 201);
  const { bookingId } = await response.json();
  assert.deepEqual(await mail, { type: 'booking-mail', composed: true });
  assert.equal((await post('/api/bookings', booking)).status, 409);
  assert.equal((await fetch(base + '/api/bookings')).status, 401);
  const rows = await fetch(base + '/api/bookings', {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, bookingId);
  assert.equal(rows[0].status, 'confirmed');
  const occupied = await fetch(base + '/api/availability/' + date).then(r => r.json());
  assert.ok(!occupied.available.includes(booking.hour));
  assert.equal((await post(`/api/bookings/${bookingId}/cancel-customer`, {
    email: booking.email,
  })).status, 200);
  const freed = await fetch(base + '/api/availability/' + date).then(r => r.json());
  assert.ok(freed.available.includes(booking.hour));
  assert.equal((await fetch(base + '/health').then(r => r.json())).confirmed_bookings, 0);
});

function futureBusinessDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function syntheticBooking(date, hour = 9) {
  return { name: 'Synthetic Customer', email: 'booking@example.invalid', phone: '5555550100', date, hour, service: 'Consultation', notes: '' };
}
function calendarEnv(date, scenario) {
  return {
    NODE_OPTIONS: `--require=${path.join(__dirname, 'calendar-stub.cjs')}`,
    GOOGLE_CLIENT_ID: 'synthetic', GOOGLE_CLIENT_SECRET: 'synthetic', GOOGLE_REFRESH_TOKEN: 'synthetic',
    CALENDAR_TEST_DATE: date, CALENDAR_SCENARIO: scenario,
  };
}
async function postBooking(address, data) {
  return fetch(`http://${address.address}:${address.port}/api/bookings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
}

test('direct booking checks the external calendar before persisting a reservation', async t => {
  const date = futureBusinessDate();
  const { address } = await startServer(t, calendarEnv(date, 'busy'));
  assert.equal((await postBooking(address, syntheticBooking(date))).status, 409);
  const health = await fetch(`http://${address.address}:${address.port}/health`).then(r => r.json());
  assert.equal(health.confirmed_bookings, 0);
});

test('Google read failure closes availability and booking without creating data', async t => {
  const date = futureBusinessDate();
  const { address } = await startServer(t, calendarEnv(date, 'failure'));
  const base = `http://${address.address}:${address.port}`;
  assert.equal((await fetch(base + '/api/availability')).status, 503);
  assert.equal((await fetch(base + '/api/availability/' + date)).status, 503);
  assert.equal((await postBooking(address, syntheticBooking(date))).status, 503);
  assert.equal((await fetch(base + '/health').then(r => r.json())).confirmed_bookings, 0);
});

test('calendar pagination and all-day events block slots, transparent events do not', async t => {
  const date = futureBusinessDate();
  for (const scenario of ['paged', 'all-day', 'transparent']) {
    const { address } = await startServer(t, calendarEnv(date, scenario));
    const { available } = await fetch(`http://${address.address}:${address.port}/api/availability/${date}`).then(r => r.json());
    if (scenario === 'all-day') assert.equal(available.length, 0);
    else assert.equal(available.includes(9), scenario === 'transparent');
  }
});

test('closed and impossible dates cannot advertise times', async t => {
  const { address } = await startServer(t);
  const base = `http://${address.address}:${address.port}`;
  for (const date of ['2000-01-01', '2026-11-01', '2099-01-01']) {
    const response = await fetch(base + '/api/availability/' + date);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).available, []);
  }
  for (const date of ['2026-02-30', '2026-13-01']) {
    assert.equal((await fetch(base + '/api/availability/' + date)).status, 400);
  }
});

test('malformed booking field types and partial hours return validation errors', async t => {
  const { address } = await startServer(t);
  const valid = syntheticBooking(futureBusinessDate());
  for (const change of [{ email: {} }, { phone: {} }, { service: {} }, { notes: {} }, { hour: '9oops' }, { hour: 9.5 }, { phone: '-------' }]) {
    assert.equal((await postBooking(address, { ...valid, ...change })).status, 422);
  }
});

test('Pacific appointment conversion and ICS preserve summer, winter and DST boundaries', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function laTimeToUTC('), source.indexOf('function isSlotBlockedByCalendar('))
    + source.slice(source.indexOf('function buildICS('), source.indexOf('async function sendConfirmationEmail(')), context);
  assert.equal(vm.runInContext("laTimeToUTC('2026-03-08', 0).toISOString()", context), '2026-03-08T08:00:00.000Z');
  assert.equal(vm.runInContext("laTimeToUTC('2026-11-01', 0).toISOString()", context), '2026-11-01T07:00:00.000Z');
  for (const [date, start] of [['2026-07-15', '20260715T160000Z'], ['2026-11-04', '20261104T170000Z'], ['2026-03-08', '20260308T160000Z'], ['2026-11-01', '20261101T170000Z']]) {
    context.booking = { ...syntheticBooking(date), id: 'synthetic-id' };
    const ics = vm.runInContext('buildICS(booking)', context);
    assert.ok(ics.includes('DTSTART:' + start), ics);
    assert.ok(ics.includes('DTEND:' + start.replace('0000Z', '3000Z')), ics);
  }
});
