
from fastapi import FastAPI
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import os, json, requests, traceback
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Query

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
LAST_LLM_ERROR = None

def llm_chat(messages, temperature=0.2, max_tokens=220):
    global LAST_LLM_ERROR
    LAST_LLM_ERROR = None
    if not OPENAI_API_KEY:
        LAST_LLM_ERROR = "OPENAI_API_KEY not set"
        return None
    try:
        r = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENAI_MODEL or "gpt-4o-mini",
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
            timeout=20,
        )
        if r.status_code != 200:
            # capture body, see the cause (e.g., invalid model, auth, quota)
            LAST_LLM_ERROR = f"HTTP {r.status_code}: {r.text[:500]}"
            return None
        return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        LAST_LLM_ERROR = f"{type(e).__name__}: {e}"
        print("LLM ERROR:", LAST_LLM_ERROR)
        traceback.print_exc()
        return None


app = FastAPI(title="Smart Financial Coach AI Service", version="0.1.0")

@app.get("/ai/llm/health")
def llm_health():
    has_key = bool(OPENAI_API_KEY)
    if not has_key:
        return {"ok": False, "has_key": False, "reason": "OPENAI_API_KEY not set"}
    msg = [
        {"role": "system", "content": "Reply with exactly PONG"},
        {"role": "user", "content": "Test"},
    ]
    text = llm_chat(msg, temperature=0.0, max_tokens=5)
    ok = (text is not None and text.strip() == "PONG")
    return {"ok": ok, "has_key": True, "sample": text, "error": LAST_LLM_ERROR}

@app.on_event("startup")
async def on_startup():
    print("AI svc ready — health route registered")

class Transaction(BaseModel):
    date: str
    amount: float  # negative = spend, positive = income
    merchant: str
    category: str
    account_type: str  # 'checking', 'credit', 'savings', 'income'
    is_recurring: Optional[bool] = False

class InsightsRequest(BaseModel):
    transactions: List[Transaction]

class SubscriptionsRequest(BaseModel):
    transactions: List[Transaction]

class UntouchableForecastRequest(BaseModel):
    monthly_income: float
    monthly_baseline_spend: float
    untouchable_pct: float  # 0.0 - 1.0
    starting_savings: float = 0.0
    months: int = 6

class CreditSimRequest(BaseModel):
    balance: float
    apr_annual: float
    min_payment: float
    extra_payment: float = 0.0
    credit_limit: float = 1000.0

class InsuranceProfile(BaseModel):
    monthly_rent: float = 0.0
    assets_value: float = 0.0
    international_trips_per_year: int = 0
    drives_and_has_auto_loan: bool = False
    dependents: int = 0
    doctor_visits_last_year: int = 0

class NarrativeRequest(BaseModel):
    metrics: Dict[str, Any]

class ExplainUntouchableReq(BaseModel):
    monthly_income: float
    baseline_spend: float
    chosen_pct: float
    suggested_pct: float
    first_month_buffer: float

class ExplainCreditReq(BaseModel):
    balance: float
    apr_annual: float
    min_months: Optional[int] = None
    min_interest: Optional[float] = None
    plus_months: Optional[int] = None
    plus_interest: Optional[float] = None
    utilization: float


def detect_recurring(transactions: List[Transaction]) -> List[Dict[str, Any]]:
    df = pd.DataFrame([t.dict() for t in transactions])
    df['date'] = pd.to_datetime(df['date'])
    df = df[df['amount'] < 0]  # spend only
    if df.empty:
        return []

    KNOWN = ['spotify','netflix','hulu','disney','apple','gym','nytimes','washington post','amazon prime','prime video']
    out = []

    for merchant, g in df.groupby('merchant'):
        g = g.sort_values('date')
        mlow = merchant.lower()
        # Strong signal: 2+ charges ~monthly
        if len(g) >= 2:
            deltas = g['date'].diff().dropna().dt.days.values
            if len(deltas) > 0:
                mean_delta = float(np.mean(deltas))
                std_delta = float(np.std(deltas)) if len(deltas) > 1 else 0.0
                if 20 <= mean_delta <= 40:
                    out.append({
                        "merchant": merchant,
                        "avg_amount": round(float(g['amount'].mean()), 2),
                        "avg_cadence_days": round(mean_delta, 1),
                        "variance_days": round(std_delta, 1),
                        "count": int(len(g)),
                        "probable": False
                    })
                    continue

        # Heuristic: single charge but known subscription merchant → mark probable
        if len(g) == 1 and any(k in mlow for k in KNOWN):
            out.append({
                "merchant": merchant,
                "avg_amount": round(float(g['amount'].mean()), 2),
                "avg_cadence_days": 30.0,
                "variance_days": 0.0,
                "count": 1,
                "probable": True
            })

    out.sort(key=lambda x: (x.get("probable", False), -abs(x["avg_amount"])), reverse=True)
    return out[:6]

