// pages/index.js
import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const API = 'http://localhost:4000';

function Card({ title, children, right }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="h2">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function Home() {
  // auth gate
  useEffect(() => {
    fetch('http://localhost:4000/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (!d.userId) window.location.href = '/login'; });
  }, []);

  // dashboard state
  const [summary, setSummary] = useState(null);
  const [pct, setPct] = useState(0.2);
  const [forecast, setForecast] = useState(null);
  const [untouchableExpl, setUntouchableExpl] = useState(null);

  // insurance results state (for the in-card panel)
  const [ins, setIns] = useState({ loading:false, error:null, items:[] });

  useEffect(() => {
    (async () => {
      const r = await fetch(API + '/dashboard/summary', { credentials: 'include' });
      if (r.status === 401) { window.location.href = '/login'; return; }
      const data = await r.json();
      setSummary(data);
    })();
  }, []);

  const runForecast = async (p) => {
    setPct(p);
    const r = await fetch(API + '/budgets/untouchable', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({ percent: p })
    });
    const data = await r.json();
    setForecast(data);
    setUntouchableExpl(null);

    try {
      if (summary) {
        const r2 = await fetch('http://localhost:8000/ai/explain/untouchable', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({
            monthly_income: summary.income,
            baseline_spend: summary.baseline,
            chosen_pct: p,
            suggested_pct: data.suggested_pct,
            first_month_buffer: data.series?.[0]?.projected_savings ?? 0
          })
        });
        const ex = await r2.json();
        setUntouchableExpl(ex.explanation || null);
      }
    } catch {
      setUntouchableExpl(null);
    }
  };

  useEffect(() => { if (summary) runForecast(pct); }, [summary]);

  // Insurance assess handler (replaces alert with inline panel)
  const onAssess = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      monthly_rent: Number(fd.get('rent')||0),
      assets_value: Number(fd.get('assets')||0),
      international_trips_per_year: Number(fd.get('trips')||0),
      drives_and_has_auto_loan: !!fd.get('auto'),
      dependents: Number(fd.get('deps')||0),
      doctor_visits_last_year: Number(fd.get('visits')||0)
    };

    try{
      setIns({ loading:true, error:null, items:[] });
      const r = await fetch(API + '/insurance/assess',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        credentials:'include',
        body: JSON.stringify(body)
      });
      const data = await r.json();
      if(!r.ok || !Array.isArray(data?.suggestions)){
        setIns({ loading:false, error:'Could not assess right now.', items:[] });
        return;
      }
      setIns({ loading:false, error:null, items:data.suggestions });
    }catch{
      setIns({ loading:false, error:'Network error.', items:[] });
    }
  };

  return (
    <div className="container py-8 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <h1 className="h1">Spendr</h1>
        <div className="hidden md:flex gap-2">
          <span className="badge">Income: ${summary?.income ?? '—'}</span>
          <span className="badge">Baseline: ${summary?.baseline ?? '—'}</span>
          <span className="badge">Utilization: {summary?.credit?.utilization ?? '—'}%</span>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-5">
        {/* Left column */}
        <div className="col-span-12 lg:col-span-8 space-y-5">
          <Card title="Spending Pulse">
            {!summary ? (
              <p className="text-muted">Loading…</p>
            ) : (
              <p className="text-sm text-muted">{summary.weekly_narrative}</p>
            )}
          </Card>

          <Card
            title="Untouchable % Simulator"
            right={forecast && (
              <div className="text-sm text-muted">
                Suggested: <span className="text-slate-100">{Math.round(forecast.suggested_pct*100)}%</span>
              </div>
            )}
          >
            <div className="flex items-center gap-4">
              <input
                type="range" min="0.05" max="0.5" step="0.05"
                value={pct} onChange={(e)=>runForecast(parseFloat(e.target.value))}
              />
              <div className="badge">{Math.round(pct*100)}%</div>
            </div>

            <div className="mt-5 h-64">
              {forecast ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={forecast.series} margin={{ left: -10, right: 10, top: 5 }}>
                    <XAxis dataKey="month_index" tick={{fill:'#94a3b8'}} axisLine={{stroke:'#334155'}} tickLine={{stroke:'#334155'}}/>
                    <YAxis tick={{fill:'#94a3b8'}} axisLine={{stroke:'#334155'}} tickLine={{stroke:'#334155'}}/>
                    <Tooltip contentStyle={{background:'rgba(15,23,42,.95)', border:'1px solid #1f2943', borderRadius:12, color:'#e2e8f0'}}/>
                    <Line type="monotone" dataKey="projected_savings" stroke="#7CFFB2" strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-muted">Calculating…</p>}
            </div>

            {untouchableExpl && (
              <div
                className="mt-4 p-4 rounded-2xl border"
                style={{
                  borderColor:'rgba(124,255,178,.3)',
                  background:'linear-gradient(180deg, rgba(124,255,178,.08), rgba(124,255,178,.03))',
                  boxShadow:'var(--glow)'
                }}
              >
                <p className="text-sm">{untouchableExpl}</p>
              </div>
            )}
          </Card>

          <Card title="Weekly Insights">
            {summary ? (
              <div className="overflow-x-auto">
                {(summary.spikes && summary.spikes.length > 0) ? (
                  <table className="text-sm">
                    <thead>
                      <tr>
                        <th className="py-2 text-left">Spike Category</th>
                        <th className="py-2 text-left">Z</th>
                        <th className="py-2 text-left">Latest</th>
                        <th className="py-2 text-left">Avg Prior</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.spikes.map((s, i) => (
                        <tr key={i} className="border-slate-800">
                          <td className="py-2">{s.category}</td>
                          <td className="py-2">{s.zscore}</td>
                          <td className="py-2">${Math.abs(s.latest_total)}</td>
                          <td className="py-2">${Math.abs(s.avg_prior)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div>
                    <p className="text-sm text-muted mb-3">
                      No unusual spikes this month — nice and steady. Here are the top category movers:
                    </p>
                    <table className="text-sm">
                      <thead>
                        <tr>
                          <th className="py-2 text-left">Category</th>
                          <th className="py-2 text-left">Δ vs Prior Avg</th>
                          <th className="py-2 text-left">Latest</th>
                          <th className="py-2 text-left">Avg Prior</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(summary.movers ?? []).map((s, i) => (
                          <tr key={i} className="border-slate-800">
                            <td className="py-2">{s.category}</td>
                            <td className="py-2">${Math.abs(s.delta)}</td>
                            <td className="py-2">${Math.abs(s.latest_total)}</td>
                            <td className="py-2">${Math.abs(s.avg_prior)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : <p className="text-muted">Loading…</p>}
          </Card>
        </div>

        {/* Right column */}
        <div className="col-span-12 lg:col-span-4 space-y-5">
          <Card title="Credit Health" right={<span className="badge">Coach</span>}>
            {!summary ? <p className="text-muted">Loading…</p> : (
              <div className="space-y-2 text-sm">
                <p><b>Utilization:</b> {summary?.credit?.utilization != null ? `${summary.credit.utilization}%` : '—'}</p>
                {(summary?.credit?.alerts ?? []).map((a,i)=>(
                  <p key={i} className="text-amber-400">{a}</p>
                ))}
                <a href="/credit" className="btn mt-2">Open Credit Coach</a>
              </div>
            )}
          </Card>

          <Card title="Subscriptions">
            {!summary ? <p className="text-muted">Loading…</p> : (
              <div className="space-y-2 text-sm">
                {(summary.subscriptions ?? []).map((s,i)=>(
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-2xl px-3 py-2 border"
                    style={{borderColor:'var(--border)', background:'rgba(255,255,255,.03)'}}
                  >
                    <span>{s.merchant} {s.probable ? <span className="text-xs text-muted">(likely)</span> : null}</span>
                    <span>${Math.abs(s.avg_amount)}/~{Math.round(s.avg_cadence_days)}d</span>
                  </div>
                ))}
                {(summary.subscriptions ?? []).length === 0 && <p className="text-muted">None detected yet.</p>}
              </div>
            )}
          </Card>

          {/* Insurance card with inline results */}
          <Card title="Insurance Gaps">
            <div className="space-y-4">
              <form className="space-y-2" onSubmit={onAssess}>
                <input name="rent"   placeholder="Monthly rent ($)"         className="input" />
                <input name="assets" placeholder="Assets value ($)"         className="input" />
                <input name="trips"  placeholder="Intl trips / yr"          className="input" />
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="auto" /> Drives & has auto loan
                </label>
                <input name="deps"   placeholder="Dependents"               className="input" />
                <input name="visits" placeholder="Doctor visits last year"  className="input" />
                <button className="btn w-full" type="submit">
                  {ins.loading ? 'Assessing…' : 'Assess Coverage'}
                </button>
              </form>

              <div className="rounded-2xl border p-3 glow-panel">
                <div className="flex items-center justify-between mb-2">
                  <div className="h2">Top suggestions</div>
                  {ins.items.length > 0 && <span className="badge">{ins.items.length}</span>}
                </div>

                {ins.error && <p className="text-sm text-red-400">{ins.error}</p>}
                {!ins.error && !ins.loading && ins.items.length === 0 && (
                  <p className="text-sm text-muted">No major gaps detected yet. Try adding rent, assets, or travel.</p>
                )}

                <div className="space-y-2">
                  {ins.items.map((s, i) => (
                    <div key={i} className="suggestion">
                      <div className="title">
                        <div className="flex items-center gap-2">
                          <span className="dot" />
                          <span className="capitalize">{s.type.replace('_',' / ')}</span>
                        </div>
                        <span className="cost">~${s.est_cost_per_month ?? s.est_cost_per_trip ?? 0}/mo</span>
                      </div>
                      <p className="why">{s.why}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
