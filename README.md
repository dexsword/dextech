# Dex Tech Website

A business website with booking system for a tech support company in Henderson, NV.

## Quick Start

```bash
npm start
```

Then open http://localhost:3000

## Development

The site runs on Node.js with Express. Static files are served from the root directory.

### API Endpoints

- `GET /api/availability` - Get available dates for next 14 days
- `GET /api/availability/:date` - Get time slots for a specific date
- `POST /api/bookings` - Create a booking
- `DELETE /api/bookings/:id` - Cancel a booking
- `GET /api/bookings` - List all bookings

### Email Configuration (optional)

Set environment variables for email notifications:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`

### Files

- `index.html` - Main homepage
- `support.html` - Donation/tip page
- `privacy.html` - Privacy policy
- `style.css` - Styles
- `script.js` - JavaScript
- `server.js` - Express backend
- `bookings.json` - Booking data storage

### Guarded pull-request auto-merge

Phase 1 combines exact-head, read-only Codex review with deterministic eligibility
and native GitHub squash auto-merge. Sensitive changes remain manual-only.
[Setup, required checks, trust assumptions and first-run procedure](docs/guarded-auto-merge.md)
include the required OpenAI key, branch protection and downstream deployment-event
limitation. Repository settings and production are not changed by installing it.
