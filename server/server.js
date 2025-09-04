// server/server.js (ESM)
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 4000;
const AI_BASE = process.env.AI_BASE || 'http://localhost:8000';

// __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); 
    const ok =
      origin.startsWith('http://localhost:3000') ||
      origin.startsWith('http://127.0.0.1:3000') ||
      origin.startsWith('http://dhcp-v037-206:3000'); 
    cb(null, ok);
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.options('*', cors({
  origin: true,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,   
    sameSite: 'lax',  
  },
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'auth' });
  next();
}

async function getOrCreateDefaultAccounts(userId) {
  const types = ['income','checking','savings','credit'];
  const map = {};
  for (const t of types) {
    const a = await prisma.account.upsert({
      where: { userId_name: { userId, name: t } },
      update: {},
      create: { userId, type: t, name: t, balance: 0 }
    });
    map[t] = a.id;
  }
  return map;
}

async function dbTransactions(userId) {
  return prisma.transaction.findMany({
    where: { userId },
    orderBy: { date: 'asc' }
  });
}

const FIXTURE_TX = (() => {
  try {
    const p = path.join(__dirname, 'data', 'transactions.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {}
  return [];
})();

function monthlyIncomeArray(tx) {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - 90); // last 90 days
  const pos = tx
    .filter(t => new Date(t.date) >= from && Number(t.amount) > 0)
    .map(t => Number(t.amount))
    .reduce((a,b)=>a+b, 0);

    return Math.round(pos / 3);
}

function monthlyBaselineSpendArray(tx) {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - 90);
  const neg = tx
    .filter(t => new Date(t.date) >= from && Number(t.amount) < 0)
    .map(t => Number(t.amount))
    .reduce((a,b)=>a+b, 0);
  return Math.abs(Math.round(neg / 3));
}

// SIGNUP
app.post('/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email/password required' });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(400).json({ error: 'email exists' });

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, password: hash } });
  await getOrCreateDefaultAccounts(user.id);

  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'session regen failed' });
    req.session.userId = user.id;
    req.session.save(e => {
      if (e) return res.status(500).json({ error: 'session save failed' });
      res.json({ ok: true });
    });
  });
});

// LOGIN
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.password) return res.status(400).json({ error: 'invalid' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: 'invalid' });

  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'session regen failed' });
    req.session.userId = user.id;
    req.session.save(e => {
      if (e) return res.status(500).json({ error: 'session save failed' });
      res.json({ ok: true });
    });
  });
});

// LOGOUT (unchanged)
app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/me', (req,res) => {
  res.json({ userId: req.session.userId || null });
});

app.get('/debug/session', (req, res) => {
  res.json({ sid: req.sessionID, session: req.session, cookies: req.headers.cookie || null });
});

app.get('/debug/ping', (req, res) => res.json({ ok: true }));

