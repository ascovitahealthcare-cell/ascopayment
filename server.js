// ═══════════════════════════════════════════════════════════
// ASCOVITA PAYMENT BACKEND v3.0
// Deploy on Render.com — Node.js
// ═══════════════════════════════════════════════════════════

const express    = require('express');
const cors       = require('cors');
const axios      = require('axios');
const bodyParser = require('body-parser');
const crypto     = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── CONFIG ───────────────────────────────────────────────
// Set these in Render → Environment Variables:
//   CASHFREE_APP_ID   → your LIVE app id  (e.g. 109093592f...)
//   CASHFREE_SECRET   → your LIVE secret key
//   CASHFREE_ENV      → "PROD" (must be uppercase)
//   ALLOWED_ORIGIN    → https://darkblue-chimpanzee-556703.hostingersite.com

const CF_APP_ID  = process.env.CASHFREE_APP_ID  || '';
const CF_SECRET  = process.env.CASHFREE_SECRET   || '';
const CF_ENV     = (process.env.CASHFREE_ENV     || 'PROD').toUpperCase();
const ALLOWED    = process.env.ALLOWED_ORIGIN    || 'https://darkblue-chimpanzee-556703.hostingersite.com';

// Cashfree endpoints
const CF_BASE = CF_ENV === 'PROD'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

const CF_VERSION = '2023-08-01';

console.log(`[CONFIG] Cashfree env: ${CF_ENV}`);
console.log(`[CONFIG] Cashfree base: ${CF_BASE}`);
console.log(`[CONFIG] App ID set: ${CF_APP_ID ? 'YES (' + CF_APP_ID.slice(0,8) + '...)' : '⚠ NO - SET ENV VAR'}`);
console.log(`[CONFIG] Secret set: ${CF_SECRET ? 'YES' : '⚠ NO - SET ENV VAR'}`);

// ─── MIDDLEWARE ───────────────────────────────────────────
app.use(cors({
  origin: [
    ALLOWED,
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    /hostingersite\.com$/,
    /localhost/
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.options('*', cors());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// ─── HEALTH CHECK ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Ascovita Payment Backend',
    version: '3.0',
    mode: CF_ENV,
    appIdConfigured: !!CF_APP_ID,
    secretConfigured: !!CF_SECRET,
    apiUrl: CF_BASE,
    timestamp: new Date().toISOString()
  });
});

// ─── CREATE ORDER ─────────────────────────────────────────
// POST /create-order
// Body: { orderId, amount, customerName, customerEmail, customerPhone }
app.post('/create-order', async (req, res) => {
  console.log('[CREATE-ORDER] Request received:', req.body);

  // Validate config
  if (!CF_APP_ID || !CF_SECRET) {
    console.error('[CREATE-ORDER] Missing Cashfree credentials in environment');
    return res.status(500).json({
      error: 'Payment gateway not configured. Contact admin.',
      debug: 'Set CASHFREE_APP_ID and CASHFREE_SECRET in Render environment variables.'
    });
  }

  const {
    orderId,
    amount,
    customerName,
    customerEmail,
    customerPhone,
    returnUrl,
    notifyUrl
  } = req.body;

  // Validate required fields
  if (!orderId || !amount || !customerName || !customerEmail || !customerPhone) {
    return res.status(400).json({
      error: 'Missing required fields: orderId, amount, customerName, customerEmail, customerPhone'
    });
  }

  // Validate amount
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'Invalid amount: must be a positive number' });
  }

  // Clean phone number - Cashfree needs 10-digit Indian mobile
  let phone = String(customerPhone).replace(/\D/g, '');
  if (phone.startsWith('91') && phone.length === 12) phone = phone.slice(2);
  if (phone.length !== 10) {
    // Use a default if invalid - payment can still proceed
    console.warn('[CREATE-ORDER] Invalid phone, using fallback:', phone);
    phone = '9999999999';
  }

  // Clean email
  const email = customerEmail.trim().toLowerCase() || 'customer@ascovita.com';

  const orderPayload = {
    order_id: orderId,
    order_amount: amountNum.toFixed(2),
    order_currency: 'INR',
    order_note: 'Ascovita Healthcare Order',
    customer_details: {
      customer_id: `cust_${orderId}`,
      customer_name: customerName.trim().slice(0, 50),
      customer_email: email,
      customer_phone: phone
    },
    order_meta: {
      return_url: returnUrl || `${ALLOWED}#order-success?orderId=${orderId}&status=SUCCESS`,
      notify_url: notifyUrl || `https://ascopayment-2-0.onrender.com/webhook`
    }
  };

  console.log('[CREATE-ORDER] Sending to Cashfree:', JSON.stringify(orderPayload));

  try {
    const response = await axios.post(
      `${CF_BASE}/orders`,
      orderPayload,
      {
        headers: {
          'x-client-id': CF_APP_ID,
          'x-client-secret': CF_SECRET,
          'x-api-version': CF_VERSION,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log('[CREATE-ORDER] Cashfree response:', response.status, JSON.stringify(response.data));

    const { payment_session_id, order_id, order_status, order_expiry_time } = response.data;

    if (!payment_session_id) {
      throw new Error('Cashfree did not return payment_session_id. Response: ' + JSON.stringify(response.data));
    }

    res.json({
      success: true,
      orderId: order_id,
      paymentSessionId: payment_session_id,
      orderStatus: order_status,
      expiryTime: order_expiry_time
    });

  } catch (err) {
    const cfError = err.response?.data;
    const status  = err.response?.status || 500;

    console.error('[CREATE-ORDER] Error:', status, JSON.stringify(cfError || err.message));

    // Helpful error messages
    let userMsg = 'Payment initiation failed. Please try again.';
    let debugMsg = cfError?.message || err.message;

    if (status === 401) {
      userMsg = 'Payment gateway authentication failed. Contact support.';
      debugMsg = 'Invalid Cashfree credentials. Check CASHFREE_APP_ID and CASHFREE_SECRET env vars.';
    } else if (status === 422) {
      userMsg = 'Invalid order details. Please check and retry.';
    } else if (cfError?.code === 'order_already_paid') {
      userMsg = 'This order is already paid.';
    } else if (cfError?.code === 'order_expired') {
      userMsg = 'Order session expired. Please go back to cart and try again.';
    }

    res.status(status).json({
      error: userMsg,
      code: cfError?.code || 'UNKNOWN',
      debug: debugMsg
    });
  }
});

// ─── VERIFY PAYMENT ───────────────────────────────────────
// POST /verify-payment
// Body: { orderId }
app.post('/verify-payment', async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) return res.status(400).json({ error: 'orderId required' });
  if (!CF_APP_ID || !CF_SECRET) return res.status(500).json({ error: 'Gateway not configured' });

  console.log('[VERIFY] Verifying orderId:', orderId);

  try {
    // Get order details
    const orderRes = await axios.get(
      `${CF_BASE}/orders/${orderId}`,
      {
        headers: {
          'x-client-id': CF_APP_ID,
          'x-client-secret': CF_SECRET,
          'x-api-version': CF_VERSION
        },
        timeout: 10000
      }
    );

    const order = orderRes.data;
    console.log('[VERIFY] Order status:', order.order_status);

    // Get payments for this order
    let payments = [];
    try {
      const payRes = await axios.get(
        `${CF_BASE}/orders/${orderId}/payments`,
        {
          headers: {
            'x-client-id': CF_APP_ID,
            'x-client-secret': CF_SECRET,
            'x-api-version': CF_VERSION
          },
          timeout: 10000
        }
      );
      payments = payRes.data || [];
    } catch (e) {
      console.warn('[VERIFY] Could not fetch payments:', e.message);
    }

    const paid = order.order_status === 'PAID';
    const latestPayment = payments[0] || {};

    res.json({
      success: true,
      paid,
      orderId: order.order_id,
      orderStatus: order.order_status,
      amount: order.order_amount,
      currency: order.order_currency,
      paymentMethod: latestPayment.payment_method || null,
      paymentTime: latestPayment.payment_completion_time || null,
      cfPaymentId: latestPayment.cf_payment_id || null
    });

  } catch (err) {
    const status = err.response?.status || 500;
    console.error('[VERIFY] Error:', status, err.response?.data || err.message);
    res.status(status).json({
      error: 'Could not verify payment',
      debug: err.response?.data?.message || err.message
    });
  }
});