def zscore_category_spikes(transactions: List[Transaction]) -> List[Dict[str, Any]]:
    df = pd.DataFrame([t.dict() for t in transactions])
    df['date'] = pd.to_datetime(df['date'])
    df['month'] = df['date'].dt.to_period('M').dt.to_timestamp()
    df_spend = df[df['amount'] < 0]
    if df_spend.empty:
        return []
    agg = df_spend.groupby(['month', 'category'])['amount'].sum().reset_index()
    latest_month = agg['month'].max()
    spikes = []
    for cat, g in agg.groupby('category'):
        hist = g[g['month'] < latest_month]['amount'].values
        if len(hist) < 2:
            continue
        mu, sigma = np.mean(hist), np.std(hist)
        latest = g[g['month'] == latest_month]['amount'].sum()
        if sigma == 0:
            continue
        z = (latest - mu) / sigma

        if abs(z) > 1.2:
            spikes.append({
                "category": cat,
                "latest_month": str(latest_month.date()),
                "zscore": round(float(z), 2),
                "avg_prior": round(float(mu), 2),
                "latest_total": round(float(latest), 2)
            })
    spikes.sort(key=lambda x: abs(x["zscore"]), reverse=True)
    return spikes[:5]

def top_category_movers(transactions: List[Transaction]) -> List[Dict[str, Any]]:
    df = pd.DataFrame([t.dict() for t in transactions])
    df['date'] = pd.to_datetime(df['date'])
    df['month'] = df['date'].dt.to_period('M').dt.to_timestamp()
    df_spend = df[df['amount'] < 0]
    if df_spend.empty:
        return []

    agg = df_spend.groupby(['month', 'category'])['amount'].sum().reset_index()
    latest_month = agg['month'].max()
    rows = []

    for cat, g in agg.groupby('category'):
        hist = g[g['month'] < latest_month]['amount'].values
        latest = g[g['month'] == latest_month]['amount'].sum()
        if len(hist) == 0:
            # No history → show latest totals as movers
            rows.append({
                "category": cat,
                "latest_month": str(latest_month.date()),
                "delta": round(float(latest), 2),
                "avg_prior": 0.0,
                "latest_total": round(float(latest), 2)
            })
        else:
            mu = np.mean(hist)
            delta = latest - mu
            rows.append({
                "category": cat,
                "latest_month": str(latest_month.date()),
                "delta": round(float(delta), 2),
                "avg_prior": round(float(mu), 2),
                "latest_total": round(float(latest), 2)
            })

    rows.sort(key=lambda x: abs(x["delta"]), reverse=True)
    return rows[:5]


def simulate_cashflow(monthly_income: float, monthly_baseline_spend: float,
                      untouchable_pct: float, starting_savings: float, months: int):
    # deterministic simulation
    savings = starting_savings
    series = []
    for m in range(months):
        to_save = monthly_income * untouchable_pct
        spendable = monthly_income - to_save
        net = spendable - monthly_baseline_spend
        # if negative, dip into savings (assume emergency fund use)
        savings += to_save + max(net, 0) + min(net, 0)
        series.append({
            "month_index": m+1,
            "projected_savings": round(float(savings), 2),
            "spendable": round(float(spendable), 2),
            "net_after_baseline": round(float(net), 2)
        })
    # basic safe bounds suggestion: ensure 1.2x monthly spend buffer
    target_buffer = 1.2 * (monthly_baseline_spend / 4)  # ~ one week and some
    # if savings after first month < target buffer,  suggest lowering pct slightly
    suggested_pct = untouchable_pct
    if series[0]["projected_savings"] < target_buffer:
        suggested_pct = max(0.05, untouchable_pct - 0.05)
    elif series[0]["projected_savings"] > 2 * target_buffer:
        suggested_pct = min(0.5, untouchable_pct + 0.05)
    return series, suggested_pct

