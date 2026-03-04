const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.options('*', cors());
app.use(express.json());

// ─── CONFIG — ALL CREDENTIALS FROM ENVIRONMENT VARIABLES ONLY ────────────────
// Set these in Render Dashboard → Environment (never hardcode passwords in code)
const CF_APP_ID  = process.env.CASHFREE_APP_ID     || '';
const CF_SECRET  = process.env.CASHFREE_SECRET_KEY || '';
const CF_BASE    = 'https://api.cashfree.com/pg';

const SR_EMAIL   = process.env.SHIPROCKET_EMAIL    || '';
const SR_PASS    = process.env.SHIPROCKET_PASSWORD || '';  // Never hardcoded here
const SR_BASE    = 'https://apiv2.shiprocket.in/v1/external';

// Warn on startup if credentials are missing
if (!SR_EMAIL || !SR_PASS) {
  console.warn('[WARN] SHIPROCKET_EMAIL or SHIPROCKET_PASSWORD env vars not set!');
}
if (!CF_APP_ID || !CF_SECRET) {
  console.warn('[WARN] CASHFREE_APP_ID or CASHFREE_SECRET_KEY env vars not set!');
}

// Shiprocket token cache
let srToken = null;
let srTokenExpiry = 0;

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Ascovita Payment Backend',
    appId: CF_APP_ID || 'not-set',
    mode: 'PRODUCTION',
    timestamp: new Date().toISOString()
  });
});

// ─── CASHFREE: CREATE ORDER ───────────────────────────────────────────────────
app.post('/api/create-cashfree-order', async (req, res) => {
  try {
    const { order_id, order_amount, order_currency, customer_details } = req.body;

    if (!order_id || !order_amount || !customer_details) {
      return res.status(400).json({ error: 'Missing: order_id, order_amount or customer_details' });
    }

    const payload = {
      order_id: order_id,
      order_amount: Number(order_amount),
      order_currency: order_currency || 'INR',
      customer_details: {
        customer_id:    customer_details.customer_id    || ('CUST_' + Date.now()),
        customer_name:  customer_details.customer_name  || '',
        customer_email: customer_details.customer_email || '',
        customer_phone: customer_details.customer_phone || ''
      },
      order_meta: {
        return_url: 'https://ascovita.netlify.app/?order_id={order_id}',
        notify_url: 'https://ascopayment-2-0.onrender.com/api/cashfree-webhook'
      }
    };

    const response = await axios.post(CF_BASE + '/orders', payload, {
      headers: {
        'x-api-version':   '2023-08-01',
        'x-client-id':     CF_APP_ID,
        'x-client-secret': CF_SECRET,
        'Content-Type':    'application/json'
      }
    });

    return res.json({
      order_id:           response.data.order_id,
      payment_session_id: response.data.payment_session_id,
      order_status:       response.data.order_status
    });

  } catch (err) {
    console.error('[Cashfree] create-order error:', err.response && err.response.data ? err.response.data : err.message);
    return res.status(500).json({ error: (err.response && err.response.data && err.response.data.message) || 'Cashfree error' });
  }
});

