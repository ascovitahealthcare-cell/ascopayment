# Ascovita Healthcare — Payment & Shipping Backend

> Node.js backend for **Cashfree** payments and **Shiprocket** order fulfilment.
> Live at: [https://ascopayment-2-0.onrender.com](https://ascopayment-2-0.onrender.com)

---

## 🚀 Tech Stack

- **Node.js** + **Express** — REST API server
- **Cashfree** — Payment gateway (Production mode)
- **Shiprocket** — Order creation, courier assignment, pickup scheduling
- **Render** — Cloud hosting

---

## 📁 Project Structure

```
ascovita-backend/
├── server.js          ← Main server (all API endpoints)
├── package.json       ← Dependencies
├── .env.example       ← Environment variable template (safe to commit)
├── .gitignore         ← Keeps secrets out of GitHub
└── README.md          ← This file
```

---

## ⚙️ Environment Variables

**Never put real credentials in code.** All secrets are stored as environment variables.

Copy `.env.example` to `.env` for local development:

```bash
cp .env.example .env
# Then fill in your real values in .env
```

| Variable | Description |
|---|---|
| `CASHFREE_APP_ID` | Your Cashfree App ID (from Cashfree dashboard) |
| `CASHFREE_SECRET_KEY` | Your Cashfree Secret Key |
| `SHIPROCKET_EMAIL` | Your Shiprocket login email |
| `SHIPROCKET_PASSWORD` | Your Shiprocket login password |
| `PORT` | Server port (Render sets this automatically) |

---

## 🌐 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/api/create-cashfree-order` | Create Cashfree payment session |
| `GET` | `/api/verify-order/:orderId` | Verify Cashfree payment status |
| `POST` | `/api/cashfree-webhook` | Cashfree payment webhook |
| `POST` | `/api/create-shiprocket-order` | Push order to Shiprocket |
| `GET` | `/api/track-shiprocket/:orderId` | Track a Shiprocket order |
| `GET` | `/api/shiprocket-status` | Test Shiprocket authentication |

---

## 🏭 Warehouse (Primary)

```
Name    : Primary  ← must match exactly in Shiprocket panel
Address : Amin Auto Road, Near Rajshivalay Cinema
City    : Anand
State   : Gujarat
PIN     : 388001
SPOC    : Amit Dantani
```

---

## 🖥️ Deploy on Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New Web Service → Connect your repo
3. Set **Build Command**: `npm install`
4. Set **Start Command**: `node server.js`
5. Add all environment variables under **Environment** tab
6. Click **Deploy**

---

## 🔒 Security Notes

- `.env` is in `.gitignore` — your real passwords are **never** pushed to GitHub
- The backend never exposes credentials to the frontend
- Shiprocket token is cached server-side for 10 days and auto-refreshes
- All Cashfree API calls use server-side secret keys only

---

## 📞 Support

**Ascovita Healthcare**
- Email: Ascovitahealthcare@gmail.com
- WhatsApp: +91 98985 82650
- Address: Near Rajshivalay Cinema, Anand – 388001, Gujarat
