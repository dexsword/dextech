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

test('static pages declare matching HTTPS canonical URLs in head', () => {
  const root = path.resolve(__dirname, '..');
  const pages = [
    { file: 'index.html', href: 'https://dextech.cloud/' },
    { file: 'support.html', href: 'https://dextech.cloud/support.html' },
    { file: 'privacy.html', href: 'https://dextech.cloud/privacy.html' },
    { file: 'terms.html', href: 'https://dextech.cloud/terms.html' },
  ];

  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page.file), 'utf8');
    const dom = new JSDOM(html, { url: 'https://dextech.invalid/' });
    try {
      const canonicals = Array.from(dom.window.document.head.querySelectorAll('link[rel="canonical"]'));
      assert.equal(canonicals.length, 1, `${page.file} must have exactly one canonical link in head`);
      assert.equal(canonicals[0].getAttribute('href'), page.href);
    } finally {
      dom.window.close();
    }
  }
});

test('homepage Open Graph and Twitter images point at /images/preview.jpg', () => {
  const root = path.resolve(__dirname, '..');
  const previewPath = path.join(root, 'images', 'preview.jpg');
  assert.equal(fs.existsSync(previewPath), true, 'images/preview.jpg must exist');

  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    url: 'https://dextech.invalid/',
  });
  const { document } = dom.window;
  try {
    const ogImage = document.querySelector('meta[property="og:image"]');
    const twitterImage = document.querySelector('meta[name="twitter:image"]');
    assert.ok(ogImage, 'og:image meta tag must exist');
    assert.ok(twitterImage, 'twitter:image meta tag must exist');
    assert.equal(ogImage.getAttribute('content'), 'https://dextech.cloud/images/preview.jpg');
    assert.equal(twitterImage.getAttribute('content'), 'https://dextech.cloud/images/preview.jpg');
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

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_JS = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const PAID_SERVICE_LINKS = {
  'Custom PC Build': 'https://buy.stripe.com/7sY28j75Be0N0SZ3VuaAw06',
  'PC Tune-Up': 'https://buy.stripe.com/14A00bahNf4RfNT3VuaAw02',
  'Virus & Junk Removal': 'https://buy.stripe.com/00w5kv61x2i50SZ8bKaAw03',
  'Network Optimization': 'https://buy.stripe.com/7sYeV53Tp4qdbxD0JiaAw04',
  'Pi-hole Setup': 'https://buy.stripe.com/28E28j61xg8V8lr63CaAw05',
};

const UNPAID_BOOK_SERVICES = [
  'Home & Office Setup',
  'Tech Support & Troubleshooting',
  'Home Automation',
  'Training & Guidance',
];

function waitFor(predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      try {
        if (predicate()) {
          resolve();
          return;
        }
      } catch {
        // Predicate may throw while the DOM is still settling.
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Timed out waiting for booking UI condition'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

function loadHomepage(t) {
  const scrolled = [];
  const fetchCalls = [];
  const dom = new JSDOM(INDEX_HTML, {
    url: 'https://dextech.invalid/',
    runScripts: 'outside-only',
    beforeParse(window) {
      window.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      window.HTMLElement.prototype.scrollIntoView = function() {
        scrolled.push(this.id || this.tagName);
      };
      window.fetch = async function(url, options = {}) {
        const href = String(url);
        fetchCalls.push({ href, method: options.method || 'GET' });
        if (/\/api\/availability\/\d{4}-\d{2}-\d{2}$/.test(href)) {
          return { ok: true, status: 200, json: async () => ({ available: [10, 14] }) };
        }
        if (href.includes('/api/availability')) {
          return { ok: true, status: 200, json: async () => ({}) };
        }
        if (href.includes('/api/bookings') && options.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ bookingId: 'test-booking-1' }) };
        }
        throw new Error('Unexpected fetch: ' + href);
      };
    },
  });
  t.after(() => dom.window.close());
  dom.window.eval(SCRIPT_JS);
  dom.window.initBookingWidget();
  return { dom, scrolled, fetchCalls };
}

