const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BOOKINGS_FILE = path.join(__dirname, 'bookings.json');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
const SLOT_DURATION = 60;

function loadBookings() {
  try {
    if (fs.existsSync(BOOKINGS_FILE)) {
      const data = fs.readFileSync(BOOKINGS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading bookings:', err);
  }
  return { bookings: [] };
}

function saveBookings(data) {
  try {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('Error saving bookings:', err);
    return false;
  }
}

function isSlotAvailable(date, hour) {
  const data = loadBookings();
  const dateStr = date;
  return !data.bookings.some(b => b.date === dateStr && b.hour === hour && b.status !== 'cancelled');
}

function getAvailableSlots(date) {
  return HOURS.filter(hour => isSlotAvailable(date, hour));
}

app.get('/api/availability/:date', (req, res) => {
  const { date } = req.params;
  const slots = getAvailableSlots(date);
  res.json({ date, available: slots });
});

app.get('/api/availability', (req, res) => {
  const today = new Date();
  const availability = {};
  
  for (let i = 0; i < 14; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    
    if (date.getDay() !== 0) {
      availability[dateStr] = getAvailableSlots(dateStr);
    }
  }
  
  res.json(availability);
});

app.post('/api/bookings', (req, res) => {
  const { name, email, phone, date, hour, service, notes } = req.body;
  
  if (!name || !email || !phone || !date || !hour || !service) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (!isSlotAvailable(date, hour)) {
    return res.status(409).json({ error: 'This time slot is no longer available' });
  }
  
  const booking = {
    id: Date.now().toString(),
    name,
    email,
    phone,
    date,
    hour,
    service,
    notes: notes || '',
    status: 'confirmed',
    createdAt: new Date().toISOString()
  };
  
  const data = loadBookings();
  data.bookings.push(booking);
  
  if (saveBookings(data)) {
    sendConfirmationEmail(booking);
    res.status(201).json({ success: true, booking });
  } else {
    res.status(500).json({ error: 'Failed to save booking' });
  }
});

app.delete('/api/bookings/:id', (req, res) => {
  const { id } = req.params;
  const data = loadBookings();
  const index = data.bookings.findIndex(b => b.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  
  data.bookings[index].status = 'cancelled';
  
  if (saveBookings(data)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});

app.get('/api/bookings', (req, res) => {
  const data = loadBookings();
  res.json(data.bookings);
});

async function sendConfirmationEmail(booking) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  
  const formattedDate = new Date(booking.date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const timeStr = `${booking.hour}:00 ${booking.hour >= 12 ? 'PM' : 'AM'}`;
  
  const mailOptions = {
    from: '"Dex Tech" <bookings@dextech.cloud>',
    to: booking.email,
    subject: 'Appointment Confirmed - Dex Tech',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Your Appointment is Confirmed</h2>
        <p>Hi ${booking.name},</p>
        <p>Your appointment with Dex Tech has been scheduled.</p>
        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Date:</strong> ${formattedDate}</p>
          <p><strong>Time:</strong> ${timeStr}</p>
          <p><strong>Service:</strong> ${booking.service}</p>
        </div>
        <p>If you need to reschedule or cancel, please reply to this email or call (845) 596-1708.</p>
        <p>See you soon!</p>
      </div>
    `
  };
  
  try {
    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error('Email error:', err);
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
