const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const CF_APP_ID = process.env.CASHFREE_APP_ID || '';
const CF_SECRET = process.env.CASHFREE_SECRET || process.env.CASHFREE_SECRET_KEY || '';
const CF_ENV    = (process.env.CASHFREE_ENV || 'PROD').replace(/"/g, '').toUpperCase();

const CF_BASE   = CF_ENV === 'PROD'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

const CF_VER    = '2023-08-01';

console.log('=== Ascovita Payment Backend ===');
console.log('Mode     :', CF_ENV);
console.log('API Base :', CF_BASE);
console.log('App ID   :', CF_APP_ID ? CF_APP_ID.slice(0, 10) + '...' : 'NOT SET');
console.log('Secret   :', CF_SECRET ? 'SET' : 'NOT SET');

// ── CORS ─────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── HEALTH CHECK ─────────────────────────────────
app.get('/', function(req, res) {
  res.json({
    status: 'ok',
    service: 'Ascovita Payment Backend',
    mode: CF_ENV,
    appId: CF_APP_ID ? CF_APP_ID.slice(0, 10) + '...' : 'NOT SET',
    secretSet: !!CF_SECRET,
    apiUrl: CF_BASE,
    timestamp: new Date().toISOString()
  });
});

// ── CREATE ORDER ─────────────────────────────────
app.post('/create-order', async function(req, res) {
  console.log('[create-order] body:', req.body);

  if (!CF_APP_ID || !CF_SECRET) {
    return res.status(500).json({
      error: 'Payment gateway credentials not configured on server.'
    });
  }

  var orderId       = req.body.orderId;
  var amount        = req.body.amount;
  var customerName  = req.body.customerName  || 'Customer';
  var customerEmail = req.body.customerEmail || 'customer@ascovita.com';
  var customerPhone = req.body.customerPhone || '9999999999';

  if (!orderId || !amount) {
    return res.status(400).json({ error: 'orderId and amount are required' });
  }

  var amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  // Clean phone to 10 digits
  var phone = String(customerPhone).replace(/\D/g, '');
  if (phone.startsWith('91') && phone.length === 12) {
    phone = phone.slice(2);
  }
  if (phone.length !== 10) {
    phone = '9999999999';
  }

  var payload = {
    order_id: orderId,
    order_amount: amountNum.toFixed(2),
    order_currency: 'INR',
    order_note: 'Ascovita Healthcare',
    customer_details: {
      customer_id: 'cust_' + orderId,
      customer_name: String(customerName).slice(0, 50),
      customer_email: String(customerEmail).toLowerCase().trim(),
      customer_phone: phone
    },
    order_meta: {
      return_url: 'https://darkblue-chimpanzee-556703.hostingersite.com/#order-success?orderId=' + orderId
    }
  };

  console.log('[create-order] sending to cashfree:', JSON.stringify(payload));

  try {
    var response = await axios.post(CF_BASE + '/orders', payload, {
      headers: {
        'x-client-id': CF_APP_ID,
        'x-client-secret': CF_SECRET,
        'x-api-version': CF_VER,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    console.log('[create-order] cashfree response:', response.status, JSON.stringify(response.data));

    var sessionId = response.data.payment_session_id;

    if (!sessionId) {
      return res.status(500).json({
        error: 'No payment_session_id from Cashfree',
        raw: response.data
      });
    }

    res.json({
      success: true,
      orderId: response.data.order_id,
      paymentSessionId: sessionId,
      orderStatus: response.data.order_status
    });

  } catch (err) {
    var status  = err.response ? err.response.status : 500;
    var cfError = err.response ? err.response.data : null;
    console.error('[create-order] error:', status, JSON.stringify(cfError || err.message));

    var msg = 'Payment initiation failed';
    if (status === 401) msg = 'Invalid Cashfree credentials';
    if (cfError && cfError.message) msg = cfError.message;

    res.status(status).json({
      error: msg,
      code: cfError ? cfError.code : 'UNKNOWN',
      debug: cfError ? cfError.message : err.message
    });
  }
});

// ── VERIFY PAYMENT ───────────────────────────────
app.post('/verify-payment', async function(req, res) {
  var orderId = req.body.orderId;
  if (!orderId) return res.status(400).json({ error: 'orderId required' });

  try {
    var response = await axios.get(CF_BASE + '/orders/' + orderId, {
      headers: {
        'x-client-id': CF_APP_ID,
        'x-client-secret': CF_SECRET,
        'x-api-version': CF_VER
      },
      timeout: 10000
    });

    var order = response.data;
    console.log('[verify] order:', order.order_id, 'status:', order.order_status);

    res.json({
      success: true,
      paid: order.order_status === 'PAID',
      orderId: order.order_id,
      orderStatus: order.order_status,
      amount: order.order_amount
    });

  } catch (err) {
    var status = err.response ? err.response.status : 500;
    res.status(status).json({ error: err.response ? err.response.data : err.message });
  }
});

// ── WEBHOOK ──────────────────────────────────────
app.post('/webhook', express.raw({ type: 'application/json' }), function(req, res) {
  try {
    var body = req.body.toString();
    var data = JSON.parse(body);
    var event = data.type;
    var order = data.data && data.data.order ? data.data.order : {};
    console.log('[webhook] event:', event, 'order:', order.order_id);
    res.json({ status: 'received' });
  } catch (e) {
    console.error('[webhook] error:', e.message);
    res.status(400).json({ error: 'invalid payload' });
  }
});

// ── GET ORDER ────────────────────────────────────
app.get('/order/:orderId', async function(req, res) {
  try {
    var response = await axios.get(CF_BASE + '/orders/' + req.params.orderId, {
      headers: {
        'x-client-id': CF_APP_ID,
        'x-client-secret': CF_SECRET,
        'x-api-version': CF_VER
      },
      timeout: 10000
    });
    res.json(response.data);
  } catch (err) {
    var status = err.response ? err.response.status : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── START ─────────────────────────────────────────
app.listen(PORT, function() {
  console.log('Server running on port', PORT);
});
