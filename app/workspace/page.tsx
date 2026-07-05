'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TopNav } from '../topnav';

const AUTH = { authorization: 'Bearer dev' }; // ignored when DEV_NO_AUTH=1

// ---------- design system: warm clinical palette (teal + warm neutrals) ----------
const C = {
  primary: '#0d857b', primaryDark: '#0a6e66', primarySoft: '#e6f5f4', accent: '#0d857b',
  bg: '#f6f5f3', card: '#ffffff', border: '#e4e1dc', line: '#eceae6',
  text: '#1c1a17', sub: '#847f77', muted: '#a8a29a',
  warm: '#b8860b', warmBg: '#fffbeb', warmBorder: '#fde68a',
  danger: '#c4342d', dangerBg: '#fdecea', good: '#2a7d46', goodBg: '#e7f4ec', info: '#6366f1', infoBg: '#eef0fb',
};
const FONT = "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SHADOW = '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.05)';
const SHADOW_MD = '0 6px 16px rgba(16,24,40,.07), 0 2px 6px rgba(16,24,40,.05)';
const SHADOW_LG = '0 18px 40px rgba(16,24,40,.12), 0 6px 14px rgba(16,24,40,.06)';

const TABS = [
  { key: 'documents', label: 'Documents' },
  { key: 'overview', label: 'Overview' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'labs', label: 'Labs' },
  { key: 'imaging', label: 'Imaging' },
  { key: 'medications', label: 'Medications' },
  { key: 'deliverables', label: 'Deliverables' },
] as const;

// Interface-chrome translations for the EN/AR toggle. Clinical content stays in its source language
// (English canonical); the Arabic patient-facing output lives in the Deliverables tab.
const UI_AR: Record<string, string> = {
  Documents: 'المستندات', Overview: 'نظرة عامة', Timeline: 'الجدول الزمني', Labs: 'المختبر',
  Imaging: 'الأشعة', Medications: 'الأدوية', Deliverables: 'المخرجات',
};

// Role lenses — reframe the summary + attention emphasis for the reader (same facts).
const ROLES = [
  { key: 'surgeon', label: 'Surgeon', icon: '🔪' },
  { key: 'referring', label: 'Referring', icon: '📨' },
  { key: 'insurer', label: 'Insurer', icon: '📋' },
  { key: 'patient', label: 'Patient', icon: '🧑' },
] as const;
type RoleKey = typeof ROLES[number]['key'];

type CaseItem = { patientId: string; patientName: string; docCount: number; recordCount: number };
type Coding = { display?: string; label?: string; system?: string | null; code?: string | null; laterality?: string | null; bodySite?: string | null };
type Rec = { id: string; type: string; coding: Coding | null; payload: any; assertion: string; negated: boolean; status: string; effective?: string | null; effectiveApprox?: boolean; provenance: { sourceText: string; verifier?: string | null; documentId?: string; page?: number | null } | null };
type Doc = { id: string; filename: string; mimeType: string; createdAt: string; job?: { stage: string; status: string; error?: string | null } | null; recordCount?: number };
type Verification = { trusted: boolean; reader: string; verifier: string };
type Workspace = { patient: { id: string; displayName: string; sex?: string | null; age?: number | null }; case: { id: string; procedure: string | null; signed: boolean }; documents: Doc[]; records: Rec[]; verification: Verification };
type Deliverable = { title: string; body: string; sourceRecordIds: string[] };
type Msg = { role: 'user' | 'assistant'; text: string; deliverable?: Deliverable };
type Upload = { documentId: string; patientId: string; filename: string; patientName: string; status?: string; stage?: string; recordCount?: number };

// ---------- small styled primitives ----------
function Chip({ children, bg, fg, title }: { children: React.ReactNode; bg: string; fg: string; title?: string }) {
  return <span title={title} style={{ background: bg, color: fg, borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 600, letterSpacing: 0.2, whiteSpace: 'nowrap' }}>{children}</span>;
}
function statusChip(s: string) {
  const map: Record<string, [string, string]> = {
    NEEDS_REVIEW: ['#fdf0d5', '#8a5a00'], ACCEPTED: ['#e7f4ec', '#2a7d46'],
    CORRECTED: ['#eef0fb', '#4f46e5'], EXTRACTED: ['#eceae6', '#847f77'],
  };
  const [bg, fg] = map[s] ?? map.EXTRACTED;
  return <Chip bg={bg} fg={fg}>{s.replace('_', ' ').toLowerCase()}</Chip>;
}
// Honesty: only render a verification indicator when a genuinely different real model verified.
function VerifiedChip({ verifier, trusted }: { verifier?: string | null; trusted: boolean }) {
  if (!trusted || !verifier) return null;
  return verifier === 'agree'
    ? <Chip bg="#e7f4ec" fg="#2a7d46">✓ verified</Chip>
    : <Chip bg="#fbe3e0" fg="#b3261e">⚠ disputed</Chip>;
}
function typeChip(t: string) { return <Chip bg="#e6f5f4" fg={C.primary}>{t}</Chip>; }

function payloadText(r: Rec): string {
  const p = r.payload || {};
  if (r.type === 'OBSERVATION') return [[p.value, p.unit].filter(Boolean).join(' '), p.flag ? `(${p.flag})` : ''].filter(Boolean).join(' ') || '—';
  if (r.type === 'MEDICATION') return [p.drug ?? r.coding?.display, p.dose, p.route, p.frequency].filter(Boolean).join(' · ') || '—';
  return p.name || p.substance || Object.values(p).filter((v) => typeof v === 'string').join(' ') || '—';
}

// Format a stored effective date, inferring precision (year-only stored as Jan 1 UTC).
// When `approx` (date fell back to the document's date, not the fact's own), prefix "~".
function fmtDate(iso?: string | null, approx?: boolean): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(+d)) return '';
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const s = (m === 0 && day === 1) ? String(y)
    : day === 1 ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', timeZone: 'UTC' })
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return approx ? `~${s}` : s;
}
function medDose(r: Rec): string { const p = r.payload || {}; return [p.dose, p.route, p.frequency].filter(Boolean).join(' ') || '—'; }
// Normalized drug identity for reconciliation: strip dose/route/frequency so "Atorvastatin 40 mg"
// and "Atorvastatin 20 mg daily" collapse to the same medication.
function drugKey(r: Rec): string {
  // Prefer the canonical English concept so the same drug in any language collapses to one.
  const raw = (r.coding?.display ?? r.payload?.drug ?? r.coding?.label ?? '').toString().toLowerCase();
  const k = raw
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|units?|ml|iu)\b.*$/i, '')
    .replace(/\b(?:daily|nightly|once|twice|morning|evening|night|od|bd|tds|qds|po|oral|prn|weekly|at)\b/gi, '')
    .replace(/[^a-z0-9\- ]/gi, ' ').replace(/\s+/g, ' ').trim();
  return k || raw.trim() || '(unnamed)';
}
// De-duplicate identical facts (same type/label/negation/value) so the SAME datum isn't shown
// twice when it appears across documents. Genuine changes over time (different dose/value) are
// kept — only exact repeats collapse, preferring the earliest-dated instance.
function factSig(r: Rec): string {
  const p = r.payload || {};
  const val = r.type === 'OBSERVATION' ? `${p.value}|${p.unit}`
    : r.type === 'MEDICATION' ? `${p.dose ?? ''}|${p.status ?? ''}`
    : (p.name ?? p.substance ?? '');
  return [r.type, (r.coding?.display ?? '').toLowerCase().trim(), r.negated, val].join('¦');
}
function dedupe(records: Rec[]): Rec[] {
  const best = new Map<string, Rec>();
  for (const r of records) {
    const k = factSig(r);
    const cur = best.get(k);
    if (!cur) { best.set(k, r); continue; }
    if (r.effective && (!cur.effective || r.effective < cur.effective)) best.set(k, r); // keep earliest dated
  }
  return [...best.values()];
}

// ---------- cross-document / cross-language entity resolution ----------
// Merge is a PROJECTION over stored records: nothing is dropped or mutated, every record keeps its
// provenance. A merged entity aggregates its members' provenance and threads status over time.
function norm(s?: string | null) { return (s ?? '').toString().toLowerCase().replace(/\s+/g, ' ').trim(); }
// PRIMARY dedup key: a normalized ontology code (system:code) when the extractor coded the concept.
function codeKey(coding: Coding | null | undefined, systems: string[]): string | null {
  const sys = norm(coding?.system).replace(/[^a-z0-9]/g, '');
  const code = norm(coding?.code).replace(/\s+/g, '');
  if (!sys || !code || code === 'null') return null;
  if (!systems.some((s) => sys.includes(s))) return null;
  return `${sys}:${code}`;
}
// Standard interpretation of a CITED lab value (never replaces it). eGFR->CKD stage, HbA1c->control.
function labInterpretation(name: string, valueStr: any, unit?: string): string | null {
  const v = parseFloat(valueStr); if (isNaN(v)) return null;
  const n = norm(name); const u = norm(unit);
  if (/egfr|glomerular filtration/.test(n)) return `CKD ${v >= 90 ? 'G1 (normal/high)' : v >= 60 ? 'G2 (mildly ↓)' : v >= 45 ? 'G3a' : v >= 30 ? 'G3b' : v >= 15 ? 'G4' : 'G5 (failure)'}`;
  if (/hba1c|glycated h|glycohaemoglobin|glycohemoglobin|(^|\b)a1c\b/.test(n)) { const pct = /mmol\/mol/.test(u) ? (v / 10.929) + 2.15 : v; return pct < 5.7 ? 'Non-diabetic range' : pct < 6.5 ? 'Pre-diabetes range' : pct < 7 ? 'Diabetes — at target' : pct < 8 ? 'Diabetes — above target' : 'Diabetes — poor control'; }
  return null;
}

type Entity = {
  key: string; kind: 'condition' | 'med'; title: string; subtitle: string; code: string;
  members: Rec[]; docCount: number; currentStatus: string; current: Rec;
  history: { r: Rec; date: string | null; approx: boolean; status: string; detail: string }[];
};

