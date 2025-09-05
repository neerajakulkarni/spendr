# Spendr — Smart Financial Coach

Spendr is a **financial coaching web-app** built to help users understand their money and take action.  
It combines simple explainable math, interactive simulations, and AI into a clean desktop web experience.

This project is lightweight, fast to demo, and easy to extend.

---
DEMO VIDEO: https://drive.google.com/file/d/14LnrfP3q6VsNVKKm59NTaZtXtEfa316a/view?usp=sharing 
LINK TO DOCUMENTATION: https://drive.google.com/file/d/1mi1LISmZKZ7ALJ65-D0sqe81N-Flt8jy/view?usp=drive_link

## Features

- **Onboarding** — seeded synthetic data; can be swapped with Plaid or real imports  
- **Dashboard** — one glance at spending, savings, and financial health  
- **Spending Pulse** — weekly narrative of what changed in your money habits  
- **Untouchable % Simulator** — slider → 6-month savings forecast + AI explanation  
- **Credit Coach** — repayment simulation and utilization guardrails  
- **Subscriptions Detector** — recurring charges (Spotify, Netflix, etc.) grouped by cadence  
- **Insurance Nudge** — short form → ranked suggestions for coverage gaps  
- **Weekly Insights** — anomaly detection (spikes vs. movers) so the narrative is never empty  
- **Data** — seeded JSON (transactions, accounts) to make the demo reproducible  
- **Explainable AI** — math + rule templates (optionally backed by OpenAI if key provided)  

---

## Tech Stack

- **Web:** Next.js + TailwindCSS + Recharts (dashboard UI)  
- **API:** Node.js + Express + Prisma (reads seeded JSON or Postgres)  
- **AI Service:** Python + FastAPI (forecasts, anomalies, repayment, nudges)  
- **Database:** JSON fixtures (default) or Postgres (optional)  

---

## Getting Started

### 0) Requirements

- Node.js 18+  
- Python 3.10+  
- (Optional) Postgres 15+ if you want persistence beyond demo JSON  

---

### 1) Run the AI Service (Python/FastAPI)

```bash
cd ai
python -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Start AI service
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Runs at http://localhost:8000.  
Health check: `curl http://localhost:8000/ai/llm/health`

### 2) Run the API Server (Node/Express)

```bash
cd server
npm install

# Option A: demo with JSON data (default)
npm run dev

# Option B: use Postgres (optional)
# 1. Start Postgres locally (or via Docker)
# 2. Update DATABASE_URL in .env
# 3. Run migrations and seed
npx prisma migrate dev --name init
node prisma/seed.mjs
npm run dev
```

Runs at http://localhost:4000.  
Health check: `curl http://localhost:4000/debug/ping`

### 3) Run the Web App (Next.js)

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

---

## Demo Flow

1. Login with demo account (email: `demo@example.com`, password: `demo1234`)
2. Dashboard shows:
   - Weekly narrative ("spending pulse")
   - Credit utilization & alerts
   - Subscriptions
   - Insurance gaps (form → suggestions)
3. Slide the **Untouchable %** to simulate savings buffer with AI explanation
4. Open **Credit Coach** to test repayment + utilization guardrails

---

## Notes

- All data is synthetic for demo purposes (see `server/data/transactions.json` and `server/data/accounts.json`).
- Future developments: connect Plaid and add real authentication. 
