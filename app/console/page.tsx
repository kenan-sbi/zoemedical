'use client';
import { useCallback, useEffect, useState } from 'react';

// Phone-width detector, so fixed multi-column grids can collapse instead of shrinking to slivers.
function useIsMobile(breakpoint = 760) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [breakpoint]);
  return mobile;
}

// ---------- design tokens (same calm clinical palette as the main build) ----------
const C = {
  primary: '#0f4c5c', primaryDark: '#0a3743', accent: '#2a8fa8', warm: '#b45309',
  bg: '#eef2f5', card: '#ffffff', border: '#dce3ea', text: '#1b2a35', sub: '#5f7182', muted: '#93a1af',
};
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SHADOW = '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.04)';
const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: SHADOW };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: C.accent, cursor: 'pointer', padding: 0, fontSize: 12.5, fontWeight: 600 };

const SLOTS = [
  { key: 'front', label: 'Front hairline' },
  { key: 'top', label: 'Top-down' },
  { key: 'crown', label: 'Crown' },
  { key: 'left', label: 'Left side' },
  { key: 'right', label: 'Right side' },
] as const;
const NORWOOD = ['Norwood II', 'Norwood III', 'Norwood III vertex', 'Norwood IV', 'Norwood V', 'Norwood VI', 'Norwood VII'];
const LUDWIG = ['Ludwig I', 'Ludwig II', 'Ludwig III'];
const TECH = ['FUE', 'FUT', 'DHI'];
const stagesFor = (sex: string) => (sex === 'female' ? LUDWIG : NORWOOD);

type Photos = Partial<Record<string, string>>;
type Form = { sex: string; stage: string; graftMin: string; graftMax: string; technique: string; notes: string; photos: Photos };
type HairCase = { id: string; sex: string; stage: string; graftMin: number | null; graftMax: number | null; technique: string | null; notes: string | null; photos: Photos; isTest: boolean; estimate: any; createdAt: string };
type Estimate = { scale: string; stage: string; confidence: string; rationale: string; method: string; graftMin: number | null; graftMax: number | null; technique: string | null; basedOn: number; exactStageMatches: number; libraryTotal: number };

const emptyForm = (): Form => ({ sex: 'male', stage: '', graftMin: '', graftMax: '', technique: '', notes: '', photos: {} });
const photoUrl = (k?: string) => (k ? `/api/console/photo?key=${encodeURIComponent(k)}` : '');
const grafts = (a: number | null, b: number | null) => a == null && b == null ? '—' : a != null && b != null && a !== b ? `${a.toLocaleString()}–${b.toLocaleString()}` : `${(a ?? b)!.toLocaleString()}`;

// ---------- photo slot ----------
function PhotoSlot({ label, value, onChange, small }: { label: string; value?: string; onChange: (k: string | undefined) => void; small?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function pick(file: File) {
    setBusy(true);
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/api/console/upload', { method: 'POST', body: fd });
    const d = await r.json(); setBusy(false);
    if (r.ok) onChange(d.key); else alert(d.error || 'upload failed');
  }
  const h = small ? 92 : 116;
  return (
    <div style={{ position: 'relative' }}>
      <label style={{ display: 'block', height: h, borderRadius: 9, border: `1.5px dashed ${value ? C.accent : C.border}`, background: value ? '#000' : '#f7fafb', cursor: 'pointer', overflow: 'hidden', position: 'relative' }}>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl(value)} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 6 }}>
            <div>
              <div style={{ fontSize: 20, color: C.muted }}>{busy ? '…' : '＋'}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.sub }}>{busy ? 'Uploading' : label}</div>
            </div>
          </div>
        )}
        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.currentTarget.value = ''; }} />
      </label>
      <div style={{ fontSize: 10.5, color: C.muted, textAlign: 'center', marginTop: 3 }}>{label}</div>
      {value && <button onClick={() => onChange(undefined)} title="Remove" style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>×</button>}
    </div>
  );
}