function medStatus(r: Rec): string {
  // Prefer the model's explicit status (language-agnostic) over regex on possibly-non-English source.
  const s = norm(r.payload?.status);
  if (s) {
    if (/stop|discontinu|cease|held/.test(s)) return 'stopped';
    if (/start|initiat|begin|commenc/.test(s)) return 'started';
    if (/increas|decreas|chang|switch|titrat/.test(s)) return 'changed';
    return s;
  }
  if (r.negated) return 'stopped';
  const t = `${r.coding?.display ?? ''} ${r.provenance?.sourceText ?? ''}`.toLowerCase();
  if (/stopped|discontinued|ceased|held|d\/c/.test(t)) return 'stopped';
  if (/started|initiated|commenced|began/.test(t)) return 'started';
  if (/increased|switched|titrated|reduced|changed/.test(t)) return 'changed';
  return 'ongoing';
}
function condStatus(r: Rec): string {
  const t = `${r.coding?.display ?? ''} ${r.coding?.label ?? ''} ${r.provenance?.sourceText ?? ''} ${r.payload?.status ?? ''}`.toLowerCase();
  if (/remission/.test(t)) return 'in remission';
  if (/recurren/.test(t)) return 'recurrence';
  if (/resolved/.test(t)) return 'resolved';
  if (r.negated || r.assertion === 'RULED_OUT') return 'ruled out';
  if (r.assertion === 'HISTORICAL') return 'historical';
  if (r.assertion === 'SUSPECTED') return 'suspected';
  return 'active';
}
function buildEntity(members: Rec[], kind: 'condition' | 'med', titleOverride?: string): Entity {
  const dated = members.filter((m) => m.effective).sort((a, b) => a.effective!.localeCompare(b.effective!));
  const ordered = [...dated, ...members.filter((m) => !m.effective)];
  const current = dated[dated.length - 1] ?? members[0];
  const c = current.coding || {};
  const rawTitle = (kind === 'med' ? (c.display ?? current.payload?.drug) : c.display) ?? c.label ?? '(unknown)';
  const title = titleOverride ?? String(rawTitle).replace(/\b\w/g, (x) => x.toUpperCase());
  const subtitle = [c.laterality, c.bodySite].filter(Boolean).join(' · ');
  const code = c.system && c.code ? `${c.system} ${c.code}` : (c.code ?? '');
  const history = ordered.map((r) => ({ r, date: r.effective ?? null, approx: !!r.effectiveApprox, status: kind === 'med' ? medStatus(r) : condStatus(r), detail: kind === 'med' ? medDose(r) : '' }));
  const docCount = new Set(members.map((m) => m.provenance?.documentId).filter(Boolean)).size;
  return { key: title + '|' + subtitle, kind, title, subtitle, code, members, docCount, current, currentStatus: kind === 'med' ? medStatus(current) : condStatus(current), history };
}
// Strip laterality/site/filler words from the canonical display so phrasing variants of the SAME
// concept ("invasive ductal carcinoma" / "…of breast" / "…of left breast") collapse. Laterality
// and site remain SEPARATE key components, so left vs right (or breast vs lung) stay distinct.
const SITES = 'breast|lung|kidney|renal|liver|hepatic|colon|colorectal|prostate|thyroid|ovar|cervi|pancrea|bladder|brain|skin|bone|stomach|gastric|esophag|rect|uter|endometri|wrist|radius|gallbladder|hip|femoral|femur|knee|shoulder|ankle|elbow|spine|hand|foot';
const siteRe = new RegExp(`\\b(${SITES})\\w*`);
function conceptCore(c: Coding): string {
  let s = norm(c.display ?? c.label).replace(/[.,;:()/]/g, ' ');
  s = s.replace(/\b(left|right|bilateral|sol|sağ|أيسر|أيمن)\b/g, ' ');
  s = s.replace(/invasive ductal carcinoma|ductal carcinoma in situ|ductal carcinoma|malignant neoplasm|carcinoma|malignancy|tumou?r/g, 'cancer');
  s = s.replace(/\bgrade\s*\d+\b|\bstage\s*[0-4ivx]+\b|\bclass\s+[ivx]+\b/g, ' ');
  // Strip non-distinguishing qualifiers so granularity variants of one diagnosis collapse.
  s = s.replace(/\b(unspecified|not intractable|without status epilepticus|nos|nec|active|acute on chronic|primary|secondary|steroid[- ]induced|drug[- ]induced|type [12])\b/g, ' ');
  s = s.replace(new RegExp(`\\b(${SITES})\\w*\\b`, 'g'), ' ');
  s = s.replace(/\b(head|neck|shaft)\b/g, ' '); // "femoral head" == "femur" for dedup
  s = s.replace(/\b(of|the|de|la|el)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return s || norm(c.display ?? c.label);
}
// Aggressive clinical synonym folding for the PROBLEM LIST. When a condition matches, it collapses
// to the canonical concept REGARDLESS of site/laterality (so lupus manifestations, the seizure
// family, and cognitive symptoms each become one headline problem). Every member is preserved and
// visible on expand — nothing is dropped, provenance is intact.
// Order matters — specific organ/system folds run BEFORE the generic lupus umbrella, so lupus
// nephritis stays its own problem and the SLE fold doesn't swallow it.
const COND_CANON: [RegExp, string][] = [
  [/lupus nephritis|glomerulonephrit|nephrotic|proteinuria|frothy urine|reduced urine output|acute kidney injury|\baki\b|\bnephritis\b/i, 'Lupus nephritis'],
  [/cytopenia|lymphopenia|leuko?penia|neutropenia|thrombocytopenia|an[ae]mia|pancytopenia/i, 'Cytopenia'],
  [/arthralg|arthrit|synovit|joint (pain|swelling)/i, 'Inflammatory arthritis'],
  [/avascular necrosis|osteonecrosis|aseptic necrosis|hip pain|femoral head/i, 'Avascular necrosis'],
  [/antiphospholipid|hughes syndrome|anticardiolipin|deep vein thrombos|\bdvt\b|pulmonary embol/i, 'Antiphospholipid syndrome'],
  [/postictal|convuls|seizure|epilep|status epilepticus/i, 'Epilepsy'],
  [/word.?finding|forgetful|memory (loss|impair)|amnesi|attention deficit|cognit|concentrat|subacute organic/i, 'Cognitive impairment'],
  [/low mood|depress|dysthym/i, 'Depression'],
  [/lupus|(^|\b)sle\b|systemically active disease|persistent clinical and serological|malar rash|photosensitive rash|facial rash|butterfly rash/i, 'Systemic lupus erythematosus'],
];
function condCanon(c: Coding): string | null {
  const t = norm(`${c.display ?? ''} ${c.label ?? ''}`);
  for (const [re, canon] of COND_CANON) if (re.test(t)) return canon;
  return null;
}
// Transient symptoms / signs / non-diagnosis states — real records (kept in Timeline/Findings) but
// NOT headline entries on the active problem list. Matched against the entity's resolved title.
const NOT_A_PROBLEM = /^(fatigue|tiredness|fever|pyrexia|malaise|lethargy|night sweats?|weight (loss|gain)|nausea|vomiting|headache|dizziness|anorexia|leg swelling|pitting edema|pitting oedema|peripheral (edema|oedema)|edema|oedema|swelling|immunosuppression|myalgia|rash|pain|mouth ulcers?|alopecia|hair loss)( \(.*\))?$/i;
function isProblemWorthy(e: Entity): boolean { return !NOT_A_PROBLEM.test(norm(e.title)); }
// Lab analyte normalization: the SAME test under different names/dates merges into one dated trend.
// Order matters: the urine protein:creatinine ratio must be caught BEFORE plain "creatinine",
// or a uPCR (mg/mmol) wrongly folds into serum creatinine (µmol/L) and corrupts the trend.
const ANALYTE_CANON: [RegExp, string][] = [
  [/ds.?dna|double.?strand|anti.?dsdna|dna \(ds\)/i, 'Anti-dsDNA antibody'],
  [/urine protein|proteinuria|protein.creatinine|albumin.creatinine|(^|\b)upcr(\b|$)|(^|\b)a?cr(\b|$)/i, 'Urine protein:creatinine'],
  [/complement c3|(^|\b)c3(\b|$)/i, 'Complement C3'],
  [/complement c4|(^|\b)c4(\b|$)/i, 'Complement C4'],
  [/egfr|glomerular filtration/i, 'eGFR'],
  [/serum creatinin|plasma creatinin|creatinin/i, 'Creatinine'],
  [/urea|\bbun\b/i, 'Urea'],
  [/h(a)?emoglobin|(^|\b)hb(\b|$)/i, 'Haemoglobin'],
  [/platelet|thrombocyt/i, 'Platelets'],
  [/(^|\b)wbc(\b|$)|white cell|white blood cell|leucocyte|leukocyte/i, 'White cell count'],
  [/(^|\b)crp(\b|$)|c.?reactive protein/i, 'CRP'],
  [/(^|\b)esr(\b|$)|sedimentation/i, 'ESR'],
  [/(^|\b)alt(\b|$)|alanine amino/i, 'ALT'],
  [/(^|\b)ast(\b|$)|aspartate amino/i, 'AST'],
  [/anti.?smith|anti.?sm\b/i, 'Anti-Smith antibody'],
  [/antinuclear|(^|\b)ana(\b|$)/i, 'Antinuclear antibody'],
];
// Guard against merging readings that don't share a unit family (e.g. µmol/L vs mg/mmol) — keep the
// canonical name but split the trend by unit so incompatible scales never sit in one series.
function analyteKey(r: Rec): string {
  const unit = norm(r.payload?.unit);
  const code = codeKey(r.coding, ['loinc']); // PRIMARY: LOINC code = same analyte across aliases
  if (code) return unit ? `${code}||${unit}` : code;
  const t = norm(r.coding?.display ?? r.coding?.label);
  for (const [re, canon] of ANALYTE_CANON) if (re.test(t)) return unit ? `${canon}||${unit}` : canon;
  return r.coding?.display ?? '(unnamed)';
}
// Human analyte name (the LOINC key isn't display-friendly, so derive the name from the record).
function analyteDisplay(r: Rec): string {
  const t = norm(r.coding?.display ?? r.coding?.label);
  for (const [re, canon] of ANALYTE_CANON) if (re.test(t)) return canon;
  return r.coding?.display ?? r.coding?.label ?? '(unnamed)';
}
const analyteLabel = (k: string) => k.split('||')[0];
// A "real lab" for the Labs tab: prefer the extractor's category; else a numeric value+unit that
// isn't an imaging/exam/vital/symptom finding.
function isLabObservation(r: Rec): boolean {
  if (r.type !== 'OBSERVATION') return false;
  const cat = norm(r.payload?.category);
  if (cat) return /lab|serolog|blood|urine|chemistr|h[ae]matolog|csf|immunolog/.test(cat);
  const hasNum = r.payload?.value != null && !isNaN(parseFloat(r.payload.value)) && !!r.payload?.unit;
  const name = norm(`${r.coding?.display} ${r.coding?.label}`);
  const nonLab = /hyperintensit|white matter|lesion|\bmri\b|\bct\b|x.?ray|ultrasound|imaging|radiograph|attention|memory|cognit|orientat|fever|seizure|duration|recommend|consultation|plan|blood pressure|heart rate|pulse|weight|height|\bbmi\b|temperature|respirat|saturation/;
  return hasNum && !nonLab.test(name);
}

// ---------- Imaging / studies (REPORT intelligence only — pixels are never analyzed) ----------
const MODALITIES: { key: string; re: RegExp; icon: string }[] = [
  { key: 'MRI', re: /\bmri\b|magnetic resonance/i, icon: '🧲' },
  { key: 'CT', re: /\bct\b|\bct scan\b|computed tomograph|\bcat scan\b/i, icon: '🩻' },
  { key: 'PET', re: /\bpet\b|positron emission|pet-?ct/i, icon: '☢️' },
  { key: 'Mammogram', re: /mammogram|mammograph/i, icon: '🎗️' },
  { key: 'Ultrasound', re: /ultrasound|sonograph|doppler|\bu\/?s\b/i, icon: '🌊' },
  { key: 'Echocardiogram', re: /echocardiogra|\becho\b/i, icon: '🫀' },
  { key: 'X-ray', re: /x-?ray|radiograph|plain film/i, icon: '🦴' },
  { key: 'Nuclear', re: /scintigraph|bone scan|\bdexa\b|nuclear med/i, icon: '⚛️' },
];
function modalityOf(r: Rec): { key: string; icon: string } | null {
  const t = norm(`${r.coding?.display} ${r.coding?.label} ${r.provenance?.sourceText}`);
  for (const m of MODALITIES) if (m.re.test(t)) return { key: m.key, icon: m.icon };
  return null;
}
// An imaging record = an observation the extractor tagged category "imaging", or any finding whose
// own source sentence names a modality. Meds/allergies/immunizations are never imaging.
function isImaging(r: Rec): boolean {
  if (r.type === 'MEDICATION' || r.type === 'ALLERGY' || r.type === 'IMMUNIZATION') return false;
  const name = norm(`${r.coding?.display} ${r.coding?.label}`);
  const text = `${name} ${norm(r.provenance?.sourceText)}`;
  // Clearly non-imaging findings that can share a sentence with a scan (labs, cultures, histology,
  // electrophysiology) must never be pulled in as imaging.
  if (/\bculture\b|septic screen|glomerulonephrit|histopatholog|electroencephalogram|\beeg\b|nerve conduction|\bemg\b|electrocardiogram|\becg\b|\bekg\b/.test(name)) return false;
  if (r.type === 'OBSERVATION' && norm(r.payload?.category) === 'imaging') return true;
  return !!modalityOf(r) && !/electroencephalogram|\beeg\b/.test(text);
}
// A measurement in mm parsed from a finding's value/unit or its text (cm -> mm). null if none.
function parseMm(r: Rec): number | null {
  const v = parseFloat(r.payload?.value); const u = norm(r.payload?.unit);
  if (!isNaN(v) && /\b(mm|cm)\b/.test(u)) return u.includes('cm') ? v * 10 : v;
  const t = `${r.coding?.display ?? ''} ${r.provenance?.sourceText ?? ''}`;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(mm|cm)\b/i);
  return m ? parseFloat(m[1]) * (/cm/i.test(m[2]) ? 10 : 1) : null;
}
const tc = (s: string) => String(s ?? '').replace(/\b\w/g, (x) => x.toUpperCase());
type Study = { key: string; modality: string; icon: string; date: string | null; approx: boolean; region: string; findings: Rec[]; impression: Rec[] };
const IMPRESSION_RE = /impression|conclusion|consistent with|in keeping with|suggestive of|compatible with|no evidence of|reported as/i;
// Reconstruct "studies" from extracted findings: one report (document) + modality = one study.
function buildStudies(records: Rec[]): Study[] {
  const imaging = dedupe(records.filter(isImaging));
  // Pass 1: count modality mentions per source document (one report ≈ one document).
  const docMods = new Map<string, Map<string, number>>();
  for (const r of imaging) { const m = modalityOf(r); if (m) { const d = r.provenance?.documentId ?? 'x'; const mm = docMods.get(d) ?? docMods.set(d, new Map()).get(d)!; mm.set(m.key, (mm.get(m.key) ?? 0) + 1); } }
  const dominant = (d: string) => { const mm = docMods.get(d); return mm ? [...mm.entries()].sort((a, b) => b[1] - a[1])[0][0] : null; };
  // Pass 2: a finding with no modality keyword inherits its report's DOMINANT modality, so a report's
  // findings stay in one study instead of fragmenting into a stray "Imaging" bucket.
  const groups = new Map<string, Rec[]>();
  for (const r of imaging) {
    const doc = r.provenance?.documentId ?? 'x';
    const mod = modalityOf(r)?.key ?? dominant(doc) ?? 'Imaging';
    const k = `${doc}|${mod}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  return [...groups.entries()].map(([k, recs]) => {
    const mod = k.split('|')[1];
    const icon = MODALITIES.find((m) => m.key === mod)?.icon ?? '🖼️';
    const dated = recs.filter((r) => r.effective).map((r) => r.effective!).sort();
    const date = dated[0] ?? null;
    const approx = recs.some((r) => r.effectiveApprox) && !recs.some((r) => r.effective && !r.effectiveApprox);
    const region = tc([...new Set(recs.map((r) => siteOf(r.coding)).filter(Boolean))].join(', '));
    const impression = recs.filter((r) => IMPRESSION_RE.test(norm(r.provenance?.sourceText)));
    const findings = recs.filter((r) => !impression.includes(r));
    return { key: k, modality: mod, icon, date, approx, region, findings: findings.length ? findings : recs, impression };
  }).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}
// Serial tracking: link measurements of the SAME target (concept + site) across studies over time.
function serialTracks(records: Rec[]) {
  const meas: { target: string; label: string; mm: number; date: string | null; approx: boolean; modality: string }[] = [];
  for (const r of records.filter(isImaging)) {
    const mm = parseMm(r); if (mm == null) continue;
    meas.push({
      target: `${conceptCore(r.coding || {})}|${siteOf(r.coding)}`,
      label: tc(r.coding?.display ?? r.coding?.label ?? 'lesion'),
      mm, date: r.effective ?? null, approx: !!r.effectiveApprox, modality: modalityOf(r)?.key ?? 'Imaging',
    });
  }
  const byTarget = new Map<string, typeof meas>();
  for (const m of meas) (byTarget.get(m.target) ?? byTarget.set(m.target, []).get(m.target)!).push(m);
  return [...byTarget.values()]
    .map((a) => a.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? '')))
    .filter((a) => a.length >= 2); // a "series" needs at least two timepoints
}
// Drug-class abstractions collapsed into the specific named drug when present (mirrors lib/resolve).
const MED_CLASS_TERMS = /^(anti-?convulsant|anti-?epileptic|cortico-?steroid|steroid|immuno-?suppress(ant|ive)|statin|beta.?blocker|anti-?coagulant|anti-?coagulation|anti-?platelet|ace ?inhibitor|arb|antibiotic|anti-?depressant|anti-?hypertensive|analgesic|nsaid|ppi|proton pump inhibitor|diuretic|opioid|benzodiazepine|anti-?emetic|anti-?psychotic|bisphosphonate|anti-?malarial|immunomodulator|dmard|biologic|blood thinner)s?$/;
const MED_CLASS_MEMBERS: Record<string, RegExp> = {
  anticonvulsant: /levetiracetam|valproat|valproic|carbamazepine|phenytoin|lamotrigine|topiramate|gabapentin|pregabalin|lacosamide|clonazepam|clobazam/,
  corticosteroid: /prednisolon|prednison|dexamethason|hydrocortison|methylprednisolon|budesonid|betamethason/,
  immunosuppressant: /mycophenolat|tacrolimus|ciclosporin|cyclosporin|azathioprin|sirolimus|everolimus|methotrexat|belimumab|rituximab/,
  statin: /atorvastatin|simvastatin|rosuvastatin|pravastatin|fluvastatin/,
  anticoagulant: /warfarin|apixaban|rivaroxaban|dabigatran|edoxaban|heparin/,
  antiplatelet: /aspirin|clopidogrel|ticagrelor|prasugrel/,
  bisphosphonate: /alendron|risedron|zoledron|ibandron|pamidron/,
  antimalarial: /hydroxychloroquine|chloroquine/,
};
function medClassKey(n: string): string | null {
  if (/convuls|epilep/.test(n)) return 'anticonvulsant';
  if (/steroid/.test(n)) return 'corticosteroid';
  if (/immuno-?suppress/.test(n)) return 'immunosuppressant';
  if (/\bstatin\b/.test(n)) return 'statin';
  if (/anti-?coagul|blood thinner/.test(n)) return 'anticoagulant';
  if (/anti-?platelet/.test(n)) return 'antiplatelet';
  if (/bisphosphonate/.test(n)) return 'bisphosphonate';
  if (/anti-?malarial/.test(n)) return 'antimalarial';
  return null;
}
const MED_SALT = /\b(mofetil|sodium|potassium|hydrochloride|hcl|sulfate|sulphate|acetate|succinate|tartrate|maleate|besylate|mesylate|fumarate|phosphate|citrate|monohydrate|dihydrate|hemihydrate)\b/g;
// Normalize a medication to its specific ingredient (drop dose, salt/ester, "therapy").
function medIdentity(r: Rec): string {
  let s = (r.coding?.display ?? r.payload?.drug ?? r.coding?.label ?? '').toString().toLowerCase();
  s = s.replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|units?|ml|iu)\b.*$/i, '');
  s = s.replace(/\btherapy\b/g, '').replace(MED_SALT, '').replace(/[^a-z\- ]/gi, ' ').replace(/\s+/g, ' ').trim();
  // Calcium / vitamin-D supplement fragments (and common brands) fold to one supplement entry.
  if (/\bcalcium\b|\bvitamin d\b|cole?calciferol|ergocalciferol|\badcal\b|calcichew|\bcacit\b|caltrate/.test(s)) return 'calcium and vitamin d';
  return s;
}
// Episodic (one-time / course) treatment markers vs. an explicit continuation later on.
const MED_EPISODIC = /\bpulse|pulsed|\bpcp\b|pneumocystis|prophylaxis|stat dose|single dose|one-off|\bfor \d+ days\b|three days|\bx\s?\d+\s?(?:days|\/7)\b|managed with|during (the )?admission|\binpatient\b/;
const MED_CONTINUED = /\bcontinue|continued|continuing|remains? on|remain on|still (on|taking|takes)|ongoing/;
// Classify a reconciled medication for the current-vs-historical split. A drug given as a one-time
// inpatient course (IV pulses, PCP prophylaxis, "managed with…") is inpatient — UNLESS a later note
// continues it (e.g. levetiracetam started in hospital but "continued"), in which case it's current.
function medEra(e: Entity, nowY: number): 'current' | 'inpatient' | 'past' {
  if (e.currentStatus === 'stopped') return 'past';
  const txt = e.members.map((m) => `${m.provenance?.sourceText ?? ''} ${m.payload?.dose ?? ''} ${m.payload?.route ?? ''}`).join(' ').toLowerCase();
  const latestY = Math.max(0, ...e.members.filter((m) => m.effective).map((m) => new Date(m.effective!).getUTCFullYear()));
  const continued = MED_CONTINUED.test(txt) || (nowY > 0 && latestY >= nowY - 1);
  if (MED_EPISODIC.test(txt) && !continued) return 'inpatient';
  return 'current';
}
// Allergen synonym folding — the same substance under different names is ONE allergy.
const ALLERGEN_CANON: [RegExp, string][] = [
  [/co.?trimoxazole|trimethoprim.?sulfa|sulfamethoxazole.?trimethoprim|sulfamethoxazole|\btmp.?smx\b|bactrim|septrin/i, 'Co-trimoxazole'],
  [/penicillin|amoxicillin|flucloxacillin/i, 'Penicillin'],
  [/aspirin|acetylsalicylic/i, 'Aspirin'],
  [/ibuprofen|naproxen|\bnsaid/i, 'NSAIDs'],
];
function allergenName(s: string): string {
  const t = norm(s);
  for (const [re, canon] of ALLERGEN_CANON) if (re.test(t)) return canon;
  return String(s).replace(/\b\w/g, (x) => x.toUpperCase());
}
const latOf = (c?: Coding | null) => {
  const l = norm(c?.laterality); if (l) return l;
  const t = `${norm(c?.display)} ${norm(c?.bodySite)}`;
  return /\bleft\b|\bsol\b/.test(t) ? 'left' : /\bright\b|\bsağ\b/.test(t) ? 'right' : /\bbilateral\b/.test(t) ? 'bilateral' : '';
};
const siteOf = (c?: Coding | null) => {
  const b = norm(c?.bodySite).replace(/\b(left|right|bilateral)\b/g, ' ').trim();
  const m = (b || norm(c?.display)).match(siteRe);
  const s = m ? m[1] : b;
  return /femoral|femur/.test(s) ? 'hip' : s; // femoral head/neck is the hip joint
};
function resolveConditions(records: Rec[]): Entity[] {
  const groups = new Map<string, Rec[]>();
  const canonOf = new Map<string, string>();
  for (const r of records.filter((r) => r.type === 'CONDITION')) {
    const c = r.coding || {};
    // Family fold first, then SNOMED/ICD code (same code = same entity), then concept-core + site.
    const canon = condCanon(c);
    const key = canon ?? codeKey(c, ['snomed', 'icd']) ?? `${conceptCore(c)}|${latOf(c)}|${siteOf(c)}`;
    if (canon) canonOf.set(key, canon);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  return [...groups.entries()].map(([k, m]) => buildEntity(m, 'condition', canonOf.get(k))).sort((a, b) => a.title.localeCompare(b.title));
}
function resolveMeds(records: Rec[]): Entity[] {
  const groups = new Map<string, Rec[]>();
  const identityOf = new Map<string, string>();
  // A negated/absent medication statement ("not on X", "no meds that…") is NOT an active med.
  for (const r of records.filter((r) => r.type === 'MEDICATION' && !r.negated)) {
    const id = medIdentity(r); if (!id) continue;
    // PRIMARY: RxNorm ingredient code (co-trimoxazole synonyms/brands/class collapse). Fallback: name.
    const k = codeKey(r.coding, ['rxnorm', 'rxcui']) ?? id;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
    if (!identityOf.has(k)) identityOf.set(k, id);
  }
  const specific = [...groups.keys()].filter((k) => !MED_CLASS_TERMS.test(identityOf.get(k) ?? ''));
  const kept: Rec[][] = [];
  for (const [k, ms] of groups) {
    const id = identityOf.get(k) ?? '';
    if (MED_CLASS_TERMS.test(id)) {
      const ck = medClassKey(id);
      if (ck && MED_CLASS_MEMBERS[ck] && specific.some((sk) => MED_CLASS_MEMBERS[ck].test(identityOf.get(sk) ?? ''))) continue; // drop class dup
    }
    kept.push(ms);
  }
  return kept.map((m) => buildEntity(m, 'med')).sort((a, b) => a.title.localeCompare(b.title));
}
function statusTone(s: string): [string, string] {
  if (/remission|historical|resolved/.test(s)) return ['#eef0fb', '#4f46e5'];
  if (/ruled out|stopped/.test(s)) return ['#f0efec', '#847f77'];
  if (/recurrence|suspected|flare/.test(s)) return ['#fdf0d5', '#8a5a00'];
  return ['#e7f4ec', '#2a7d46']; // active / ongoing / started
}
// A calm clinical signal: ACTIVE/flare items carry a warm accent; historical/resolved go muted grey.
const WARM = { fg: '#b45309', bg: '#fdf3e6', border: '#e7b986' };
const GREY = { fg: C.sub, bg: '#f5f7f9', border: C.border };
function isActiveStatus(s: string) { return /active|ongoing|started|recurrence|suspected|flare|changed/.test(s); }
function accentFor(status: string) { return isActiveStatus(status) ? WARM : GREY; }

// Per-type visual identity: a small type-icon + accent colour, used on every card and the timeline.
const TYPE_META: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  CONDITION:    { icon: '🩺', label: 'Diagnosis',    color: '#0d857b', bg: '#e6f5f4' },
  MEDICATION:   { icon: '💊', label: 'Medication',   color: '#5b3fa8', bg: '#ece7fb' },
  PROCEDURE:    { icon: '🔧', label: 'Procedure',    color: '#8a5a00', bg: '#fdf0d5' },
  OBSERVATION:  { icon: '🧪', label: 'Result',       color: '#4f46e5', bg: '#eef0fb' },
  ALLERGY:      { icon: '⚠️', label: 'Allergy',      color: '#b3261e', bg: '#fbe3e0' },
  IMMUNIZATION: { icon: '💉', label: 'Immunization', color: '#2a7d46', bg: '#e7f4ec' },
};
const typeIcon = (t: string) => TYPE_META[t]?.icon ?? '•';
function TypeDot({ type, title }: { type: string; title?: string }) {
  const m = TYPE_META[type] ?? { icon: '•', color: C.sub, bg: C.bg };
  return <span title={title ?? m.color} style={{ width: 24, height: 24, borderRadius: 7, background: m.bg, display: 'inline-grid', placeItems: 'center', fontSize: 13, flexShrink: 0 }}>{m.icon}</span>;
}

// Clinical-system grouping for the problem list. Order matters — earlier wins on overlap
// (lupus nephritis -> Renal; antiphospholipid/clot -> Cardiovascular; NPSLE -> Neurological).
const SYSTEMS: { label: string; re: RegExp }[] = [
  { label: 'Renal / Genitourinary', re: /nephr|renal|kidney|glomerul|dialysis|proteinuria|urin|bladder|prostate/i },
  { label: 'Neurological', re: /neuro|seizure|epilep|convuls|postictal|stroke|migraine|cognit|memory|forgetful|word.?finding|confusion|dementia|parkinson|neuropath|\bcns\b/i },
  { label: 'Cardiovascular', re: /cardi|heart|coronary|hypertens|atrial|arrhythm|angina|infarct|vascular|thrombos|embol|\bdvt\b|antiphospholipid|clot/i },
  { label: 'Musculoskeletal', re: /arthr|joint|osteo|avascular necrosis|fracture|muscle|myopath|femoral|femur|\bhip\b|knee|spine|back pain|tendon|bone/i },
  { label: 'Rheumatology / Immune', re: /lupus|\bsle\b|rheumat|vasculitis|autoimmune|scleroderma|sjogren|connective tissue|systemically active/i },
  { label: 'Endocrine / Metabolic', re: /diabet|thyroid|adrenal|pituitary|osteoporos|hyperlipid|dyslipid|metabolic|cushing/i },
  { label: 'Respiratory', re: /pulmon|lung|asthma|copd|respirat|pneumon|pleural|bronch/i },
  { label: 'Gastrointestinal', re: /gastr|hepat|liver|bowel|colon|crohn|colitis|pancrea|biliary|reflux|ulcer/i },
  { label: 'Haematology / Oncology', re: /anaem|anemia|leuk|lymph|thrombocyt|neutropen|cancer|carcinoma|malignan|tumou?r|neoplas/i },
  { label: 'Psychiatry / Mood', re: /depress|anxiety|low mood|\bmood\b|psych|suicid|bipolar/i },
  { label: 'Dermatology', re: /rash|derm|\bskin\b|eczema|psorias|urticaria/i },
  { label: 'Infectious disease', re: /infect|sepsis|abscess|cellulitis|hepatitis [bc]|\bhiv\b|tuberculos/i },
];
function systemOf(e: Entity): string {
  const t = norm(`${e.title} ${e.current.coding?.display ?? ''} ${e.current.coding?.label ?? ''}`);
  for (const s of SYSTEMS) if (s.re.test(t)) return s.label;
  return 'Other / unclassified';
}

// Tiny inline SVG sparkline for a lab analyte's numeric trend.
function Sparkline({ values, width = 92, height = 22 }: { values: number[]; width?: number; height?: number }) {
  const pts = values.filter((v) => !isNaN(v));
  if (pts.length < 2) return null;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const step = width / (pts.length - 1);
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1], rising = last > pts[0];
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <path d={d} fill="none" stroke={C.accent} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(width).toFixed(1)} cy={y(last).toFixed(1)} r={2.4} fill={rising ? '#b45309' : C.accent} />
    </svg>
  );
}

// Shimmer skeleton block for loading/extracting states.
function Skeleton({ h = 14, w = '100%', mb = 8, r = 6 }: { h?: number; w?: number | string; mb?: number; r?: number }) {
  return <div style={{ height: h, width: w, marginBottom: mb, borderRadius: r, background: `linear-gradient(90deg, ${C.bg} 25%, #e6ecf1 37%, ${C.bg} 63%)`, backgroundSize: '400% 100%', animation: 'zshimmer 1.4s ease infinite' }} />;
}
function SkeletonCard() {
  return (
    <div style={{ ...card, padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ width: 24, height: 24, borderRadius: 7, background: C.bg }} />
        <Skeleton h={15} w="42%" mb={0} />
        <div style={{ flex: 1 }} />
        <Skeleton h={12} w={60} mb={0} />
      </div>
      <div style={{ marginTop: 12 }}><Skeleton h={11} w="88%" mb={6} /><Skeleton h={11} w="70%" mb={0} /></div>
    </div>
  );
}
function TabSkeleton({ rows = 4 }: { rows?: number }) {
  return <div>{Array.from({ length: rows }).map((_, i) => <SkeletonCard key={i} />)}</div>;
}

// One merged clinical entity as a SINGLE clean row: prominent name, quiet coding, one status +
// date. Expand (▸) to reveal the over-time history and every source quote. Active/flare items get
// a warm left-accent; historical/resolved go muted grey. Coding + provenance stay secondary.
function EntityCard({ e, trusted, badge }: { e: Entity; trusted?: boolean; badge?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [bg, fg] = statusTone(e.currentStatus);
  const acc = accentFor(e.currentStatus);
  const latest = e.current;
  const detail = e.kind === 'med' ? medDose(latest) : '';
  const dateStr = fmtDate(latest.effective, latest.effectiveApprox);
  return (
    <div className="zcard" style={{ ...card, padding: 0, marginBottom: 10, borderLeft: `3px solid ${acc.border}`, overflow: 'hidden' }}>
      {/* the one clean row — name prominent; dose + status a quiet subline; date secondary */}
      <div className="zrow" onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', cursor: 'pointer' }}>
        <TypeDot type={e.kind === 'med' ? 'MEDICATION' : (latest.type || 'CONDITION')} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <strong dir="auto" style={{ fontSize: 15, color: C.text, letterSpacing: -0.1 }}>{e.title}</strong>
            {e.subtitle && <span style={{ fontSize: 12, color: C.muted }}>{e.subtitle}</span>}
            {badge}
          </div>
          {e.kind === 'med' ? (
            // meds: "dose · status" quiet subline, with a small colour dot for status
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontSize: 12.5, color: C.sub }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: fg, flexShrink: 0 }} />
              <span dir="auto">{[detail && detail !== '—' ? detail : null, e.currentStatus].filter(Boolean).join(' · ')}</span>
            </div>
          ) : (detail && detail !== '—') ? <div style={{ fontSize: 12.5, color: C.sub, marginTop: 1 }}>{detail}</div> : null}
        </div>
        {e.kind !== 'med' && <Chip bg={bg} fg={fg}>{e.currentStatus}</Chip>}
        {dateStr && <span style={{ fontSize: 12, color: C.muted, minWidth: 62, textAlign: 'right' }}>{dateStr}</span>}
        <span className={`zexp${open ? ' o' : ''}`} style={{ color: C.muted, fontSize: 12, width: 12 }}>▸</span>
      </div>
      {open && (
        <div style={{ padding: '2px 14px 12px 48px', borderTop: `1px solid ${C.bg}` }}>
          {e.code && <div style={{ fontSize: 11, color: C.muted, margin: '8px 0 2px', fontFamily: 'ui-monospace, monospace' }}>{e.code}</div>}
          {/* threaded history over time */}
          {e.history.length > 1 && (
            <div style={{ borderLeft: `2px solid ${C.border}`, paddingLeft: 14, marginTop: 8 }}>
              {e.history.map((h, i) => (
                <div key={i} style={{ position: 'relative', fontSize: 12.5, padding: '3px 0' }}>
                  <div style={{ position: 'absolute', left: -20, top: 8, width: 8, height: 8, borderRadius: 4, background: statusTone(h.status)[1] }} />
                  <span style={{ display: 'inline-block', minWidth: 72, color: C.muted }}>{fmtDate(h.date, h.approx) || 'undated'}</span>
                  <span style={{ fontWeight: 600 }}>{h.status}</span>
                  {h.detail && h.detail !== '—' && <span style={{ color: C.sub }}> · {h.detail}</span>}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <SectionLabel>Sources · {e.docCount} doc{e.docCount !== 1 ? 's' : ''} · {e.members.length} mention{e.members.length !== 1 ? 's' : ''}</SectionLabel>
            {e.members.map((m) => (
              <div key={m.id} style={{ padding: '5px 0', borderTop: `1px solid ${C.bg}` }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11.5, color: C.muted, minWidth: 72 }}>{fmtDate(m.effective, m.effectiveApprox) || '—'}</span>
                  <span dir="auto" style={{ fontSize: 12.5, color: C.sub }}>{m.coding?.label ?? m.coding?.display ?? '(mention)'}</span>
                  <VerifiedChip verifier={m.provenance?.verifier} trusted={!!trusted} />
                </div>
                <div dir="auto" style={sourceQuote}>“{m.provenance?.sourceText ?? '—'}”</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// A readable clinical sentence for a fact (timeline/prose contexts).
function eventProse(r: Rec): string {
  const label = r.coding?.display ?? '(unnamed)';
  const p = r.payload || {};
  switch (r.type) {
    case 'CONDITION':
      if (r.negated) return `${label} ruled out`;
      if (r.assertion === 'HISTORICAL') return `History of ${label.toLowerCase()}`;
      if (r.assertion === 'SUSPECTED') return `Suspected ${label.toLowerCase()}`;
      return `Diagnosed with ${label.toLowerCase()}`;
    case 'MEDICATION': {
      const dose = medDose(r);
      const verb = p.status === 'stopped' || r.negated ? 'Stopped' : p.status === 'started' ? 'Started' : 'Prescribed';
      return `${verb} ${label}${dose !== '—' ? ` ${dose}` : ''}`;
    }
    case 'OBSERVATION': {
      const v = [p.value, p.unit].filter(Boolean).join(' ');
      return `${label}${v ? ` ${v}` : ''}${p.flag ? ` (${p.flag})` : ''}`;
    }
    case 'PROCEDURE': return r.negated ? `${label} not performed` : `Underwent ${label.toLowerCase()}`;
    case 'ALLERGY': return `Allergy — ${label}`;
    case 'IMMUNIZATION': return `Immunization — ${label}`;
    default: return label;
  }
}

// Tracks whether we're on a phone-width screen, so the sidebar can become a slide-in drawer.
function useIsMobile(breakpoint = 860) {
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

// ---------- main ----------
function WorkspaceInner() {
  const initial = useSearchParams().get('patientId') ?? '';
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false); // mobile sidebar drawer
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [patientId, setPatientId] = useState(initial);
  const [ws, setWs] = useState<Workspace | null>(null);
  const [wsLoading, setWsLoading] = useState(false);
  // One cached analysis per record-set (keyed), so switching between patients and back never
  // re-runs (re-costs) a completed Clinical Attention analysis.
  const [attentionMap, setAttentionMap] = useState<Record<string, AttnState>>({});
  const setAttention = useCallback((v: AttnState) => setAttentionMap((m) => ({ ...m, [v.key]: v })), []);
  const [tab, setTab] = useState<string>('overview');
  const [role, setRole] = useState<RoleKey>('surgeon');
  const [lang, setLang] = useState<'en' | 'ar'>('en');
  const tt = (s: string) => (lang === 'ar' ? (UI_AR[s] ?? s) : s);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const loadCases = useCallback(async () => {
    const d = await (await fetch('/api/cases')).json();
    setCases(d.cases ?? []);
  }, []);
  useEffect(() => { loadCases(); }, [loadCases]);

  const loadWs = useCallback(async () => {
    if (!patientId) { setWs(null); return; }
    setWsLoading(true);
    try {
      const r = await fetch(`/api/workspace?patientId=${patientId}`, { headers: AUTH });
      const d = await r.json();
      setWs(r.ok ? d : null);
    } finally { setWsLoading(false); }
  }, [patientId]);
  useEffect(() => { loadWs(); }, [loadWs]);

  async function createPatient() {
    const name = newName.trim();
    if (!name) return;
    const r = await fetch('/api/patient', { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name }) });
    const d = await r.json();
    if (!r.ok) { alert(d.error || 'could not create patient'); return; }
    setNewName('');
    await loadCases();
    setPatientId(d.id); // select the new patient so dropped files attach to them
  }

  async function renamePatient(id: string, name: string) {
    const displayName = name.trim();
    if (!displayName) return;
    const r = await fetch(`/api/patient/${id}`, { method: 'PATCH', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) });
    if (!r.ok) { alert('rename failed'); return; }
    setRenamingId(null);
    await loadCases();
    if (id === patientId) loadWs();
  }
  async function deletePatient(id: string, name: string) {
    if (!confirm(`Delete patient "${name}" and ALL their documents and records? This cannot be undone.`)) return;
    const r = await fetch(`/api/patient/${id}`, { method: 'DELETE', headers: AUTH });
    if (!r.ok) { alert('delete failed'); return; }
    if (id === patientId) setPatientId('');
    await loadCases();
  }

  async function uploadFiles(files: File[]) {
    // ONE patient, MANY documents: files always attach to the selected patient — never auto-create.
    if (!patientId) { alert('Select or create a patient first, then drop files onto them.'); return; }
    // Accept PDFs, plain text, and images. (.txt + text PDFs extract now; images/scanned PDFs
    // upload but need OCR — see the note in the Documents tab.)
    const ok = /\.(pdf|txt|png|jpe?g|webp)$/i;
    const accepted = files.filter((f) => ok.test(f.name) || /^(application\/pdf|text\/plain|image\/)/.test(f.type));
    if (accepted.length === 0) { alert('Supported files: PDF, .txt, PNG, JPG, WEBP.'); return; }
    const form = new FormData();
    accepted.forEach((f) => form.append('file', f));
    form.append('patientId', patientId);
    setUploading(accepted.length); // instant feedback while the upload request is in flight
    try {
      const r = await fetch('/api/upload/bulk', { method: 'POST', headers: AUTH, body: form });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'upload failed'); return; }
      setUploads((u) => [...(d.uploads as Upload[]).map((x) => ({ ...x, status: 'QUEUED' })), ...u]);
      // Refresh the case + workspace NOW so the new documents (and their QUEUED status) appear at once.
      await Promise.all([loadCases(), loadWs()]);
    } finally { setUploading(0); }
  }

  useEffect(() => {
    const pending = uploads.filter((u) => u.status !== 'DONE' && u.status !== 'FAILED');
    if (pending.length === 0) return;
    const h = setInterval(async () => {
      const next = await Promise.all(uploads.map(async (u) => {
        if (u.status === 'DONE' || u.status === 'FAILED') return u;
        try {
          const d = await (await fetch(`/api/document/${u.documentId}/status`)).json();
          return { ...u, status: d.status ?? u.status, stage: d.stage, recordCount: d.recordCount };
        } catch { return u; }
      }));
      setUploads(next);
      if (next.some((u) => u.status === 'DONE')) { loadCases(); loadWs(); }
    }, 2000);
    return () => clearInterval(h);
  }, [uploads, loadCases, loadWs]);

  // Resume progress after a RELOAD: if any document's DB job is still processing, keep refreshing the
  // workspace until it's done — so ingestion status is visible and live even without the in-memory list.
  useEffect(() => {
    const active = ws?.documents.some((d) => d.job && d.job.status !== 'DONE' && d.job.status !== 'FAILED');
    if (!active) return;
    const h = setInterval(() => { loadWs(); loadCases(); }, 2500);
    return () => clearInterval(h);
  }, [ws, loadWs, loadCases]);

  const selectedName = cases.find((c) => c.patientId === patientId)?.patientName ?? ws?.patient.displayName;
  // Counts for the sticky banner — same active-problem definition the Overview uses.
  const bannerCounts = (() => {
    if (!ws) return { active: 0, meds: 0 };
    const active = resolveConditions(ws.records).filter((e) => e.currentStatus !== 'ruled out' && e.current.assertion !== 'FAMILY_HISTORY' && isActiveStatus(e.currentStatus) && isProblemWorthy(e)).length;
    const nowY = Math.max(0, ...ws.records.filter((r) => r.effective).map((r) => new Date(r.effective!).getUTCFullYear()));
    const meds = resolveMeds(ws.records).filter((e) => medEra(e, nowY) === 'current').length;
    return { active, meds };
  })();

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: C.bg, color: C.text, font: `14px ${FONT}` }}>
      <TopNav active="medical" onMenu={() => setNavOpen(true)} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
      {/* MOBILE: backdrop behind the open drawer */}
      {isMobile && navOpen && (
        <div onClick={() => setNavOpen(false)} style={{ position: 'fixed', top: 50, inset: '50px 0 0 0', zIndex: 55, background: 'rgba(16,24,40,.42)' }} />
      )}
      {/* LEFT: brand + intake + cases */}
      <aside style={{
        width: 272, background: C.card, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'auto',
        ...(isMobile ? { position: 'fixed', top: 50, bottom: 0, left: 0, zIndex: 60, width: 'min(85vw, 320px)', transform: navOpen ? 'none' : 'translateX(-105%)', transition: 'transform .26s cubic-bezier(.22,.61,.36,1)' } : {}),
      }}>
        <div style={{ padding: '17px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: `linear-gradient(145deg, ${C.accent}, ${C.primary} 65%)`, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 15, boxShadow: '0 2px 6px rgba(15,76,92,.30)' }}>Z</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15.5, letterSpacing: -0.3 }}>Zoe Medical</div>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 0.3, textTransform: 'uppercase', fontWeight: 600 }}>Clinical Intelligence</div>
          </div>
          <a href="/" style={{ marginLeft: 'auto', fontSize: 12, color: C.accent, textDecoration: 'none', fontWeight: 600 }}>Home</a>
          {isMobile && (
            <button onClick={() => setNavOpen(false)} aria-label="Close menu"
              style={{ border: 'none', background: 'none', color: C.muted, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px' }}>✕</button>
          )}
        </div>

        <div style={{ padding: '14px 14px 14px' }}>
          <SectionLabel>Patients</SectionLabel>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createPatient()}
              placeholder="New patient name" style={{ flex: 1, padding: '7px 9px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none' }} />
            <button onClick={createPatient} disabled={!newName.trim()} title="Create patient"
              style={{ padding: '7px 11px', borderRadius: 8, border: 'none', background: newName.trim() ? C.primary : C.border, color: '#fff', cursor: newName.trim() ? 'pointer' : 'default', fontWeight: 600, fontSize: 13 }}>Add</button>
          </div>
          {cases.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>No patients yet — add one above.</p>}
          {cases.map((c) => {
            const active = c.patientId === patientId;
            const renaming = renamingId === c.patientId;
            return (
              <div key={c.patientId} style={{ marginBottom: 6, borderRadius: 10, background: active ? C.primarySoft : C.card, border: `1px solid ${active ? '#c7dbe1' : 'transparent'}`, overflow: 'hidden', position: 'relative' }}>
                {active && <div style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 3, background: C.primary }} />}
                {renaming ? (
                  <div style={{ display: 'flex', gap: 6, padding: 8 }}>
                    <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') renamePatient(c.patientId, renameVal); if (e.key === 'Escape') setRenamingId(null); }}
                      style={{ flex: 1, padding: '5px 7px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none' }} />
                    <button onClick={() => renamePatient(c.patientId, renameVal)} style={{ ...linkBtn, color: C.primary }}>Save</button>
                    <button onClick={() => setRenamingId(null)} style={linkBtn}>✕</button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => { setPatientId(c.patientId); setNavOpen(false); }} className={active ? '' : 'zcaselink'}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 11px', cursor: 'pointer', border: 'none', background: 'none' }}>
                      <div style={{ width: 30, height: 30, borderRadius: 15, flexShrink: 0, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12.5, color: active ? '#fff' : C.sub, background: active ? C.primary : '#eceae6' }}>{(c.patientName.trim()[0] || '?').toUpperCase()}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div dir="auto" style={{ fontWeight: 600, fontSize: 13, color: active ? C.primary : C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.patientName}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{c.recordCount} facts · {c.docCount} docs</div>
                      </div>
                    </button>
                    {active && (
                      <div style={{ display: 'flex', gap: 14, padding: '0 11px 9px 48px' }}>
                        <button onClick={() => { setRenamingId(c.patientId); setRenameVal(c.patientName); }} style={linkBtn}>Rename</button>
                        <button onClick={() => deletePatient(c.patientId, c.patientName)} style={{ ...linkBtn, color: C.danger }}>Delete</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 'auto', borderTop: `1px solid ${C.border}`, padding: 12 }}>
          <button onClick={() => setTeamOpen(true)} className="zcaselink"
            style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', border: `1px solid ${C.border}`, borderRadius: 10, background: C.card, cursor: 'pointer', padding: '9px 11px', textAlign: 'left' }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: C.primarySoft, display: 'grid', placeItems: 'center', fontSize: 14 }}>👥</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>Team &amp; Access</div>
              <div style={{ fontSize: 11, color: C.muted }}>Roles · sign-off · audit log</div>
            </div>
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{ flex: 1, overflow: 'auto', padding: isMobile ? '0 13px 24px' : '0 28px 28px' }}>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" />
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes zshimmer { 0% { background-position: 100% 0 } 100% { background-position: 0 0 } }
          @keyframes zfade { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
          @keyframes zpulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }
          * { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
          ::selection { background: rgba(13,133,123,.20); }
          .zscroll::-webkit-scrollbar, main::-webkit-scrollbar, aside::-webkit-scrollbar { width: 10px; height: 10px; }
          .zscroll::-webkit-scrollbar-thumb, main::-webkit-scrollbar-thumb, aside::-webkit-scrollbar-thumb { background: #d8d4ce; border-radius: 8px; border: 3px solid transparent; background-clip: content-box; }
          .zscroll::-webkit-scrollbar-thumb:hover, main::-webkit-scrollbar-thumb:hover, aside::-webkit-scrollbar-thumb:hover { background: #c4c0b9; background-clip: content-box; }
          input:focus, select:focus, textarea:focus { border-color: ${C.accent} !important; box-shadow: 0 0 0 3px rgba(13,133,123,.16); }
          button { font-family: inherit; }
          .zcard { transition: box-shadow .18s ease, border-color .18s ease, transform .18s ease; }
          .zcard:hover { box-shadow: ${SHADOW_MD}; border-color: #d8d4ce; }
          .zrow { transition: background .13s ease; }
          .zrow:hover { background: #faf9f7; }
          .ztab { animation: zfade .22s cubic-bezier(.22,.61,.36,1) both; }
          .zexp { transition: transform .18s ease; display: inline-block; }
          .zexp.o { transform: rotate(90deg); }
          .ztabbtn { position: relative; transition: color .15s ease; }
          .ztabbtn::after { content:''; position:absolute; left:12px; right:12px; bottom:-1px; height:2px; border-radius:2px; background:${C.primary}; transform: scaleX(0); transform-origin:center; transition: transform .2s cubic-bezier(.22,.61,.36,1); }
          .ztabbtn.on::after { transform: scaleX(1); }
          .zcaselink { transition: background .14s ease; }
          .zcaselink:hover { background: #faf9f7; }
          .zfab { transition: transform .16s ease, box-shadow .16s ease; }
          .zfab:hover { transform: translateY(-2px) scale(1.04); }
        `}} />
        {!patientId ? (
          <div style={{ color: C.muted, marginTop: 60, textAlign: 'center' }}>{isMobile ? 'Tap ☰ (top-left) to pick or add a patient.' : 'Select or create a patient on the left to begin.'}</div>
        ) : !ws ? (
          <div style={{ maxWidth: 980, margin: '0 auto', paddingTop: 22 }}>
            {wsLoading ? (<><Skeleton h={64} mb={14} r={10} /><Skeleton h={40} w="60%" mb={18} /><TabSkeleton /></>)
              : <div style={{ color: C.muted, marginTop: 60, textAlign: 'center' }}>Could not load this patient. Try again.</div>}
          </div>
        ) : (
          <div style={{ maxWidth: 980, margin: '0 auto' }}>
            {/* Sticky clinical header — identity, counts, and the allergy banner never scroll away */}
            <div style={{ position: 'sticky', top: 0, zIndex: 20, background: C.bg, paddingTop: 16, boxShadow: '0 10px 16px -14px rgba(16,24,40,.35)' }}>
              <PatientBanner name={ws.patient.displayName} sex={ws.patient.sex} age={ws.patient.age} records={ws.records}
                docCount={ws.documents.length} activeCount={bannerCounts.active} medCount={bannerCounts.meds} signed={ws.case.signed} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, borderBottom: `1px solid ${C.border}`, background: C.bg, overflowX: 'auto' }} className="zscroll">
                {TABS.map((t) => {
                  const on = tab === t.key;
                  return (
                    <button key={t.key} onClick={() => setTab(t.key)} className={`ztabbtn${on ? ' on' : ''}`}
                      style={{
                        padding: '11px 15px 12px', cursor: 'pointer', border: 'none', background: 'none', whiteSpace: 'nowrap',
                        fontSize: 13.5, fontWeight: on ? 700 : 500, color: on ? C.primary : C.sub, letterSpacing: -0.1, marginBottom: -1,
                      }}>{tt(t.label)}</button>
                  );
                })}
                <div style={{ flex: 1 }} />
                <div style={{ display: 'inline-flex', background: '#eceae6', borderRadius: 8, padding: 2, marginBottom: 6, alignSelf: 'center' }}>
                  {(['en', 'ar'] as const).map((l) => (
                    <button key={l} onClick={() => setLang(l)} title={l === 'en' ? 'English' : 'العربية'}
                      style={{ border: 'none', cursor: 'pointer', borderRadius: 6, padding: '4px 11px', fontSize: 12, fontWeight: 700, background: lang === l ? C.card : 'transparent', color: lang === l ? C.primary : C.sub, boxShadow: lang === l ? SHADOW : 'none' }}>
                      {l === 'en' ? 'EN' : 'ع'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div key={tab} className="ztab" dir={lang === 'ar' ? 'rtl' : 'ltr'} style={{ paddingTop: 16 }}>
              {tab === 'overview' && <CompletenessPanel caseId={ws.case.id} records={ws.records.length} />}
              <div style={{ height: tab === 'overview' ? 16 : 0 }} />
              {tab === 'documents' && (
                <DocumentsTab ws={ws} uploads={uploads} uploading={uploading} dragOver={dragOver} setDragOver={setDragOver}
                  uploadFiles={uploadFiles} selectedName={selectedName} onViewRecords={() => setTab('overview')}
                  onChanged={() => { loadWs(); loadCases(); }} />
              )}
              {tab === 'overview' && <OverviewTab records={ws.records} trusted={ws.verification?.trusted} caseId={ws.case.id} patientName={ws.patient.displayName} patientSex={ws.patient.sex} patientAge={ws.patient.age} docCount={ws.documents.length} attention={attentionMap} setAttention={setAttention} role={role} setRole={setRole} />}
              {tab === 'timeline' && <TimelineTab records={ws.records} trusted={ws.verification?.trusted} />}
              {tab === 'labs' && <LabsTab records={ws.records} trusted={ws.verification?.trusted} />}
              {tab === 'imaging' && <ImagingTab records={ws.records} trusted={ws.verification?.trusted} />}
              {tab === 'medications' && <MedicationsTab records={ws.records} trusted={ws.verification?.trusted} />}
              {tab === 'deliverables' && <DeliverablesTab patientId={ws.patient.id} caseId={ws.case.id} patientName={ws.patient.displayName} onSigned={() => { loadWs(); loadCases(); }} />}
            </div>
          </div>
        )}
      </main>
      </div>{/* /inner flex row */}

      {/* CHAT: launcher + collapsible drawer */}
      {!chatOpen && (
        <button onClick={() => setChatOpen(true)} title="Open assistant" className="zfab"
          style={{ position: 'fixed', right: 24, bottom: 24, width: 56, height: 56, borderRadius: 28, border: 'none', cursor: 'pointer', background: `linear-gradient(145deg, ${C.accent}, ${C.primary} 70%)`, color: '#fff', boxShadow: '0 8px 22px rgba(15,76,92,.38)', fontSize: 22 }}>
          💬
        </button>
      )}
      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} patientId={ws?.patient.id ?? ''} patientName={ws?.patient.displayName ?? ''} />
      {teamOpen && <TeamPanel onClose={() => setTeamOpen(false)} onActed={() => { loadCases(); if (patientId) loadWs(); }} />}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.muted, margin: '2px 0 8px' }}>{children}</div>;
}
function uploadChip(u: Upload) {
  if (u.status === 'DONE') return <Chip bg="#e7f4ec" fg="#2a7d46">done · {u.recordCount ?? 0}</Chip>;
  if (u.status === 'FAILED') return <Chip bg="#fbe3e0" fg="#b3261e">failed</Chip>;
  if (u.status === 'RUNNING') return <Chip bg="#fdf0d5" fg="#8a5a00">extracting</Chip>;
  return <Chip bg="#eceae6" fg={C.sub}>queued</Chip>;
}

const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: SHADOW };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: C.accent, cursor: 'pointer', padding: 0, fontSize: 12, fontWeight: 600 };
const sourceQuote: React.CSSProperties = { fontSize: 12.5, color: C.sub, fontStyle: 'italic', marginTop: 6, paddingLeft: 10, borderLeft: `2px solid ${C.border}` };

// Minimal Markdown → React for the summary: **bold**, "- " bullet lists, and paragraphs.
function mdInline(s: string): React.ReactNode {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>);
}
function SummaryBody({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    blocks.push(<ul key={blocks.length} style={{ margin: '2px 0 10px', paddingLeft: 18 }}>
      {bullets.map((b, i) => <li key={i} dir="auto" style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 3, color: C.text }}>{mdInline(b)}</li>)}
    </ul>);
    bullets = [];
  };
  for (const raw of text.split('\n')) {
    const t = raw.trim();
    if (!t) { flush(); continue; }
    if (/^[-*•]\s+/.test(t)) bullets.push(t.replace(/^[-*•]\s+/, ''));
    else { flush(); blocks.push(<p key={blocks.length} dir="auto" style={{ fontSize: 14.5, lineHeight: 1.55, margin: '0 0 8px', color: C.text }}>{mdInline(t)}</p>); }
  }
  flush();
  return <div>{blocks}</div>;
}

// Common chronic conditions — used only to tag "chronic" when confidently matched (never guesses acute).
const CHRONIC = /diabet|hypertens|chronic kidney|ckd|copd|asthma|heart failure|cardiomyopath|carcinoma|cancer|malignan|cirrhos|hypothyroid|hyperthyroid|hyperlipid|dyslipid|atrial fibrillation|osteoporos|osteoarthr|rheumatoid|depress|epileps|parkinson|dementia|hiv|hepatitis [bc]/i;
function isChronic(e: Entity): boolean { return CHRONIC.test(e.title) || CHRONIC.test(norm(e.current.coding?.display ?? e.current.coding?.label)); }

// Patient banner (Epic Storyboard-style): identity + safety-critical allergies + at-a-glance counts.
function PatientBanner({ name, sex, age, records, docCount, activeCount, medCount, signed }: { name: string; sex?: string | null; age?: number | null; records: Rec[]; docCount: number; activeCount: number; medCount: number; signed?: boolean }) {
  const demo = [age != null ? `${age} y` : null, sex ? sex.charAt(0).toUpperCase() + sex.slice(1) : null].filter(Boolean).join(' · ');
  const allergyRecs = dedupe(records.filter((r) => r.type === 'ALLERGY'));
  const seenAll = new Set<string>();
  const present: string[] = [];
  for (const r of allergyRecs) { if (r.negated) continue; const nm = allergenName(r.coding?.display || r.coding?.label || 'allergy'); const k = codeKey(r.coding, ['rxnorm', 'rxcui']) ?? norm(nm); if (!seenAll.has(k)) { seenAll.add(k); present.push(nm); } }
  const nkda = allergyRecs.some((r) => r.negated) && present.length === 0;
  const stat = (n: number, label: string) => (
    <div style={{ textAlign: 'center', minWidth: 76, padding: '0 4px' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.primary, letterSpacing: -0.5, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginTop: 4 }}>{label}</div>
    </div>
  );
  return (
    <div style={{ ...card, padding: 0, marginBottom: 12, overflow: 'hidden', boxShadow: SHADOW_MD }}>
      <div style={{ height: 4, background: `linear-gradient(90deg, ${C.primary}, ${C.accent})` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 18px' }}>
        <div style={{ width: 44, height: 44, borderRadius: 22, background: `linear-gradient(145deg, ${C.accent}, ${C.primary} 65%)`, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 17, flexShrink: 0, boxShadow: '0 0 0 3px #fff, 0 0 0 4px #eceae6' }}>
          {name.trim().charAt(0).toUpperCase() || '?'}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div dir="auto" style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.4, color: C.text }}>{name}</div>
            {signed && <Chip bg={C.goodBg} fg={C.good}>✓ signed</Chip>}
          </div>
          <div style={{ fontSize: 12, color: C.sub, marginTop: 1 }}>{demo || 'Patient summary'}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {stat(activeCount, 'Problems')}
          <div style={{ width: 1, height: 30, background: C.border }} />
          {stat(medCount, 'Medications')}
          <div style={{ width: 1, height: 30, background: C.border }} />
          {stat(docCount, 'Documents')}
        </div>
      </div>
      {/* Allergy alert strip — safety critical, always visible */}
      <div style={{
        padding: '9px 18px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
        background: present.length ? C.dangerBg : C.goodBg, color: present.length ? C.danger : C.good, borderTop: `1px solid ${C.line}`,
      }}>
        <span style={{ fontSize: 14 }}>{present.length ? '⚠️' : '✓'}</span>
        <span style={{ textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 11 }}>Allergies</span>
        <span dir="auto" style={{ fontWeight: 700 }}>
          {present.length ? present.join(', ') : nkda ? 'No known allergies' : 'None recorded'}
        </span>
      </div>
    </div>
  );
}

// ---------- Clinical Attention (decision support) ----------
type AttnItem = { priority: string; category: string; title: string; detail: string; sources: string[] };
// Lifted cache entry: one analysis per record-set. `status` prevents re-running (re-costing a Gemini
// call) on tab switches and surfaces failures as a retryable error instead of a silent empty result.
type AttnState = { key: string; status: 'loading' | 'done' | 'error'; items: AttnItem[] };
const ATTN_CAT: Record<string, { icon: string; label: string }> = {
  trend: { icon: '📈', label: 'Trend' },
  stale: { icon: '⏳', label: 'Stale' },
  unresolved: { icon: '❓', label: 'Unresolved' },
  interaction: { icon: '⚠️', label: 'Interaction' },
  contraindication: { icon: '🚫', label: 'Contraindication' },
  monitoring: { icon: '🩸', label: 'Monitoring' },
  connection: { icon: '🔗', label: 'Connection' },
};
function attnTone(p: string): { bar: string; chip: string; fg: string } {
  if (p === 'high') return { bar: '#b3261e', chip: '#fbe3e0', fg: '#b3261e' };
  if (p === 'low') return { bar: '#9aa7b2', chip: '#f0efec', fg: '#847f77' };
  return { bar: '#b45309', chip: '#fdf3e6', fg: '#b45309' }; // medium
}
// Per-role emphasis: a SECONDARY ordering by category (severity stays primary — safety unchanged).
const ROLE_CAT_ORDER: Record<string, string[]> = {
  surgeon: ['interaction', 'contraindication', 'monitoring', 'trend', 'stale', 'unresolved', 'connection'],
  referring: ['unresolved', 'connection', 'trend', 'monitoring', 'stale', 'interaction', 'contraindication'],
  insurer: ['stale', 'unresolved', 'monitoring', 'trend', 'interaction', 'contraindication', 'connection'],
  patient: ['monitoring', 'trend', 'unresolved', 'connection', 'stale', 'interaction', 'contraindication'],
};
const catRank = (role: string, cat: string) => { const o = ROLE_CAT_ORDER[role] ?? ROLE_CAT_ORDER.surgeon; const i = o.indexOf(cat); return i < 0 ? 99 : i; };
// Prioritized "what to notice" list — ANALYZER over the reconciled, source-cited facts. Decision
// support only; every item cites its source facts. State is lifted so it survives tab switches.
function ClinicalAttention({ caseId, recordCount, cached, onResult, role }: {
  caseId: string; recordCount: number; cached: AttnState | null; onResult: (v: AttnState) => void; role: RoleKey;
}) {
  const [lensMap, setLensMap] = useState<Record<string, string>>({});
  const key = `${caseId}:${recordCount}`;
  // The lifted cache for THIS record-set (survives tab switches, so no re-cost). status drives the UI.
  const state = cached && cached.key === key ? cached : null;
  const status = state?.status;
  const items = status === 'done' ? state!.items : null;
  const gen = useCallback(async (force = false) => {
    // Mark in-flight in the LIFTED state FIRST, so a remount (tab switch) during analysis sees
    // "loading" and does NOT fire a second Gemini call. Result/error are cached too.
    onResult({ key, status: 'loading', items: [] });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000); // never hang on "Analyzing…"
    try {
      const r = await fetch(`/api/case/${caseId}/attention`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ force }), signal: ctrl.signal });
      if (!r.ok) throw new Error(`attention ${r.status}`);
      const d = await r.json();
      onResult({ key, status: 'done', items: Array.isArray(d.items) ? d.items : [] });
    } catch {
      onResult({ key, status: 'error', items: [] });
    } finally { clearTimeout(timer); }
  }, [caseId, key, onResult]);
  // Fetch once per record-set: only when there's no cache entry for this key (a "loading" entry from
  // another mount, or a done/error entry, prevents a duplicate call).
  useEffect(() => { if (recordCount > 0 && !state) gen(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key, recordCount]);
  // Role LENS — reframes emphasis over the EXISTING flags (never regenerates or re-ranks them).
  const lensKey = items && items.length ? `${role}:${key}` : '';
  const lens = lensMap[lensKey];
  useEffect(() => {
    if (!items || items.length === 0 || lensMap[lensKey] !== undefined) return;
    fetch(`/api/case/${caseId}/attention/lens`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ role, items }) })
      .then((r) => r.json()).then((d) => setLensMap((m) => ({ ...m, [lensKey]: d.lens || '' }))).catch(() => setLensMap((m) => ({ ...m, [lensKey]: '' })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lensKey]);
  if (recordCount === 0) return null;
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  // Severity stays PRIMARY (safety unchanged); role only reorders within equal severity.
  const sorted = items ? [...items].sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || catRank(role, a.category) - catRank(role, b.category)) : [];
  const highCount = sorted.filter((s) => s.priority === 'high').length;
  const roleLabel = ROLES.find((r) => r.key === role)?.label ?? '';
  return (
    <div className="zcard" style={{ ...card, padding: 0, marginBottom: 18, overflow: 'hidden', boxShadow: SHADOW_MD, border: `1px solid ${highCount ? C.warmBorder : C.border}` }}>
      {/* HERO header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: `linear-gradient(120deg, ${C.primary}, ${C.primaryDark})`, color: '#fff' }}>
        <div style={{ width: 36, height: 36, borderRadius: 11, background: 'rgba(255,255,255,.15)', display: 'grid', placeItems: 'center', fontSize: 18, flexShrink: 0 }}>🩺</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: -0.3 }}>Clinical Attention</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.72)' }}>Prioritized decision support — not a diagnosis</div>
        </div>
        <div style={{ flex: 1 }} />
        {sorted.length > 0 && (
          <span style={{ fontSize: 11.5, fontWeight: 700, background: highCount ? 'rgba(255,176,120,.30)' : 'rgba(255,255,255,.16)', color: '#fff', borderRadius: 999, padding: '4px 12px', whiteSpace: 'nowrap' }}>
            {sorted.length} flag{sorted.length !== 1 ? 's' : ''}{highCount ? ` · ${highCount} high` : ''}
          </span>
        )}
        <button onClick={() => gen(true)} disabled={status === 'loading'} style={{ ...linkBtn, color: '#cfe6ec' }}>{status === 'loading' ? 'Analyzing…' : status === 'done' ? 'Refresh' : ''}</button>
      </div>
      {/* ROLE LENS — reframed emphasis for the selected reader (same flags) */}
      {sorted.length > 0 && (
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '10px 18px', background: C.primarySoft, borderBottom: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 13, marginTop: 1 }}>{ROLES.find((r) => r.key === role)?.icon}</span>
          <div style={{ minWidth: 0 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: C.primary, letterSpacing: 0.3, textTransform: 'uppercase' }}>For the {roleLabel} · </span>
            <span dir="auto" style={{ fontSize: 12.5, color: C.text, lineHeight: 1.5 }}>{lens === undefined ? 'framing for this reader…' : (lens || 'Emphasis reordered for this reader below.')}</span>
          </div>
        </div>
      )}
      {status === 'loading' ? (
        <div style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Analyzing this patient’s facts…</div>
          <Skeleton h={13} w="72%" mb={9} /><Skeleton h={13} w="92%" mb={9} /><Skeleton h={13} w="58%" mb={0} />
        </div>
      ) : status === 'error' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: C.dangerBg, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.danger }}>Analysis couldn’t complete</div>
            <div style={{ fontSize: 12, color: C.sub }}>The attention analysis failed or timed out — no charge was cached. Retry when ready.</div>
          </div>
          <button onClick={() => gen(true)} style={{ padding: '7px 15px', borderRadius: 8, border: 'none', background: C.danger, color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Retry</button>
        </div>
      ) : sorted.length === 0 ? (
        <div style={{ padding: '16px 18px', color: C.sub, fontSize: 13 }}>✓ Nothing flagged for attention from the current facts.</div>
      ) : (
        <div>
          {sorted.map((it, i) => {
            const t = attnTone(it.priority);
            const cat = ATTN_CAT[it.category] ?? ATTN_CAT.connection;
            const hi = it.priority === 'high';
            return (
              <div key={i} style={{ display: 'flex', gap: 0, borderTop: i ? `1px solid ${C.line}` : 'none', background: hi ? '#fffaf4' : undefined }}>
                <div style={{ width: 4, background: t.bar, flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span title={cat.label} style={{ width: 22, height: 22, borderRadius: 6, background: t.chip, display: 'inline-grid', placeItems: 'center', fontSize: 12 }}>{cat.icon}</span>
                    <strong dir="auto" style={{ fontSize: 14, color: C.text, letterSpacing: -0.1 }}>{it.title}</strong>
                    <Chip bg={t.chip} fg={t.fg}>{it.priority}</Chip>
                  </div>
                  {it.detail && <div dir="auto" style={{ fontSize: 12.5, color: C.sub, marginTop: 4, lineHeight: 1.55 }}>{it.detail}</div>}
                  {it.sources.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
                      {it.sources.map((s, j) => (
                        <span key={j} dir="auto" style={{ fontSize: 11, color: C.sub, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: '2px 8px' }}>{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: 11, color: C.muted, padding: '9px 18px', borderTop: `1px solid ${C.line}`, background: '#fbfaf8' }}>AI-surfaced from this patient’s extracted, source-cited facts — clinician judgment required; not a diagnosis.</div>
    </div>
  );
}

// Auto-generated problem-oriented synopsis at the top of the chart. Reframed per ROLE lens; each
// role's summary is cached client-side so switching readers is instant after the first generation.
function SummaryHeader({ caseId, records, role }: { caseId: string; records: number; role: RoleKey }) {
  const [cache, setCache] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const key = `${role}:${records}`;
  const summary = cache[key];
  const gen = useCallback(async (force = false) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/case/${caseId}/summary`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ role, force }) });
      const d = await r.json();
      setCache((c) => ({ ...c, [key]: r.ok ? (d.summary || '') : '' }));
    } finally { setBusy(false); }
  }, [caseId, role, key]);
  // Generate on role/record change; reuse the per-role cache so re-selecting a reader is instant.
  useEffect(() => { if (records > 0 && cache[key] === undefined && !busy) gen(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key, records]);
  const clean = (summary ?? '').trim();
  const show = clean && clean !== '[]' && clean !== '{}';
  const roleLabel = ROLES.find((r) => r.key === role)?.label ?? '';
  return (
    <div className="zcard" style={{ ...card, padding: 0, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderBottom: show ? `1px solid ${C.line}` : 'none' }}>
        <span style={{ width: 24, height: 24, borderRadius: 7, background: C.primarySoft, display: 'grid', placeItems: 'center', fontSize: 13 }}>📝</span>
        <strong style={{ fontSize: 13.5, letterSpacing: -0.1 }}>Clinical Summary</strong>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: C.accent, background: C.primarySoft, borderRadius: 999, padding: '2px 8px', letterSpacing: 0.3 }}>AI</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: C.sub, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 999, padding: '2px 8px' }}>for {roleLabel}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => gen(true)} disabled={busy} style={linkBtn}>{busy ? 'Generating…' : 'Regenerate'}</button>
      </div>
      <div style={{ padding: '12px 16px' }}>
        {busy && !show ? <div style={{ padding: '2px 0' }}><Skeleton h={12} w="94%" mb={8} /><Skeleton h={12} w="88%" mb={8} /><Skeleton h={12} w="60%" mb={0} /></div>
          : show ? <SummaryBody text={clean} />
          : <div style={{ color: C.muted, fontSize: 13 }}>No synopsis yet.</div>}
        <div style={{ fontSize: 11, color: C.muted, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>AI-generated from this patient’s extracted, source-cited facts — verify before clinical use.</div>
      </div>
    </div>
  );
}

// ---------- tabs ----------
function OverviewTab({ records, trusted, caseId, patientName, patientSex, patientAge, docCount, attention, setAttention, role, setRole }: { records: Rec[]; trusted?: boolean; caseId: string; patientName: string; patientSex?: string | null; patientAge?: number | null; docCount: number; attention: Record<string, AttnState>; setAttention: (v: AttnState) => void; role: RoleKey; setRole: (r: RoleKey) => void }) {
  const [showInactive, setShowInactive] = useState(false);
  const [showSymptoms, setShowSymptoms] = useState(false);
  const conditions = resolveConditions(records);
  const nowY = Math.max(0, ...records.filter((r) => r.effective).map((r) => new Date(r.effective!).getUTCFullYear()));
  const meds = resolveMeds(records).filter((e) => medEra(e, nowY) === 'current'); // Overview lists CURRENT meds only
  const recs = dedupe(records);
  // Split conditions: active problem list vs resolved/historical vs family history vs ruled-out.
  const ruledOut = conditions.filter((e) => e.currentStatus === 'ruled out');
  const family = conditions.filter((e) => e.current.assertion === 'FAMILY_HISTORY' && e.currentStatus !== 'ruled out');
  const nonRuled = conditions.filter((e) => e.currentStatus !== 'ruled out' && e.current.assertion !== 'FAMILY_HISTORY');
  const isActive = (e: Entity) => /active|ongoing|recurrence|suspected/.test(e.currentStatus);
  const byRecent = (a: Entity, b: Entity) => (b.current.effective ?? '').localeCompare(a.current.effective ?? '');
  // Problem list = active DIAGNOSES only; transient symptoms/signs are excluded (still in Timeline/Findings).
  const symptoms = nonRuled.filter((e) => isActive(e) && !isProblemWorthy(e)).sort(byRecent);
  // Significance ordering: chronic major problems first, then most recent.
  const activeProblems = nonRuled.filter((e) => isActive(e) && isProblemWorthy(e)).sort((a, b) => (isChronic(b) ? 1 : 0) - (isChronic(a) ? 1 : 0) || byRecent(a, b));
  const inactive = nonRuled.filter((e) => !isActive(e)).sort(byRecent);
  const chronicBadge = (e: Entity) => (isChronic(e) ? <Chip bg="#eef0fb" fg="#4f46e5">chronic</Chip> : null);
  // Drop surveillance negatives from ruled-out: "ruled out X" when the patient actually has X.
  const coreOf = (e: Entity) => conceptCore(e.current.coding || {});
  const knownCores = new Set([...activeProblems, ...inactive, ...family].map(coreOf));
  const ruledOutShown = ruledOut.filter((e) => !knownCores.has(coreOf(e)));
  // IPS-aligned section order: Allergies, Diagnostic Results, Immunizations, Procedures.
  const otherGroups: { label: string; types: string[]; filter?: (r: Rec) => boolean }[] = [
    { label: 'Allergies', types: ['ALLERGY'] },
    // Findings = non-lab, non-imaging observations (exam, vitals, symptoms coded as observations).
    // Real labs live in the Labs tab; imaging findings live in the Imaging tab.
    { label: 'Findings', types: ['OBSERVATION'], filter: (r) => !isLabObservation(r) && !isImaging(r) },
    { label: 'Immunizations', types: ['IMMUNIZATION'] },
    { label: 'Procedures', types: ['PROCEDURE'] },
  ];
  // Group active problems by clinical system (renal, cardiac, neuro, MSK…), in a stable order.
  const bySystem = new Map<string, Entity[]>();
  for (const e of activeProblems) { const s = systemOf(e); (bySystem.get(s) ?? bySystem.set(s, []).get(s)!).push(e); }
  const systemOrder = [...SYSTEMS.map((s) => s.label), 'Other / unclassified'];
  const activeSystems = [...bySystem.keys()].sort((a, b) => systemOrder.indexOf(a) - systemOrder.indexOf(b));
  return (
    <div>
      {/* Role lens — reframes the summary + attention emphasis for the reader (same facts) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: C.muted }}>Viewing as</span>
        <div style={{ display: 'inline-flex', background: '#eceae6', borderRadius: 10, padding: 3, gap: 2 }}>
          {ROLES.map((r) => {
            const on = role === r.key;
            return (
              <button key={r.key} onClick={() => setRole(r.key)} title={r.label}
                style={{ border: 'none', cursor: 'pointer', borderRadius: 7, padding: '6px 12px', fontSize: 12.5, fontWeight: on ? 700 : 600, background: on ? C.card : 'transparent', color: on ? C.primary : C.sub, boxShadow: on ? SHADOW : 'none', display: 'flex', alignItems: 'center', gap: 6, transition: 'all .14s ease' }}>
                <span style={{ fontSize: 13 }}>{r.icon}</span>{r.label}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: 11.5, color: C.muted }}>same source-cited facts · reframed emphasis</span>
      </div>
      <ClinicalAttention caseId={caseId} recordCount={records.length} cached={attention[`${caseId}:${records.length}`] ?? null} onResult={setAttention} role={role} />
      <SummaryHeader caseId={caseId} records={records.length} role={role} />
      {!trusted && (
        <div style={{ ...card, padding: '10px 14px', marginBottom: 14, background: '#fbfaf5', borderColor: '#eadfb8', fontSize: 12.5, color: '#7a6a2f' }}>
          Independent verification is not active — the verifier is the mock or the same model as the extractor, so no “verified” badges are shown. Route <code>VERIFIER_PROVIDER</code> to a different real model to enable it.
        </div>
      )}
      {activeProblems.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <SectionLabel>Problem list · {activeProblems.length}</SectionLabel>
          {activeSystems.map((sys) => (
            <div key={sys} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 6px' }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: WARM.border }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: C.sub, letterSpacing: 0.2 }}>{sys}</span>
                <span style={{ fontSize: 11, color: C.muted }}>· {bySystem.get(sys)!.length}</span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>
              {bySystem.get(sys)!.map((e) => <EntityCard key={e.key} e={e} trusted={trusted} badge={chronicBadge(e)} />)}
            </div>
          ))}
        </section>
      )}
      {inactive.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <button onClick={() => setShowInactive(!showInactive)}
            style={{ ...linkBtn, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>
            Resolved / historical · {inactive.length} {showInactive ? '▾' : '▸'}
          </button>
          {showInactive && inactive.map((e) => <EntityCard key={e.key} e={e} trusted={trusted} badge={chronicBadge(e)} />)}
        </section>
      )}
      {symptoms.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <button onClick={() => setShowSymptoms(!showSymptoms)}
            style={{ ...linkBtn, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>
            Symptoms &amp; signs · {symptoms.length} {showSymptoms ? '▾' : '▸'}
          </button>
          {showSymptoms && symptoms.map((e) => <EntityCard key={e.key} e={e} trusted={trusted} />)}
        </section>
      )}
      {meds.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <SectionLabel>Current medications · {meds.length}</SectionLabel>
          {meds.map((e) => <EntityCard key={e.key} e={e} trusted={trusted} />)}
        </section>
      )}
      {otherGroups.map((g) => {
        let rows = recs.filter((r) => g.types.includes(r.type) && (!g.filter || g.filter(r)));
        // Allergies: one row per substance (co-trimoxazole == trimethoprim-sulfamethoxazole).
        if (g.label === 'Allergies') {
          const seen = new Set<string>();
          rows = rows.filter((r) => { const k = codeKey(r.coding, ['rxnorm', 'rxcui']) ?? allergenName(r.coding?.display ?? r.coding?.label ?? ''); if (seen.has(k)) return false; seen.add(k); return true; });
        }
        if (rows.length === 0) return null;
        return (
          <section key={g.label} style={{ marginBottom: 18 }}>
            <SectionLabel>{g.label} · {rows.length}</SectionLabel>
            <div style={{ ...card, overflow: 'hidden' }}>
              {rows.map((r, i) => (
                <div key={r.id} style={{ padding: '12px 14px', borderTop: i ? `1px solid ${C.bg}` : 'none' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {typeChip(r.type)}
                    <strong dir="auto" style={{ fontSize: 14 }}>{r.coding?.display ?? '(no label)'}</strong>
                    <div style={{ flex: 1 }} />
                    {r.negated && <Chip bg="#fbe3e0" fg="#b3261e">negated</Chip>}
                    {statusChip(r.status)}
                    <VerifiedChip verifier={r.provenance?.verifier} trusted={!!trusted} />
                  </div>
                  <div dir="auto" style={{ fontSize: 13.5, marginTop: 5, color: C.text }}>{payloadText(r)}
                    <span style={{ color: C.muted, fontSize: 12, marginLeft: 8 }}>{r.assertion.toLowerCase()}</span>
                  </div>
                  <div dir="auto" style={sourceQuote}>“{r.provenance?.sourceText ?? '(missing!)'}”</div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {family.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <SectionLabel>Family history · {family.length}</SectionLabel>
          {family.map((e) => <EntityCard key={e.key} e={e} trusted={trusted} badge={chronicBadge(e)} />)}
        </section>
      )}

      {ruledOutShown.length > 0 && (
        <section style={{ marginBottom: 18, opacity: 0.85 }}>
          <SectionLabel>Ruled out / negative findings · {ruledOutShown.length}</SectionLabel>
          <div style={{ ...card, background: '#fafbfc', padding: '4px 14px' }}>
            {ruledOutShown.map((e, i) => (
              <div key={e.key} style={{ padding: '10px 0', borderTop: i ? `1px solid ${C.bg}` : 'none' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: C.muted, fontSize: 15 }}>⊘</span>
                  <strong dir="auto" style={{ fontSize: 14, color: C.sub, textDecoration: 'line-through' }}>{e.title}</strong>
                  {e.subtitle && <span style={{ fontSize: 12, color: C.muted }}>{e.subtitle}</span>}
                  <Chip bg="#f0efec" fg="#847f77">ruled out</Chip>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: C.muted }}>{e.docCount} doc{e.docCount !== 1 ? 's' : ''}</span>
                </div>
                <div dir="auto" style={{ ...sourceQuote, color: C.muted }}>“{e.current.provenance?.sourceText ?? '—'}”</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>These are explicitly NOT present — kept for the record, not part of the active problem list.</div>
        </section>
      )}
    </div>
  );
}

function DocumentsTab({ ws, uploads, uploading, dragOver, setDragOver, uploadFiles, selectedName, onViewRecords, onChanged }: {
  ws: Workspace; uploads: Upload[]; uploading: number; dragOver: boolean; setDragOver: (v: boolean) => void;
  uploadFiles: (f: File[]) => void; selectedName?: string; onViewRecords: () => void; onChanged: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState<{ text: string | null; note?: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  async function open(id: string) {
    setOpenId(id); setText(null);
    setText(await (await fetch(`/api/document/${id}/text`)).json());
  }
  async function removeDoc(d: Doc) {
    if (!confirm(`Remove "${d.filename}" and all facts extracted from it? This cannot be undone.`)) return;
    setRemoving(d.id);
    const r = await fetch(`/api/document/${d.id}`, { method: 'DELETE', headers: AUTH });
    const j = await r.json();
    setRemoving(null);
    if (!r.ok) { alert(j.error || 'could not remove document'); return; }
    onChanged(); // reloads records → completeness + all tabs recompute automatically
  }
  // Per-document status: the live in-memory upload wins during the session; after a RELOAD it falls
  // back to the DB job (ProcessingJob), so the "extracting/queued/failed/done" state is still shown.
  const uploadByDoc = new Map(uploads.filter((u) => u.patientId === ws.patient.id).map((u) => [u.documentId, u] as const));
  const statusOf = (d: Doc): { status: string; stage?: string; recordCount?: number } | null => {
    const u = uploadByDoc.get(d.id);
    if (u) return { status: u.status ?? 'QUEUED', stage: u.stage, recordCount: u.recordCount };
    if (d.job) return { status: d.job.status, stage: d.job.stage ?? undefined, recordCount: d.recordCount };
    return null;
  };
  const pending = ws.documents.filter((d) => { const s = statusOf(d); return s && s.status !== 'DONE' && s.status !== 'FAILED'; });
  return (
    <div>
      {/* Ingestion drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); uploadFiles([...e.dataTransfer.files]); }}
        style={{ border: `2px dashed ${uploading > 0 ? C.accent : dragOver ? C.accent : C.border}`, borderRadius: 12, padding: '26px 20px', textAlign: 'center', background: uploading > 0 ? '#e6f5f4' : dragOver ? '#e6f5f4' : '#faf9f7', transition: 'all .15s', marginBottom: 16 }}
      >
        <div style={{ fontSize: 30, lineHeight: 1 }}>{uploading > 0 ? '⏳' : '📥'}</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 8 }}>{uploading > 0 ? `Uploading ${uploading} file${uploading !== 1 ? 's' : ''}…` : `Drop files to add to ${selectedName ?? 'this patient'}`}</div>
        <div style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 2px' }}>PDF · TXT · PNG · JPG · WEBP — attach any number; they merge into this one patient.</div>
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 12 }}>Text PDFs &amp; .txt extract now · images &amp; scanned PDFs upload but need OCR (coming)</div>
        <label style={{ display: 'inline-block', padding: '8px 16px', background: C.primary, color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
          Browse files
          <input type="file" multiple accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,image/*" style={{ display: 'none' }}
            onChange={(e) => { uploadFiles([...(e.target.files ?? [])]); e.currentTarget.value = ''; }} />
        </label>
      </div>

      {/* In-progress ingestion — driven by the DB job, so it stays visible after a reload */}
      {pending.length > 0 && (
        <div style={{ ...card, padding: '10px 14px', marginBottom: 16, borderLeft: `3px solid ${C.warm}` }}>
          <SectionLabel>Ingesting · {pending.length}</SectionLabel>
          {pending.map((d) => { const s = statusOf(d)!; return (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.filename}>{d.filename}</span>
              <span style={{ fontSize: 11, color: C.muted }}>{s.stage ? s.stage.toLowerCase() : ''}</span>
              {uploadChip({ status: s.status, recordCount: s.recordCount } as any)}
            </div>
          ); })}
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Extraction runs on the server — this keeps updating even if you reload.</div>
        </div>
      )}

      <SectionLabel>Documents · {ws.documents.length}</SectionLabel>
      {ws.documents.map((d) => {
        const s = statusOf(d);
        const failed = s?.status === 'FAILED';
        const extracting = !!s && s.status !== 'DONE' && s.status !== 'FAILED';
        return (
        <div key={d.id} style={{ ...card, padding: 12, marginBottom: 10, borderLeft: failed ? `3px solid ${C.danger}` : undefined }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => open(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: C.text, padding: 0, flex: 1, textAlign: 'left' }}>
              📄 {d.filename} <span style={{ color: C.muted, fontSize: 12, fontWeight: 400 }}>· {d.mimeType}</span>
            </button>
            {s && uploadChip({ status: s.status, recordCount: s.recordCount } as any)}
            <button onClick={() => removeDoc(d)} disabled={removing === d.id} title="Remove document"
              style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: C.danger, padding: '4px 10px' }}>
              {removing === d.id ? 'Removing…' : 'Remove'}
            </button>
          </div>
          {failed && (
            <div style={{ marginTop: 8, padding: '8px 10px', background: C.dangerBg, border: `1px solid ${C.warmBorder}`, borderRadius: 8, fontSize: 12.5, color: C.danger }}>
              ⚠ Extraction failed{s?.stage ? ` at ${s.stage}` : ''}. No facts were stored from this document — remove and re-upload, or check the worker log.
            </div>
          )}
          {extracting && <div style={{ marginTop: 8 }}><Skeleton h={11} w="82%" mb={6} /><Skeleton h={11} w="55%" mb={0} /></div>}
          {openId === d.id && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 10 }}>
              <div>
                <SectionLabel>Original text</SectionLabel>
                <pre dir="auto" style={{ whiteSpace: 'pre-wrap', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 12.5, margin: 0, fontFamily: 'ui-monospace, monospace' }}>
                  {text ? (text.text ?? text.note) : 'Loading…'}
                </pre>
              </div>
              <div>
                <SectionLabel>Translated view</SectionLabel>
                <pre style={{ whiteSpace: 'pre-wrap', background: '#fbfbfc', border: `1px dashed ${C.border}`, borderRadius: 8, padding: 10, fontSize: 12.5, color: C.muted, margin: 0 }}>
                  Coming in a later slice.
                </pre>
              </div>
            </div>
          )}
        </div>
        );
      })}
      {ws.documents.length === 0 && <p style={{ color: C.muted }}>No documents uploaded.</p>}
    </div>
  );
}

// Medication reconciliation: Current meds (active) up top, a collapsed Previous list (stopped, with
// stop dates) below. Within each, meds are grouped by era (the year they started / stopped).
function MedicationsTab({ records, trusted }: { records: Rec[]; trusted?: boolean }) {
  const [showPast, setShowPast] = useState(false);
  const [showInpatient, setShowInpatient] = useState(false);
  const meds = resolveMeds(records);
  if (meds.length === 0) return <Empty label="medications" />;
  const nowY = Math.max(0, ...records.filter((r) => r.effective).map((r) => new Date(r.effective!).getUTCFullYear()));
  const current = meds.filter((e) => medEra(e, nowY) === 'current');
  const inpatient = meds.filter((e) => medEra(e, nowY) === 'inpatient');
  const past = meds.filter((e) => medEra(e, nowY) === 'past');
  const sinceOf = (e: Entity) => e.history.map((h) => h.date).filter(Boolean).sort()[0] ?? null; // earliest mention
  const stopOf = (e: Entity) => e.current.effective ?? null; // latest mention (when stopped)
  const yearOf = (d: string | null) => (d ? String(new Date(d).getUTCFullYear()) : 'Undated');
  const byEra = (list: Entity[], pick: (e: Entity) => string | null) => {
    const g = new Map<string, Entity[]>();
    for (const e of list) { const k = yearOf(pick(e)); (g.get(k) ?? g.set(k, []).get(k)!).push(e); }
    return [...g.entries()].sort((a, b) => (a[0] === 'Undated' ? 1 : b[0] === 'Undated' ? -1 : b[0].localeCompare(a[0])));
  };
  const eraBlock = (label: string, count: number, groups: [string, Entity[]][], verb: string) => (
    <section style={{ marginBottom: 18 }}>
      <SectionLabel>{label} · {count}</SectionLabel>
      {groups.map(([era, list]) => (
        <div key={era} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 6px' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>{era === 'Undated' ? 'Date not stated' : `${verb} ${era}`}</span>
            <div style={{ flex: 1, height: 1, background: C.border }} />
          </div>
          {list.map((e) => <EntityCard key={e.key} e={e} trusted={trusted} />)}
        </div>
      ))}
    </section>
  );
  return (
    <div>
      {current.length > 0
        ? eraBlock('Current medications', current.length, byEra(current, sinceOf), 'Since')
        : <div style={{ ...card, padding: 16, marginBottom: 16, color: C.muted, fontSize: 13 }}>No current medications on the active list.</div>}
      {inpatient.length > 0 && (
        <section style={{ marginBottom: 8 }}>
          <button onClick={() => setShowInpatient(!showInpatient)}
            style={{ ...linkBtn, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>
            Inpatient / one-time treatments · {inpatient.length} {showInpatient ? '▾' : '▸'}
          </button>
          {showInpatient && eraBlock('', inpatient.length, byEra(inpatient, stopOf), 'Given')}
        </section>
      )}
      {past.length > 0 && (
        <section>
          <button onClick={() => setShowPast(!showPast)}
            style={{ ...linkBtn, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>
            Previous medications · {past.length} {showPast ? '▾' : '▸'}
          </button>
          {showPast && eraBlock('', past.length, byEra(past, stopOf), 'Stopped')}
        </section>
      )}
    </div>
  );
}

// Labs: one compact row per analyte — latest value + flag + inline trend sparkline. Click to
// expand the full dated trend and the source quote.
function LabRow({ name, rows, trusted }: { name: string; rows: Rec[]; trusted?: boolean }) {
  const [open, setOpen] = useState(false);
  const ordered = [...rows.filter((r) => r.effective).sort((a, b) => a.effective!.localeCompare(b.effective!)), ...rows.filter((r) => !r.effective)];
  const latest = ordered[ordered.length - 1];
  const lp = latest.payload || {};
  const series = ordered.map((r) => parseFloat(r.payload?.value)).filter((v) => !isNaN(v));
  const arrow = (prev?: number, cur?: number) => (prev == null || cur == null || isNaN(prev) || isNaN(cur)) ? '' : cur > prev ? ' ▲' : cur < prev ? ' ▼' : ' →';
  return (
    <div className="zcard" style={{ ...card, padding: 0, marginBottom: 10, overflow: 'hidden' }}>
      <div className="zrow" onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer' }}>
        <TypeDot type="OBSERVATION" />
        <strong dir="auto" style={{ fontSize: 14.5, minWidth: 0, flex: 1 }}>{name}</strong>
        {series.length > 1 && <Sparkline values={series} />}
        <span style={{ fontSize: 16, fontWeight: 700, color: C.primary, whiteSpace: 'nowrap' }}>{[lp.value, lp.unit].filter(Boolean).join(' ') || '—'}</span>
        {(() => { const it = labInterpretation(name, lp.value, lp.unit); return it ? <Chip bg={C.infoBg} fg={C.info} title="Standard interpretation of the cited value">{it}</Chip> : null; })()}
        {lp.flag && <Chip bg="#fdf0d5" fg="#8a5a00">{lp.flag}</Chip>}
        <span style={{ fontSize: 11.5, color: C.muted, minWidth: 60, textAlign: 'right' }}>{fmtDate(latest.effective, latest.effectiveApprox) || '—'}</span>
        <span className={`zexp${open ? ' o' : ''}`} style={{ color: C.muted, fontSize: 12, width: 12 }}>▸</span>
      </div>
      {open && (
        <div style={{ padding: '2px 14px 12px 48px', borderTop: `1px solid ${C.bg}` }}>
          {ordered.length > 1 && (
            <div style={{ borderLeft: `2px solid ${C.border}`, paddingLeft: 14, marginTop: 8 }}>
              {ordered.map((r, i) => {
                const prev = i > 0 ? parseFloat(ordered[i - 1].payload?.value) : undefined;
                const cur = parseFloat(r.payload?.value);
                return (
                  <div key={r.id} style={{ fontSize: 12.5, padding: '3px 0' }}>
                    <span style={{ display: 'inline-block', minWidth: 72, color: C.muted }}>{fmtDate(r.effective, r.effectiveApprox) || 'undated'}</span>
                    <span style={{ fontWeight: 600 }}>{[r.payload?.value, r.payload?.unit].filter(Boolean).join(' ') || '—'}{arrow(prev, cur)}</span>
                    {r.payload?.flag && <span style={{ color: '#8a5a00' }}> ({r.payload.flag})</span>}
                  </div>
                );
              })}
            </div>
          )}
          <div dir="auto" style={{ ...sourceQuote, marginTop: 8 }}>“{latest.provenance?.sourceText ?? '—'}”</div>
        </div>
      )}
    </div>
  );
}
function LabsTab({ records, trusted }: { records: Rec[]; trusted?: boolean }) {
  // Only actual laboratory results — symptoms, imaging, exam and vital-sign observations live under
  // Overview → Findings, not here.
  const labs = dedupe(records.filter(isLabObservation));
  if (labs.length === 0) return <Empty label="laboratory results" />;
  // Group by canonical analyte (+ unit family) so the same test across dates/aliases is ONE dated trend.
  const groups = new Map<string, Rec[]>();
  for (const r of labs) { const k = analyteKey(r); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  return (
    <div>
      <p style={{ color: C.sub, marginTop: 0, fontSize: 12.5, marginBottom: 14 }}>Laboratory results only — one dated trend per analyte. Click a row for the full series and source.</p>
      {[...groups.entries()].map(([k, rows]) => <LabRow key={k} name={analyteDisplay(rows[0])} rows={rows} trusted={trusted} />)}
    </div>
  );
}

// One timeline event: a card color-coded by clinical type (left accent + type-icon), the date, a
// readable clinical sentence, and the source quote.
function TimelineEvent({ r, trusted }: { r: Rec; trusted?: boolean }) {
  const m = TYPE_META[r.type] ?? { color: C.accent };
  return (
    <div style={{ position: 'relative', marginBottom: 9 }}>
      <div style={{ position: 'absolute', left: -25, top: 13, width: 11, height: 11, borderRadius: 6, background: r.negated ? '#b3261e' : m.color, border: '2px solid #fff', boxShadow: `0 0 0 2px ${C.border}` }} />
      <div className="zcard" style={{ ...card, padding: '10px 13px', borderLeft: `3px solid ${m.color}` }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <TypeDot type={r.type} />
          <span style={{ fontSize: 11.5, color: C.muted }}>{fmtDate(r.effective, r.effectiveApprox)}</span>
          <div style={{ flex: 1 }} />
          {r.negated && <Chip bg="#fbe3e0" fg="#b3261e">ruled out</Chip>}
          <VerifiedChip verifier={r.provenance?.verifier} trusted={!!trusted} />
        </div>
        <div dir="auto" style={{ fontSize: 14, fontWeight: 600, marginTop: 5, color: C.text }}>{eventProse(r)}</div>
        <div dir="auto" style={sourceQuote}>“{r.provenance?.sourceText ?? '—'}”</div>
      </div>
    </div>
  );
}
function YearBlock({ year, rows, trusted, defaultOpen }: { year: string; rows: Rec[]; trusted?: boolean; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const undated = year === 'Undated';
  const sorted = undated ? rows : [...rows].sort((a, b) => b.effective!.localeCompare(a.effective!)); // newest-first within the year
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 14 }}>
      <button onClick={() => setOpen(!open)} style={{ textAlign: 'right', border: 'none', background: 'none', cursor: 'pointer', padding: '2px 0', color: undated ? C.muted : C.primary }}>
        <div style={{ fontWeight: undated ? 700 : 800, fontSize: undated ? 13 : 19 }}>{year}</div>
        <div style={{ fontSize: 11, color: C.muted }}>{rows.length} {open ? '▾' : '▸'}</div>
      </button>
      <div style={{ borderLeft: `2px solid ${C.border}`, paddingLeft: 18, paddingBottom: 10 }}>
        {open ? sorted.map((r) => <TimelineEvent key={r.id} r={r} trusted={trusted} />)
          : <div style={{ color: C.muted, fontSize: 12.5, padding: '6px 0' }}>{rows.length} event{rows.length !== 1 ? 's' : ''} — click the year to expand</div>}
      </div>
    </div>
  );
}
// Timeline organized by CLINICAL effective date (not upload). A continuous year rail runs down the
// left; each year is an expandable block; undated facts sit in a muted bucket at the bottom.
function TimelineTab({ records, trusted }: { records: Rec[]; trusted?: boolean }) {
  const uniq = dedupe(records);
  const dated = uniq.filter((r) => r.effective && !isNaN(+new Date(r.effective)));
  const undated = uniq.filter((r) => !r.effective || isNaN(+new Date(r.effective)));
  if (dated.length === 0 && undated.length === 0) return <Empty label="records" />;

  const byYear = new Map<number, Rec[]>();
  for (const r of dated) { const y = new Date(r.effective!).getUTCFullYear(); (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(r); }
  const years = [...byYear.keys()].sort((a, b) => b - a); // newest year first
  const recent = years[0]; // expand the two most recent years by default
  return (
    <div>
      <p style={{ color: C.sub, marginTop: 0, fontSize: 12.5, marginBottom: 14 }}>Clinical history by effective date — newest first. Click a year to collapse it; “~” marks a date inferred from the document.</p>
      {years.map((y) => <YearBlock key={y} year={String(y)} rows={byYear.get(y)!} trusted={trusted} defaultOpen={recent - y <= 1} />)}
      {undated.length > 0 && <YearBlock year="Undated" rows={undated} trusted={trusted} defaultOpen={false} />}
    </div>
  );
}

// ---------- Deliverables + physician sign-off ----------
type DeliverableDoc = { title: string; body: string; lang: 'en' | 'ar'; dir: 'ltr' | 'rtl'; type: string; signed?: boolean; sourceRecordIds?: string[] };
type ReviewState = {
  locked: boolean;
  signOff: { at: string; license: string | null; name: string | null } | null;
  needsReview: number;
  records: Rec[];
  me: { canSign: boolean; name: string | null; license: string | null; role: string };
};
const DELIVERABLE_KINDS: { type: 'referral' | 'patient'; lang: 'en' | 'ar'; label: string; icon: string }[] = [
  { type: 'referral', lang: 'en', label: 'Referral / board packet', icon: '📋' },
  { type: 'referral', lang: 'ar', label: 'حزمة الإحالة (عربي)', icon: '📋' },
  { type: 'patient', lang: 'en', label: 'Patient summary', icon: '🧑‍⚕️' },
  { type: 'patient', lang: 'ar', label: 'ملخص المريض (عربي)', icon: '🧑‍⚕️' },
];

type SavedDeliverable = DeliverableDoc & { id: string; createdAt: string; signedAtGeneration?: boolean };
function DeliverablesTab({ patientId, caseId, patientName, onSigned }: { patientId: string; caseId: string; patientName: string; onSigned: () => void }) {
  const [review, setReview] = useState<ReviewState | null>(null);
  const [saved, setSaved] = useState<SavedDeliverable[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [signName, setSignName] = useState('');
  const [signLicense, setSignLicense] = useState('');
  const [signing, setSigning] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const loadReview = useCallback(async () => {
    const r = await fetch(`/api/review?patientId=${patientId}`, { headers: AUTH });
    if (r.ok) { const d = await r.json(); setReview(d); setSignName((n) => n || d.me?.name || ''); setSignLicense((l) => l || d.me?.license || ''); }
  }, [patientId]);
  const loadDeliverables = useCallback(async () => {
    const r = await fetch(`/api/case/${caseId}/deliverable`, { headers: AUTH });
    if (r.ok) { const d = await r.json(); setSaved(d.deliverables ?? []); }
  }, [caseId]);
  useEffect(() => { loadReview(); loadDeliverables(); }, [loadReview, loadDeliverables]);

  const signed = !!review?.signOff;
  const flagged = (review?.records ?? []).filter((r) => r.status === 'NEEDS_REVIEW');

  async function accept(id: string) {
    const r = await fetch(`/api/records/${id}/accept`, { method: 'POST', headers: AUTH });
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'accept failed'); return; }
    await loadReview();
  }
  async function acceptAll() {
    if (!confirm(`Accept all ${flagged.length} flagged fact(s) as reviewed? Each remains source-cited; this clears them for sign-off.`)) return;
    setAccepting(true);
    try {
      for (const rec of flagged) {
        await fetch(`/api/records/${rec.id}/accept`, { method: 'POST', headers: AUTH });
      }
      await loadReview();
    } finally { setAccepting(false); }
  }

  async function generate(type: string, lang: string) {
    const key = `${type}_${lang}`;
    setBusy(key);
    try {
      const r = await fetch(`/api/case/${caseId}/deliverable`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ type, lang }) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'generation failed'); return; }
      await loadDeliverables();
      setOpenId(d.id); // reveal the freshly generated one
    } finally { setBusy(null); }
  }

  async function del(id: string) {
    if (!confirm('Delete this saved deliverable? This does not affect the clinical record.')) return;
    const r = await fetch(`/api/case/${caseId}/deliverable/${id}`, { method: 'DELETE', headers: AUTH });
    if (r.ok) { if (openId === id) setOpenId(null); await loadDeliverables(); }
  }

  async function exportPdf(d: SavedDeliverable) {
    setExporting(d.id);
    try {
      const r = await fetch('/api/export/pdf', { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId, title: d.title, body: d.body, sourceRecordIds: d.sourceRecordIds, dir: d.dir }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'export failed'); return; }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a'); a.href = url; a.download = `${signed ? '' : 'DRAFT-'}${d.type}-${d.lang}.pdf`; a.click(); URL.revokeObjectURL(url);
    } finally { setExporting(null); }
  }

  async function signOff() {
    if (!signName.trim() || !signLicense.trim()) { alert('Enter the reviewing physician name and Saudi license number.'); return; }
    setSigning(true);
    try {
      const r = await fetch(`/api/case/${caseId}/signoff`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: signName.trim(), license: signLicense.trim() }) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'sign-off failed'); return; }
      await loadReview(); onSigned();
    } finally { setSigning(false); }
  }

  return (
    <div>
      {/* ---- Sign-off status / action ---- */}
      {signed ? (
        <div style={{ ...card, padding: '13px 16px', marginBottom: 16, borderLeft: `4px solid #2a7d46`, background: '#f2faf5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>✓</span>
            <strong style={{ fontSize: 14, color: '#2a7d46' }}>Reviewed &amp; signed off by Dr. {review!.signOff!.name ?? '—'}</strong>
            {review!.signOff!.license && <Chip bg="#e7f4ec" fg="#2a7d46">Saudi license #{review!.signOff!.license}</Chip>}
            <Chip bg="#f0efec" fg="#847f77">🔒 locked</Chip>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: C.muted }}>{fmtDateTime(review!.signOff!.at)}</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.sub, marginTop: 4 }}>Deliverables below carry this stamp and are cleared for export.</div>
        </div>
      ) : (
        <div style={{ ...card, padding: '13px 16px', marginBottom: 16, borderLeft: `4px solid ${WARM.border}`, background: WARM.bg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 15 }}>✍️</span>
            <strong style={{ fontSize: 14, color: WARM.fg }}>Physician review &amp; sign-off required</strong>
            {review && review.needsReview > 0 && <Chip bg="#fbe3e0" fg="#b3261e">{review.needsReview} fact(s) need review</Chip>}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: C.sub }}>Drafts export watermarked · final PDF needs sign-off.</span>
          </div>
          {review && !review.me.canSign ? (
            <div style={{ fontSize: 13, color: C.sub }}>Awaiting a reviewer/physician (your role: {review.me.role.toLowerCase()}). Sign-off requires REVIEWER or OWNER.</div>
          ) : (
            <>
              {flagged.length > 0 && (
                <div style={{ ...card, padding: 0, marginBottom: 10, background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px' }}>
                    <button onClick={() => setShowReview(!showReview)} style={{ ...linkBtn, color: C.text }}>
                      {showReview ? '▾' : '▸'} Review {flagged.length} flagged fact{flagged.length !== 1 ? 's' : ''}
                    </button>
                    <div style={{ flex: 1 }} />
                    <button onClick={acceptAll} disabled={accepting} style={{ ...linkBtn, color: '#2a7d46', fontWeight: 700 }}>
                      {accepting ? 'Accepting…' : `Accept all (${flagged.length})`}
                    </button>
                  </div>
                  {showReview && (
                    <div style={{ maxHeight: 280, overflow: 'auto', borderTop: `1px solid ${C.bg}` }}>
                      {flagged.map((r) => (
                        <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 12px', borderTop: `1px solid ${C.bg}` }}>
                          <TypeDot type={r.type} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div dir="auto" style={{ fontSize: 12.5, fontWeight: 600 }}>{r.coding?.display ?? r.coding?.label ?? '(fact)'} {r.negated && <span style={{ color: '#b3261e' }}>· negated</span>}</div>
                            <div dir="auto" style={{ fontSize: 11.5, color: C.muted, fontStyle: 'italic' }}>“{r.provenance?.sourceText ?? '—'}”</div>
                          </div>
                          <button onClick={() => accept(r.id)} style={{ ...linkBtn, color: '#2a7d46', flexShrink: 0 }}>Accept</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="Reviewing physician (Dr. …)"
                  style={{ flex: '1 1 200px', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none' }} />
                <input value={signLicense} onChange={(e) => setSignLicense(e.target.value)} placeholder="Saudi license #"
                  style={{ flex: '0 1 160px', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none' }} />
                <button onClick={signOff} disabled={signing || flagged.length > 0}
                  title={flagged.length > 0 ? 'Accept the flagged facts first' : 'Sign off & lock'}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: flagged.length > 0 ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13, color: '#fff', background: signing || flagged.length > 0 ? C.border : '#2a7d46' }}>
                  {signing ? 'Signing…' : 'Review & sign off'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- Generators ---- */}
      <SectionLabel>Generate a deliverable</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 18 }}>
        {DELIVERABLE_KINDS.map((k) => {
          const key = `${k.type}_${k.lang}`;
          const has = saved.some((s) => s.type === k.type && s.lang === k.lang);
          return (
            <button key={key} onClick={() => generate(k.type, k.lang)} disabled={busy === key} className="zcard"
              dir={k.lang === 'ar' ? 'rtl' : 'ltr'}
              style={{ ...card, padding: '12px 14px', textAlign: k.lang === 'ar' ? 'right' : 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>{k.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{k.label}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{busy === key ? 'Generating…' : has ? 'Regenerate' : k.type === 'referral' ? 'Clinician handover' : 'Plain language'} · {k.lang === 'ar' ? 'العربية' : 'English'}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ---- Saved deliverables (persisted against the case) ---- */}
      <SectionLabel>Saved deliverables · {saved.length}</SectionLabel>
      {saved.length === 0 && <div style={{ ...card, padding: 20, color: C.muted, fontSize: 13, textAlign: 'center' }}>No deliverables generated yet — pick one above.</div>}
      {saved.map((d) => {
        const open = openId === d.id;
        return (
          <div key={d.id} className="zcard" style={{ ...card, padding: 0, marginBottom: 12, overflow: 'hidden' }}>
            <div className="zrow" onClick={() => setOpenId(open ? null : d.id)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 16px', cursor: 'pointer', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 16 }}>{d.type === 'patient' ? '🧑‍⚕️' : '📋'}</span>
              <strong dir="auto" style={{ fontSize: 14 }}>{d.title}</strong>
              <Chip bg="#e6f5f4" fg={C.primary}>{d.lang === 'ar' ? 'العربية · RTL' : 'English'}</Chip>
              {signed ? <Chip bg="#e7f4ec" fg="#2a7d46">signed</Chip> : <Chip bg="#fdf3e6" fg={WARM.fg}>draft</Chip>}
              <span style={{ fontSize: 11, color: C.muted }}>{fmtDateTime(d.createdAt)}</span>
              <div style={{ flex: 1 }} />
              <button onClick={(e) => { e.stopPropagation(); exportPdf(d); }} disabled={exporting === d.id}
                title={signed ? 'Download signed PDF' : 'Download draft PDF (watermarked)'}
                style={{ padding: '6px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12.5, color: '#fff', background: signed ? C.primary : WARM.fg }}>
                {exporting === d.id ? 'Preparing…' : signed ? 'Download PDF' : 'Download draft'}
              </button>
              <button onClick={(e) => { e.stopPropagation(); generate(d.type, d.lang); }} disabled={busy === `${d.type}_${d.lang}`} style={linkBtn} title="Regenerate from the latest facts">↻</button>
              <button onClick={(e) => { e.stopPropagation(); del(d.id); }} style={{ ...linkBtn, color: '#b3261e' }} title="Delete">✕</button>
              <span className={`zexp${open ? ' o' : ''}`} style={{ color: C.muted, fontSize: 12, width: 12 }}>▸</span>
            </div>
            {open && (
              <>
                <div dir={d.dir} style={{ padding: '12px 18px', textAlign: d.dir === 'rtl' ? 'right' : 'left', borderTop: `1px solid ${C.bg}` }}>
                  <SummaryBody text={d.body} />
                </div>
                {signed && review?.signOff ? (
                  <div dir={d.dir} style={{ margin: '0 16px 14px', border: '1px solid #bfe3cd', borderRadius: 8, background: '#f2faf5', padding: '10px 14px' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#2a7d46' }}>✓ Reviewed &amp; signed off by Dr. {review.signOff.name ?? '—'}{review.signOff.license ? ` · Saudi license #${review.signOff.license}` : ''}</div>
                    <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>Signed {fmtDateTime(review.signOff.at)} · 🔒 locked · physician-approved for release.</div>
                  </div>
                ) : (
                  <div style={{ margin: '0 16px 14px', border: `1px dashed ${WARM.border}`, borderRadius: 8, background: WARM.bg, padding: '10px 14px' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: WARM.fg }}>DRAFT — not physician-reviewed</div>
                    <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>Unsigned working copy. Download exports a watermarked draft; sign off to release a final PDF.</div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: C.muted, padding: '8px 16px', borderTop: `1px solid ${C.bg}` }}>Drawn only from {patientName}’s extracted, source-cited facts{d.signedAtGeneration != null ? ` · generated while the case was ${d.signedAtGeneration ? 'signed' : 'unsigned'}` : ''}.</div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso); return isNaN(+d) ? '' : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------- Imaging / Studies tab ----------
function ImagingTab({ records, trusted }: { records: Rec[]; trusted?: boolean }) {
  const studies = buildStudies(records);
  const tracks = serialTracks(records);

  const partner = (
    <div style={{ ...card, padding: '11px 14px', marginBottom: 16, background: '#faf9f7', borderStyle: 'dashed' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15 }}>🖼️</span>
        <strong style={{ fontSize: 13, color: C.text }}>Report intelligence only</strong>
        <span style={{ fontSize: 12, color: C.sub }}>— findings are parsed from the radiology <em>report text</em>; image pixels are never analyzed.</span>
        <div style={{ flex: 1 }} />
        <Chip bg="#eef0fb" fg="#4f46e5">Radiology-AI partner integration — coming</Chip>
      </div>
    </div>
  );

  if (studies.length === 0 && tracks.length === 0) {
    return <div>{partner}<Empty label="imaging studies" /></div>;
  }

  return (
    <div>
      {partner}

      {/* Serial tracking — same target measured across studies over time */}
      {tracks.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <SectionLabel>Serial tracking · {tracks.length}</SectionLabel>
          {tracks.map((series, i) => {
            const first = series[0], last = series[series.length - 1];
            const delta = last.mm - first.mm;
            const dir = delta > 0.5 ? { s: '▲', c: '#b3261e', t: `+${(delta).toFixed(0)} mm` } : delta < -0.5 ? { s: '▼', c: '#2a7d46', t: `${(delta).toFixed(0)} mm` } : { s: '→', c: C.sub, t: 'stable' };
            return (
              <div key={i} className="zcard" style={{ ...card, padding: '12px 14px', marginBottom: 10, borderLeft: `3px solid ${dir.c}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <strong dir="auto" style={{ fontSize: 14 }}>{last.label}</strong>
                  <Sparkline values={series.map((m) => m.mm)} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: dir.c }}>{dir.s} {dir.t}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 11.5, color: C.muted }}>{series.length} timepoints</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {series.map((m, j) => (
                    <span key={j} style={{ fontSize: 12, color: C.sub, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 8px' }}>
                      {m.mm % 1 === 0 ? m.mm : m.mm.toFixed(1)} mm · {fmtDate(m.date, m.approx) || '—'} <span style={{ color: C.muted }}>({m.modality})</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Studies — chronological (newest first), each dated with findings + impression */}
      <SectionLabel>Studies · {studies.length}</SectionLabel>
      {studies.map((s) => (
        <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '84px 1fr', gap: 14, marginBottom: 6 }}>
          <div style={{ textAlign: 'right', paddingTop: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: C.primary }}>{fmtDate(s.date, s.approx) || '—'}</div>
          </div>
          <div className="zcard" style={{ ...card, padding: '12px 14px', marginBottom: 8, borderLeft: `3px solid ${TYPE_META.OBSERVATION.color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: '#eef0fb', display: 'inline-grid', placeItems: 'center', fontSize: 14 }}>{s.icon}</span>
              <strong style={{ fontSize: 14.5 }}>{s.modality}</strong>
              {s.region && <span style={{ fontSize: 12.5, color: C.sub }}>· {s.region}</span>}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: C.muted }}>{s.findings.length + s.impression.length} finding{s.findings.length + s.impression.length !== 1 ? 's' : ''}</span>
            </div>
            {/* Findings */}
            <div style={{ marginTop: 8 }}>
              <SectionLabel>Findings</SectionLabel>
              {s.findings.map((f) => (
                <div key={f.id} style={{ padding: '5px 0', borderTop: `1px solid ${C.bg}` }}>
                  <div dir="auto" style={{ fontSize: 13, fontWeight: 600 }}>
                    {f.negated && <span style={{ color: '#2a7d46' }}>No </span>}{f.coding?.display ?? f.coding?.label ?? '(finding)'}
                    {parseMm(f) != null && <span style={{ color: C.accent, fontWeight: 700 }}> · {parseMm(f)! % 1 === 0 ? parseMm(f) : parseMm(f)!.toFixed(1)} mm</span>}
                    <VerifiedChip verifier={f.provenance?.verifier} trusted={!!trusted} />
                  </div>
                  <div dir="auto" style={sourceQuote}>“{f.provenance?.sourceText ?? '—'}”</div>
                </div>
              ))}
            </div>
            {/* Impression */}
            {s.impression.length > 0 && (
              <div style={{ marginTop: 10, background: '#f6f5f3', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
                <SectionLabel>Impression</SectionLabel>
                {s.impression.map((f) => (
                  <div key={f.id} dir="auto" style={{ fontSize: 12.5, color: C.text, marginBottom: 3 }}>
                    · {f.coding?.display ?? f.coding?.label} <span style={{ color: C.muted, fontStyle: 'italic' }}>— “{f.provenance?.sourceText ?? ''}”</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
      <p style={{ color: C.muted, fontSize: 11.5, marginTop: 8 }}>Studies also appear on the main Timeline. Dates marked “~” were inferred from the document date.</p>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div style={{ ...card, padding: '40px 30px', textAlign: 'center', background: '#fbfaf8' }}>
      <div style={{ width: 46, height: 46, borderRadius: 14, background: C.primarySoft, display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 22 }}>🗂️</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>No {label} yet</div>
      <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>Nothing extracted for this case in this section.</div>
    </div>);
}

function CompletenessPanel({ caseId, records }: { caseId: string; records: number }) {
  const [data, setData] = useState<{ score: number | null; assessment: any[] | null } | null>(null);
  const [busy, setBusy] = useState(false);
  // Auto-recompute whenever the record count changes (e.g. after a document finishes extracting).
  // With records present we POST (recompute + store); with none we just read the stored score.
  useEffect(() => {
    let stop = false;
    (async () => {
      const method = records > 0 ? 'POST' : 'GET';
      const r = await fetch(`/api/case/${caseId}/score`, { method, headers: AUTH });
      if (!stop) setData(await r.json());
    })();
    return () => { stop = true; };
  }, [caseId, records]);
  async function recompute() { setBusy(true); const r = await fetch(`/api/case/${caseId}/score`, { method: 'POST', headers: AUTH }); setData(await r.json()); setBusy(false); }
  const score = data?.score;
  const ring = score == null ? C.muted : score >= 80 ? '#137333' : score >= 50 ? '#a66300' : '#b3261e';
  const cell = (s: string) => s === 'present-valid' ? ['#e7f4ec', '#2a7d46'] : s === 'stale' ? ['#fdf0d5', '#8a5a00'] : s === 'referenced-not-uploaded' ? ['#eef0fb', '#4f46e5'] : ['#fbe3e0', '#b3261e'];
  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 52, height: 52, borderRadius: 26, border: `3px solid ${ring}`, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 15, color: ring }}>
          {score == null ? '—' : `${score}%`}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Case completeness</div>
          <div style={{ fontSize: 12, color: C.muted }}>required items present & valid</div>
        </div>
        <button onClick={recompute} disabled={busy} style={{ marginLeft: 'auto', padding: '7px 14px', cursor: 'pointer', borderRadius: 8, border: `1px solid ${C.primary}`, background: C.primary, color: '#fff', fontSize: 13, fontWeight: 600 }}>
          {busy ? 'Scoring…' : 'Recompute'}
        </button>
      </div>
      {data?.assessment && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
          {data.assessment.map((a) => { const [bg, fg] = cell(a.status); return <Chip key={a.key} bg={bg} fg={fg} title={`${a.matchCount} match(es)${a.required ? ' · required' : ''}`}>{a.label}: {a.status}</Chip>; })}
        </div>
      )}
    </div>
  );
}

// ---------- collapsible chat drawer ----------
function ChatDrawer({ open, onClose, patientId, patientName }: { open: boolean; onClose: () => void; patientId: string; patientName: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!patientId || !input.trim() || busy) return;
    const q = input.trim();
    setMsgs((m) => [...m, { role: 'user', text: q }]);
    setInput(''); setBusy(true);
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId, message: q }) });
      const d = await r.json();
      if (!r.ok) { setMsgs((m) => [...m, { role: 'assistant', text: `Error: ${d.error}` }]); return; }
      setMsgs((m) => [...m, d.mode === 'generate'
        ? { role: 'assistant', text: d.answer || 'Drafted the document below.', deliverable: { title: d.title, body: d.body, sourceRecordIds: d.sourceRecordIds } }
        : { role: 'assistant', text: d.answer }]);
    } finally { setBusy(false); }
  }
  async function exportPdf(del: Deliverable) {
    const r = await fetch('/api/export/pdf', { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId, ...del }) });
    if (!r.ok) { alert('PDF export failed'); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = (del.title || 'document').replace(/[^\w]+/g, '-').toLowerCase() + '.pdf'; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <aside style={{
      position: 'fixed', top: 0, right: 0, height: '100dvh', width: 'min(404px, 100vw)', background: C.card,
      borderLeft: `1px solid ${C.border}`, boxShadow: '-8px 0 24px rgba(16,24,40,.10)',
      display: 'flex', flexDirection: 'column', transform: open ? 'translateX(0)' : 'translateX(110%)',
      transition: 'transform .22s ease', zIndex: 50,
    }}>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 700 }}>Assistant</div>
        {patientName && <span style={{ color: C.muted, fontSize: 12 }}>· {patientName}</span>}
        <button onClick={onClose} title="Close" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: C.sub, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ padding: '4px 16px 0', fontSize: 11.5, color: C.muted }}>Answers &amp; drafts from this case’s records only.</div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {msgs.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>Try “What are the active medications?” or “Draft an insurance letter.”</p>}
        {msgs.map((m, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>{m.role === 'user' ? 'You' : 'Analyzer'}</div>
            <div dir="auto" style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: m.role === 'user' ? '#e6f5f4' : C.bg, padding: 10, borderRadius: 9 }}>{m.text}</div>
            {m.deliverable && (
              <div style={{ ...card, marginTop: 6, padding: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{m.deliverable.title}</div>
                <pre dir="auto" style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 220, overflow: 'auto', fontFamily: FONT }}>{m.deliverable.body}</pre>
                <button onClick={() => exportPdf(m.deliverable!)} style={{ padding: '6px 12px', cursor: 'pointer', background: C.primary, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 12.5 }}>Export PDF</button>
              </div>
            )}
          </div>
        ))}
        {busy && <p style={{ color: C.muted, fontSize: 13 }}>Analyzer thinking…</p>}
      </div>
      <div style={{ padding: 14, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={patientId ? 'Ask or command…' : 'Select a case first'} disabled={!patientId}
          style={{ flex: 1, padding: '9px 11px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none' }} />
        <button onClick={send} disabled={!patientId || busy} style={{ padding: '9px 14px', cursor: 'pointer', borderRadius: 8, border: 'none', background: C.primary, color: '#fff', fontWeight: 600, fontSize: 13 }}>Send</button>
      </div>
    </aside>
  );
}

// ---------- Team & Access (RBAC + audit) ----------
type Member = { id: string; name: string | null; email: string; role: string; license: string | null };
type TeamData = { clinic: { id: string; name: string } | null; members: Member[]; me: { id: string; role: string; canManage: boolean; canSign: boolean } };
type AuditEntry = { id: string; action: string; resource: string; meta: any; at: string; user: { id: string; name?: string | null; email?: string; role?: string } | null };
const ALL_ROLES = ['OWNER', 'REVIEWER', 'CLINICIAN', 'COORDINATOR'];
const roleTone: Record<string, [string, string]> = { OWNER: ['#e6eefb', '#4f46e5'], REVIEWER: ['#e4f4ea', '#0f7a45'], CLINICIAN: ['#e6f5f4', '#0d857b'], COORDINATOR: ['#eef1f5', '#5c6b78'] };
const AUDIT_META: Record<string, [string, string]> = { VIEW: ['👁', 'viewed'], EDIT: ['✏️', 'edited'], CREATE: ['➕', 'created'], SIGN_OFF: ['🖊️', 'signed off'], HAIR_SIGN_OFF: ['🖊️', 'signed off'], EXPORT: ['📄', 'exported'], DELIVERABLE: ['📝', 'generated deliverable'], TEAM_ADD: ['👤', 'added member'], TEAM_ROLE: ['🔧', 'changed role'], TEAM_REMOVE: ['➖', 'removed member'] };

function TeamPanel({ onClose, onActed }: { onClose: () => void; onActed: () => void }) {
  const [data, setData] = useState<TeamData | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [tab, setTab] = useState<'members' | 'audit'>('members');
  const [nm, setNm] = useState(''); const [em, setEm] = useState(''); const [rl, setRl] = useState('COORDINATOR'); const [lic, setLic] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [t, a] = await Promise.all([fetch('/api/team', { headers: AUTH }), fetch('/api/audit', { headers: AUTH })]);
    if (t.ok) setData(await t.json());
    if (a.ok) setAudit((await a.json()).entries ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(userId: string) { await fetch('/api/team/act', { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) }); await load(); onActed(); }
  async function addMember() {
    if (!em.trim()) { alert('email required'); return; }
    setBusy(true);
    const r = await fetch('/api/team', { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm, email: em, role: rl, license: lic }) });
    setBusy(false);
    if (!r.ok) { alert((await r.json()).error || 'failed'); return; }
    setNm(''); setEm(''); setLic(''); setRl('COORDINATOR'); await load();
  }
  async function changeRole(id: string, role: string) { const r = await fetch(`/api/team/${id}`, { method: 'PATCH', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) }); if (!r.ok) alert((await r.json()).error || 'failed'); await load(); }
  async function remove(id: string) { if (!confirm('Remove this member from the clinic?')) return; await fetch(`/api/team/${id}`, { method: 'DELETE', headers: AUTH }); await load(); }

  const me = data?.me;
  const canManage = !!me?.canManage;
  const roleChip = (role: string) => { const [bg, fg] = roleTone[role] ?? roleTone.COORDINATOR; return <Chip bg={bg} fg={fg}>{role.toLowerCase()}</Chip>; };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,24,40,.5)', display: 'grid', placeItems: 'start center', overflow: 'auto', zIndex: 60, padding: '44px 16px' }}>
      <div onClick={(e) => e.stopPropagation()} className="zscroll" style={{ ...card, width: '100%', maxWidth: 680, boxShadow: SHADOW_LG, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 18px', background: `linear-gradient(120deg, ${C.primary}, ${C.primaryDark})`, color: '#fff' }}>
          <span style={{ fontSize: 18 }}>👥</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.2 }}>Team &amp; Access</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.72)' }}>{data?.clinic?.name ?? 'Clinic'} · cases shared within the team</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        {/* acting-as */}
        {me && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 18px', background: C.primarySoft, borderBottom: `1px solid ${C.line}`, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>Acting as</span>
            <strong style={{ fontSize: 13.5 }}>{data?.members.find((m) => m.id === me.id)?.name || data?.members.find((m) => m.id === me.id)?.email || 'you'}</strong>
            {roleChip(me.role)}
            <span style={{ fontSize: 11.5, color: me.canSign ? C.good : C.sub }}>{me.canSign ? '· can sign off' : '· cannot sign off'}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${C.border}`, padding: '0 12px' }}>
          {(['members', 'audit'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)} className={`ztabbtn${tab === k ? ' on' : ''}`} style={{ padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === k ? 700 : 500, color: tab === k ? C.primary : C.sub }}>{k === 'members' ? 'Members' : 'Audit log'}</button>
          ))}
        </div>

        <div style={{ padding: 18, maxHeight: '58vh', overflow: 'auto' }} className="zscroll">
          {tab === 'members' ? (
            <>
              {(data?.members ?? []).map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.line}` }}>
                  <div style={{ width: 34, height: 34, borderRadius: 17, background: C.primarySoft, color: C.primary, display: 'grid', placeItems: 'center', fontWeight: 700, flexShrink: 0 }}>{(m.name?.trim()[0] || m.email[0] || '?').toUpperCase()}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.name || m.email}{m.id === me?.id && <span style={{ color: C.muted, fontWeight: 400 }}> · you</span>}</div>
                    <div style={{ fontSize: 11.5, color: C.muted }}>{m.email}{m.license ? ` · lic ${m.license}` : ''}</div>
                  </div>
                  {canManage
                    ? <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)} style={{ padding: '5px 8px', borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 12, outline: 'none' }}>{ALL_ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}</select>
                    : roleChip(m.role)}
                  {m.id !== me?.id && <button onClick={() => act(m.id)} style={linkBtn} title="Act as this member (dev)">act as</button>}
                  {canManage && m.id !== me?.id && <button onClick={() => remove(m.id)} style={{ ...linkBtn, color: C.danger }}>✕</button>}
                </div>
              ))}
              {canManage ? (
                <div style={{ marginTop: 14, ...card, padding: 12, background: '#fbfaf8' }}>
                  <SectionLabel>Add team member</SectionLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 8 }}>
                    <input value={nm} onChange={(e) => setNm(e.target.value)} placeholder="Name" style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none' }} />
                    <input value={em} onChange={(e) => setEm(e.target.value)} placeholder="Email" style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none' }} />
                    <select value={rl} onChange={(e) => setRl(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none' }}>{ALL_ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}</select>
                    <input value={lic} onChange={(e) => setLic(e.target.value)} placeholder="License # (for reviewers)" style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none' }} />
                  </div>
                  <button onClick={addMember} disabled={busy} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: C.primary, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{busy ? 'Adding…' : 'Add member'}</button>
                </div>
              ) : <div style={{ fontSize: 12, color: C.muted, marginTop: 12 }}>Only an OWNER can add members or change roles.</div>}
            </>
          ) : (
            <>
              {audit.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>No activity recorded yet.</div>}
              {audit.map((e) => {
                const [icon, verb] = AUDIT_META[e.action] ?? ['•', e.action.toLowerCase()];
                const what = e.meta?.name || e.meta?.title || e.meta?.action || '';
                return (
                  <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 0', borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ fontSize: 13, width: 18, textAlign: 'center' }}>{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5 }}><strong>{e.user?.name || e.user?.email || 'someone'}</strong> {verb}{what ? <span style={{ color: C.sub }}> · {String(what)}</span> : ''}</div>
                      <div style={{ fontSize: 11, color: C.muted }}>{e.user?.role ? e.user.role.toLowerCase() + ' · ' : ''}{new Date(e.at).toLocaleString()}</div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  return <Suspense fallback={<div style={{ padding: 24, font: `14px ${FONT}` }}>Loading…</div>}><WorkspaceInner /></Suspense>;
}
