const express = require('express');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(cors({
  origin: '*', // Allow all origins for now, restrict later
  methods: ['GET', 'POST', 'OPTIONS']
}));

// Google Sheets Authentication
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// Email Transporter (optional - only if you want email confirmations)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Constants
const MAX_SLOTS = 56;

// Helper: Get current counts for both time slots
async function getTimeCounts() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:C', // Columns: Number, Name, Time
    });
    
    const rows = response.data.values || [];
    
    const counts = {
      '18:00': 0,
      '19:30': 0
    };
    
    // Skip header row, count each time slot
    for (let i = 1; i < rows.length; i++) {
      const time = rows[i][2];
      if (counts[time] !== undefined) {
        counts[time]++;
      }
    }
    
    return counts;
    
  } catch (error) {
    console.error('Error getting counts:', error);
    return { '18:00': 0, '19:30': 0 };
  }
}

// Helper: Get next RSVP number
async function getNextRSVPNumber() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:A',
    });
    
    const rows = response.data.values || [];
    
    if (rows.length <= 1) return 1;
    
    const lastNumber = parseInt(rows[rows.length - 1][0]) || 0;
    return lastNumber + 1;
    
  } catch (error) {
    console.error('Error getting RSVP number:', error);
    return 1;
  }
}

// GET endpoint: Return current counts
app.get('/api/rsvp/counts', async (req, res) => {
  try {
    const counts = await getTimeCounts();
    
    res.json({
      success: true,
      counts: counts
    });
    
  } catch (error) {
    console.error('Error in counts endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get counts'
    });
  }
});

// POST endpoint: Submit RSVP
app.post('/api/rsvp', async (req, res) => {
  try {
    console.log('📥 Received RSVP request:', req.body);
    const { name, time, email } = req.body;

    // Validation
    if (!name || !time) {
      console.log('❌ Validation failed: missing name or time');
      return res.status(400).json({
        success: false,
        message: 'Name and time are required'
      });
    }

    if (time !== '18:00' && time !== '19:30') {
      console.log('❌ Validation failed: invalid time slot');
      return res.status(400).json({
        success: false,
        message: 'Invalid time slot'
      });
    }

    console.log('✅ Validation passed, checking slot availability...');

    // Check if time slot is full
    const counts = await getTimeCounts();
    console.log('📊 Current counts:', counts);
    
    if (counts[time] >= MAX_SLOTS) {
      console.log('❌ Time slot is full');
      return res.status(400).json({
        success: false,
        message: 'This time slot is full'
      });
    }

    // Get next RSVP number
    console.log('🔢 Getting next RSVP number...');
    const rsvpNumber = await getNextRSVPNumber();
    const formattedNumber = String(rsvpNumber).padStart(3, '0');
    console.log('✅ RSVP Number:', rsvpNumber);

    // Add to Google Sheet
    console.log('📝 Writing to Google Sheet...');
    const timestamp = new Date().toISOString();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:E',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[rsvpNumber, name, time, timestamp, email || '']],
      },
    });
    console.log('✅ Successfully wrote to Google Sheet');

    //Send confirmation email if email provided
    if (email && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      try {
        console.log('📧 Sending confirmation email to:', email);
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: email,
          subject: 'TCP LIVE-STOCK RSVP Confirmation',
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { 
                  font-family: Arial, sans-serif; 
                  margin: 0;
                  padding: 0;
                  background-color: #f5f5f5;
                }
                .container { 
                  max-width: 600px; 
                  margin: 40px auto; 
                  padding: 40px;
                  background-color: white;
                  border: 1px solid #000;
                }
                .number { 
                  font-size: 72px; 
                  font-weight: bold; 
                  text-align: center; 
                  margin: 30px 0;
                  letter-spacing: 5px;
                }
                .details { 
                  font-size: 16px; 
                  line-height: 1.8;
                }
                .details p {
                  margin: 10px 0;
                }
                .header {
                  text-align: center;
                  font-size: 24px;
                  font-weight: bold;
                  margin-bottom: 20px;
                }
                .footer {
                  margin-top: 30px;
                  padding-top: 20px;
                  border-top: 1px solid #000;
                  font-size: 14px;
                  text-align: center;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">RSVP CONFIRMED</div>
                <div class="number">${formattedNumber}</div>
                <div class="details">
                  <p><strong>Name:</strong> ${name}</p>
                  <p><strong>Time:</strong> ${time}</p>
                  <p><strong>Event:</strong> TCP LIVE-STOCK Spring Summer 26</p>
                  <p><strong>Date:</strong> October 11th, 2025</p>
                  <p><strong>Location:</strong> 45 W 29th St, New York, NY</p>
                </div>
                <div class="footer">
                  Please save this confirmation email for your records.
                </div>
              </div>
            </body>
            </html>
          `,
        });
        console.log('✅ Email sent successfully');
      } catch (emailError) {
        console.error('⚠️ Email send failed:', emailError.message);
        // Don't fail the request if email fails
      }
    }

    // Success response
    console.log('🎉 RSVP completed successfully');
        res.json({
            success: true,
            number: String(rsvpNumber).padStart(3, '0'),
            message: 'RSVP confirmed!'
});

  } catch (error) {
    console.error('💥 ERROR processing RSVP:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to process RSVP. Please try again.'
    });
  }
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'RSVP API Server',
    endpoints: {
      health: 'GET /api/health',
      counts: 'GET /api/rsvp/counts',
      rsvp: 'POST /api/rsvp'
    }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📊 Google Sheet ID: ${process.env.GOOGLE_SHEET_ID}`);
});