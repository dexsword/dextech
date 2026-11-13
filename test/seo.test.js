const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('sitemap pages and internal links resolve, with unique titles and matching canonicals', () => {
  const xml = new JSDOM(read('sitemap.xml'), { contentType: 'text/xml' });
  const urls = [...xml.window.document.querySelectorAll('loc')].map(n => n.textContent);
  const titles = new Set();
  assert.equal(urls.length, 8);
  for (const url of urls) {
    const file = new URL(url).pathname.slice(1) || 'index.html';
    const dom = new JSDOM(read(file));
    const doc = dom.window.document;
    assert.equal(doc.querySelector('link[rel="canonical"]').href, url);
    assert.equal(doc.querySelectorAll('h1').length, 1);
    assert.ok(!titles.has(doc.title));
    titles.add(doc.title);
    for (const tag of doc.querySelectorAll('script[type="application/ld+json"]')) JSON.parse(tag.textContent);
    for (const link of doc.querySelectorAll('a[href]')) {
      const target = new URL(link.getAttribute('href'), url);
      if (target.origin !== 'https://dextech.cloud') continue;
      if (['/admin', '/cancel'].includes(target.pathname)) continue;
      const destination = target.pathname.slice(1) || 'index.html';
      assert.ok(fs.existsSync(path.join(root, destination)), `${file}: ${destination}`);
      if (target.hash) {
        const other = new JSDOM(read(destination));
        assert.ok(other.window.document.getElementById(target.hash.slice(1)), `${file}: ${target.hash}`);
        other.window.close();
      }
    }
    const preview = doc.querySelector('meta[property="og:image"]');
    if (preview) assert.ok(fs.existsSync(path.join(root, new URL(preview.content).pathname)));
    dom.window.close();
  }
  xml.window.close();
});

test('quote form switches contact method, posts an inquiry, and preserves input after failure', async t => {
  const dom = new JSDOM(read('index.html'), { runScripts: 'outside-only', url: 'https://dextech.cloud/' });
  t.after(() => dom.window.close());
  const { window } = dom;
  // Initialize only the quote form; no booking/calendar calls or real email.
  window.eval(read('script.js').slice(read('script.js').indexOf('function initQuoteForm()')));
  window.initQuoteForm();
  const doc = window.document;
  const form = doc.getElementById('quoteForm');
  const method = doc.getElementById('quoteMethod');
  const fill = () => {
    doc.getElementById('quoteName').value = 'Test Visitor';
    doc.getElementById('quoteContact').value = '(555) 555-0100';
    doc.getElementById('quoteMessage').value = 'Synthetic inquiry for Wi-Fi help';
  };
  method.value = 'phone';
  method.dispatchEvent(new window.Event('change'));
  assert.equal(doc.getElementById('quoteContact').type, 'tel');
  fill();
  window.fetch = async (url, options) => {
    assert.equal(url, '/api/inquiries');
    assert.equal(JSON.parse(options.body).method, 'phone');
    return { ok: false, json: async () => ({ error: 'Unavailable' }) };
  };
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(doc.getElementById('quoteStatus').textContent, /could not be sent/);
  assert.equal(doc.getElementById('quoteName').value, 'Test Visitor');
  window.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(doc.getElementById('quoteStatus').textContent, /has been sent/);
  assert.equal(doc.getElementById('quoteName').value, '');
  assert.equal(doc.getElementById('quoteContact').type, 'email');
});

test('search metadata, service schema and breadcrumbs agree with visible content', () => {
  const sitemap = new JSDOM(read('sitemap.xml'), { contentType: 'text/xml' });
  const descriptions = new Set();
  for (const loc of sitemap.window.document.querySelectorAll('loc')) {
    const url = loc.textContent;
    const file = new URL(url).pathname.slice(1) || 'index.html';
    const dom = new JSDOM(read(file));
    const doc = dom.window.document;
    const description = doc.querySelector('meta[name="description"]').content;
    assert.ok(description.length > 40 && !descriptions.has(description), `${file}: unique useful description`);
    descriptions.add(description);
    assert.equal(doc.querySelector('meta[property="og:url"]').content, url);
    assert.equal(doc.querySelector('meta[property="og:title"]').content, doc.title);
    assert.equal(doc.querySelector('meta[property="og:description"]').content, description);
    assert.equal(doc.querySelector('meta[name="twitter:description"]').content, description);
    assert.ok(!doc.querySelector('a[href^="index.html"]'), 'Use canonical internal links');
    const graph = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent)['@graph'];
    const page = graph.find(node => node['@type'] === 'WebPage');
    assert.equal(page.url, url);
    assert.equal(page.description, description);
    if (file === 'index.html') {
      assert.equal(graph.find(node => node['@type'] === 'WebSite').name, 'Dex Tech');
      const offers = graph.find(node => node['@type'] === 'LocalBusiness').hasOfferCatalog.itemListElement;
      const cards = [...doc.querySelectorAll('.service-card')];
      assert.equal(offers.length, cards.length);
      cards.forEach((card, i) => {
        assert.equal(offers[i].itemOffered.name, card.querySelector('.service-title').textContent.trim());
        assert.equal(offers[i].itemOffered.description, card.querySelector('.service-description').textContent.trim());
      });
    }
    if (file.endsWith('-henderson.html')) {
      const breadcrumb = graph.find(node => node['@type'] === 'BreadcrumbList');
      assert.deepEqual(breadcrumb.itemListElement.map(item => item.position), [1, 2]);
      assert.equal(breadcrumb.itemListElement[1].name, doc.querySelector('h1').textContent);
      assert.equal(breadcrumb.itemListElement[1].item, url);
      assert.equal(doc.querySelector('[aria-current="page"]').textContent, doc.querySelector('h1').textContent);
      assert.equal(graph.find(node => node['@type'] === 'Service')['@id'], page.mainEntity['@id']);
    }
    dom.window.close();
  }
  sitemap.window.close();
});

test('utility pages remain noindex and outside the public sitemap', () => {
  for (const file of ['admin.html', 'cancel.html']) {
    const dom = new JSDOM(read(file));
    assert.match(dom.window.document.querySelector('meta[name="robots"]').content, /noindex/);
    assert.ok(!read('sitemap.xml').includes(file));
    dom.window.close();
  }
});
