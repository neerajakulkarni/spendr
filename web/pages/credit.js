import { useState } from 'react';
const API = 'http://localhost:4000';

export default function Credit() {
  const [form, setForm] = useState({ balance: 780, apr: 23.99, min_payment: 35, extra_payment: 50, credit_limit: 2000 });
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const go = async () => {
    setErr(null);
    try {
      const r = await fetch(API + '/credit/simulate', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        credentials: 'include',
        body: JSON.stringify(form)
      });
      const data = await r.json();
      if (!r.ok || data.error) { setErr(data.error || 'Simulation failed'); setResult(null); return; }
      if (!data.guardrails) data.guardrails = { utilization: 0, alerts: [] };
      setResult(data);
    } catch { setErr('Network error'); setResult(null); }
  };

  return (
    <div className="container py-8 space-y-6">
      <a href="/" className="text-indigo-300">← Back</a>
      <h1 className="h1">Credit Coach</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card space-y-3">
          <div className="grid grid-cols-2 gap-4">
            {Object.entries(form).map(([k,v])=> (
              <label key={k} className="text-sm">
                <div className="mb-1 capitalize">{k.replace('_',' ')}</div>
                <input className="input" value={v} onChange={e=>setForm(f=>({...f,[k]: Number(e.target.value)}))} />
              </label>
            ))}
          </div>
          <button className="btn" onClick={go}>Simulate</button>
          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="card">
          {!result ? <p className="text-sm text-muted">Enter values and simulate.</p> : (
            <div className="text-sm space-y-2">
              <p><b>Utilization:</b> {result?.guardrails?.utilization != null ? `${result.guardrails.utilization}%` : '—'}</p>
              {(result?.guardrails?.alerts ?? []).map((a,i)=>(
                <p key={i} className="text-amber-400">{a}</p>
              ))}

              <div className="mt-4">
                <h3 className="h2">Minimum Only</h3>
                <p>Months: {result?.simulation?.min_only?.months ?? 'N/A'}</p>
                <p>Total interest: {result?.simulation?.min_only?.total_interest ?? 'N/A'}</p>
              </div>
              <div className="mt-4">
                <h3 className="h2">Min + Extra</h3>
                <p>Months: {result?.simulation?.min_plus_extra?.months ?? 'N/A'}</p>
                <p>Total interest: {result?.simulation?.min_plus_extra?.total_interest ?? 'N/A'}</p>
              </div>

              {result?.explanation && (
                <div className="mt-4 p-4 rounded-2xl border" style={{borderColor:'rgba(124,255,178,.3)', background:'linear-gradient(180deg, rgba(124,255,178,.08), rgba(124,255,178,.03))', boxShadow:'var(--glow)'}}>
                  {result.explanation}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
