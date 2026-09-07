require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const Database = require('better-sqlite3');
const path = require('path');
const { randomUUID } = require('crypto');

// ─── Environment validation ───────────────────────────────────────────────────
const REQUIRED_FOR_EMAIL = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
const EMAIL_ENABLED = REQUIRED_FOR_EMAIL.every(k => process.env[k]);
if (!EMAIL_ENABLED) {
  console.warn('[warn] Email disabled — set SMTP_HOST, SMTP_USER, SMTP_PASS to enable confirmations');
}

const REQUIRED_FOR_GCAL = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
const GCAL_ENABLED = REQUIRED_FOR_GCAL.every(k => process.env[k]);
if (!GCAL_ENABLED) {
  console.warn('[warn] Google Calendar disabled — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN');
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  console.warn('[warn] ADMIN_TOKEN not set — admin endpoints will be inaccessible');
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const RAW_RELEASE_SHA = process.env.APP_RELEASE_SHA || '';
const APP_RELEASE_SHA = RAW_RELEASE_SHA.length === 40 && /^[a-f0-9]+$/i.test(RAW_RELEASE_SHA)
  ? RAW_RELEASE_SHA.toLowerCase()
  : 'unknown';
const BOOKING_HORIZON_DAYS = 35;
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
const VALID_SERVICES = new Set([
  'Consultation',
  'Home & Office Setup',
  'Tech Support & Troubleshooting',
  'Custom PC Build',
  'PC Tune-Up',
  'Virus & Junk Removal',
  'Network Optimization',
  'Pi-hole Setup',
  'Home Automation',
  'Training & Guidance',
  'Other',
]);

// ─── Database setup ───────────────────────────────────────────────────────────
const db = new Database(process.env.DB_PATH || '/var/lib/dextech/bookings.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL,
    phone           TEXT NOT NULL,
    date            TEXT NOT NULL,
    hour            INTEGER NOT NULL,
    service         TEXT NOT NULL,
    notes           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'confirmed',
    cancel_reason   TEXT NOT NULL DEFAULT '',
    gcal_event_id   TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    UNIQUE(date, hour, status)
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
  CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
`);

try { db.exec(`ALTER TABLE bookings ADD COLUMN cancel_reason TEXT NOT NULL DEFAULT ''`); } catch (_) {}
try { db.exec(`ALTER TABLE bookings ADD COLUMN gcal_event_id TEXT NOT NULL DEFAULT ''`); } catch (_) {}

// Migrate existing bookings.json if present
const fs = require('fs');
const LEGACY_FILE = path.join(__dirname, 'bookings.json');
if (fs.existsSync(LEGACY_FILE)) {
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
    if (Array.isArray(legacy.bookings) && legacy.bookings.length > 0) {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO bookings (id, name, email, phone, date, hour, service, notes, status, created_at)
         VALUES (@id, @name, @email, @phone, @date, @hour, @service, @notes, @status, @created_at)`
      );
      const migrate = db.transaction((bookings) => {
        for (const b of bookings) {
          insert.run({
            id: b.id || randomUUID(),
            name: b.name || '',
            email: b.email || '',
            phone: b.phone || '',
            date: b.date || '',
            hour: Number(b.hour),
            service: b.service || '',
            notes: b.notes || '',
            status: b.status || 'confirmed',
            created_at: b.createdAt || new Date().toISOString(),
          });
        }
      });
      migrate(legacy.bookings);
      fs.renameSync(LEGACY_FILE, LEGACY_FILE + '.migrated');
      console.log(`[info] Migrated ${legacy.bookings.length} bookings from bookings.json`);
    }
  } catch (err) {
    console.error('[error] Migration failed:', err.message);
  }
}

