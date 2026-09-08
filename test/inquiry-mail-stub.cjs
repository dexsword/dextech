// Loaded only by isolated integration tests. No SMTP connection is opened.
const Module = require('node:module');
const assert = require('node:assert/strict');
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === 'nodemailer') {
    return { createTransport: () => ({ sendMail: async mail => {
      assert.equal(mail.to, 'dextech.me@gmail.com');
      assert.equal(mail.subject, 'New website quote request – Dex Tech');
      assert.ok(mail.text.includes('Synthetic inquiry'));
      assert.equal(mail.html, undefined);
      if (mail.text.includes('Preferred contact: email')) assert.equal(mail.replyTo, 'test@example.invalid');
      else assert.equal(mail.replyTo, undefined);
      if (process.env.SMTP_HOST === 'reject.invalid') throw new Error('Synthetic transport failure');
      if (process.env.SMTP_HOST === 'unaccepted.invalid') return { accepted: [] };
      return { accepted: [mail.to] };
    } }) };
  }
  return originalLoad.call(this, request, ...args);
};