app.post('/debug/seed-demo', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const acct = await getOrCreateDefaultAccounts(userId);

    // Clear existing txns for a clean demo (optional)
    await prisma.transaction.deleteMany({ where: { userId } });

    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = (n) => new Date(y, m, n);

    const tx = [
      // Income (biweekly)
      { date: d(1),  amount: 1900,  merchant: 'Payroll', category: 'income', account_type: 'income' },
      { date: d(15), amount: 1900,  merchant: 'Payroll', category: 'income', account_type: 'income' },

      // Bills & subs
      { date: d(2),  amount: -1600, merchant: 'Rent',     category: 'housing',    account_type: 'checking' },
      { date: d(5),  amount: -60,   merchant: 'Verizon',  category: 'utilities',  account_type: 'checking' },
      { date: d(6),  amount: -55,   merchant: 'Wi-Fi',      category: 'utilities',  account_type: 'checking' },
      { date: d(7),  amount: -11,   merchant: 'Spotify',  category: 'subscription',account_type: 'credit', is_recurring: true },
      { date: d(8),  amount: -16,   merchant: 'Netflix',  category: 'subscription',account_type: 'credit', is_recurring: true },
      { date: d(9),  amount: -29,   merchant: 'Gym',      category: 'subscription',account_type: 'credit', is_recurring: true },

      // Discretionary
      { date: d(10), amount: -65,   merchant: 'Starbucks', category: 'coffee',     account_type: 'credit' },
      { date: d(12), amount: -120,  merchant: 'Walmart',   category: 'groceries',  account_type: 'checking' },
      { date: d(18), amount: -140,  merchant: 'Target',   category: 'groceries',  account_type: 'checking' },
      { date: d(20), amount: -85,   merchant: 'Restaurant',  category: 'dining',     account_type: 'credit' },
    ];

    await prisma.transaction.createMany({
      data: tx.map(t => ({
        userId,
        accountId: acct[t.account_type],
        date: t.date,
        amount: t.amount,
        merchant: t.merchant,
        category: t.category,
        isRecurring: !!t.is_recurring
      }))
    });

    // Give the credit account a live balance/limit for utilization
    await prisma.account.update({
      where: { id: acct['credit'] },
      data: { balance: 780, creditLimit: 2000, apr: 23.99 }
    });

    res.json({ ok: true, inserted: tx.length });
  } catch (e) {
    console.error('/debug/seed-demo error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Adds last month's copies of key merchants to create cadence & history
app.post('/debug/seed-more', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const acct = await getOrCreateDefaultAccounts(userId);

    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const d = (n) => new Date(lastMonth.getFullYear(), lastMonth.getMonth(), n);

    const prev = [
      { date: d(1),  amount: 1900, merchant: 'Payroll',  category: 'income',        account_type: 'income' },
      { date: d(15), amount: 1900, merchant: 'Payroll',  category: 'income',        account_type: 'income' },
      { date: d(2),  amount: -1600,merchant: 'Rent',     category: 'housing',       account_type: 'checking' },
      { date: d(5),  amount: -60,  merchant: 'Verizon',  category: 'utilities',     account_type: 'checking' },
      { date: d(6),  amount: -55,  merchant: 'Wi-Fi',      category: 'utilities',     account_type: 'checking' },
      { date: d(7),  amount: -11,  merchant: 'Spotify',  category: 'subscription',  account_type: 'credit', is_recurring: true },
      { date: d(8),  amount: -16,  merchant: 'Netflix',  category: 'subscription',  account_type: 'credit', is_recurring: true },
      { date: d(9),  amount: -29,  merchant: 'Gym',      category: 'subscription',  account_type: 'credit', is_recurring: true },
      { date: d(10), amount: -58,  merchant: 'Starbucks', category: 'coffee',        account_type: 'credit' },
      { date: d(12), amount: -115, merchant: 'Walmart',   category: 'groceries',     account_type: 'checking' },
      { date: d(18), amount: -130, merchant: 'Target',   category: 'groceries',     account_type: 'checking' },
      { date: d(20), amount: -92,  merchant: 'Restaurant',  category: 'dining',        account_type: 'credit' },
    ];

    await prisma.transaction.createMany({
      data: prev.map(t => ({
        userId,
        accountId: acct[t.account_type],
        date: t.date,
        amount: t.amount,
        merchant: t.merchant,
        category: t.category,
        isRecurring: !!t.is_recurring
      }))
    });

    res.json({ ok: true, inserted: prev.length });
  } catch (e) {
    console.error('/debug/seed-more error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/insurance/assess', requireAuth, async (req, res) => {
  try {
    const r = await axios.post(`${AI_BASE}/ai/insurance/nudge`, req.body, { timeout: 8000 });
    const suggestions = Array.isArray(r.data?.suggestions) ? r.data.suggestions : [];
    res.json({ suggestions });
  } catch (e) {
    console.warn('/insurance/assess error:', e?.message || e);
    res.status(200).json({ suggestions: [] }); // keep client happy
  }
});


// ---------- Dashboard Summary ----------
app.get('/dashboard/summary', requireAuth, async (req, res) => {
  const userId = req.session.userId;

  try {
    // 1) Get txns (DB or fixtures)
    const txns = await dbTransactions(userId);
    let txArray = txns.length ? txns : FIXTURE_TX;

    // 2) Normalize for AI svc (ensure required keys & ISO dates)
    //    Fallback account_type to 'checking' if unknown.
    const norm = txArray.map(t => ({
      date: new Date(t.date).toISOString().slice(0,10),
      amount: Number(t.amount),
      merchant: t.merchant || 'Unknown',
      category: t.category || 'other',
      account_type: t.account_type || t.type || 'checking',
      is_recurring: !!(t.isRecurring ?? t.is_recurring)
    }));

    // 3) Aggregates for badges
    const income = monthlyIncomeArray(norm);
    const baseline = monthlyBaselineSpendArray(norm);

    // 4) Call AI svc with timeouts and independent error handling
    const ai = axios.create({ baseURL: AI_BASE, timeout: 8000 });

    const [subsP, spikesP, moversP] = await Promise.allSettled([
      ai.post('/ai/subscriptions/detect', { transactions: norm }),
      ai.post('/ai/spend/insights',       { transactions: norm }),
      ai.post('/ai/spend/movers',         { transactions: norm })
    ]);

    const subscriptions =
      subsP.status === 'fulfilled' ? subsP.value.data.subscriptions : [];
    const spikes =
      spikesP.status === 'fulfilled' ? spikesP.value.data.spikes : [];
    const movers =
      moversP.status === 'fulfilled' ? moversP.value.data.movers : [];

    // 5) Credit guardrails (safe fallback)
    let credit = { utilization: 39.0, alerts: [
      "Demo default: pay a small amount before statement close to reduce utilization."
    ] };

    try {
      const creditAcct = await prisma.account.findFirst({
        where: { userId, type: 'credit' }
      });

      const payload = creditAcct ? {
        balance: (creditAcct.balance && creditAcct.balance > 0) ? creditAcct.balance : 780,
        apr_annual: (creditAcct.apr && creditAcct.apr > 0) ? creditAcct.apr : 23.99,
        min_payment: 35,
        extra_payment: 0,
        credit_limit: (creditAcct.creditLimit && creditAcct.creditLimit > 0) ? creditAcct.creditLimit : 2000
      } : {
        balance: 780, apr_annual: 23.99, min_payment: 35, extra_payment: 0, credit_limit: 2000
      };

      const r = await ai.post('/ai/credit/repayment', payload);
      credit = r.data.guardrails;
    } catch (e) {
      console.warn('[credit guardrails] fallback used:', e?.message || e);
    }

    // 6) Narrative (don’t fail the whole route)
    let weekly_narrative = 'Stable week.';
    try {
      const metrics = {
        income,
        baseline,
        credit_utilization: credit.utilization,
        subscriptions_count: subscriptions.length,
        top_spike_category: spikes[0]?.category || null,
        untouchable_pct: 0.2
      };
      const r = await ai.post('/ai/narrative', { metrics });
      weekly_narrative = r.data.narrative || weekly_narrative;
    } catch (e) {
      console.warn('[narrative] fallback used:', e?.message || e);
    }

    // 7) Respond
    res.json({
      income,
      baseline,
      credit,
      subscriptions,
      spikes,
      movers,
      weekly_narrative
    });
  } catch (err) {
    console.error('[/dashboard/summary] fatal:', err);
    res.status(500).json({ error: 'summary_failed', detail: String(err?.message || err) });
  }
});

// ---------- Untouchable forecast (persists budget) ----------
app.post('/budgets/untouchable', requireAuth, async (req,res) => {
  const userId = req.session.userId;
  const { percent, starting_savings = 350 } = req.body;

  const txns = await dbTransactions(userId);
  const txArray = txns.length ? txns : FIXTURE_TX;
  const income = monthlyIncomeArray(txArray);
  const baseline = monthlyBaselineSpendArray(txArray);

  const r = await axios.post(`${AI_BASE}/ai/untouchable/forecast`, {
    monthly_income: income,
    monthly_baseline_spend: baseline,
    untouchable_pct: percent,
    starting_savings,
    months: 6
  });

  await prisma.budget.upsert({
    where: { userId },
    update: { untouchablePct: percent },
    create: { userId, untouchablePct: percent }
  });

  res.json(r.data);
});

// ---------- Credit simulate (with explainer) ----------
app.post('/credit/simulate', requireAuth, async (req,res) => {
  try {
    const { balance, apr, min_payment, extra_payment, credit_limit } = req.body;
    const sim = await axios.post(`${AI_BASE}/ai/credit/repayment`, {
      balance, apr_annual: apr, min_payment, extra_payment, credit_limit
    });

    let explanation = null;
    try {
      const ex = await axios.post(`${AI_BASE}/ai/explain/credit`, {
        balance,
        apr_annual: apr,
        min_months: sim.data.simulation.min_only.months,
        min_interest: sim.data.simulation.min_only.total_interest,
        plus_months: sim.data.simulation.min_plus_extra.months,
        plus_interest: sim.data.simulation.min_plus_extra.total_interest,
        utilization: sim.data.guardrails.utilization
      });
      explanation = ex.data.explanation;
    } catch (innerErr) {}

    res.json({ ...sim.data, explanation });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Credit simulation failed' });
  }
});

// ---------- Insurance assess pass-through ----------
app.post('/insurance/assess', requireAuth, async (req,res) => {
  const r = await axios.post(`${AI_BASE}/ai/insurance/nudge`, req.body);
  res.json(r.data);
});

app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