// The 5 angle slots with drag-to-correct (swap two slots) + per-slot upload/remove.
function PhotoSlots({ photos, set }: { photos: Photos; set: (p: Photos) => void }) {
  const isMobile = useIsMobile();
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function upload(slot: string, file: File) {
    setBusy(slot);
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/api/console/upload', { method: 'POST', body: fd });
    const d = await r.json(); setBusy(null);
    if (r.ok) set({ ...photos, [slot]: d.key }); else alert(d.error || 'upload failed');
  }
  function drop(target: string) {
    const from = dragFrom; setDragFrom(null);
    if (!from || from === target) return;
    const p: Photos = { ...photos }; const t = p[target]; p[target] = p[from]; if (t) p[from] = t; else delete p[from];
    set(p);
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 10 }}>
      {SLOTS.map((s) => {
        const val = photos[s.key];
        const dragging = dragFrom === s.key;
        return (
          <div key={s.key} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); drop(s.key); }}>
            <div style={{ position: 'relative', height: 116, borderRadius: 9, border: `1.5px dashed ${dragFrom && !dragging ? C.accent : val ? C.accent : C.border}`, background: val ? '#000' : '#f7fafb', overflow: 'hidden', opacity: dragging ? 0.5 : 1 }}>
              {val ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrl(val)} alt={s.label} draggable onDragStart={() => setDragFrom(s.key)} onDragEnd={() => setDragFrom(null)} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'grab' }} />
                  <button onClick={() => { const p = { ...photos }; delete p[s.key]; set(p); }} title="Remove" style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>×</button>
                </>
              ) : (
                <label style={{ height: '100%', display: 'grid', placeItems: 'center', cursor: 'pointer', textAlign: 'center' }}>
                  <div><div style={{ fontSize: 20, color: C.muted }}>{busy === s.key ? '…' : '＋'}</div><div style={{ fontSize: 11, fontWeight: 600, color: C.sub }}>{busy === s.key ? 'Uploading' : s.label}</div></div>
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(s.key, f); e.currentTarget.value = ''; }} />
                </label>
              )}
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, textAlign: 'center', marginTop: 3 }}>{s.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- shared case fields ----------
// `suggestion` (optional) marks sex+stage as an AI suggestion that must be confirmed/overridden.
function CaseFields({ form, set, suggestion, confirmed, onConfirm }: { form: Form; set: (f: Form) => void; suggestion?: { sex: string | null; stage: string | null; confidence: string } | null; confirmed?: boolean; onConfirm?: () => void }) {
  const isMobile = useIsMobile();
  const stages = stagesFor(form.sex);
  const input: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none', width: '100%' };
  const suggesting = !!suggestion && !confirmed;
  const sugBadge = <span style={{ fontSize: 10, fontWeight: 700, color: C.warm, background: '#fdf3e6', border: `1px solid ${C.warm}`, borderRadius: 999, padding: '1px 7px', marginLeft: 6 }}>suggested — please confirm</span>;
  return (
    <div>
      <SectionLabel>Standardized photos — same five angles every case</SectionLabel>
      <div style={{ marginBottom: 16 }}><PhotoSlots photos={form.photos} set={(p) => set({ ...form, photos: p })} /></div>

      {suggesting && (
        <div style={{ ...card, padding: '10px 13px', marginBottom: 12, background: '#fdf3e6', border: `1px solid ${C.warm}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14 }}>🤖</span>
          <span style={{ fontSize: 12.5, color: '#7a5a2a' }}>AI suggestion: <strong style={{ textTransform: 'capitalize' }}>{suggestion!.sex ?? '—'}</strong> · <strong>{suggestion!.stage ?? '—'}</strong> <span style={{ color: C.muted }}>(confidence {suggestion!.confidence})</span>. This is a <strong>suggestion</strong> — confirm or change it.</span>
          <div style={{ flex: 1 }} />
          <button onClick={onConfirm} style={{ padding: '6px 13px', borderRadius: 7, border: 'none', background: C.primary, color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Confirm suggestion</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
        <div>
          <SectionLabel>Sex {suggesting && sugBadge}</SectionLabel>
          <div style={{ display: 'flex', gap: 8 }}>
            {['male', 'female'].map((s) => (
              <button key={s} onClick={() => { set({ ...form, sex: s, stage: form.sex === s ? form.stage : '' }); onConfirm?.(); }}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1px solid ${form.sex === s ? C.primary : C.border}`, background: form.sex === s ? '#e8f2f5' : '#fff', color: form.sex === s ? C.primary : C.sub, fontWeight: 700, fontSize: 13, cursor: 'pointer', textTransform: 'capitalize' }}>{s}</button>
            ))}
          </div>
        </div>
        <div>
          <SectionLabel>Stage you assign · {form.sex === 'female' ? 'Ludwig' : 'Norwood'} {suggesting && sugBadge}</SectionLabel>
          <select value={form.stage} onChange={(e) => { set({ ...form, stage: e.target.value }); onConfirm?.(); }} style={{ ...input, borderColor: suggesting ? C.warm : C.border, background: suggesting ? '#fffdf8' : '#fff' }}>
            <option value="">Select stage…</option>
            {[form.stage, ...stages.filter((s) => s !== form.stage)].filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <SectionLabel>Grafts you would quote <span style={{ color: C.primary }}>· your judgment</span></SectionLabel>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input inputMode="numeric" placeholder="min" value={form.graftMin} onChange={(e) => set({ ...form, graftMin: e.target.value.replace(/[^\d]/g, '') })} style={input} />
            <span style={{ color: C.muted }}>–</span>
            <input inputMode="numeric" placeholder="max" value={form.graftMax} onChange={(e) => set({ ...form, graftMax: e.target.value.replace(/[^\d]/g, '') })} style={input} />
          </div>
        </div>
        <div>
          <SectionLabel>Technique</SectionLabel>
          <div style={{ display: 'flex', gap: 8 }}>
            {TECH.map((t) => (
              <button key={t} onClick={() => set({ ...form, technique: form.technique === t ? '' : t })}
                style={{ flex: 1, padding: '8px 6px', borderRadius: 8, border: `1px solid ${form.technique === t ? C.primary : C.border}`, background: form.technique === t ? '#e8f2f5' : '#fff', color: form.technique === t ? C.primary : C.sub, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>{t}</button>
            ))}
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <SectionLabel>Notes</SectionLabel>
          <textarea value={form.notes} onChange={(e) => set({ ...form, notes: e.target.value })} rows={3} placeholder="Donor density, recipient plan, expectations…" style={{ ...input, resize: 'vertical', fontFamily: FONT }} />
        </div>
      </div>
    </div>
  );
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.muted, margin: '2px 0 7px' }}>{children}</div>;
}
const toPayload = (f: Form, isTest = false, estimate?: any) => ({ sex: f.sex, stage: f.stage, graftMin: f.graftMin || null, graftMax: f.graftMax || null, technique: f.technique || null, notes: f.notes || null, photos: f.photos, isTest, estimate });

// ================= main =================
export default function ConsolePage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [passcode, setPasscode] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [tab, setTab] = useState<'add' | 'library' | 'rulebook' | 'assess'>('assess');
  const [cases, setCases] = useState<HairCase[]>([]);

  const loadCases = useCallback(async () => {
    const r = await fetch('/api/console/cases');
    if (r.ok) setCases((await r.json()).cases ?? []);
  }, []);
  useEffect(() => {
    (async () => {
      const r = await fetch('/api/console/login');
      const d = await r.json();
      setAuthed(!!d.authed);
      if (d.authed) loadCases();
    })();
  }, [loadCases]);

  async function login() {
    setLoginErr('');
    const r = await fetch('/api/console/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) });
    if (r.ok) { setAuthed(true); setPasscode(''); loadCases(); } else { setLoginErr((await r.json()).error || 'Login failed'); }
  }
  async function logout() { await fetch('/api/console/login', { method: 'DELETE' }); setAuthed(false); setCases([]); }

  if (authed === null) return <Shell><div style={{ color: C.muted, textAlign: 'center', marginTop: 80 }}>Loading…</div></Shell>;
  if (!authed) return <LoginGate passcode={passcode} setPasscode={setPasscode} onLogin={login} err={loginErr} />;

  const library = cases.filter((c) => !c.isTest);
  return (
    <Shell onLogout={logout}>
      <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${C.border}`, marginBottom: 18, flexWrap: 'wrap' }}>
        {([['assess', 'New assessment'], ['add', 'Add case'], ['library', `Case library · ${library.length}`], ['rulebook', 'Rulebook']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: '9px 15px', cursor: 'pointer', border: 'none', background: 'none', fontSize: 13.5, fontWeight: tab === k ? 700 : 500, color: tab === k ? C.primary : C.sub, borderBottom: `2px solid ${tab === k ? C.primary : 'transparent'}`, marginBottom: -1 }}>{label}</button>
        ))}
      </div>
      {tab === 'assess' && <AssessTab libraryCount={library.length} />}
      {tab === 'add' && <AddTab onSaved={() => { loadCases(); setTab('library'); }} />}
      {tab === 'library' && <LibraryTab cases={library} reload={loadCases} />}
      {tab === 'rulebook' && <RulebookTab />}
    </Shell>
  );
}

function Shell({ children, onLogout }: { children: React.ReactNode; onLogout?: () => void }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, font: `14px ${FONT}` }}>
      <header style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '13px clamp(12px, 4vw, 24px)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: C.primary, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>Z</div>
        <div><div style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.2 }}>Doctor Console</div><div style={{ fontSize: 11, color: C.muted }}>Hair-transplant standards — private teaching library</div></div>
        <div style={{ flex: 1 }} />
        {onLogout && <button onClick={onLogout} style={linkBtn}>Sign out</button>}
      </header>
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '22px clamp(12px, 4vw, 24px) 60px' }}>{children}</main>
    </div>
  );
}

function LoginGate({ passcode, setPasscode, onLogin, err }: { passcode: string; setPasscode: (v: string) => void; onLogin: () => void; err: string }) {
  return (
    <Shell>
      <div style={{ ...card, maxWidth: 380, margin: '70px auto 0', padding: 26 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Surgeon sign-in</div>
        <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 16 }}>Enter your console passcode to open your private case library.</div>
        <input type="password" value={passcode} autoFocus onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onLogin()}
          placeholder="Passcode" style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 14, outline: 'none', marginBottom: 10 }} />
        {err && <div style={{ color: '#b3261e', fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
        <button onClick={onLogin} disabled={!passcode} style={{ width: '100%', padding: '10px', borderRadius: 9, border: 'none', background: passcode ? C.primary : C.border, color: '#fff', fontWeight: 700, fontSize: 14, cursor: passcode ? 'pointer' : 'default' }}>Sign in</button>
      </div>
    </Shell>
  );
}

// ---------- Add ----------
function AddTab({ onSaved }: { onSaved: () => void }) {
  const [form, setForm] = useState<Form>(emptyForm());
  const [suggestion, setSuggestion] = useState<{ sex: string | null; stage: string | null; confidence: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importedFrom, setImportedFrom] = useState<string | null>(null);

  // Import the NON-photo fields from a case note (PDF/TXT) — his own record, so it's his judgment.
  async function onImport(file: File) {
    if (/^image\//.test(file.type)) { alert('Images go in the photo area above.'); return; }
    setImporting(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await fetch('/api/console/import', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'import failed'); return; }
      const f = d.fields;
      setForm((prev) => ({
        ...prev,
        sex: f.sex || prev.sex,
        stage: f.stage || prev.stage,
        graftMin: f.graftMin != null ? String(f.graftMin) : prev.graftMin,
        graftMax: f.graftMax != null ? String(f.graftMax) : prev.graftMax,
        technique: f.technique || prev.technique,
        notes: f.notes || prev.notes,
      }));
      setSuggestion(null); setConfirmed(true); // his own note -> no AI-suggestion gate
      setImportedFrom(d.filename);
    } finally { setImporting(false); }
  }

  // Bulk: upload every dropped photo, then vision-sort into angle slots + suggest sex/stage.
  async function onBulk(files: File[]) {
    const imgs = files.filter((f) => /^image\//.test(f.type));
    if (imgs.length === 0) { alert('Drop image files (JPG/PNG/WEBP).'); return; }
    setSorting(true);
    try {
      const keys: string[] = [];
      for (const f of imgs) {
        const fd = new FormData(); fd.append('file', f);
        const r = await fetch('/api/console/upload', { method: 'POST', body: fd });
        const d = await r.json(); if (r.ok) keys.push(d.key);
      }
      if (keys.length === 0) { alert('upload failed'); return; }
      const r = await fetch('/api/console/sort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'auto-sort failed'); return; }
      // place each photo into its angle; on collision, fall to the next empty slot (drag-correctable)
      const photos: Photos = { ...form.photos };
      const order = SLOTS.map((s) => s.key);
      for (const a of d.assignments as { key: string; angle: string }[]) {
        if (!photos[a.angle]) photos[a.angle] = a.key;
        else { const empty = order.find((s) => !photos[s]); if (empty) photos[empty] = a.key; }
      }
      const sug = d.suggestion as { sex: string | null; stage: string | null; confidence: string };
      setForm((f) => ({ ...f, photos, sex: sug?.sex || f.sex, stage: sug?.stage || '' }));
      setSuggestion(sug?.stage || sug?.sex ? sug : null);
      setConfirmed(false); // must confirm before saving
    } finally { setSorting(false); }
  }

  const graftEntered = !!(form.graftMin || form.graftMax);
  const stageOk = !!form.stage && (!suggestion || confirmed);
  const canSave = stageOk && graftEntered && !!form.sex;

  async function save() {
    setSaving(true);
    const r = await fetch('/api/console/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toPayload(form)) });
    setSaving(false);
    if (!r.ok) { alert((await r.json()).error || 'save failed'); return; }
    setForm(emptyForm()); setSuggestion(null); setConfirmed(false); setImportedFrom(null); onSaved();
  }

  return (
    <div style={{ ...card, padding: 18 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Add a case</div>
      <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 16 }}>Drop the photos in any order — the system sorts them by angle and suggests a stage. Your staging and graft number are the source of truth: confirm the stage and enter your graft quote.</div>

      {/* bulk drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onBulk([...e.dataTransfer.files]); }}
        style={{ border: `2px dashed ${dragOver ? C.accent : C.border}`, borderRadius: 12, padding: '18px 20px', textAlign: 'center', background: dragOver ? '#e8f2f5' : '#f7fafb', marginBottom: 16, transition: 'all .15s' }}>
        <div style={{ fontSize: 24 }}>{sorting ? '🔎' : '📥'}</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 6 }}>{sorting ? 'Sorting photos by angle…' : 'Drop multiple scalp photos here'}</div>
        <div style={{ fontSize: 12, color: C.sub, margin: '3px 0 8px' }}>They auto-sort into front / top / crown / left / right. Drag any thumbnail between slots to correct it.</div>
        <label style={{ display: 'inline-block', padding: '7px 15px', background: C.primary, color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12.5 }}>
          Browse photos
          <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { onBulk([...(e.target.files ?? [])]); e.currentTarget.value = ''; }} />
        </label>
      </div>

      {/* import non-photo fields from a note */}
      <div
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); const f = [...e.dataTransfer.files].find((x) => !/^image\//.test(x.type)); if (f) onImport(f); }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: `1px solid ${C.border}`, borderRadius: 9, background: '#f7fafb', marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16 }}>📄</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{importing ? 'Reading note…' : 'Import case details from a note'}</div>
          <div style={{ fontSize: 11, color: C.sub }}>{importedFrom ? <span style={{ color: '#116b40' }}>✓ Filled fields from “{importedFrom}” — review below.</span> : 'PDF or TXT with your write-up — fills sex / stage / grafts / technique / notes (not photos).'}</div>
        </div>
        <label style={{ padding: '6px 13px', background: C.primary, color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12.5 }}>
          {importing ? '…' : 'Choose file'}
          <input type="file" accept=".pdf,.txt,text/plain,application/pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.currentTarget.value = ''; }} />
        </label>
      </div>

      <CaseFields form={form} set={setForm} suggestion={suggestion} confirmed={confirmed} onConfirm={() => setConfirmed(true)} />

      <div style={{ display: 'flex', gap: 12, marginTop: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={save} disabled={!canSave || saving} style={{ padding: '10px 20px', borderRadius: 9, border: 'none', background: canSave && !saving ? C.primary : C.border, color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: canSave && !saving ? 'pointer' : 'default' }}>{saving ? 'Saving…' : 'Save to library'}</button>
        {!canSave && (
          <span style={{ fontSize: 12, color: C.muted }}>
            {!stageOk ? (suggestion && !confirmed ? 'Confirm the suggested stage (or change it) to save.' : 'Set the stage.') : !graftEntered ? 'Enter your graft number — it stays your judgment.' : 'Set sex.'}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- Library ----------
function LibraryTab({ cases, reload }: { cases: HairCase[]; reload: () => void }) {
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<HairCase | null>(null);
  const stages = [...new Set(cases.map((c) => c.stage))].sort();
  const shown = filter ? cases.filter((c) => c.stage === filter) : cases;

  async function del(id: string) {
    if (!confirm('Delete this case?')) return;
    await fetch(`/api/console/cases/${id}`, { method: 'DELETE' });
    reload();
  }
  if (cases.length === 0) return <div style={{ ...card, padding: 30, textAlign: 'center', color: C.muted }}>No cases yet — add your first from the “Add case” tab.</div>;
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>Filter by stage:</span>
        <button onClick={() => setFilter('')} style={chip(filter === '')}>All · {cases.length}</button>
        {stages.map((s) => <button key={s} onClick={() => setFilter(s)} style={chip(filter === s)}>{s} · {cases.filter((c) => c.stage === s).length}</button>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {shown.map((c) => (
          <div key={c.id} style={{ ...card, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: C.border, aspectRatio: '2 / 1' }}>
              {['front', 'top', 'crown', 'left'].map((k) => (
                <div key={k} style={{ background: '#000', overflow: 'hidden' }}>
                  {c.photos?.[k] ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={photoUrl(c.photos[k])} alt={k} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: C.muted, fontSize: 10 }}>{k}</div>}
                </div>
              ))}
            </div>
            <div style={{ padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14 }}>{c.stage}</strong>
                <span style={{ fontSize: 11, color: C.sub, textTransform: 'capitalize' }}>· {c.sex}</span>
                {c.technique && <span style={{ fontSize: 11, background: '#e3eef1', color: C.primary, borderRadius: 999, padding: '1px 8px', fontWeight: 600 }}>{c.technique}</span>}
              </div>
              <div style={{ fontSize: 13, color: C.text, marginTop: 3 }}>{grafts(c.graftMin, c.graftMax)} grafts</div>
              {c.notes && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.notes}</div>}
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button onClick={() => setEditing(c)} style={linkBtn}>Edit</button>
                <button onClick={() => del(c.id)} style={{ ...linkBtn, color: '#b3261e' }}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {editing && <EditModal c={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}
const chip = (on: boolean): React.CSSProperties => ({ padding: '4px 11px', borderRadius: 999, border: `1px solid ${on ? C.primary : C.border}`, background: on ? '#e8f2f5' : '#fff', color: on ? C.primary : C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer' });

function EditModal({ c, onClose, onSaved }: { c: HairCase; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>({ sex: c.sex, stage: c.stage, graftMin: c.graftMin?.toString() ?? '', graftMax: c.graftMax?.toString() ?? '', technique: c.technique ?? '', notes: c.notes ?? '', photos: c.photos ?? {} });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await fetch(`/api/console/cases/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toPayload(form)) });
    setBusy(false);
    if (!r.ok) { alert('save failed'); return; }
    onSaved();
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,24,40,.45)', display: 'grid', placeItems: 'start center', overflow: 'auto', zIndex: 50, padding: '40px 16px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 720, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Edit case</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...linkBtn, color: C.sub, fontSize: 18 }}>×</button>
        </div>
        <CaseFields form={form} set={setForm} />
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={save} disabled={busy || !form.stage} style={{ padding: '9px 18px', borderRadius: 9, border: 'none', background: C.primary, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{busy ? 'Saving…' : 'Save changes'}</button>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 9, border: `1px solid ${C.border}`, background: '#fff', color: C.sub, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Rulebook ----------
function RulebookTab() {
  const isMobile = useIsMobile();
  const [rules, setRules] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { (async () => { const r = await fetch('/api/console/rulebook'); if (r.ok) setRules((await r.json()).rules); })(); }, []);
  async function save() {
    setBusy(true);
    const r = await fetch('/api/console/rulebook', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }) });
    setBusy(false);
    if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 1500); } else alert('save failed');
  }
  if (!rules) return <div style={{ color: C.muted }}>Loading rulebook…</div>;
  const inp: React.CSSProperties = { padding: '7px 9px', borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none', width: '100%' };
  const num = (v: any) => (v === '' || v == null ? '' : v);
  const setZone = (z: string, v: string) => setRules({ ...rules, densityPerZone: { ...rules.densityPerZone, [z]: v === '' ? '' : +v } });
  const setRow = (i: number, k: string, v: string) => { const rows = [...rules.graftRangePerStage]; rows[i] = { ...rows[i], [k]: v === '' ? '' : +v }; setRules({ ...rules, graftRangePerStage: rows }); };
  const setFlag = (i: number, v: string) => { const f = [...rules.redFlags]; f[i] = v; setRules({ ...rules, redFlags: f }); };
  const faq: { q: string; a: string }[] = Array.isArray(rules.faq) ? rules.faq : [];
  const setFaq = (next: any[]) => setRules({ ...rules, faq: next });
  const setFaqField = (i: number, k: 'q' | 'a', v: string) => { const f = [...faq]; f[i] = { ...f[i], [k]: v }; setFaq(f); };
  const moveFaq = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= faq.length) return; const f = [...faq]; [f[i], f[j]] = [f[j], f[i]]; setFaq(f); };
  return (
    <div style={{ ...card, padding: 18 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Rulebook</div>
      <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 16 }}>Your standards. The agent applies these to every assessment — edit them any time.</div>

      <SectionLabel>Target density per zone (grafts / cm²)</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(3,1fr)', gap: 10, marginBottom: 18 }}>
        {['hairline', 'mid', 'crown'].map((z) => (
          <div key={z}><div style={{ fontSize: 12, color: C.sub, marginBottom: 4, textTransform: 'capitalize' }}>{z}</div><input inputMode="numeric" value={num(rules.densityPerZone?.[z])} onChange={(e) => setZone(z, e.target.value.replace(/[^\d]/g, ''))} style={inp} /></div>
        ))}
      </div>

      <SectionLabel>Graft range per stage</SectionLabel>
      <div style={{ ...card, overflow: 'hidden', marginBottom: 18 }}>
        {rules.graftRangePerStage.map((row: any, i: number) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 10, alignItems: 'center', padding: '7px 12px', borderTop: i ? `1px solid ${C.bg}` : 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{row.stage}</div>
            <input inputMode="numeric" placeholder="min" value={num(row.min)} onChange={(e) => setRow(i, 'min', e.target.value.replace(/[^\d]/g, ''))} style={inp} />
            <input inputMode="numeric" placeholder="max" value={num(row.max)} onChange={(e) => setRow(i, 'max', e.target.value.replace(/[^\d]/g, ''))} style={inp} />
          </div>
        ))}
      </div>

      <SectionLabel>Donor-supply assessment</SectionLabel>
      <textarea value={rules.donorSupply ?? ''} onChange={(e) => setRules({ ...rules, donorSupply: e.target.value })} rows={3} style={{ ...inp, resize: 'vertical', fontFamily: FONT, marginBottom: 18 }} />

      <SectionLabel>Red flags to screen for</SectionLabel>
      <div style={{ marginBottom: 18 }}>
        {rules.redFlags.map((f: string, i: number) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input value={f} onChange={(e) => setFlag(i, e.target.value)} style={inp} />
            <button onClick={() => setRules({ ...rules, redFlags: rules.redFlags.filter((_: any, j: number) => j !== i) })} style={{ ...linkBtn, color: '#b3261e', flexShrink: 0 }}>✕</button>
          </div>
        ))}
        <button onClick={() => setRules({ ...rules, redFlags: [...rules.redFlags, ''] })} style={linkBtn}>+ Add red flag</button>
      </div>

      <SectionLabel>FAQ / My standards — your answers, in your words</SectionLabel>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 10 }}>The agent treats these as authoritative — same weight as your ranges — and voices assessment summaries in <strong>your</strong> phrasing and policy, not generic AI answers.</div>
      <div style={{ marginBottom: 14 }}>
        {faq.length === 0 && <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8 }}>No entries yet. Add your standards below — e.g. how you decide candidacy, how you handle limited donor supply, what you tell a Norwood 6, whether there’s an age limit.</div>}
        {faq.map((item, i) => (
          <div key={i} style={{ ...card, padding: 12, marginBottom: 10, borderLeft: `3px solid ${C.accent}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>Entry {i + 1}</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => moveFaq(i, -1)} disabled={i === 0} title="Move up" style={{ ...linkBtn, color: i === 0 ? C.border : C.sub }}>↑</button>
              <button onClick={() => moveFaq(i, 1)} disabled={i === faq.length - 1} title="Move down" style={{ ...linkBtn, color: i === faq.length - 1 ? C.border : C.sub }}>↓</button>
              <button onClick={() => setFaq(faq.filter((_, j) => j !== i))} title="Delete" style={{ ...linkBtn, color: '#b3261e' }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: C.sub, marginBottom: 3 }}>Question</div>
            <input value={item.q ?? ''} onChange={(e) => setFaqField(i, 'q', e.target.value)} placeholder="e.g. How do you decide if someone’s a candidate?" style={{ ...inp, marginBottom: 8, fontWeight: 600 }} />
            <div style={{ fontSize: 11, color: C.sub, marginBottom: 3 }}>Your answer</div>
            <textarea value={item.a ?? ''} onChange={(e) => setFaqField(i, 'a', e.target.value)} rows={3} placeholder="Your policy, in your own words…" style={{ ...inp, resize: 'vertical', fontFamily: FONT }} />
          </div>
        ))}
        <button onClick={() => setFaq([...faq, { q: '', a: '' }])} style={linkBtn}>+ Add FAQ entry</button>
      </div>

      <button onClick={save} disabled={busy} style={{ padding: '10px 20px', borderRadius: 9, border: 'none', background: saved ? '#116b40' : C.primary, color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>{busy ? 'Saving…' : saved ? '✓ Saved' : 'Save rulebook'}</button>
    </div>
  );
}

// ---------- New assessment (the agent) ----------
type Intake = { sex: string; age: string; duration: string; photos: Photos };
type Assessment = { id: string; sex: string; age: number | null; duration: string | null; photos: Photos; estimate: any; finalStage: string | null; finalGraftMin: number | null; finalGraftMax: number | null; finalNotes: string | null; signedName: string | null; signedLicense: string | null; signedAt: string | null; createdAt: string };
const PRELIM = (
  <div style={{ ...card, padding: '9px 13px', marginBottom: 14, background: '#fdf3e6', border: `1px solid ${C.warm}`, fontSize: 12, color: '#7a5a2a' }}>
    ⚠ Physician-operated pre-consultation tool. Outputs are <strong>preliminary estimates (ranges)</strong>, require physician review, and are <strong>not a diagnosis</strong>.
  </div>
);

function IntakeFields({ intake, set }: { intake: Intake; set: (v: Intake) => void }) {
  const isMobile = useIsMobile();
  const input: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none', width: '100%' };
  return (
    <div>
      <SectionLabel>Guided photos — same five angles every time</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
        {SLOTS.map((s) => <PhotoSlot key={s.key} label={s.label} value={intake.photos[s.key]} onChange={(k) => set({ ...intake, photos: { ...intake.photos, [s.key]: k } })} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 12 }}>
        <div>
          <SectionLabel>Sex</SectionLabel>
          <div style={{ display: 'flex', gap: 8 }}>
            {['male', 'female'].map((s) => <button key={s} onClick={() => set({ ...intake, sex: s })} style={{ flex: 1, padding: '8px 6px', borderRadius: 8, border: `1px solid ${intake.sex === s ? C.primary : C.border}`, background: intake.sex === s ? '#e8f2f5' : '#fff', color: intake.sex === s ? C.primary : C.sub, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', textTransform: 'capitalize' }}>{s}</button>)}
          </div>
        </div>
        <div><SectionLabel>Age</SectionLabel><input inputMode="numeric" placeholder="e.g. 34" value={intake.age} onChange={(e) => set({ ...intake, age: e.target.value.replace(/[^\d]/g, '') })} style={input} /></div>
        <div><SectionLabel>Duration of loss</SectionLabel><input placeholder="e.g. 3 years" value={intake.duration} onChange={(e) => set({ ...intake, duration: e.target.value })} style={input} /></div>
      </div>
    </div>
  );
}

function AssessTab({ libraryCount }: { libraryCount: number }) {
  const [intake, setIntake] = useState<Intake>({ sex: 'male', age: '', duration: '', photos: {} });
  const [active, setActive] = useState<{ assessment: Assessment; references: HairCase[] } | null>(null);
  const [list, setList] = useState<Assessment[]>([]);
  const [busy, setBusy] = useState(false);
  const loadList = useCallback(async () => { const r = await fetch('/api/console/assessment'); if (r.ok) setList((await r.json()).assessments ?? []); }, []);
  useEffect(() => { loadList(); }, [loadList]);
  const hasPhoto = Object.values(intake.photos).some(Boolean);

  async function run() {
    setBusy(true); setActive(null);
    const r = await fetch('/api/console/assessment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sex: intake.sex, age: intake.age || null, duration: intake.duration || null, photos: intake.photos }) });
    const d = await r.json(); setBusy(false);
    if (!r.ok) { alert(d.error || 'assessment failed'); return; }
    setActive({ assessment: d.assessment, references: d.references ?? [] });
    setIntake({ sex: 'male', age: '', duration: '', photos: {} });
    loadList();
  }
  async function open(id: string) {
    const r = await fetch(`/api/console/assessment/${id}`);
    if (r.ok) { const d = await r.json(); setActive({ assessment: d.assessment, references: d.references ?? [] }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }

  return (
    <div>
      {PRELIM}
      {!active && (
        <div style={{ ...card, padding: 18, marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>New assessment</div>
          <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 16 }}>New patient photos + intake. The agent reads the photos, pulls your most similar cases, applies your rulebook, and returns a preliminary range for your review.</div>
          <IntakeFields intake={intake} set={setIntake} />
          <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center' }}>
            <button onClick={run} disabled={!hasPhoto || busy} style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: hasPhoto && !busy ? C.accent : C.border, color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: hasPhoto && !busy ? 'pointer' : 'default' }}>{busy ? 'Analyzing photos…' : 'Run assessment'}</button>
            {!hasPhoto && <span style={{ fontSize: 12, color: C.muted }}>Upload at least a front, top &amp; crown photo.</span>}
            {libraryCount === 0 && <span style={{ fontSize: 12, color: C.warm }}>Tip: add a few cases first so it calibrates to you.</span>}
          </div>
        </div>
      )}

      {active && <AssessmentView data={active} onDone={() => { setActive(null); loadList(); }} onChange={(a) => setActive({ ...active, assessment: a })} />}

      {list.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <SectionLabel>Past assessments · {list.length}</SectionLabel>
          {list.map((a) => (
            <div key={a.id} className="zrow" onClick={() => open(a.id)} style={{ ...card, padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <span style={{ fontSize: 15 }}>🧑</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.finalStage || a.estimate?.stage || '—'} <span style={{ color: C.sub, fontWeight: 400 }}>· {grafts(a.finalGraftMin ?? a.estimate?.graftMin ?? null, a.finalGraftMax ?? a.estimate?.graftMax ?? null)} grafts</span></div>
                <div style={{ fontSize: 11, color: C.muted }}>{a.sex}{a.age ? ` · ${a.age}y` : ''} · {new Date(a.createdAt).toLocaleDateString()}</div>
              </div>
              {a.signedAt ? <span style={{ fontSize: 11, background: '#dcf1e6', color: '#116b40', borderRadius: 999, padding: '2px 9px', fontWeight: 700 }}>signed · final</span> : <span style={{ fontSize: 11, background: '#fdf3e6', color: C.warm, borderRadius: 999, padding: '2px 9px', fontWeight: 700 }}>preliminary</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssessmentView({ data, onDone, onChange }: { data: { assessment: Assessment; references: HairCase[] }; onDone: () => void; onChange: (a: Assessment) => void }) {
  const isMobile = useIsMobile();
  const a = data.assessment; const est = a.estimate ?? {}; const v = est.vision ?? {};
  const signed = !!a.signedAt;
  const [fStage, setFStage] = useState(a.finalStage ?? est.stage ?? '');
  const [fMin, setFMin] = useState((a.finalGraftMin ?? est.graftMin ?? '').toString());
  const [fMax, setFMax] = useState((a.finalGraftMax ?? est.graftMax ?? '').toString());
  const [fNotes, setFNotes] = useState(a.finalNotes ?? '');
  const [name, setName] = useState(a.signedName ?? '');
  const [license, setLicense] = useState(a.signedLicense ?? '');
  const [busy, setBusy] = useState(false);
  const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none', width: '100%' };

  async function sign() {
    if (!name.trim() || !license.trim()) { alert('Enter your name and license to sign.'); return; }
    setBusy(true);
    const r = await fetch(`/api/console/assessment/${a.id}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, license, finalStage: fStage, finalGraftMin: fMin || null, finalGraftMax: fMax || null, finalNotes: fNotes }) });
    const d = await r.json(); setBusy(false);
    if (!r.ok) { alert(d.error || 'sign-off failed'); return; }
    onChange(d.assessment);
  }
  const stages = stagesFor(a.sex);

  return (
    <div style={{ ...card, padding: 18, marginBottom: 18, borderTop: `3px solid ${signed ? '#116b40' : C.warm}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Assessment</div>
        {signed
          ? <span style={{ fontSize: 11, background: '#dcf1e6', color: '#116b40', borderRadius: 999, padding: '3px 10px', fontWeight: 700 }}>✓ signed · final · 🔒</span>
          : <span style={{ fontSize: 11, background: '#fdf3e6', color: C.warm, borderRadius: 999, padding: '3px 10px', fontWeight: 700 }}>preliminary — not final</span>}
        <div style={{ flex: 1 }} />
        <button onClick={onDone} style={linkBtn}>← New / back</button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>{a.sex}{a.age ? ` · ${a.age}y` : ''}{a.duration ? ` · loss ~${a.duration}` : ''}</div>

      {/* (a) vision read */}
      <SectionLabel>What the photos show{est.method === 'vision' ? '' : ' (photo analysis unavailable — library fallback)'}</SectionLabel>
      <div style={{ ...card, padding: 14, marginBottom: 14, background: '#f7fafb' }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{v.description || est.summary}</div>
        {(v.pattern || v.recession || v.coverage) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {v.pattern && <Tag k="Pattern" val={v.pattern} />}{v.recession && <Tag k="Recession" val={v.recession} />}{v.coverage && <Tag k="Coverage" val={v.coverage} />}
          </div>
        )}
      </div>

      {/* (d) preliminary estimate — RANGES only */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div style={{ ...card, padding: 14, borderLeft: `3px solid ${C.accent}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: .5 }}>Preliminary stage</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{est.stage}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{est.scale} scale · confidence {est.confidence}</div>
        </div>
        <div style={{ ...card, padding: 14, borderLeft: `3px solid ${C.accent}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: .5 }}>Preliminary graft range</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{grafts(est.graftMin, est.graftMax)}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>grafts (range){est.technique ? ` · ${est.technique}` : ''}</div>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.55, marginBottom: 6 }}>{est.coverageNote}</div>
      <div style={{ ...card, padding: 12, background: '#f7fafb', fontSize: 13, lineHeight: 1.55, marginBottom: Array.isArray(est.appliedFaq) && est.appliedFaq.length ? 8 : 14 }}>{est.summary}</div>
      {Array.isArray(est.appliedFaq) && est.appliedFaq.length > 0 && (
        <div style={{ marginBottom: 14, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.accent }}>Your standards applied:</span>
          {est.appliedFaq.map((q: string, i: number) => <span key={i} style={{ fontSize: 11, background: '#e3eef1', color: C.primary, borderRadius: 7, padding: '2px 8px' }}>{q}</span>)}
        </div>
      )}

      {/* red flags */}
      {Array.isArray(est.redFlags) && est.redFlags.length > 0 && (
        <div style={{ ...card, padding: '10px 14px', marginBottom: 14, background: '#fbe3e0', border: '1px solid #f3c9c4' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#b3261e', marginBottom: 4 }}>⚠ Red flags to review</div>
          {est.redFlags.map((f: string, i: number) => <div key={i} style={{ fontSize: 12.5, color: '#b3261e' }}>· {f}</div>)}
        </div>
      )}

      {/* (b) which of his cases it used */}
      <SectionLabel>Reference cases used · {data.references.length} of your case{data.references.length !== 1 ? 's' : ''}{est.exactStageMatches ? ` (${est.exactStageMatches} at this stage)` : ''}</SectionLabel>
      {data.references.length === 0
        ? <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 14 }}>No matching cases yet — add cases at this stage to calibrate the range to you. (Range fell back to your rulebook.)</div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
            {data.references.map((c) => (
              <div key={c.id} style={{ ...card, overflow: 'hidden' }}>
                <div style={{ aspectRatio: '3/2', background: '#000' }}>
                  {c.photos?.top || c.photos?.front ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={photoUrl(c.photos.top || c.photos.front)} alt="ref" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: C.muted, fontSize: 11 }}>no photo</div>}
                </div>
                <div style={{ padding: '7px 9px' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{c.stage}</div>
                  <div style={{ fontSize: 11.5, color: C.sub }}>{grafts(c.graftMin, c.graftMax)}{c.technique ? ` · ${c.technique}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}

      {/* (PART 3) physician review + sign-off */}
      {signed ? (
        <div style={{ ...card, padding: '13px 16px', background: '#f2faf5', border: '1px solid #bfe3cd' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#116b40' }}>✓ Reviewed &amp; signed off by Dr. {a.signedName} · Saudi license #{a.signedLicense}</div>
          <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>Final: <strong>{a.finalStage}</strong> · <strong>{grafts(a.finalGraftMin, a.finalGraftMax)}</strong> grafts. Signed {new Date(a.signedAt!).toLocaleString()} · 🔒 locked.</div>
          {a.finalNotes && <div style={{ fontSize: 12.5, color: C.text, marginTop: 6 }}>{a.finalNotes}</div>}
        </div>
      ) : (
        <div style={{ ...card, padding: 16, borderLeft: `4px solid ${C.warm}`, background: '#fffdf8' }}>
          <SectionLabel>Physician review &amp; sign-off — adjust, then sign to finalize</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div><div style={{ fontSize: 11, color: C.sub, marginBottom: 3 }}>Final stage</div>
              <select value={fStage} onChange={(e) => setFStage(e.target.value)} style={inp}>{[fStage, ...stages.filter((s) => s !== fStage)].filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><div style={{ fontSize: 11, color: C.sub, marginBottom: 3 }}>Graft min</div><input inputMode="numeric" value={fMin} onChange={(e) => setFMin(e.target.value.replace(/[^\d]/g, ''))} style={inp} /></div>
            <div><div style={{ fontSize: 11, color: C.sub, marginBottom: 3 }}>Graft max</div><input inputMode="numeric" value={fMax} onChange={(e) => setFMax(e.target.value.replace(/[^\d]/g, ''))} style={inp} /></div>
          </div>
          <div style={{ fontSize: 11, color: C.sub, marginBottom: 3 }}>Notes</div>
          <textarea value={fNotes} onChange={(e) => setFNotes(e.target.value)} rows={2} placeholder="Any adjustment or note for the record…" style={{ ...inp, resize: 'vertical', fontFamily: FONT, marginBottom: 12 }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Physician name (Dr. …)" style={{ ...inp, flex: '1 1 180px', width: 'auto' }} />
            <input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="Saudi license #" style={{ ...inp, flex: '0 1 150px', width: 'auto' }} />
            <button onClick={sign} disabled={busy} style={{ padding: '9px 18px', borderRadius: 9, border: 'none', background: '#116b40', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{busy ? 'Signing…' : 'Sign off & finalize'}</button>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>Nothing is final until you sign. Your signature stamps the record and locks it.</div>
        </div>
      )}
    </div>
  );
}
function Tag({ k, val }: { k: string; val: string }) {
  return <span style={{ fontSize: 11.5, background: '#e3eef1', color: C.primary, borderRadius: 7, padding: '3px 9px' }}><strong>{k}:</strong> {val}</span>;
}
