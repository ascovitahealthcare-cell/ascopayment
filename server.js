// ═══════════════════════════════════════════════════════
// ASCOVITA — Cashfree Payment Backend Server
// Host this on Render.com (FREE) or Railway.app (FREE)
// ═══════════════════════════════════════════════════════

const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── YOUR CASHFREE CREDENTIALS ──
const CASHFREE_APP_ID    = '114759508ea58eec808caeb98b75957411';
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || 'YOUR_SECRET_KEY_HERE';
// ⚠️  NEVER hardcode your Secret Key in this file.
//     Set it as an environment variable on Render/Railway.
//     The App ID is not sensitive so it can stay here.

// ── CASHFREE API URL (PRODUCTION) ──
const CF_BASE_URL = 'https://api.cashfree.com/pg';

// ── YOUR HOSTINGER SITE URL (for CORS) ──
// Replace with your actual Hostinger domain
const ALLOWED_ORIGINS = [
  'https://www.ascovita.com',
  'https://ascovita.com',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
];

// ── MIDDLEWARE ──
app.use(express.json());
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('CORS blocked: ' + origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── HEALTH CHECK ──
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Ascovita Cashfree Backend is running 🌿' });
});

// ══════════════════════════════════════════════════════
// POST /api/create-cashfree-order
// Called by the website when user clicks "Pay Securely"
// ══════════════════════════════════════════════════════
app.post('/api/create-cashfree-order', async (req, res) => {
  const { order_id, order_amount, order_currency, customer_details } = req.body;

  // ── Validate required fields ──
  if (!order_id || !order_amount || !customer_details) {
    return res.status(400).json({ error: 'Missing required fields: order_id, order_amount, customer_details' });
  }
  if (!customer_details.customer_phone || customer_details.customer_phone.length < 10) {
    return res.status(400).json({ error: 'Invalid customer phone number' });
  }
  if (!customer_details.customer_email || !customer_details.customer_email.includes('@')) {
    return res.status(400).json({ error: 'Invalid customer email' });
  }
  if (order_amount < 1) {
    return res.status(400).json({ error: 'Order amount must be at least ₹1' });
  }

  // ── Build Cashfree order payload ──
  const orderPayload = {
    order_id:        order_id,
    order_amount:    parseFloat(order_amount.toFixed(2)),
    order_currency:  order_currency || 'INR',
    customer_details: {
      customer_id:    customer_details.customer_id || ('CUST_' + Date.now()),
      customer_name:  customer_details.customer_name,
      customer_email: customer_details.customer_email,
      customer_phone: customer_details.customer_phone,
    },
    order_meta: {
      return_url: `https://www.ascovita.com/?order_id=${order_id}&payment_status=SUCCESS`,
      notify_url: `https://your-backend-url.onrender.com/api/payment-webhook`,
    },
  };

  console.log('Creating Cashfree order:', order_id, 'Amount: ₹' + order_amount);

  try {
    const response = await axios.post(`${CF_BASE_URL}/orders`, orderPayload, {
      headers: {
        'Content-Type':  'application/json',
        'x-api-version': '2023-08-01',
        'x-client-id':   CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY,
      },
      timeout: 10000, // 10 second timeout
    });

    const { payment_session_id, cf_order_id } = response.data;
    console.log('✅ Order created:', cf_order_id, 'Session:', payment_session_id);

    res.json({ payment_session_id, cf_order_id, order_id });

  } catch (err) {
    const status  = err.response?.status;
    const cfError = err.response?.data;

    console.error('❌ Cashfree API error:', status, cfError);

    // Return a helpful error message
    res.status(status || 500).json({
      error:   cfError?.message  || 'Cashfree API error',
      code:    cfError?.code     || 'UNKNOWN',
      details: cfError           || err.message,
    });
  }
});

// ══════════════════════════════════════════════════════
// POST /api/payment-webhook
// Cashfree calls this URL after payment success/failure
// Use this to update your order database / send emails
// ══════════════════════════════════════════════════════
app.post('/api/payment-webhook', (req, res) => {
  const event = req.body;
  console.log('📥 Webhook received:', JSON.stringify(event, null, 2));

  // TODO: Verify webhook signature (see Cashfree docs)
  // TODO: Update order status in your database
  // TODO: Send order confirmation email via SendGrid/Nodemailer

  const orderId    = event?.data?.order?.order_id;
  const payStatus  = event?.data?.payment?.payment_status;
  const payAmount  = event?.data?.payment?.payment_amount;

  if (payStatus === 'SUCCESS') {
    console.log(`✅ Payment confirmed: ${orderId} · ₹${payAmount}`);
    // Mark order as paid in DB here
  } else {
    console.log(`⚠️ Payment not successful: ${orderId} · Status: ${payStatus}`);
  }

  res.json({ status: 'received' });
});

// ── START SERVER ──
app.listen(PORT, () => {
  console.log(`🌿 Ascovita backend running on port ${PORT}`);
  console.log(`   App ID: ${CASHFREE_APP_ID}`);
  console.log(`   Mode: PRODUCTION`);
});