def simulate_credit_payoff(balance: float, apr_annual: float, min_payment: float, extra_payment: float):
    monthly_rate = apr_annual / 100 / 12
    def run(pay_extra: float):
        b = balance
        months = 0
        total_interest = 0.0
        schedule = []
        while b > 0 and months < 600:
            interest = b * monthly_rate
            pay = max(min_payment, 0) + pay_extra
            principal = pay - interest
            if principal <= 0:

                schedule.append({"month": months+1, "balance": round(b,2), "interest": round(interest,2), "payment": round(pay,2)})
                return {"months": None, "total_interest": None, "schedule": schedule, "note": "Payment too low to reduce balance."}
            b = max(0.0, b - principal)
            total_interest += interest
            months += 1
            schedule.append({"month": months, "balance": round(b,2), "interest": round(interest,2), "payment": round(pay,2)})
            if b <= 0: break
        return {"months": months, "total_interest": round(total_interest,2), "schedule": schedule}
    return {"min_only": run(0.0), "min_plus_extra": run(extra_payment)}

def utilization_guardrails(balance: float, credit_limit: float):
    util = (balance / credit_limit) if credit_limit else 1.0
    alerts = []
    if util >= 0.5:
        alerts.append("High utilization (≥50%) can significantly hurt credit scores. Aim to pay down before statement close.")
    elif util >= 0.3:
        alerts.append("Utilization above 30% may start to affect your score. Consider a small extra payment.")
    return {"utilization": round(util*100,1), "alerts": alerts}

def insurance_suggestions(profile: InsuranceProfile):
    suggestions = []
    # renters
    if profile.monthly_rent >= 800 and profile.assets_value >= 3000:
        suggestions.append({"type":"renters","est_cost_per_month":15,"why":"Protect ~$%d of belongings; common claims cost >$1,000." % profile.assets_value})
    # travel
    if profile.international_trips_per_year >= 1:
        suggestions.append({"type":"travel_medical","est_cost_per_trip":30,"why":"International trips can have out-of-network care. Short-term coverage prevents large expenses."})
    # auto/gap
    if profile.drives_and_has_auto_loan:
        suggestions.append({"type":"auto/gap","est_cost_per_month":8,"why":"If car is totaled early in loan, gap covers difference between value and remaining loan."})
    # health add-on
    if profile.doctor_visits_last_year >= 3 and profile.dependents >= 1:
        suggestions.append({"type":"health_addon","est_cost_per_month":20,"why":"Frequent visits + dependents → consider lower co-pay/urgent care add-ons."})
    # rank simple by potential impact count
    return suggestions[:3]


@app.post("/ai/spend/insights")
def ai_spend_insights(req: InsightsRequest):
    spikes = zscore_category_spikes(req.transactions)
    return {"spikes": spikes}

@app.post("/ai/subscriptions/detect")
def ai_subscriptions_detect(req: SubscriptionsRequest):
    groups = detect_recurring(req.transactions)
    return {"subscriptions": groups}

@app.post("/ai/untouchable/forecast")
def ai_untouchable_forecast(req: UntouchableForecastRequest):
    series, suggested_pct = simulate_cashflow(
        req.monthly_income, req.monthly_baseline_spend, req.untouchable_pct, req.starting_savings, req.months
    )
    return {"series": series, "suggested_pct": suggested_pct}

@app.post("/ai/credit/repayment")
def ai_credit_repayment(req: CreditSimRequest):
    sims = simulate_credit_payoff(req.balance, req.apr_annual, req.min_payment, req.extra_payment)
    guards = utilization_guardrails(req.balance, req.credit_limit)
    return {"simulation": sims, "guardrails": guards}

@app.post("/ai/insurance/nudge")
def ai_insurance_nudge(profile: InsuranceProfile):
    return {"suggestions": insurance_suggestions(profile)}

@app.post("/ai/spend/movers")
def ai_spend_movers(req: InsightsRequest):
    return {"movers": top_category_movers(req.transactions)}