// ─── Prepared statements ──────────────────────────────────────────────────────
const stmtInsert = db.prepare(
  `INSERT INTO bookings (id, name, email, phone, date, hour, service, notes, status, created_at)
   VALUES (@id, @name, @email, @phone, @date, @hour, @service, @notes, 'confirmed', @created_at)`
);
const stmtUpdateGcalId = db.prepare(
  `UPDATE bookings SET gcal_event_id = ? WHERE id = ?`
);
const stmtCancel = db.prepare(
  `UPDATE bookings SET status = 'cancelled', cancel_reason = ? WHERE id = ? AND status != 'cancelled'`
);
const stmtIsBooked = db.prepare(
  `SELECT 1 FROM bookings WHERE date = ? AND hour = ? AND status = 'confirmed' LIMIT 1`
);
const stmtSlotsByDate = db.prepare(
  `SELECT hour FROM bookings WHERE date = ? AND status = 'confirmed'`
);
const stmtAll = db.prepare(
  `SELECT * FROM bookings ORDER BY date ASC, hour ASC`
);
const stmtByStatus = db.prepare(
  `SELECT * FROM bookings WHERE status = ? ORDER BY date ASC, hour ASC`
);
const stmtById = db.prepare(`SELECT * FROM bookings WHERE id = ?`);

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : null;

app.use(cors({
  origin: allowedOrigins || ['https://dextech.cloud', 'https://www.dextech.cloud'],
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '16kb' }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many booking attempts. Please try again later.' },
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

const cancelLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many cancellation attempts. Please try again later.' },
});

app.use('/api/', apiLimiter);

// ─── Request logging ──────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  const start = Date.now();
  _res.on('finish', () => {
    const duration = Date.now() - start;
    const ip = req.ip || req.socket?.remoteAddress;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${_res.statusCode} ${duration}ms ip=${ip}`);
  });
  next();
});

// ─── Admin auth middleware ────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ error: 'Admin access not configured' });
  }
  const auth = req.headers['authorization'];
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token !== ADMIN_TOKEN) {
    console.warn(`[warn] Failed admin auth from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── Validation helpers ───────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s\-()+.]{7,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateBookingInput({ name, email, phone, date, hour, service, notes }) {
  const errors = [];

  if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
    errors.push('Name must be 2–100 characters');
  }
  if (!email || !EMAIL_RE.test(email.trim())) {
    errors.push('Valid email address required');
  }
  if (!phone || !PHONE_RE.test(phone.trim())) {
    errors.push('Valid phone number required (7–20 digits)');
  }
  if (!date || !DATE_RE.test(date)) {
    errors.push('Date must be YYYY-MM-DD format');
  } else {
    const d = new Date(date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + BOOKING_HORIZON_DAYS);
    if (isNaN(d.getTime())) {
      errors.push('Invalid date');
    } else if (d < today) {
      errors.push('Cannot book a date in the past');
    } else if (d > maxDate) {
      errors.push(`Cannot book more than ${BOOKING_HORIZON_DAYS} days ahead`);
    } else if (d.getDay() === 0) {
      errors.push('Sundays are not available');
    }
  }
  const hourNum = parseInt(hour, 10);
  if (isNaN(hourNum) || !HOURS.includes(hourNum)) {
    errors.push(`Hour must be one of: ${HOURS.join(', ')}`);
  }
  if (!service || !VALID_SERVICES.has(service.trim())) {
    errors.push('Please select a valid service');
  }
  if (notes && notes.length > 1000) {
    errors.push('Notes must be under 1000 characters');
  }

  return errors;
}

// ─── Google Calendar busy-time cache ─────────────────────────────────────────
const gcalCache = { periods: [], fetchedAt: 0 };
const GCAL_CACHE_TTL = 2 * 60 * 1000; // refresh every 2 minutes

async function refreshGCalBusy() {
  if (!GCAL_ENABLED) return;
  if (Date.now() - gcalCache.fetchedAt < GCAL_CACHE_TTL) return;

  const timeMin = new Date();
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(timeMin);
  timeMax.setDate(timeMin.getDate() + BOOKING_HORIZON_DAYS + 1);

  try {
    const calendar = getCalendarClient();
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const res = await calendar.events.list({
      calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 500,
    });

    const events = (res.data.items || []).filter(e => e.status !== 'cancelled');
    gcalCache.periods = events.map(e => {
      if (e.start.dateTime) {
        // Timed event — use UTC datetimes as-is
        return { start: e.start.dateTime, end: e.end.dateTime };
      }
      // All-day event — convert calendar date to LA midnight in UTC so the
      // full local day is blocked regardless of the server's timezone
      return {
        start: laTimeToUTC(e.start.date, 0).toISOString(),
        end:   laTimeToUTC(e.end.date,   0).toISOString(),
      };
    });
    gcalCache.fetchedAt = Date.now();
    console.log(`[info] GCal events cache refreshed: ${gcalCache.periods.length} event(s)`);
  } catch (err) {
    console.error('[error] GCal events fetch failed:', err.message);
  }
}

function laTimeToUTC(dateStr, hour) {
  // Determine LA UTC offset at noon on this date (safe from DST boundary at 2am)
  const noonUTC = new Date(dateStr + 'T12:00:00Z');
  const laNoon = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false,
  }).format(noonUTC));
  const offsetHours = 12 - laNoon; // e.g. LA=5am → offset=7 (UTC-7/PDT)
  const midnightUTC = new Date(dateStr + 'T00:00:00Z').getTime();
  return new Date(midnightUTC + (hour + offsetHours) * 3_600_000);
}

