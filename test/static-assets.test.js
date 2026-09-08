const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');

test('every shared script and stylesheet URL identifies the current asset content', () => {
  let references = 0;
  for (const file of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, file), 'utf8'), { url: 'https://dextech.cloud/' });
    for (const element of dom.window.document.querySelectorAll('script[src], link[rel="stylesheet"][href]')) {
      const url = new URL(element.src || element.href);
      if (url.origin !== 'https://dextech.cloud') continue;
      const asset = url.pathname.slice(1);
      if (!['style.css', 'script.js'].includes(asset)) continue;
      const version = createHash('sha256').update(fs.readFileSync(path.join(root, asset))).digest('hex').slice(0, 12);
      assert.equal(url.searchParams.get('v'), version, `${file}: run npm run assets:version after editing ${asset}`);
      references++;
    }
    dom.window.close();
  }
  assert.ok(references >= 10, 'Must check the shared assets across the public site');
});
