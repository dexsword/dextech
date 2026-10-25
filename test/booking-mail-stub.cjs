// Compile the real booking confirmation in memory; never connect to SMTP.
const Module = require('node:module');
const assert = require('node:assert/strict');
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  const loaded = originalLoad.call(this, request, ...args);
  if (request !== 'nodemailer') return loaded;
  return { createTransport: options => {
    assert.equal(options.disableFileAccess, true);
    assert.equal(options.disableUrlAccess, true);
    const transport = loaded.createTransport({
      streamTransport: true, buffer: true, disableFileAccess: true, disableUrlAccess: true,
    });
    return { sendMail: async mail => {
      assert.equal(mail.to, 'booking@example.invalid');
      assert.match(mail.subject, /Appointment Confirmed/);
      assert.match(mail.html, /Synthetic Customer/);
      assert.match(mail.text, /Synthetic Customer/);
      assert.match(mail.attachments[0].content, /BEGIN:VCALENDAR/);
      const result = await transport.sendMail(mail);
      assert.match(result.message.toString(), /appointment\.ics/);
      process.send({ type: 'booking-mail', composed: true });
      return result;
    } };
  } };
};
