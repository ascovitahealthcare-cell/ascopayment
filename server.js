/**
 * ══════════════════════════════════════════════════════════════════
 *  ASCOVITA PAYMENT + SHIPPING BACKEND
 *  Cashfree (TEST MODE) + Shiprocket
 *  Deploy: https://ascopayment-2-0.onrender.com
 * ══════════════════════════════════════════════════════════════════
 *
 *  TEST CREDENTIALS (Cashfree Sandbox):
 *  App ID:  TEST10909359a2b60b1dde0c88c62dda9539090
 *  API URL: https://sandbox.cashfree.com/pg   ← TEST endpoint
 *
 *  To switch to PRODUCTION later:
 *  1. Change CASHFREE_BASE_URL to https://api.cashfree.com/pg
 *  2. Change App ID + Secret to your LIVE credentials in Render env vars
 *  3. Change Cashfree SDK mode to 'PRODUCTION' in index.html
 * ══════════════════════════════════════════════════════════════════
 */

const express        = require('express');
const cors           = require('cors');
const axios          = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());
app.use(express.json());

// ── CONFIG ────────────────────────────────────────────────────────
// Cashfree TEST credentials
// To go LIVE: change these env vars in Render Dashboard → Environment
const CASHFREE_APP_ID     = process.env.CASHFREE_APP_ID     || 'TEST10909359a2b60b1dde0c88c62dda9539090';
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || '';   // ← Set your TEST secret key in Render env vars
const CASHFREE_MODE       = process.env.CASHFREE_MODE       || 'TEST'; // 'TEST' or 'PROD'

// Automatically pick the right API URL based on mode
const CASHFREE_BASE_URL = CASHFREE_MODE === 'PROD'
  ? 'https://api.cashfree.com/pg'       // PRODUCTION
  : 'https://sandbox.cashfree.com/pg';  // TEST / SANDBOX

// Shiprocket credentials
const SHIPROCKET_EMAIL    = process.env.SHIPROCKET_EMAIL    || 'ascovitahealthcare@gmail.com';
const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD || '';   // ← Set in Render env vars
const SHIPROCKET_BASE     = 'https://apiv2.shiprocket.in/v1/external';

// Shiprocket token cache (valid 10 days)
let srTokenCache = { token: null, expiresAt: 0 };

// ─────────────────────────────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status:    'ok',
    service:   'Ascovita Payment Backend',
    mode:      CASHFREE_MODE,
    appId:     CASHFREE_APP_ID.slice(0, 12) + '...',
    apiUrl:    CASHFREE_BASE_URL,
    timestamp: new Date().toISOString(),
  });
});

// ══════════════════════════════════════════════════════════════════
//  CASHFREE — CREATE ORDER (returns payment_session_id)
// ══════════════════════════════════════════════════════════════════
app.post('/api/create-cashfree-order', async (req, res) => {
  try {
    const { order_id, order_amount, order_currency = 'INR', customer_details } = req.body;

    if (!order_id || !order_amount || !customer_details) {
      return res.status(400).json({ error: 'Missing required fields: order_id, order_amount, customer_details' });
    }

    // Cashfree requires phone in 10-digit format (no country code)
    let phone = String(customer_details.customer_phone || '').replace(/\D/g, '');
    if (phone.startsWith('91') && phone.length === 12) phone = phone.slice(2);
    if (phone.length !== 10) phone = '9898582650'; // fallback for test

    const payload = {
      order_id:       order_id,
      order_amount:   Number(order_amount),
      order_currency: order_currency,
      customer_details: {
        customer_id:    customer_details.customer_id    || ('CUST_' + Date.now()),
        customer_name:  customer_details.customer_name  || 'Customer',
        customer_email: customer_details.customer_email || 'customer@ascovita.com',
        customer_phone: phone,
      },
      order_meta: {
        return_url: 'https://aqua-porpoise-757079.hostingersite.com/?cf_order={order_id}',
        notify_url: 'https://ascopayment-2-0.onrender.com/api/cashfree-webhook',
      },
    };

    console.log(`📦 Creating Cashfree order [${CASHFREE_MODE}]: ${order_id} ₹${order_amount}`);

    const response = await axios.post(`${CASHFREE_BASE_URL}/orders`, payload, {
      headers: {
        'x-api-version':   '2023-08-01',
        'x-client-id':     CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY,
        'Content-Type':    'application/json',
      },
      timeout: 15000,
    });

    console.log(`✅ Cashfree order created: ${response.data.order_id} | session: ${response.data.payment_session_id?.slice(0,20)}...`);

    return res.json({
      order_id:           response.data.order_id,
      payment_session_id: response.data.payment_session_id,
      order_status:       response.data.order_status,
      mode:               CASHFREE_MODE,
    });

  } catch (err) {
    const errData = err?.response?.data;
    console.error('❌ Cashfree create order error:', errData || err.message);
    return res.status(err?.response?.status || 500).json({
      error:   errData?.message || errData?.error || 'Cashfree order creation failed',
      details: errData || null,
      mode:    CASHFREE_MODE,
    });
  }
});