@app.post("/ai/narrative")
def ai_narrative(req: NarrativeRequest):
    msg = [
        {"role": "system", "content": "You are a careful, friendly money coach. Be brief (2–3 sentences), concrete, and non-judgmental. Never give legal or tax advice."},
        {"role": "user", "content": f"Metrics JSON: {json.dumps(req.metrics)}\nTurn the numbers into a short, encouraging weekly check-in. Include one tiny action the user can take next week."}
    ]
    text = llm_chat(msg, temperature=0.25, max_tokens=180)
    if not text:
        m = req.metrics
        parts = []
        if "top_spike_category" in m and m["top_spike_category"]:
            parts.append(f"Spending in {m['top_spike_category']} was higher than usual.")
        if "untouchable_pct" in m:
            parts.append(f"Untouchable rate: {int(m['untouchable_pct']*100)}%.")
        if "credit_utilization" in m:
            parts.append(f"Credit utilization: {m['credit_utilization']}%. Keep it <30% if possible.")
        if "subscriptions_count" in m:
            parts.append(f"{m['subscriptions_count']} recurring charges on file.")
        text = (" ".join(parts) or "Stable week. No notable anomalies.") + " Tiny action: review one subscription."
    return {"narrative": text}

@app.post("/ai/explain/untouchable")
def explain_untouchable(req: ExplainUntouchableReq):
    inc = float(req.monthly_income)
    base = float(req.baseline_spend)
    chosen = float(req.chosen_pct)
    sugg = float(req.suggested_pct)
    buf1 = float(req.first_month_buffer)

    chosen_save = inc * chosen
    sugg_save = inc * sugg
    delta_save = sugg_save - chosen_save
    spendable = inc - chosen_save
    net_after_baseline = spendable - base

    base_text = (
        f"At {int(chosen*100)}% you’ll set aside ${chosen_save:.0f} this month, leaving ${spendable:.0f} to spend "
        f"and a first-month buffer of ${buf1:.0f}. "
        f"Our safe bound suggests {int(sugg*100)}% (≈ ${sugg_save:.0f}), "
        f"{'+' if delta_save>=0 else ''}${delta_save:.0f} vs your choice. "
        f"Net after baseline ${base:.0f} is {'+' if net_after_baseline>=0 else ''}${net_after_baseline:.0f}."
    )

    msg = [
        {"role": "system", "content": "Rewrite the user's note in 2 short sentences, friendly and practical. "
                                      "Do NOT change any numbers or percentages. Keep them exactly as given."},
        {"role": "user", "content": base_text + " End with one tiny next step (e.g., try the suggested % for one paycheck)."}
    ]
    text = llm_chat(msg, temperature=0.15, max_tokens=140) or base_text
    return {"explanation": text}

# @app.get("/ai/llm/health")
# def llm_health():
#     has_key = bool(OPENAI_API_KEY)
#     if not has_key:
#         return {"ok": False, "has_key": False, "reason": "OPENAI_API_KEY not set"}

#     msg = [
#         {"role": "system", "content": "Reply with exactly PONG"},
#         {"role": "user", "content": "Test"},
#     ]
#     text = llm_chat(msg, temperature=0.0, max_tokens=5)
#     ok = (text is not None and text.strip() == "PONG")
#     return {"ok": ok, "has_key": True, "sample": text}

@app.post("/ai/explain/credit")
def explain_credit(req: ExplainCreditReq):
    bal = float(req.balance)
    apr = float(req.apr_annual)
    util = float(req.utilization)
    m_mo = req.min_months
    m_int = req.min_interest
    p_mo = req.plus_months
    p_int = req.plus_interest

    base_text = (
        f"Balance ${bal:.0f} at {apr:.2f}% APR. "
        f"Minimum only: {m_mo if m_mo is not None else 'N/A'} months, ${m_int if m_int is not None else 'N/A'} interest. "
        f"Min+extra: {p_mo if p_mo is not None else 'N/A'} months, ${p_int if p_int is not None else 'N/A'} interest. "
        f"Current utilization {util:.1f}%."
    )

    msg = [
        {"role": "system", "content": "Rewrite in 2 short sentences, friendly and practical. "
                                      "Do NOT change numbers or percentages; keep them identical."},
        {"role": "user", "content": base_text + " Suggest a tiny next step to lower utilization. If {util:.1f} is less than 30%, add the step but with a small compliment."}
    ]
    text = llm_chat(msg, temperature=0.15, max_tokens=140) or base_text
    return {"explanation": text}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