function isSlotBlockedByCalendar(dateStr, hour) {
  if (!gcalCache.periods.length) return false;
  const slotStart = laTimeToUTC(dateStr, hour);
  const slotEnd = new Date(slotStart.getTime() + 30 * 60_000); // 30-min session
  return gcalCache.periods.some(({ start, end }) =>
    slotStart < new Date(end) && slotEnd > new Date(start)
  );
}

// ─── Availability helpers ─────────────────────────────────────────────────────
function getBookedHours(dateStr) {
  return new Set(stmtSlotsByDate.all(dateStr).map(r => r.hour));
}

function getAvailableSlots(dateStr) {
  const booked = getBookedHours(dateStr);
  return HOURS.filter(h => !booked.has(h) && !isSlotBlockedByCalendar(dateStr, h));
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  const bookingCount = db.prepare("SELECT COUNT(*) as n FROM bookings WHERE status = 'confirmed'").get();
  res.json({
    status: 'ok',
    release_sha: APP_RELEASE_SHA,
    timestamp: new Date().toISOString(),
    confirmed_bookings: bookingCount.n,
    email_enabled: EMAIL_ENABLED,
    gcal_enabled: GCAL_ENABLED,
  });
});

app.get('/api/availability', async (_req, res) => {
  await refreshGCalBusy();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const availability = {};

  for (let i = 0; i <= BOOKING_HORIZON_DAYS; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    if (d.getDay() === 0) continue;
    const dateStr = formatDate(d);
    availability[dateStr] = getAvailableSlots(dateStr);
  }

  res.set('Cache-Control', 'no-store').json(availability);
});

app.get('/api/availability/:date', async (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  await refreshGCalBusy();
  res.set('Cache-Control', 'no-store').json({ date, available: getAvailableSlots(date) });
});

app.post('/api/bookings', bookingLimiter, (req, res) => {
  const { name, email, phone, date, hour, service, notes } = req.body;

  const errors = validateBookingInput({ name, email, phone, date, hour, service, notes });
  if (errors.length > 0) {
    return res.status(422).json({ error: errors[0], errors });
  }

  const hourNum = parseInt(hour, 10);
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  const cleanPhone = phone.trim();
  const cleanService = service.trim();
  const cleanNotes = (notes || '').trim();

  const book = db.transaction(() => {
    const taken = stmtIsBooked.get(date, hourNum);
    if (taken) return null;

    const booking = {
      id: randomUUID(),
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      date,
      hour: hourNum,
      service: cleanService,
      notes: cleanNotes,
      created_at: new Date().toISOString(),
    };
    stmtInsert.run(booking);
    return booking;
  });

  const booking = book();
  if (!booking) {
    return res.status(409).json({ error: 'This time slot was just taken. Please choose another.' });
  }

  // Fire-and-forget: email ICS to customer + create calendar event for admin
  sendConfirmationEmail(booking).catch(err =>
    console.error('[error] Confirmation email failed:', err.message)
  );
  createCalendarEvent(booking).then(eventId => {
    if (eventId) stmtUpdateGcalId.run(eventId, booking.id);
    gcalCache.fetchedAt = 0; // invalidate so next availability check reflects new event
  }).catch(err =>
    console.error('[error] Calendar event creation failed:', err.message)
  );

  res.status(201).json({
    success: true,
    bookingId: booking.id,
    message: 'Booking confirmed! Check your email for a calendar invite.',
  });
});

// ─── Admin-only routes ────────────────────────────────────────────────────────

