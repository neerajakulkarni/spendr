// web/pages/login.js
import { useState } from 'react';
const API = 'http://localhost:4000';

export default function Login() {
  const [email, setEmail] = useState('demo@example.com');
  const [password, setPassword] = useState('demo1234');
  const [mode, setMode] = useState('login');
  const [msg, setMsg] = useState('');

  const go = async () => {
    setMsg('');
    const r = await fetch(API + `/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    const data = await r.json();
    if (!r.ok) { setMsg(data.error || 'error'); return; }
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen grid place-items-center">
      <div className="card w-[380px] space-y-5 p-6">
        <div className="flex items-center justify-between">
          <h1 className="h1">Spendr</h1>
          <span className="badge">Demo</span>
        </div>

        <div className="space-y-3">
          <label className="block text-sm">
            Email
            <input className="input mt-1" value={email} onChange={e=>setEmail(e.target.value)} />
          </label>
          <label className="block text-sm">
            Password
            <input type="password" className="input mt-1" value={password} onChange={e=>setPassword(e.target.value)} />
          </label>
        </div>

        {msg && <p className="text-sm text-red-400">{msg}</p>}

        <div className="flex items-center justify-between">
          <div className="space-x-2">
            <button onClick={()=>setMode('login')}
              className={`px-3 py-1 rounded-2xl ${mode==='login' ? 'bg-white/10 border border-white/20' : 'bg-white/5 border border-white/5'}`}>
              Login
            </button>
            <button onClick={()=>setMode('signup')}
              className={`px-3 py-1 rounded-2xl ${mode==='signup' ? 'bg-white/10 border border-white/20' : 'bg-white/5 border border-white/5'}`}>
              Sign up
            </button>
          </div>
          <button onClick={go} className="btn">Submit</button>
        </div>
      </div>
    </div>
  );
}
