const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

test('existing support-page UI suite passes without network access', async t => {
  const root = path.resolve(__dirname, '..');
  const errors = [];
  const console = new VirtualConsole();
  console.on('error', message => errors.push(String(message).startsWith('FAIL:') ? message : 'Browser test error'));
  console.on('jsdomError', () => errors.push('Browser script error'));
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'support.html'), 'utf8'), {
    url: 'https://dextech.invalid/support.html',
    runScripts: 'dangerously',
    // External resources are disabled; load only the two local scripts below.
    virtualConsole: console,
    beforeParse(window) {
      window.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    },
  });
  t.after(() => dom.window.close());
  dom.window.eval(fs.readFileSync(path.join(root, 'script.js'), 'utf8'));
  const suite = fs.readFileSync(path.join(root, 'tests.js'), 'utf8');
  dom.window.eval(`${suite}\nwindow.getUiTestResults = () => ({ total: totalTests, passed: passedTests });`);
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  await dom.window.runAllTests();
  const result = dom.window.getUiTestResults();
  assert.deepEqual(errors, []);
  assert.ok(result.total > 0, 'Existing suite must execute assertions');
  assert.equal(result.passed, result.total);
});

test('homepage booking anchors and cancel route stay wired in index.html', () => {
  const root = path.resolve(__dirname, '..');
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    url: 'https://dextech.invalid/',
  });
  const { document } = dom.window;
  try {
    const logo = document.querySelector('header a.logo');
    assert.ok(logo, 'Homepage logo must exist');
    assert.equal(logo.getAttribute('href'), '#home');

    const booking = document.getElementById('booking');
    const widget = document.getElementById('bookingWidget');
    assert.ok(booking, 'Booking target id="booking" must exist');
    assert.ok(widget, 'Booking widget must exist');
    assert.ok(booking.contains(widget), 'id="booking" must wrap the booking widget');

    const supportNav = document.querySelector('nav[aria-label="Support navigation"]');
    assert.ok(supportNav, 'Support footer nav must exist');
    const cancelLink = Array.from(supportNav.querySelectorAll('a')).find(anchor => (
      anchor.getAttribute('href') === '/cancel' || /cancel/i.test(anchor.textContent)
    ));
    assert.ok(cancelLink, 'Support footer must include a cancel entry');
    assert.equal(cancelLink.getAttribute('href'), '/cancel');
    assert.equal(document.querySelectorAll('a[href="cancel.html"]').length, 0);
  } finally {
    dom.window.close();
  }
});

test('support.html footer includes privacy, terms, and Express cancel route', () => {
  const root = path.resolve(__dirname, '..');
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'support.html'), 'utf8'), {
    url: 'https://dextech.invalid/support.html',
  });
  const { document } = dom.window;
  try {
    const footer = document.querySelector('footer.footer');
    assert.ok(footer, 'Support page footer must exist');

    const hrefs = Array.from(footer.querySelectorAll('a')).map(anchor => anchor.getAttribute('href'));
    assert.ok(hrefs.includes('privacy.html'), 'Support footer must link to privacy.html');
    assert.ok(hrefs.includes('terms.html'), 'Support footer must link to terms.html');
    assert.ok(hrefs.includes('/cancel'), 'Support footer must link to /cancel');
    assert.equal(footer.querySelectorAll('a[href="cancel.html"]').length, 0);

    const github = footer.querySelector('a[href="https://github.com/dexsword"]');
    assert.ok(github, 'Support footer must keep the GitHub link');
    assert.equal(github.getAttribute('target'), '_blank');
    assert.equal(github.getAttribute('rel'), 'noopener noreferrer');
  } finally {
    dom.window.close();
  }
});
