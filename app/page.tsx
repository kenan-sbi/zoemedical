'use client';
import { useEffect, useState } from 'react';

type Provenance = { sourceText: string; page: number | null; spanStart: number | null; spanEnd: number | null };
type Record = {
  id: string;
  type: string;
  coding: { display?: string } | null;
  payload: any;
  assertion: string;
  negated: boolean;
  confidence: number | null;
  status: string;
  provenance: Provenance | null;
};
type Job = { stage: string; status: string; error: string | null } | null;

export default function Home() {
  const [patientName, setPatientName] = useState('');
  const [patientId, setPatientId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [records, setRecords] = useState<Record[]>([]);
  const [job, setJob] = useState<Job>(null);
  const [msg, setMsg] = useState('');
  const [polling, setPolling] = useState(false);

  async function createPatient() {
    setMsg('Creating patient…');
    const res = await fetch('/api/patient', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: patientName }),
    });
    const data = await res.json();
    if (!res.ok) return setMsg(`Error: ${data.error}`);
    setPatientId(data.id);
    setRecords([]);
    setJob(null);
    setMsg(`Patient created: ${data.id}`);
  }

  async function upload() {
    if (!patientId || !file) return setMsg('Need a patient and a file first.');
    setMsg('Uploading…');
    const form = new FormData();
    form.append('file', file);
    form.append('patientId', patientId);
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { authorization: 'Bearer dev' }, // ignored when DEV_NO_AUTH=1
      body: form,
    });
    const data = await res.json();
    if (!res.ok) return setMsg(`Error: ${data.error}`);
    setMsg(`Queued document ${data.documentId}. Extracting…`);
    setPolling(true);
  }

  // Poll records for the selected patient while polling is on.
  useEffect(() => {
    if (!patientId || !polling) return;
    let stop = false;
    const tick = async () => {
      const res = await fetch(`/api/records?patientId=${patientId}`);
      const data = await res.json();
      if (stop) return;
      setRecords(data.records ?? []);
      setJob(data.job ?? null);
      if (data.job && (data.job.status === 'DONE' || data.job.status === 'FAILED')) {
        setPolling(false);
      }
    };
    tick();
    const h = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(h); };
  }, [patientId, polling]);

  return (
    <main>
      <h1>Zoe Medical — extraction loop (Slice 1)</h1>
      <p><a href="/workspace"><strong>→ Open analysis workspace</strong></a></p>

      <section style={box}>
        <h2>1. Create patient</h2>
        <input value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="Patient display name" style={input} />
        <button onClick={createPatient} disabled={!patientName.trim()} style={btn}>Create</button>
        {patientId && <p style={{ color: '#555' }}>patientId: <code>{patientId}</code></p>}
      </section>

      <section style={box}>
        <h2>2. Upload document</h2>
        <p style={{ color: '#555', marginTop: 0 }}>Use <code>samples/discharge_summary.txt</code>.</p>
        <input type="file" accept=".txt,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button onClick={upload} disabled={!patientId || !file} style={btn}>Upload &amp; extract</button>
      </section>

      {msg && <p><strong>{msg}</strong></p>}
      {job && <p>Job: stage <code>{job.stage}</code> / status <code>{job.status}</code>{job.error ? ` — ${job.error}` : ''}{polling ? ' (polling…)' : ''}</p>}

      <section style={box}>
        <h2>3. Extracted clinical records {records.length > 0 && `(${records.length})`}</h2>
        {records.length > 0 && patientId && (
          <p><a href={`/review?patientId=${patientId}`}><strong>→ Review &amp; sign this patient</strong></a></p>
        )}
        {records.length === 0 && <p style={{ color: '#777' }}>No records yet.</p>}
        {records.map((r) => (
          <div key={r.id} style={{ borderTop: '1px solid #eee', padding: '10px 0' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={tag('#e8eefc')}>{r.type}</span>
              <strong>{r.coding?.display ?? '(no label)'}</strong>
              {r.negated && <span style={tag('#fde8e8')}>NEGATED</span>}
              {r.status === 'NEEDS_REVIEW' && <span style={tag('#fff3cd')}>NEEDS_REVIEW</span>}
              <span style={{ color: '#777', fontSize: 13 }}>
                conf {r.confidence ?? '—'} · {r.assertion}
              </span>
            </div>
            <div style={{ fontSize: 14, margin: '4px 0' }}>value: <code>{JSON.stringify(r.payload)}</code></div>
            <div style={{ fontSize: 13, color: '#444' }}>
              source: <em>&ldquo;{r.provenance?.sourceText ?? '(missing!)'}&rdquo;</em>
              {r.provenance?.spanStart != null && <span style={{ color: '#999' }}> [{r.provenance.spanStart}–{r.provenance.spanEnd}]</span>}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

const box: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '16px 0' };
const input: React.CSSProperties = { padding: 8, marginRight: 8, minWidth: 240 };
const btn: React.CSSProperties = { padding: '8px 14px', cursor: 'pointer' };
const tag = (bg: string): React.CSSProperties => ({ background: bg, borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600 });