app.get('/api/bookings', requireAdmin, (req, res) => {
  const { status } = req.query;
  const validStatuses = new Set(['confirmed', 'cancelled']);
  const rows = (status && validStatuses.has(status)) ? stmtByStatus.all(status) : stmtAll.all();
  res.json(rows.map(rowToBooking));
});

const VALID_CANCEL_REASONS = new Set([
  'Schedule conflict',
  'Customer request',
  'Emergency',
  'Weather',
  'Other',
]);

app.post('/api/bookings/:id/cancel', requireAdmin, (req, res) => {
  const { id } = req.params;
  const reason = (req.body.reason || '').trim();
  if (!reason || !VALID_CANCEL_REASONS.has(reason)) {
    return res.status(422).json({ error: 'Please select a cancellation reason' });
  }
  const booking = stmtById.get(id);
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  if (booking.status === 'cancelled') {
    return res.status(409).json({ error: 'Booking already cancelled' });
  }
  const result = stmtCancel.run(reason, id);
  if (result.changes === 0) {
    return res.status(500).json({ error: 'Cancel failed' });
  }

  if (booking.gcal_event_id) {
    deleteCalendarEvent(booking.gcal_event_id).catch(err =>
      console.error('[error] Calendar event deletion failed:', err.message)
    );
  }

  res.json({ success: true });
});

// Customer self-cancellation
app.post('/api/bookings/:id/cancel-customer', cancelLimiter, (req, res) => {
  const { id } = req.params;
  const email = (req.body.email || '').trim().toLowerCase();

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(422).json({ error: 'Valid email address required' });
  }

  const booking = stmtById.get(id);
  if (!booking || booking.email !== email) {
    return res.status(404).json({ error: 'No confirmed booking found with that ID and email.' });
  }
  if (booking.status === 'cancelled') {
    return res.status(409).json({ error: 'This booking is already cancelled.' });
  }

  const result = stmtCancel.run('Customer request', id);
  if (result.changes === 0) {
    return res.status(500).json({ error: 'Cancellation failed. Please try again.' });
  }

  if (booking.gcal_event_id) {
    deleteCalendarEvent(booking.gcal_event_id).catch(err =>
      console.error('[error] Calendar event deletion failed on customer cancel:', err.message)
    );
  }

  res.json({ success: true });
});

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(__dirname));

const HTML_NO_CACHE = { headers: { 'Cache-Control': 'no-store' } };
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html'), HTML_NO_CACHE));
app.get('/cancel', (_req, res) => res.sendFile(path.join(__dirname, 'cancel.html'), HTML_NO_CACHE));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'admin.html'), HTML_NO_CACHE));

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTimeStr(hour) {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
  return `${h}:00 ${suffix}`;
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function rowToBooking(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    date: row.date,
    hour: row.hour,
    service: row.service,
    notes: row.notes,
    status: row.status,
    cancelReason: row.cancel_reason || '',
    gcalEventId: row.gcal_event_id || '',
    createdAt: row.created_at,
  };
}

