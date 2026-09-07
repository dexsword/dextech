const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const nodemailer = require('nodemailer');

function memoryTransport(options = {}) {
  // Compile synthetic mail in memory: no SMTP connection or real delivery.
  return nodemailer.createTransport({ streamTransport: true, buffer: true, ...options });
}

test('Nodemailer composes text, HTML and calendar attachments without delivery', async () => {
  const result = await memoryTransport().sendMail({
    from: 'sender@example.invalid',
    to: 'recipient@example.invalid',
    subject: 'Synthetic compatibility check',
    text: 'Synthetic confirmation',
    html: '<p>Synthetic confirmation</p>',
    attachments: [{
      filename: 'appointment.ics',
      content: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR',
      contentType: 'text/calendar',
    }],
  });
  assert.ok(Buffer.isBuffer(result.message));
  const message = result.message.toString();
  assert.match(message, /Content-Type: multipart\/mixed/);
  assert.match(message, /Content-Type: text\/plain/);
  assert.match(message, /Content-Type: text\/html/);
  assert.match(message, /Content-Type: text\/calendar/);
  assert.match(message, /appointment\.ics/);
});

test('Nodemailer rejects raw file access when disabled', async () => {
  await assert.rejects(
    memoryTransport({ disableFileAccess: true }).sendMail({
      raw: { path: 'must-not-be-opened.txt' },
    }),
    /File access rejected/
  );
});

test('Nodemailer rejects raw URL access when disabled', async () => {
  await assert.rejects(
    memoryTransport({ disableUrlAccess: true }).sendMail({
      raw: { href: 'https://must-not-be-requested.invalid/message' },
    }),
    /Url access rejected/
  );
});

test('the rate limiter resolves an IP parser that rejects ambiguous leading zeroes', () => {
  const limiterDirectory = path.dirname(require.resolve('express-rate-limit'));
  const { Address4 } = require(require.resolve('ip-address', { paths: [limiterDirectory] }));
  assert.equal(Address4.isValid('10.0.0.1'), true);
  assert.equal(Address4.isValid('012.0.0.1'), false);
  assert.throws(() => new Address4('012.0.0.1'));
});
