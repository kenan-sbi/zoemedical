'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const ASSERTIONS = ['CONFIRMED', 'SUSPECTED', 'HISTORICAL', 'RULED_OUT', 'FAMILY_HISTORY'];

type Provenance = { sourceText: string; spanStart: number | null; spanEnd: number | null };
type Rec = {
  id: string; type: string; coding: { display?: string } | null; payload: any;
  assertion: string; negated: boolean; confidence: number | null; status: string;
  provenance: Provenance | null;
};
type Data = {
  patient: { id: string; displayName: string } | null;
  case: { id: string; procedure: string | null };
  locked: boolean;
  signOff: { at: string; name: string | null; license: string | null } | null;
  needsReview: number;
  records: Rec[];
  me: { id: string; role: string; name: string | null; license: string | null; canSign: boolean };
};

const AUTH = { authorization: 'Bearer dev' }; // ignored when DEV_NO_AUTH=1

function ReviewInner() {
  const patientId = useSearchParams().get('patientId') ?? '';
  const [data, setData] = useState<Data | null>(null);
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [license, setLicense] = useState('');

  const load = useCallback(async () => {
    if (!patientId) return;
    const res = await fetch(`/api/review?patientId=${patientId}`, { headers: AUTH });
    const d = await res.json();
    if (!res.ok) return setMsg(`Error: ${d.error}`);
    setData(d);
    if (!name && d.me?.name) setName(d.me.name);
    if (!license && d.me?.license) setLicense(d.me.license);
  }, [patientId]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  async function accept(id: string) {
    const res = await fetch(`/api/records/${id}/accept`, { method: 'POST', headers: AUTH });
    const d = await res.json();
    setMsg(res.ok ? `Accepted.` : `Error: ${d.error}`);
    load();
  }

  async function correct(id: string, patch: any) {
    const res = await fetch(`/api/records/${id}/correct`, {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(`Error: ${d.error}`);
    setMsg('Correction saved.');
    setEditing(null);
    load();
  }

  async function signOff() {
    if (!data) return;
    const res = await fetch(`/api/case/${data.case.id}/signoff`, {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, license }),
    });
    const d = await res.json();
    setMsg(res.ok ? 'Signed off. Case locked.' : `Error: ${d.error}`);
    load();
  }

  if (!patientId) return <main><p>Add <code>?patientId=…</code> to the URL.</p></main>;
  if (!data) return <main><p>Loading… {msg}</p></main>;

  return (
    <main>
      <p><a href="/">← back</a></p>
      <h1>Review — {data.patient?.displayName ?? data.patient?.id}</h1>

      {data.signOff ? (
        <div style={{ ...box, background: '#e9f7ec', borderColor: '#3c9a53' }}>
          <strong>✓ Signed &amp; locked.</strong> Reviewed by Dr. {data.signOff.name ?? '—'}, license {data.signOff.license ?? '—'}
          {' '}on {new Date(data.signOff.at).toLocaleString()}.
        </div>
      ) : (
        <div style={box}>
          <strong>{data.needsReview}</strong> fact(s) still need review.
          {data.needsReview > 0 && ' Accept or correct them all to enable sign-off.'}
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reviewer name" style={input} />
            <input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="License #" style={input} />
            <button
              onClick={signOff}
              disabled={!data.me.canSign || data.needsReview > 0}
              title={!data.me.canSign ? 'Requires REVIEWER or OWNER role' : data.needsReview > 0 ? 'Address all NEEDS_REVIEW facts first' : ''}
              style={{ ...btn, background: data.me.canSign && data.needsReview === 0 ? '#3c9a53' : '#ccc', color: '#fff' }}
            >Sign off</button>
            {!data.me.canSign && <span style={{ color: '#a00', fontSize: 13 }}>Your role ({data.me.role}) cannot sign off.</span>}
          </div>
        </div>
      )}

      {msg && <p><strong>{msg}</strong></p>}

      {data.records.map((r) => (
        <RecordRow
          key={r.id} r={r} locked={data.locked}
          editing={editing === r.id}
          onEdit={() => setEditing(editing === r.id ? null : r.id)}
          onAccept={() => accept(r.id)}
          onCorrect={(patch) => correct(r.id, patch)}
        />
      ))}
    </main>
  );
}

function RecordRow({ r, locked, editing, onEdit, onAccept, onCorrect }: {
  r: Rec; locked: boolean; editing: boolean; onEdit: () => void;
  onAccept: () => void; onCorrect: (patch: any) => void;
}) {
  const [payloadText, setPayloadText] = useState(JSON.stringify(r.payload, null, 2));
  const [negated, setNegated] = useState(r.negated);
  const [assertion, setAssertion] = useState(r.assertion);
  const [err, setErr] = useState('');

  function save() {
    let payload: any;
    try { payload = JSON.parse(payloadText); } catch { return setErr('payload must be valid JSON'); }
    onCorrect({ payload, negated, assertion });
  }

  const highlight = r.status === 'NEEDS_REVIEW';
  return (
    <div style={{ ...box, borderColor: highlight ? '#e0a800' : '#ddd', background: highlight ? '#fffdf5' : '#fff' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={tag('#e8eefc')}>{r.type}</span>
        <strong>{r.coding?.display ?? '(no label)'}</strong>
        {r.negated && <span style={tag('#fde8e8')}>NEGATED</span>}
        <span style={tag(statusColor(r.status))}>{r.status}</span>
        <span style={{ color: '#777', fontSize: 13 }}>conf {r.confidence ?? '—'} · {r.assertion}</span>
      </div>
      <div style={{ fontSize: 14, margin: '4px 0' }}>value: <code>{JSON.stringify(r.payload)}</code></div>
      <div style={{ fontSize: 13, color: '#444' }}>
        source: <em>&ldquo;{r.provenance?.sourceText ?? '(missing!)'}&rdquo;</em>
        {r.provenance?.spanStart != null && <span style={{ color: '#999' }}> [{r.provenance.spanStart}–{r.provenance.spanEnd}]</span>}
      </div>

      {!locked && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button onClick={onAccept} style={btn}>Accept</button>
          <button onClick={onEdit} style={btn}>{editing ? 'Cancel' : 'Correct'}</button>
        </div>
      )}

      {editing && !locked && (
        <div style={{ marginTop: 10, borderTop: '1px dashed #ccc', paddingTop: 10 }}>
          <label style={lbl}>payload (JSON)</label>
          <textarea value={payloadText} onChange={(e) => setPayloadText(e.target.value)} rows={5} style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }} />
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 8 }}>
            <label><input type="checkbox" checked={negated} onChange={(e) => setNegated(e.target.checked)} /> negated</label>
            <label>assertion{' '}
              <select value={assertion} onChange={(e) => setAssertion(e.target.value)}>
                {ASSERTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <button onClick={save} style={{ ...btn, background: '#2b6cb0', color: '#fff' }}>Save correction</button>
          </div>
          <p style={{ fontSize: 12, color: '#777' }}>The provenance citation stays attached — corrections never remove it.</p>
          {err && <p style={{ color: '#a00' }}>{err}</p>}
        </div>
      )}
    </div>
  );
}

function statusColor(s: string) {
  return s === 'NEEDS_REVIEW' ? '#fff3cd' : s === 'ACCEPTED' ? '#d4edda' : s === 'CORRECTED' ? '#d1e7ff' : '#eee';
}

export default function ReviewPage() {
  return <Suspense fallback={<main><p>Loading…</p></main>}><ReviewInner /></Suspense>;
}

const box: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0' };
const input: React.CSSProperties = { padding: 8, minWidth: 180 };
const btn: React.CSSProperties = { padding: '6px 12px', cursor: 'pointer' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, color: '#555', marginBottom: 4 };
const tag = (bg: string): React.CSSProperties => ({ background: bg, borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600 });