// ─── Email (customer ICS) ─────────────────────────────────────────────────────
function buildICS(booking) {
  const d = booking.date.replace(/-/g, '');
  const startH = String(booking.hour).padStart(2, '0');
  const endH = String(booking.hour).padStart(2, '0');
  const endMin = '30'; // 30-minute sessions
  const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dex Tech//Booking//EN',
    'BEGIN:VEVENT',
    `UID:${booking.id}@dextech.cloud`,
    `DTSTAMP:${now}`,
    `DTSTART:${d}T${startH}0000`,
    `DTEND:${d}T${endH}${endMin}00`,
    `SUMMARY:Dex Tech – ${booking.service}`,
    `DESCRIPTION:Tech support appointment with Dex Tech.`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

async function sendConfirmationEmail(booking) {
  if (!EMAIL_ENABLED) return;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const formattedDate = new Date(booking.date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const timeStr = formatTimeStr(booking.hour);
  const fromAddress = process.env.EMAIL_FROM || `"Dex Tech" <bookings@dextech.cloud>`;

  await transporter.sendMail({
    from: fromAddress,
    to: booking.email,
    subject: 'Appointment Confirmed – Dex Tech',
    attachments: [{
      filename: 'appointment.ics',
      content: buildICS(booking),
      contentType: 'text/calendar',
    }],
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
        <div style="background:#2563eb;padding:24px 32px;border-radius:8px 8px 0 0">
          <h2 style="color:#fff;margin:0">Appointment Confirmed ✓</h2>
        </div>
        <div style="background:#f8fafc;padding:32px;border-radius:0 0 8px 8px">
          <p>Hi ${escapeHtml(booking.name)},</p>
          <p>Your appointment with <strong>Dex Tech</strong> is confirmed.</p>
          <table style="border-collapse:collapse;width:100%;margin:20px 0">
            <tr><td style="padding:8px 12px;background:#e2e8f0;font-weight:bold;width:130px;border-radius:4px">Date</td><td style="padding:8px 12px">${formattedDate}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold">Time</td><td style="padding:8px 12px">${timeStr}</td></tr>
            <tr><td style="padding:8px 12px;background:#e2e8f0;font-weight:bold;border-radius:4px">Service</td><td style="padding:8px 12px;background:#e2e8f0">${escapeHtml(booking.service)}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold">Booking ID</td><td style="padding:8px 12px;font-family:monospace;font-size:13px">${booking.id}</td></tr>
          </table>
          ${booking.notes ? `<p><strong>Notes:</strong> ${escapeHtml(booking.notes)}</p>` : ''}
          <p>A calendar invite is attached. To reschedule or cancel, reply to this email or call <strong>(845) 596-1708</strong>.</p>
          <p style="color:#64748b;font-size:13px">See you soon!<br>— Dex Tech</p>
        </div>
      </div>`,
    text: `Appointment Confirmed – Dex Tech\n\nHi ${booking.name},\n\nYour appointment is confirmed:\n  Date: ${formattedDate}\n  Time: ${timeStr}\n  Service: ${booking.service}\n  Booking ID: ${booking.id}\n\nTo reschedule or cancel, reply to this email or call (845) 596-1708.\n\nSee you soon!\n— Dex Tech`,
  });

  console.log(`[info] Confirmation email sent to ${booking.email} for booking ${booking.id}`);
}

// ─── Google Calendar ──────────────────────────────────────────────────────────
function getCalendarClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth });
}

async function createCalendarEvent(booking) {
  if (!GCAL_ENABLED) return null;

  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const startH = String(booking.hour).padStart(2, '0');
  const siteUrl = process.env.SITE_URL || 'https://dextech.cloud';
  const cancelUrl = `${siteUrl}/cancel?id=${booking.id}`;

  const event = {
    summary: `${booking.service} — ${booking.name}`,
    description: [
      `Phone: ${booking.phone}`,
      `Email: ${booking.email}`,
      booking.notes ? `Notes: ${booking.notes}` : '',
      `Booking ID: ${booking.id}`,
      '',
      `Need to cancel? ${cancelUrl}`,
    ].filter(Boolean).join('\n'),
    start: {
      dateTime: `${booking.date}T${startH}:00:00`,
      timeZone: 'America/Los_Angeles',
    },
    end: {
      dateTime: `${booking.date}T${startH}:30:00`,
      timeZone: 'America/Los_Angeles',
    },
    attendees: [{ email: booking.email }],
  };

  const response = await calendar.events.insert({
    calendarId,
    resource: event,
    sendUpdates: 'all',
  });
  console.log(`[info] Calendar event created for booking ${booking.id}: ${response.data.id}`);
  return response.data.id;
}

async function deleteCalendarEvent(gcalEventId) {
  if (!GCAL_ENABLED) return;

  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  await calendar.events.delete({ calendarId, eventId: gcalEventId, sendUpdates: 'all' });
  console.log(`[info] Calendar event deleted: ${gcalEventId}`);
}

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, HOST, () => {
  console.log(`[info] Dex Tech server running on port ${PORT}`);
  console.log(`[info] Email confirmations: ${EMAIL_ENABLED ? 'enabled' : 'disabled'}`);
  console.log(`[info] Google Calendar: ${GCAL_ENABLED ? 'enabled' : 'disabled'}`);
  console.log(`[info] Admin panel: ${ADMIN_TOKEN ? '/admin' : 'disabled (set ADMIN_TOKEN)'}`);
});

process.on('SIGTERM', () => {
  console.log('[info] SIGTERM received — shutting down gracefully');
  server.close(() => { db.close(); process.exit(0); });
});
process.on('SIGINT', () => {
  server.close(() => { db.close(); process.exit(0); });
});
