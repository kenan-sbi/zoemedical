'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// Front door for the whole site: one passcode, then into the Medical workspace (with a top tab to
// the Hair console). Reuses the console's /api/console/login cookie so a single passcode gates both.
const TEAL = '#0d857b', DARK = '#0b6f66', BG = '#f6f5f3', INK = '#12312d', SUB = '#5b6b68', LINE = '#e0ddd7';

function Gate() {
  const next = useSearchParams().get('next') || '/workspace';
  const [passcode, setPasscode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  // Already signed in? skip straight through.
  useEffect(() => {
    fetch('/api/console/login')
      .then((r) => r.json())
      .then((d) => { if (d.authed) window.location.href = next; else setChecking(false); })
      .catch(() => setChecking(false));
  }, [next]);

  async function login() {
    if (!passcode || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/console/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) });
      if (r.ok) { window.location.href = next; return; }
      const d = await r.json().catch(() => ({}));
      setErr(d.error || 'Incorrect passcode');
    } catch { setErr('Something went wrong — try again.'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: BG, fontFamily: 'Poppins, system-ui, sans-serif', padding: 20 }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" />
      <div style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 18, border: `1px solid ${LINE}`, boxShadow: '0 18px 50px -20px rgba(16,24,40,.35)', padding: 30, textAlign: 'center' }}>
        <div style={{ width: 54, height: 54, margin: '0 auto 14px', borderRadius: 15, background: `linear-gradient(145deg, ${TEAL}, ${DARK} 70%)`, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 26, boxShadow: '0 6px 16px rgba(13,133,123,.35)' }}>Z</div>
        <div style={{ fontWeight: 800, fontSize: 22, color: INK, letterSpacing: -0.4 }}>Zoe Intelligence</div>
        <div style={{ fontSize: 13, color: SUB, marginTop: 5, marginBottom: 22 }}>Medical &amp; Hair consult tools · enter your passcode</div>

        {checking ? (
          <div style={{ color: SUB, fontSize: 13, padding: '10px 0' }}>Loading…</div>
        ) : (
          <>
            <input type="password" value={passcode} autoFocus onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()}
              placeholder="Passcode" style={{ width: '100%', padding: '12px 14px', borderRadius: 11, border: `1px solid ${err ? '#e0857d' : LINE}`, fontSize: 15, outline: 'none', textAlign: 'center', letterSpacing: 2, boxSizing: 'border-box' }} />
            {err && <div style={{ color: '#c0392b', fontSize: 12.5, marginTop: 9 }}>{err}</div>}
            <button onClick={login} disabled={!passcode || busy}
              style={{ width: '100%', marginTop: 14, padding: '12px', borderRadius: 11, border: 'none', background: passcode && !busy ? TEAL : '#c9d6d3', color: '#fff', fontWeight: 700, fontSize: 15, cursor: passcode && !busy ? 'pointer' : 'default' }}>
              {busy ? 'Checking…' : 'Enter'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return <Suspense fallback={null}><Gate /></Suspense>;
}