// ─── CASHFREE: VERIFY ORDER ───────────────────────────────────────────────────
app.get('/api/verify-order/:orderId', async (req, res) => {
  try {
    const response = await axios.get(CF_BASE + '/orders/' + req.params.orderId, {
      headers: {
        'x-api-version':   '2023-08-01',
        'x-client-id':     CF_APP_ID,
        'x-client-secret': CF_SECRET
      }
    });
    return res.json(response.data);
  } catch (err) {
    console.error('[Cashfree] verify error:', err.message);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── CASHFREE: WEBHOOK ────────────────────────────────────────────────────────
app.post('/api/cashfree-webhook', (req, res) => {
  console.log('[Cashfree] webhook received:', JSON.stringify(req.body));
  res.json({ status: 'received' });
});

// ─── SHIPROCKET: GET TOKEN (cached 10 days) ───────────────────────────────────
async function getShiprocketToken() {
  const now = Date.now();
  if (srToken && srTokenExpiry - now > 3600000) {
    return srToken;
  }
  console.log('[Shiprocket] Fetching new token...');
  const resp = await axios.post(
    SR_BASE + '/auth/login',
    { email: SR_EMAIL, password: SR_PASS },
    { headers: { 'Content-Type': 'application/json' } }
  );
  srToken = resp.data.token;
  srTokenExpiry = now + (864000 * 1000); // 10 days
  console.log('[Shiprocket] Token obtained OK');
  return srToken;
}

// ─── SHIPROCKET: CREATE ORDER ─────────────────────────────────────────────────
app.post('/api/create-shiprocket-order', async (req, res) => {
  try {
    const b = req.body;

    if (!b.order_id || !b.billing_customer_name || !b.billing_phone || !b.billing_city || !b.billing_pincode || !b.order_items || !b.order_items.length) {
      return res.status(400).json({ error: 'Missing required fields', required: ['order_id','billing_customer_name','billing_phone','billing_city','billing_pincode','order_items'] });
    }

    const token = await getShiprocketToken();

    const payload = {
      order_id:               b.order_id,
      order_date:             b.order_date || new Date().toISOString().slice(0, 19).replace('T', ' '),
      pickup_location:        b.pickup_location || 'Primary',
      channel_id:             '',
      comment:                'Ascovita D2C Order',
      billing_customer_name:  b.billing_customer_name,
      billing_last_name:      b.billing_last_name || '.',
      billing_address:        b.billing_address || '',
      billing_address_2:      b.billing_address_2 || '',
      billing_city:           b.billing_city,
      billing_pincode:        String(b.billing_pincode),
      billing_state:          b.billing_state || 'Gujarat',
      billing_country:        b.billing_country || 'India',
      billing_email:          b.billing_email || '',
      billing_phone:          String(b.billing_phone),
      shipping_is_billing:    true,
      order_items: b.order_items.map(function(item) {
        return {
          name:          item.name,
          sku:           item.sku || ('ASC-' + item.name.replace(/\s+/g, '-').slice(0, 20)),
          units:         Number(item.units) || 1,
          selling_price: Number(item.selling_price) || 0,
          discount:      Number(item.discount) || 0,
          tax:           item.tax || '',
          hsn:           item.hsn || '30049099'
        };
      }),
      payment_method: b.payment_method || 'Prepaid',
      sub_total:      Number(b.sub_total) || 0,
      length:         Number(b.length)  || 15,
      breadth:        Number(b.breadth) || 10,
      height:         Number(b.height)  || 10,
      weight:         Math.max(0.1, Number(b.weight) || 0.5)
    };

    console.log('[Shiprocket] Creating order:', b.order_id);

    const srResp = await axios.post(
      SR_BASE + '/orders/create/adhoc',
      payload,
      { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } }
    );

    const data = srResp.data;
    console.log('[Shiprocket] Order created — SR ID:', data.order_id, 'Shipment:', data.shipment_id);

    // Auto-assign courier + pickup (best-effort, won't fail the response if it errors)
    if (data.shipment_id) {
      autoAssignCourier(token, data.shipment_id).catch(function(e) {
        console.warn('[Shiprocket] Auto-assign warning:', e.message);
      });
    }

    return res.json({
      success:      true,
      order_id:     data.order_id,
      shipment_id:  data.shipment_id,
      awb_code:     data.awb_code     || null,
      courier_name: data.courier_name || null,
      status:       data.status       || 'NEW'
    });

  } catch (err) {
    const errBody = err.response && err.response.data ? err.response.data : null;
    console.error('[Shiprocket] create-order error:', errBody || err.message);
    if (err.response && err.response.status === 401) {
      srToken = null;
      srTokenExpiry = 0;
    }
    return res.status((err.response && err.response.status) || 500).json({
      error:   (errBody && errBody.message) || 'Shiprocket order creation failed',
      details: errBody || null
    });
  }
});

// Auto-assign best courier and schedule pickup
async function autoAssignCourier(token, shipmentId) {
  // Assign AWB with auto-selected courier
  const awbResp = await axios.post(
    SR_BASE + '/courier/assign/awb',
    { shipment_id: [String(shipmentId)] },
    { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } }
  );
  const awb = awbResp.data && awbResp.data.response && awbResp.data.response.data && awbResp.data.response.data.awb_code;
  console.log('[Shiprocket] AWB assigned:', awb);

  // Generate pickup
  const pickupResp = await axios.post(
    SR_BASE + '/courier/generate/pickup',
    { shipment_id: [shipmentId] },
    { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } }
  );
  const pickupDate = pickupResp.data && pickupResp.data.response && pickupResp.data.response.pickup_scheduled_date;
  console.log('[Shiprocket] Pickup scheduled:', pickupDate);
}

// ─── SHIPROCKET: TRACK ORDER ──────────────────────────────────────────────────
app.get('/api/track-shiprocket/:orderId', async (req, res) => {
  try {
    const token = await getShiprocketToken();
    const resp = await axios.get(
      SR_BASE + '/orders/show/' + req.params.orderId,
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    return res.json(resp.data);
  } catch (err) {
    console.error('[Shiprocket] track error:', err.message);
    return res.status(500).json({ error: 'Tracking fetch failed' });
  }
});

// ─── SHIPROCKET: AUTH TEST (debug endpoint) ───────────────────────────────────
app.get('/api/shiprocket-status', async (req, res) => {
  try {
    const token = await getShiprocketToken();
    return res.json({ status: 'ok', shiprocket: 'authenticated', tokenPreview: token.slice(0, 20) + '...' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Ascovita Backend started on port ' + PORT);
  console.log('Cashfree App ID : ' + (CF_APP_ID || 'NOT SET'));
  console.log('Shiprocket Email: ' + SR_EMAIL);
  console.log('Endpoints ready : /api/create-cashfree-order | /api/create-shiprocket-order | /api/track-shiprocket/:id');
});