// ══════════════════════════════════════════════════════════════════
//  CASHFREE — VERIFY ORDER STATUS
// ══════════════════════════════════════════════════════════════════
app.get('/api/verify-order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    console.log(`🔍 Verifying order [${CASHFREE_MODE}]: ${orderId}`);

    const response = await axios.get(`${CASHFREE_BASE_URL}/orders/${orderId}`, {
      headers: {
        'x-api-version':   '2023-08-01',
        'x-client-id':     CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY,
      },
      timeout: 10000,
    });

    console.log(`✅ Order status: ${response.data.order_status}`);
    return res.json(response.data);

  } catch (err) {
    console.error('❌ Cashfree verify error:', err?.response?.data || err.message);
    return res.status(err?.response?.status || 500).json({ error: 'Verification failed' });
  }
});

// ══════════════════════════════════════════════════════════════════
//  CASHFREE — WEBHOOK (payment status push from Cashfree)
// ══════════════════════════════════════════════════════════════════
app.post('/api/cashfree-webhook', (req, res) => {
  console.log('💳 Cashfree webhook received:', JSON.stringify(req.body));
  // TODO: verify signature and update order status in DB if needed
  res.json({ status: 'received' });
});

// ══════════════════════════════════════════════════════════════════
//  SHIPROCKET — AUTH TOKEN (cached, auto-refreshes every 10 days)
// ══════════════════════════════════════════════════════════════════
async function getShiprocketToken() {
  const now = Date.now();
  if (srTokenCache.token && srTokenCache.expiresAt - now > 3600000) {
    return srTokenCache.token;
  }
  console.log('🔑 Fetching fresh Shiprocket token…');
  const resp = await axios.post(`${SHIPROCKET_BASE}/auth/login`, {
    email:    SHIPROCKET_EMAIL,
    password: SHIPROCKET_PASSWORD,
  }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });

  srTokenCache.token     = resp.data.token;
  srTokenCache.expiresAt = now + (864000 * 1000); // 10 days
  console.log('✅ Shiprocket token obtained');
  return srTokenCache.token;
}

