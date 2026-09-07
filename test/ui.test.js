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
