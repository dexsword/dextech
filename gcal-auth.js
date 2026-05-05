// Run once to generate your GOOGLE_REFRESH_TOKEN.
// Usage: node gcal-auth.js
require('dotenv').config();
const { google } = require('googleapis');
const readline = require('readline');

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error('Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env first.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/calendar.events'],
  prompt: 'consent',
});

console.log('\nStep 1 — Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nStep 2 — Authorize the app, then paste the code shown:\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Code: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    if (!tokens.refresh_token) {
      console.error('\nNo refresh token returned. This usually means the app was already authorized.');
      console.error('Go to https://myaccount.google.com/permissions, revoke access for your app, then run this script again.');
      process.exit(1);
    }
    console.log('\nSuccess! Add this line to your .env:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\nThen restart the server.');
  } catch (err) {
    console.error('\nFailed to exchange code:', err.message);
    process.exit(1);
  }
});
