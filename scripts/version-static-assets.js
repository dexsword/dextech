// Refresh HTML cache keys after editing shared CSS or JavaScript.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const versions = Object.fromEntries(['style.css', 'script.js'].map(file => [
  file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0, 12),
]));
for (const file of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
  const location = path.join(root, file);
  const original = fs.readFileSync(location, 'utf8');
  const updated = original.replace(/(\b(?:src|href)=["'])(\/?)(style\.css|script\.js)(?:\?[^"']*)?(["'])/g,
    (_, prefix, slash, asset, quote) => `${prefix}${slash}${asset}?v=${versions[asset]}${quote}`);
  if (updated !== original) fs.writeFileSync(location, updated);
}
