#!/usr/bin/env node
// Run: node stripe-import.js
// Requires STRIPE_SECRET_KEY in .env
require('dotenv').config();
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error('Error: STRIPE_SECRET_KEY not set in .env');
  process.exit(1);
}

const stripe = Stripe(STRIPE_SECRET_KEY);

const SERVICES = [
  {
    key: 'pc-tuneup',
    name: 'PC Tune-Up',
    description: 'Boost your computer\'s speed with startup optimization, cleanup, and resource tuning.',
    amount: 7125, // $71.25 in cents
    mode: 'flat',
  },
  {
    key: 'virus-removal',
    name: 'Virus & Junk Removal',
    description: 'Complete malware scan, bloatware removal, and security health check for peace of mind.',
    amount: 8550, // $85.50
    mode: 'flat',
  },
  {
    key: 'network-optimization',
    name: 'Network Optimization',
    description: 'Improve Wi-Fi coverage, speed, and security for your home or office network.',
    amount: 9500, // $95.00
    mode: 'flat',
  },
  {
    key: 'pihole-setup',
    name: 'Pi-hole Setup',
    description: 'Network-wide ad blocking and enhanced privacy protection with Pi-hole.',
    amount: 11400, // $114.00
    mode: 'flat',
  },
  {
    key: 'custom-pc-build',
    name: 'Custom PC Build',
    description: 'Gaming rigs, workstations, or custom setups. Parts consultation and full assembly included. Billed per hour.',
    amount: 6175, // $61.75 per hour
    mode: 'hourly',
  },
];

async function findExistingProduct(key) {
  const results = await stripe.products.search({
    query: `metadata['dextech_key']:'${key}'`,
  });
  return results.data[0] || null;
}

async function importService(service) {
  process.stdout.write(`  ${service.name}... `);

  // Reuse existing product if already imported
  let product = await findExistingProduct(service.key);
  if (product) {
    process.stdout.write('(product exists) ');
  } else {
    product = await stripe.products.create({
      name: service.name,
      description: service.description,
      metadata: { dextech_key: service.key },
    });
    process.stdout.write('(product created) ');
  }

  // Always create a fresh price
  const priceParams = {
    product: product.id,
    unit_amount: service.amount,
    currency: 'usd',
    metadata: { dextech_key: service.key },
  };
  if (service.mode === 'hourly') {
    priceParams.recurring = undefined; // one-time, but adjustable qty
  }
  const price = await stripe.prices.create(priceParams);

  // Create payment link
  const linkParams = {
    line_items: [{
      price: price.id,
      quantity: 1,
      ...(service.mode === 'hourly' ? {
        adjustable_quantity: { enabled: true, minimum: 1, maximum: 20 },
      } : {}),
    }],
    metadata: { dextech_key: service.key },
    after_completion: {
      type: 'hosted_confirmation',
      hosted_confirmation: {
        custom_message: 'Thank you! Dex Tech will be in touch shortly to confirm your appointment.',
      },
    },
    phone_number_collection: { enabled: true },
  };
  const link = await stripe.paymentLinks.create(linkParams);

  console.log(`done → ${link.url}`);
  return { key: service.key, name: service.name, url: link.url };
}

async function updateIndexHtml(results) {
  const indexPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  const urlMap = {};
  for (const r of results) urlMap[r.key] = r.url;

  // Map service keys to the price span text in the HTML for targeting
  const replacements = [
    {
      key: 'pc-tuneup',
      oldSpan: '<span class="service-price">$71.25</span>',
      newSpan: `<span class="service-price">$71.25</span>\n            <a href="${urlMap['pc-tuneup']}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm service-buy-btn">Book &amp; Pay</a>`,
    },
    {
      key: 'virus-removal',
      oldSpan: '<span class="service-price">$85.50</span>',
      newSpan: `<span class="service-price">$85.50</span>\n            <a href="${urlMap['virus-removal']}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm service-buy-btn">Book &amp; Pay</a>`,
    },
    {
      key: 'network-optimization',
      oldSpan: '<span class="service-price">$95</span>',
      newSpan: `<span class="service-price">$95</span>\n            <a href="${urlMap['network-optimization']}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm service-buy-btn">Book &amp; Pay</a>`,
    },
    {
      key: 'pihole-setup',
      oldSpan: '<span class="service-price">$114</span>',
      newSpan: `<span class="service-price">$114</span>\n            <a href="${urlMap['pihole-setup']}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm service-buy-btn">Book &amp; Pay</a>`,
    },
    {
      key: 'custom-pc-build',
      oldSpan: '<span class="service-price">Starting at $61.75/hr</span>',
      newSpan: `<span class="service-price">Starting at $61.75/hr</span>\n            <a href="${urlMap['custom-pc-build']}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm service-buy-btn">Book &amp; Pay</a>`,
    },
  ];

  let updated = 0;
  for (const r of replacements) {
    if (html.includes(r.oldSpan)) {
      html = html.replace(r.oldSpan, r.newSpan);
      updated++;
    } else {
      console.warn(`  [warn] Could not find price span for ${r.key} — skipping HTML update for this item`);
    }
  }

  fs.writeFileSync(indexPath, html, 'utf8');
  console.log(`\nUpdated index.html with ${updated} payment links.`);
}

async function main() {
  console.log(`\nDex Tech — Stripe Product Import`);
  const isLive = STRIPE_SECRET_KEY.startsWith('sk_live') || STRIPE_SECRET_KEY.startsWith('rk_live');
  console.log(`Mode: ${isLive ? 'LIVE' : 'TEST'}\n`);

  const results = [];
  for (const service of SERVICES) {
    const result = await importService(service);
    results.push(result);
  }

  // Save results to JSON for reference
  const outPath = path.join(__dirname, 'stripe-products.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved to stripe-products.json`);

  // Patch index.html
  console.log('\nPatching index.html...');
  await updateIndexHtml(results);

  console.log('\nDone! Add a "Book & Pay" button style to style.css if needed.');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
