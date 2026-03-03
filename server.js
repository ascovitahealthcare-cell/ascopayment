const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// ─── CASHFREE CONFIG ───────────────────────────────────────
const CASHFREE_APP_ID     = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const CASHFREE_BASE_URL   = 'https://api.cashfree.com/pg'; // PRODUCTION

// ─── CORS — allow your Hostinger websites ──────────────────
const allowedOrigins = [
  'https://snow-stingray-443954.hostingersite.com',
  'https://lightskyblue-snake-825312.hostingersite.com',
  'https://ascovitahealthcare.com',
  'https://www.ascovitahealthcare.com',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Also allow any hostingersite.com subdomain
    if (origin.endsWith('.hostingersite.com') || origin.endsWith('.hostinger.com')) {
      return callback(null, true);
    }
    console.warn('CORS blocked origin:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json());

// ─── HEALTH CHECK ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Ascovita Payment Backend',
    appId: CASHFREE_APP_ID ? CASHFREE_APP_ID.substring(0, 8) + '...' : 'NOT SET',
    mode: 'PRODUCTION',
    timestamp: new Date().toISOString(),
  });
});

// ─── CREATE CASHFREE ORDER ─────────────────────────────────
// POST /api/create-cashfree-order
app.post('/api/create-cashfree-order', async (req, res) => {
  try {
    const { order_id, order_amount, order_currency, customer_details, payment_method } = req.body;

    // Validate required fields
    if (!order_id || !order_amount || !customer_details) {
      return res.status(400).json({ error: 'Missing required fields: order_id, order_amount, customer_details' });
    }
    if (!customer_details.customer_name || !customer_details.customer_email || !customer_details.customer_phone) {
      return res.status(400).json({ error: 'Missing customer details: name, email, phone required' });
    }
    if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
      console.error('❌ Cashfree credentials not set in environment variables!');
      return res.status(500).json({ error: 'Payment gateway not configured. Contact support.' });
    }

    const orderPayload = {
      order_id:        order_id,
      order_amount:    parseFloat(order_amount),
      order_currency:  order_currency || 'INR',
      customer_details: {
        customer_id:    customer_details.customer_id || ('CUST_' + Date.now()),
        customer_name:  customer_details.customer_name,
        customer_email: customer_details.customer_email,
        customer_phone: customer_details.customer_phone,
      },
      order_meta: {
        return_url: `https://snow-stingray-443954.hostingersite.com/#payment-success?order_id={order_id}`,
        notify_url: `https://ascopayment-2-0.onrender.com/api/cashfree-webhook`,
      },
    };

    console.log(`📦 Creating order: ${order_id} | ₹${order_amount} | ${customer_details.customer_name}`);

    const response = await axios.post(`${CASHFREE_BASE_URL}/orders`, orderPayload, {
      headers: {
        'x-client-id':     CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY,
        'x-api-version':   '2023-08-01',
        'Content-Type':    'application/json',
      },
    });

    const { payment_session_id, cf_order_id } = response.data;

    console.log(`✅ Order created: ${cf_order_id} | Session: ${payment_session_id?.substring(0, 20)}...`);

    return res.json({ payment_session_id, cf_order_id, order_id });

  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error('❌ Cashfree order creation failed:', JSON.stringify(errData));
    return res.status(err.response?.status || 500).json({
      error: 'Failed to create payment order',
      details: errData,
    });
  }
});

// ─── CASHFREE WEBHOOK (payment confirmation) ───────────────
app.post('/api/cashfree-webhook', (req, res) => {
  console.log('🔔 Webhook received:', JSON.stringify(req.body));
  // TODO: Verify signature and process order fulfillment
  res.json({ status: 'received' });
});

// ─── ORDER STATUS CHECK ────────────────────────────────────
app.get('/api/order-status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const response = await axios.get(`${CASHFREE_BASE_URL}/orders/${orderId}`, {
      headers: {
        'x-client-id':     CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY,
        'x-api-version':   '2023-08-01',
      },
    });
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data || err.message });
  }
});

// ─── START SERVER ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log('🌿 Ascovita backend running on port', PORT);
  console.log('   App ID:', CASHFREE_APP_ID ? CASHFREE_APP_ID.substring(0, 12) + '...' : '❌ NOT SET');
  console.log('   Secret:', CASHFREE_SECRET_KEY ? '✅ Set' : '❌ NOT SET');
  console.log('   Mode: PRODUCTION');
});
