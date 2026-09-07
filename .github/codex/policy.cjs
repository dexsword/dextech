'use strict';

const schema = require('./review.schema.json');
const REPOSITORY = 'dexsword/dextech';
const CONFIDENCE = 0.95;
const CHECKS = { gate: 'Codex Review / gate', eligible: 'Auto Merge / eligible' };
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Intentional allowlist: new namespaces need a manually reviewed policy change.
// In particular, server.js mixes credentials/auth/database/Calendar logic.
const safeRoot = new Set(['index.html', 'support.html', 'privacy.html', 'terms.html',
  'style.css', 'script.js', 'tests.js', 'README.md']);
const sensitive = /auth|oauth|credential|secret|(?:^|[/. _-])env|session|token|permission|access.?control|password|database|schema|migrat|backup|restore|rollback|deploy|sql|destruct|delete|purge|calendar|gcal|stripe|admin|payment|billing|codex|auto.?merge|review.?gate|eligib|agents\.md|dependency.security|tracked.files/i;

function pathClass(file) {
  if (typeof file !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(file) ||
      file.split('/').some(part => !part || part === '.' || part === '..')) return 'ambiguous-path';
  if (file.startsWith('.github/') || file.startsWith('ops/') ||
      file.startsWith('scripts/') || sensitive.test(file) ||
      ['server.js', 'cancel.html', 'package.json'].includes(file)) return 'protected-path';
  if (file === 'package-lock.json') return 'dependency-lock';
  if (safeRoot.has(file) || /^docs\/[A-Za-z0-9_/-]+\.(md|txt)$/.test(file) ||
      /^test\/[A-Za-z0-9_-]+\.test\.js$/.test(file)) return 'ordinary';
  return 'unrecognized-path';
}

function narrowLockUpdate(before, after) {
  // Only dev-only patch resolution updates, no new/removed packages, lifecycle
  // scripts, package metadata changes, dependency ranges, or runtime updates.
  try {
    const a = JSON.parse(before), b = JSON.parse(after);
    if (a.lockfileVersion !== 3 || b.lockfileVersion !== 3 || !plain(a.packages) || !plain(b.packages)) return false;
    const stable = lock => ({ ...lock, packages: null });
    if (JSON.stringify(stable(a)) !== JSON.stringify(stable(b))) return false;
    const names = Object.keys(a.packages).sort();
    if (JSON.stringify(names) !== JSON.stringify(Object.keys(b.packages).sort())) return false;
    let changes = 0;
    for (const name of names) {
      const old = a.packages[name], next = b.packages[name];
      if (JSON.stringify(old) === JSON.stringify(next)) continue;
      if (!name.startsWith('node_modules/') || sensitive.test(name) || old.dev !== true || next.dev !== true ||
          old.hasInstallScript || next.hasInstallScript) return false;
      const x = /^(\d+)\.(\d+)\.(\d+)$/.exec(old.version);
      const y = /^(\d+)\.(\d+)\.(\d+)$/.exec(next.version);
      if (!x || !y || x[1] !== y[1] || x[2] !== y[2] || +y[3] <= +x[3]) return false;
      if (!/^https:\/\/registry\.npmjs\.org\/[A-Za-z0-9@%_./-]+\.tgz$/.test(next.resolved) ||
          !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(next.integrity)) return false;
      const metadata = entry => ({ ...entry, version: null, resolved: null, integrity: null });
      if (JSON.stringify(metadata(old)) !== JSON.stringify(metadata(next))) return false;
      changes++;
    }
    return changes > 0 && changes <= 10;
  } catch { return false; }
}

function classify(files, locks = {}) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 100) return { eligible: false, reason: 'unsupported-change-set' };
  for (const file of files) {
    const category = pathClass(file);
    if (category === 'ordinary') continue;
    if (category === 'dependency-lock' && files.length === 1 && narrowLockUpdate(locks.before, locks.after)) continue;
    return { eligible: false, reason: category };
  }
  return { eligible: true, reason: 'allowlisted-change-set' };
}

// Validate the actual shared JSON Schema. Unknown schema keywords are errors,
// not silently ignored. Only this small, tested JSON Schema subset is needed.
function validateSchema(value, rule) {
  const keywords = new Set(['type', 'additionalProperties', 'required', 'properties',
    'enum', 'minimum', 'maximum', 'items', 'maxItems', 'minLength', 'maxLength']);
  if (Object.keys(rule).some(key => !keywords.has(key))) return false;
  const types = Array.isArray(rule.type) ? rule.type : [rule.type];
  const matches = type => ({
    object: plain(value), array: Array.isArray(value), null: value === null,
    string: typeof value === 'string', number: typeof value === 'number' && Number.isFinite(value),
    integer: Number.isSafeInteger(value)
  })[type] === true;
  if (!types.some(matches) || (rule.enum && !rule.enum.includes(value))) return false;
  if (typeof value === 'number' && (value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity))) return false;
  if (typeof value === 'string' && (value.length < (rule.minLength ?? 0) || value.length > (rule.maxLength ?? Infinity))) return false;
  if (Array.isArray(value) && (value.length > (rule.maxItems ?? Infinity) || !value.every(item => validateSchema(item, rule.items)))) return false;
  if (plain(value)) {
    if ((rule.required || []).some(key => !Object.hasOwn(value, key))) return false;
    if (rule.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(rule.properties, key))) return false;
    if (!Object.entries(value).every(([key, item]) => Object.hasOwn(rule.properties, key) && validateSchema(item, rule.properties[key]))) return false;
  }
  return true;
}

function reviewResult(raw, actionResult) {
  try {
    if (actionResult !== 'success' || typeof raw !== 'string' || !raw.trim() || Buffer.byteLength(raw) > 32000) return null;
    const result = JSON.parse(raw);
    return validateSchema(result, schema) ? result : null;
  } catch { return null; }
}

function reviewPass(raw, actionResult) {
  const result = reviewResult(raw, actionResult);
  return result !== null && result.verdict === 'pass' &&
    result.confidence >= CONFIDENCE && result.blocking_findings.length === 0;
}

function sameCandidate(pr, expected, requireReady = false) {
  return plain(pr) && sha(expected.head) && sha(expected.base) &&
    pr.number === expected.number && pr.state === 'open' &&
    (!requireReady || pr.draft === false) && pr.base?.repo?.full_name === REPOSITORY &&
    pr.base?.ref === 'main' && pr.base?.sha === expected.base &&
    pr.head?.repo?.full_name === REPOSITORY && pr.head?.sha === expected.head;
}

function mayRequest(pr, expected, gate, eligible) {
  return sameCandidate(pr, expected, true) && gate === true && eligible === true;
}

module.exports = { REPOSITORY, CONFIDENCE, CHECKS, sha, pathClass, classify,
  narrowLockUpdate, validateSchema, reviewResult, reviewPass, sameCandidate, mayRequest };