// ══════════════════════════════════════════════════════════════════
//  SHIPROCKET — CREATE ORDER
// ══════════════════════════════════════════════════════════════════
app.post('/api/create-shiprocket-order', async (req, res) => {
  try {
    const {
      order_id, order_date, pickup_location = 'Primary',
      billing_customer_name, billing_last_name,
      billing_address, billing_address_2 = '',
      billing_city, billing_pincode, billing_state,
      billing_country = 'India',
      billing_email, billing_phone,
      shipping_is_billing = true,
      order_items,
      payment_method = 'Prepaid',
      sub_total,
      length = 15, breadth = 10, height = 10, weight = 0.5,
    } = req.body;

    if (!order_id || !billing_customer_name || !billing_phone ||
        !billing_city || !billing_pincode || !order_items?.length) {
      return res.status(400).json({ error: 'Missing required Shiprocket fields' });
    }

    const token = await getShiprocketToken();

    const srPayload = {
      order_id,
      order_date:             order_date || new Date().toISOString().slice(0, 19).replace('T', ' '),
      pickup_location,
      channel_id:             '',
      comment:                'Ascovita D2C Order',
      billing_customer_name,
      billing_last_name:      billing_last_name || '.',
      billing_address,
      billing_address_2,
      billing_city,
      billing_pincode:        String(billing_pincode),
      billing_state,
      billing_country,
      billing_email,
      billing_phone:          String(billing_phone),
      shipping_is_billing,
      order_items: order_items.map(i => ({
        name:          i.name,
        sku:           i.sku || ('ASC-' + Date.now()),
        units:         Number(i.units) || 1,
        selling_price: Number(i.selling_price) || 0,
        discount:      Number(i.discount) || 0,
        tax:           i.tax || '',
        hsn:           i.hsn || '30049099',
      })),
      payment_method,
      sub_total:  Number(sub_total) || 0,
      length:     Number(length),
      breadth:    Number(breadth),
      height:     Number(height),
      weight:     Math.max(0.1, Number(weight)),
    };

    console.log('📦 Creating Shiprocket order:', order_id);

    const srResp = await axios.post(
      `${SHIPROCKET_BASE}/orders/create/adhoc`,
      srPayload,
      {
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        timeout: 15000,
      }
    );

    const srData = srResp.data;
    console.log('✅ Shiprocket order created — SR ID:', srData.order_id, '| Shipment:', srData.shipment_id);

    // Auto-assign courier + generate pickup
    if (srData.shipment_id) {
      try {
        await assignCourierAndPickup(token, srData.shipment_id);
      } catch (e) {
        console.warn('⚠️ Auto-assign courier failed (order still created):', e.message);
      }
    }

    return res.json({
      success:      true,
      order_id:     srData.order_id,
      shipment_id:  srData.shipment_id,
      awb_code:     srData.awb_code    || null,
      courier_name: srData.courier_name || null,
      status:       srData.status      || 'NEW',
    });

  } catch (err) {
    const errData = err?.response?.data;
    console.error('❌ Shiprocket order error:', errData || err.message);
    if (err?.response?.status === 401) srTokenCache = { token: null, expiresAt: 0 };
    return res.status(err?.response?.status || 500).json({
      error:   errData?.message || 'Shiprocket order creation failed',
      details: errData || null,
    });
  }
});

// ── Auto-assign courier + generate pickup ─────────────────────────
async function assignCourierAndPickup(token, shipmentId) {
  const awbResp = await axios.post(`${SHIPROCKET_BASE}/courier/assign/awb`, {
    shipment_id: [String(shipmentId)],
  }, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    timeout: 10000,
  });
  console.log('🏷️ AWB assigned:', awbResp.data?.response?.data?.awb_code);

  await axios.post(`${SHIPROCKET_BASE}/courier/generate/pickup`, {
    shipment_id: [shipmentId],
  }, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    timeout: 10000,
  });
  console.log('🚚 Pickup request generated');
}

// ══════════════════════════════════════════════════════════════════
//  SHIPROCKET — TRACK ORDER
// ══════════════════════════════════════════════════════════════════
app.get('/api/track-shiprocket/:orderId', async (req, res) => {
  try {
    const token = await getShiprocketToken();
    const resp  = await axios.get(`${SHIPROCKET_BASE}/orders/show/${req.params.orderId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000,
    });
    return res.json(resp.data);
  } catch (err) {
    return res.status(500).json({ error: 'Tracking fetch failed' });
  }
});

// ══════════════════════════════════════════════════════════════════
//  START SERVER
// ══════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║   Ascovita Backend on port ${String(PORT).padEnd(17)}      ║
  ║   Cashfree Mode : ${CASHFREE_MODE.padEnd(26)} ║
  ║   Cashfree URL  : ${CASHFREE_BASE_URL.replace('https://','').slice(0,26).padEnd(26)} ║
  ║   App ID        : ${CASHFREE_APP_ID.slice(0,26).padEnd(26)} ║
  ╚══════════════════════════════════════════════╝
  `);
});