// ─── WEBHOOK ──────────────────────────────────────────────
// POST /webhook
// Called by Cashfree on payment events
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const rawBody = req.body.toString();
    const data    = JSON.parse(rawBody);

    // Verify webhook signature
    const sig    = req.headers['x-webhook-signature'];
    const ts     = req.headers['x-webhook-timestamp'];
    const sigStr = ts + rawBody;
    const hmac   = crypto.createHmac('sha256', CF_SECRET).update(sigStr).digest('base64');

    if (sig && hmac !== sig) {
      console.warn('[WEBHOOK] Invalid signature!');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = data.type;
    const order = data.data?.order;
    const payment = data.data?.payment;

    console.log(`[WEBHOOK] Event: ${event}, Order: ${order?.order_id}, Status: ${payment?.payment_status}`);

    // Handle events
    if (event === 'PAYMENT_SUCCESS_WEBHOOK') {
      console.log(`[WEBHOOK] ✅ PAYMENT SUCCESS - Order ${order?.order_id}, Amount ₹${payment?.payment_amount}`);
      // TODO: Add your order fulfillment logic here
      // e.g. send confirmation email, update inventory, notify admin
    } else if (event === 'PAYMENT_FAILED_WEBHOOK') {
      console.log(`[WEBHOOK] ❌ PAYMENT FAILED - Order ${order?.order_id}, Reason: ${payment?.error_details?.error_description}`);
    } else if (event === 'PAYMENT_USER_DROPPED_WEBHOOK') {
      console.log(`[WEBHOOK] ⚠ USER DROPPED - Order ${order?.order_id}`);
    }

    res.json({ status: 'received' });
  } catch (e) {
    console.error('[WEBHOOK] Parse error:', e.message);
    res.status(400).json({ error: 'Invalid webhook payload' });
  }
});

// ─── GET ORDER STATUS ─────────────────────────────────────
app.get('/order/:orderId', async (req, res) => {
  const { orderId } = req.params;
  if (!CF_APP_ID || !CF_SECRET) return res.status(500).json({ error: 'Gateway not configured' });

  try {
    const response = await axios.get(
      `${CF_BASE}/orders/${orderId}`,
      {
        headers: {
          'x-client-id': CF_APP_ID,
          'x-client-secret': CF_SECRET,
          'x-api-version': CF_VERSION
        },
        timeout: 10000
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
  }
});

// ─── START ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Ascovita Payment Backend v3.0 running on port ${PORT}`);
  console.log(`   Mode: ${CF_ENV}`);
  console.log(`   API: ${CF_BASE}\n`);
});
});