async function completeBooking(window, service) {
  const { document } = window;
  await waitFor(() => document.querySelector('.calendar-day:not(.disabled)'));
  document.querySelector('.calendar-day:not(.disabled)').click();
  await waitFor(() => document.querySelector('.time-slot'));
  document.querySelector('.time-slot').click();
  document.getElementById('bookingName').value = 'Test User';
  document.getElementById('bookingEmail').value = 'test@example.com';
  document.getElementById('bookingPhone').value = '555-123-4567';
  if (service !== undefined) {
    const select = document.getElementById('bookingService');
    select.value = service;
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  document.querySelector('#bookingForm button[type="submit"]').click();
  await waitFor(() => document.getElementById('step4').classList.contains('active'));
}

function paymentState(document) {
  const paymentAction = document.getElementById('paymentAction');
  const stripePayBtn = document.getElementById('stripePayBtn');
  return {
    visible: paymentAction.style.display !== 'none' && paymentAction.style.display !== '',
    href: stripePayBtn.getAttribute('href'),
  };
}

test('service cards keep known Stripe Payment Links and add Book CTAs for unpaid services', () => {
  const dom = new JSDOM(INDEX_HTML, { url: 'https://dextech.invalid/' });
  const { document } = dom.window;
  try {
    const paidButtons = document.querySelectorAll('.service-buy-btn[data-stripe]');
    assert.equal(paidButtons.length, Object.keys(PAID_SERVICE_LINKS).length);

    for (const [service, url] of Object.entries(PAID_SERVICE_LINKS)) {
      const btn = Array.from(paidButtons).find(el => el.getAttribute('data-service') === service);
      assert.ok(btn, `Paid card CTA must exist for ${service}`);
      assert.equal(btn.getAttribute('data-stripe'), url);
      assert.equal(btn.getAttribute('href'), '#booking');
      assert.match(btn.textContent, /Book\s*&\s*Pay/i);
      const option = document.querySelector(`#bookingService option[value="${service}"]`);
      assert.ok(option, `Booking dropdown must include ${service}`);
    }

    for (const service of UNPAID_BOOK_SERVICES) {
      const btn = Array.from(document.querySelectorAll('.service-buy-btn[data-service]')).find(
        el => el.getAttribute('data-service') === service
      );
      assert.ok(btn, `Unpaid card must have a Book CTA for ${service}`);
      assert.equal(btn.getAttribute('data-stripe'), null);
      assert.equal(btn.getAttribute('href'), '#booking');
      assert.equal(btn.textContent.trim(), 'Book');
      const option = document.querySelector(`#bookingService option[value="${service}"]`);
      assert.ok(option, `Booking dropdown must include ${service}`);
    }
  } finally {
    dom.window.close();
  }
});

test('getStripeUrlForService maps paid services from card data-stripe and clears unpaid ones', () => {
  const dom = new JSDOM(INDEX_HTML, {
    url: 'https://dextech.invalid/',
    runScripts: 'outside-only',
  });
  try {
    dom.window.eval(SCRIPT_JS);
    const lookup = (service) => dom.window.getStripeUrlForService(service, dom.window.document);
    for (const [service, url] of Object.entries(PAID_SERVICE_LINKS)) {
      assert.equal(lookup(service), url);
    }
    for (const service of UNPAID_BOOK_SERVICES) {
      assert.equal(lookup(service), null);
    }
    assert.equal(lookup('Consultation'), null);
    assert.equal(lookup(''), null);
    assert.equal(lookup(null), null);
  } finally {
    dom.window.close();
  }
});

test('changing bookingService after Book & Pay updates or clears the success Stripe Pay CTA', async t => {
  const { dom } = loadHomepage(t);
  const { document } = dom.window;

  const tuneUp = Array.from(document.querySelectorAll('.service-buy-btn[data-stripe]')).find(
    el => el.getAttribute('data-service') === 'PC Tune-Up'
  );
  tuneUp.click();
  assert.equal(document.getElementById('bookingService').value, 'PC Tune-Up');

  await completeBooking(dom.window, 'Pi-hole Setup');
  let pay = paymentState(document);
  assert.equal(pay.visible, true);
  assert.equal(pay.href, PAID_SERVICE_LINKS['Pi-hole Setup']);

  document.getElementById('bookAnother').click();
  tuneUp.click();
  await completeBooking(dom.window, 'Home Automation');
  pay = paymentState(document);
  assert.equal(pay.visible, false);
});

test('booking a paid service from the form alone shows the matching Stripe Pay CTA', async t => {
  const { dom } = loadHomepage(t);
  await completeBooking(dom.window, 'Custom PC Build');
  const pay = paymentState(dom.window.document);
  assert.equal(pay.visible, true);
  assert.equal(pay.href, PAID_SERVICE_LINKS['Custom PC Build']);
});

test('unpaid Book CTAs scroll to booking and pre-select the service without Stripe', async t => {
  const { dom, scrolled } = loadHomepage(t);
  const { document } = dom.window;
  const homeAutomation = Array.from(document.querySelectorAll('.service-buy-btn[data-service]')).find(
    el => el.getAttribute('data-service') === 'Home Automation'
  );
  homeAutomation.click();
  assert.equal(document.getElementById('bookingService').value, 'Home Automation');
  assert.ok(scrolled.includes('booking'));
  assert.equal(homeAutomation.getAttribute('data-stripe'), null);

  await completeBooking(dom.window);
  const pay = paymentState(document);
  assert.equal(pay.visible, false);
});
