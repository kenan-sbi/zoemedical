// Server-side entity resolution for the summary — mirrors the Overview's client logic so the
// synopsis is built from RECONCILED, CLASSIFIED data (not raw mentions). Pure functions only.
type Rec = {
  type: string; negated: boolean; assertion: string; effective: Date | string | null; effectiveApprox?: boolean;
  payload: any; coding: any; provenance: { sourceText?: string } | null;
};

const norm = (s?: string | null) => (s ?? '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// PRIMARY DEDUP KEY: a normalized ontology code (system:code) when the extractor coded the concept.
// Two facts with the same code are the SAME entity, regardless of synonym/language/brand. Returns
// null when uncoded (callers fall back to text normalization) — never fabricated.
export function codeKey(coding: any, systems: string[]): string | null {
  const sys = norm(coding?.system).replace(/[^a-z0-9]/g, '');
  const code = norm(coding?.code).replace(/\s+/g, '');
  if (!sys || !code || code === 'null') return null;
  if (!systems.some((s) => sys.includes(s))) return null;
  return `${sys}:${code}`;
}

// Standard, unambiguous lab interpretations of a CITED value (never replaces it; always shown as an
// interpretation of the source value). Deterministic — no medical facts baked into prompts.
export function labInterpretation(name: string, valueStr: any, unit?: string): string | null {
  const v = parseFloat(valueStr); if (isNaN(v)) return null;
  const n = norm(name); const u = norm(unit);
  if (/egfr|glomerular filtration/.test(n)) {
    const g = v >= 90 ? 'G1 (normal/high)' : v >= 60 ? 'G2 (mildly ↓)' : v >= 45 ? 'G3a (mild–moderate ↓)' : v >= 30 ? 'G3b (moderate–severe ↓)' : v >= 15 ? 'G4 (severe ↓)' : 'G5 (kidney failure)';
    return `CKD ${g}`;
  }
  if (/hba1c|glycated h|glycohaemoglobin|glycohemoglobin|(^|\b)a1c\b/.test(n)) {
    const pct = /mmol\/mol/.test(u) ? (v / 10.929) + 2.15 : v; // IFCC mmol/mol -> DCCT %
    return pct < 5.7 ? 'Non-diabetic range' : pct < 6.5 ? 'Pre-diabetes range' : pct < 7 ? 'Diabetes — at target (<7%)' : pct < 8 ? 'Diabetes — above target' : 'Diabetes — poor control (≥8%)';
  }
  return null;
}
// Laterality/site are inconsistently coded by the model — derive laterality from the field OR the
// display/bodySite text, and strip it out of the site, so left vs right stays split but the same
// side merges regardless of where the model put it.
const SITES = 'breast|lung|kidney|renal|liver|hepatic|colon|colorectal|prostate|thyroid|ovar|cervi|pancrea|bladder|brain|skin|bone|stomach|gastric|esophag|rect|uter|endometri|wrist|radius|gallbladder|hip|femoral|femur|knee|shoulder|ankle|elbow|spine|hand|foot';
const siteRe = new RegExp(`\\b(${SITES})\\w*`);
const latOf = (c: any) => {
  const l = norm(c?.laterality); if (l) return l;
  const t = `${norm(c?.display)} ${norm(c?.bodySite)}`;
  return /\bleft\b|\bsol\b/.test(t) ? 'left' : /\bright\b|\bsağ\b/.test(t) ? 'right' : /\bbilateral\b/.test(t) ? 'bilateral' : '';
};
// Canonical body site from the bodySite field OR the display text (so "breast cancer" and
// "invasive ductal carcinoma" + bodySite=breast resolve to the same site).
const siteOf = (c: any) => {
  const b = norm(c?.bodySite).replace(/\b(left|right|bilateral)\b/g, ' ').trim();
  const m = (b || norm(c?.display)).match(siteRe);
  const s = m ? m[1] : b;
  return /femoral|femur/.test(s) ? 'hip' : s; // femoral head/neck is the hip joint
};

const CHRONIC = /diabet|hypertens|chronic kidney|ckd|copd|asthma|heart failure|carcinoma|cancer|malignan|cirrhos|hypothyroid|hyperthyroid|hyperlipid|dyslipid|atrial fibrillation|osteoporos|osteoarthr|rheumatoid|depress|epileps|parkinson|dementia|hiv|hepatitis [bc]/i;
const CHEMO = /doxorubicin|cyclophosphamide|paclitaxel|docetaxel|carboplatin|cisplatin|fluorouracil|5-?fu|capecitabine|epirubicin|vincristine|etoposide|gemcitabine|oxaliplatin|\bchemo/i;
const GENERIC_PROC = /^(surgical procedure|procedure|surgery|chemotherapy|adjuvant chemotherapy|radiotherapy|treatment|therapy|discharge from follow-?up|follow-?up|examination|imaging)$/i;

// Drug-class abstractions we should collapse into the specific named drug when it is present.
export const MED_CLASS_TERMS = /^(anti-?convulsant|anti-?epileptic|cortico-?steroid|steroid|immuno-?suppress(ant|ive)|statin|beta.?blocker|anti-?coagulant|anti-?coagulation|anti-?platelet|ace ?inhibitor|arb|antibiotic|anti-?depressant|anti-?hypertensive|analgesic|nsaid|ppi|proton pump inhibitor|diuretic|opioid|benzodiazepine|anti-?emetic|anti-?psychotic|bisphosphonate|anti-?malarial|immunomodulator|dmard|biologic|blood thinner)s?$/;
const MED_CLASS_MEMBERS: Record<string, RegExp> = {
  anticonvulsant: /levetiracetam|valproat|valproic|carbamazepine|phenytoin|lamotrigine|topiramate|gabapentin|pregabalin|lacosamide|clonazepam|clobazam/,
  corticosteroid: /prednisolon|prednison|dexamethason|hydrocortison|methylprednisolon|budesonid|betamethason/,
  immunosuppressant: /mycophenolat|tacrolimus|ciclosporin|cyclosporin|azathioprin|sirolimus|everolimus|methotrexat|belimumab|rituximab/,
  statin: /atorvastatin|simvastatin|rosuvastatin|pravastatin|fluvastatin/,
  anticoagulant: /warfarin|apixaban|rivaroxaban|dabigatran|edoxaban|heparin/,
  antiplatelet: /aspirin|clopidogrel|ticagrelor|prasugrel/,
  bisphosphonate: /alendron|risedron|zoledron|ibandron|pamidron/,
  antimalarial: /hydroxychloroquine|chloroquine/,
  statins: /statin/,
};
export function medClassKey(n: string): string | null {
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
// Normalize a medication to its specific ingredient (drop dose, salt/ester, "therapy"), so generic/
// brand/granularity variants collapse (Mycophenolate = Mycophenolate Mofetil).
export function medIdentity(r: { coding?: any; payload?: any }): string {
  let s = (r.coding?.display ?? r.payload?.drug ?? r.coding?.label ?? '').toString().toLowerCase();
  s = s.replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|units?|ml|iu)\b.*$/i, '');
  s = s.replace(/\btherapy\b/g, '').replace(MED_SALT, '').replace(/[^a-z\- ]/gi, ' ').replace(/\s+/g, ' ').trim();
  // Calcium / vitamin-D supplement fragments (and common brands) fold to one supplement entry.
  if (/\bcalcium\b|\bvitamin d\b|cole?calciferol|ergocalciferol|\badcal\b|calcichew|\bcacit\b|caltrate/.test(s)) return 'calcium and vitamin d';
  return s;
}
// Reconcile medications: dedup by ingredient, drop drug-class captures when a specific drug of that
// class is present, and EXCLUDE negated meds (a negated/absent statement is not an active med).
export function reconcileMedGroups(records: { type: string; negated: boolean; coding?: any; payload?: any }[]) {
  const groups = new Map<string, any[]>();
  const identityOf = new Map<string, string>(); // group key -> ingredient name (for drug-class logic)
  for (const r of records) {
    if (r.type !== 'MEDICATION' || r.negated) continue;
    const id = medIdentity(r); if (!id) continue;
    // PRIMARY dedup: RxNorm ingredient code. So co-trimoxazole = trimethoprim-sulfamethoxazole = Bactrim
    // (same code) collapse to one; class/brand coded to the same ingredient collapse too. Fallback: name.
    const k = codeKey(r.coding, ['rxnorm', 'rxcui']) ?? id;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
    if (!identityOf.has(k)) identityOf.set(k, id);
  }
  const specific = [...groups.keys()].filter((k) => !MED_CLASS_TERMS.test(identityOf.get(k) ?? ''));
  const kept = new Map<string, any[]>();
  for (const [k, ms] of groups) {
    const id = identityOf.get(k) ?? '';
    if (MED_CLASS_TERMS.test(id)) {
      const ck = medClassKey(id);
      if (ck && MED_CLASS_MEMBERS[ck] && specific.some((sk) => MED_CLASS_MEMBERS[ck].test(identityOf.get(sk) ?? ''))) continue; // drop the class
    }
    kept.set(k, ms);
  }
  return kept;
}

// Aggressive problem-list synonym folding (mirrors the client). A match collapses to the canonical
// concept regardless of site/laterality; members are preserved for the summary's dating.
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
function condCanon(c: any): string | null {
  const t = norm(`${c?.display ?? ''} ${c?.label ?? ''}`);
  for (const [re, canon] of COND_CANON) if (re.test(t)) return canon;
  return null;
}
// Transient symptoms/signs/non-diagnosis states — kept as records, but NOT counted as active problems.
const NOT_A_PROBLEM = /^(fatigue|tiredness|fever|pyrexia|malaise|lethargy|night sweats?|weight (loss|gain)|nausea|vomiting|headache|dizziness|anorexia|leg swelling|pitting edema|pitting oedema|peripheral (edema|oedema)|edema|oedema|swelling|immunosuppression|myalgia|rash|pain|mouth ulcers?|alopecia|hair loss)( \(.*\))?$/i;
// Urine protein:creatinine ratio caught BEFORE plain creatinine so a uPCR (mg/mmol) never folds
// into serum creatinine (µmol/L) and corrupts the trend.
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
// Split the trend by unit family so incompatible scales (µmol/L vs mg/mmol) never share a series.
function analyteKey(r: Rec): string {
  const unit = norm(r.payload?.unit);
  const code = codeKey(r.coding, ['loinc']); // PRIMARY: LOINC code = same analyte across aliases
  if (code) return unit ? `${code}||${unit}` : code;
  const t = norm(r.coding?.display ?? r.coding?.label);
  for (const [re, canon] of ANALYTE_CANON) if (re.test(t)) return unit ? `${canon}||${unit}` : canon;
  return norm(r.coding?.display ?? r.coding?.label);
}
// Human analyte name (the LOINC/code key isn't display-friendly, so derive the name from the record).
function analyteDisplay(r: Rec): string {
  const t = norm(r.coding?.display ?? r.coding?.label);
  for (const [re, canon] of ANALYTE_CANON) if (re.test(t)) return canon;
  return titleCase(r.coding?.display ?? r.coding?.label ?? 'result');
}
const analyteLabel = (k: string) => titleCase(k.split('||')[0]);
// Allergen synonym folding — the same substance under different names is ONE allergy.
const ALLERGEN_CANON: [RegExp, string][] = [
  [/co.?trimoxazole|trimethoprim.?sulfa|sulfamethoxazole.?trimethoprim|sulfamethoxazole.?trimethoprim|sulfamethoxazole|\btmp.?smx\b|bactrim|septrin/i, 'Co-trimoxazole'],
  [/penicillin|amoxicillin|flucloxacillin/i, 'Penicillin'],
  [/aspirin|acetylsalicylic/i, 'Aspirin'],
  [/ibuprofen|naproxen|\bnsaid/i, 'NSAIDs'],
];
export function allergenName(s: string): string {
  const t = norm(s);
  for (const [re, canon] of ALLERGEN_CANON) if (re.test(t)) return canon;
  return titleCase(s);
}
function isLabObservation(r: Rec): boolean {
  if (r.type !== 'OBSERVATION') return false;
  const cat = norm(r.payload?.category);
  if (cat) return /lab|serolog|blood|urine|chemistr|h[ae]matolog|csf|immunolog/.test(cat);
  const hasNum = r.payload?.value != null && !isNaN(parseFloat(r.payload.value)) && !!r.payload?.unit;
  const name = norm(`${r.coding?.display} ${r.coding?.label}`);
  const nonLab = /hyperintensit|white matter|lesion|\bmri\b|\bct\b|x.?ray|ultrasound|imaging|radiograph|attention|memory|cognit|orientat|fever|seizure|duration|recommend|consultation|plan|blood pressure|heart rate|pulse|weight|height|\bbmi\b|temperature|respirat|saturation/;
  return hasNum && !nonLab.test(name);
}

function conceptCore(c: any): string {
  let s = norm(c?.display ?? c?.label).replace(/[.,;:()/]/g, ' ');
  s = s.replace(/\b(left|right|bilateral|sol|sağ)\b/g, ' ');
  // Collapse oncology synonyms + grade/stage; strip anatomical site words so "breast cancer" and
  // "invasive ductal carcinoma" both reduce to "cancer" (site kept separately in the key).
  s = s.replace(/invasive ductal carcinoma|ductal carcinoma in situ|ductal carcinoma|malignant neoplasm|carcinoma|malignancy|tumou?r/g, 'cancer');
  s = s.replace(/\bgrade\s*\d+\b|\bstage\s*[0-4ivx]+\b|\bclass\s+[ivx]+\b/g, ' ');
  // Strip non-distinguishing qualifiers so granularity variants of one diagnosis collapse:
  // "Active SLE" / "SLE, unspecified" / "SLE" -> same core; "steroid-induced AVN" -> "AVN".
  s = s.replace(/\b(unspecified|not intractable|without status epilepticus|nos|nec|active|acute on chronic|primary|secondary|steroid[- ]induced|drug[- ]induced|type [12])\b/g, ' ');
  s = s.replace(new RegExp(`\\b(${SITES})\\w*\\b`, 'g'), ' ');
  s = s.replace(/\b(head|neck|shaft)\b/g, ' '); // anatomical sub-parts: "femoral head" == "femur" for dedup
  return s.replace(/\b(of|the|de|la|el)\b/g, ' ').replace(/\s+/g, ' ').trim() || norm(c?.display ?? c?.label);
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
function medStatus(r: Rec): string {
  const s = norm(r.payload?.status);
  if (s) { if (/stop|discontinu|cease|held/.test(s)) return 'stopped'; if (/start|initiat|begin|commenc/.test(s)) return 'started'; if (/increas|decreas|chang|switch|titrat/.test(s)) return 'changed'; return s; }
  if (r.negated) return 'stopped';
  const t = `${r.coding?.display ?? ''} ${r.provenance?.sourceText ?? ''}`.toLowerCase();
  if (/stopped|discontinued|ceased|held/.test(t)) return 'stopped';
  if (/started|initiated|commenced|began/.test(t)) return 'started';
  return 'ongoing';
}
function drugKey(r: Rec): string {
  const raw = (r.coding?.display ?? r.payload?.drug ?? r.coding?.label ?? '').toString().toLowerCase();
  return raw.replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|units?|ml|iu)\b.*$/i, '').replace(/[^a-z0-9\- ]/gi, ' ').replace(/\s+/g, ' ').trim() || raw.trim();
}
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
function earliest(rs: Rec[]) { return rs.map((r) => iso(r.effective)).filter(Boolean).sort()[0] ?? null; }
function latest(rs: Rec[]) { const d = rs.filter((r) => r.effective).sort((a, b) => iso(a.effective)!.localeCompare(iso(b.effective)!)); return d[d.length - 1] ?? rs[0]; }

// Build a reconciled, classified input for the summary model — deduped, one entity per concept.
export function buildSummaryInput(records: Rec[], demographics: { sex?: string | null; age?: number | null }) {
  const conds = records.filter((r) => r.type === 'CONDITION' && r.assertion !== 'FAMILY_HISTORY');
  const condGroups = new Map<string, Rec[]>();
  const canonName = new Map<string, string>();
  for (const r of conds) {
    const c = r.coding || {};
    const canon = condCanon(c);
    // Aggressive family folds first, then SNOMED/ICD code (same code = same entity), then text.
    const k = canon ?? codeKey(c, ['snomed', 'icd']) ?? `${conceptCore(c)}|${latOf(c)}|${siteOf(c)}`;
    if (canon) canonName.set(k, canon);
    (condGroups.get(k) ?? condGroups.set(k, []).get(k)!).push(r);
  }
  const activeProblems: any[] = [], resolvedHistorical: any[] = [], ruledOutRaw: any[] = [], symptoms: any[] = [];
  const knownCores = new Set<string>();
  for (const [k, ms] of condGroups) {
    const core = k.split('|')[0];
    const cur = latest(ms); const c = cur.coding || {};
    const name = canonName.get(k) ?? titleCase(c.display ?? c.label ?? conceptCore(c));
    const status = condStatus(cur);
    const site = [latOf(c), siteOf(c)].filter(Boolean).join(' ');
    const entry = { name, site: site || undefined, status, since: earliest(ms), chronic: CHRONIC.test(name) || undefined };
    if (status === 'ruled out') { ruledOutRaw.push({ name, site: site || undefined, core }); continue; }
    knownCores.add(core);
    if (/active|recurrence|suspected/.test(status)) {
      // Transient symptoms/signs are recorded but kept OFF the active problem list.
      if (NOT_A_PROBLEM.test(norm(name))) symptoms.push({ name, site: site || undefined });
      else activeProblems.push(entry);
    } else resolvedHistorical.push(entry);
  }
  // Drop surveillance negatives — "ruled out X" when the patient actually HAS X (same concept).
  const ruledOut = ruledOutRaw.filter((r) => !knownCores.has(r.core)).map(({ name, site }) => ({ name, site }));

  // Medications reconciled: one per ingredient (class/granularity collapsed, negated dropped).
  const nowY = Math.max(0, ...records.filter((r) => r.effective).map((r) => new Date(r.effective as any).getUTCFullYear()));
  const medGroups = reconcileMedGroups(records as any);
  const current: any[] = [], past: any[] = [];
  for (const ms of medGroups.values()) {
    const cur = latest(ms); const st = medStatus(cur);
    const drug = titleCase(cur.coding?.display ?? cur.payload?.drug ?? drugKey(cur));
    const dose = [cur.payload?.dose, cur.payload?.route, cur.payload?.frequency].filter(Boolean).join(' ') || undefined;
    const started = earliest(ms.filter((m) => medStatus(m) !== 'stopped'));
    const stoppedDate = iso(latest(ms.filter((m) => medStatus(m) === 'stopped'))?.effective ?? null);
    // Inpatient one-time treatment (IV pulses, PCP prophylaxis, "managed with…") is NOT a current
    // med — UNLESS a later note continues it (started in hospital but "continued" => current).
    const memberText = ms.map((m) => `${m.provenance?.sourceText ?? ''} ${m.payload?.dose ?? ''} ${m.payload?.route ?? ''}`).join(' ').toLowerCase();
    const latestY = Math.max(0, ...ms.filter((m) => m.effective).map((m) => new Date(m.effective as any).getUTCFullYear()));
    const episodic = /\bpulse|pulsed|\bpcp\b|pneumocystis|prophylaxis|stat dose|single dose|one-off|\bfor \d+ days\b|three days|\bx\s?\d+\s?(?:days|\/7)\b|managed with|during (the )?admission|\binpatient\b/.test(memberText);
    const continued = /\bcontinue|continued|continuing|remains? on|remain on|still (on|taking|takes)|ongoing/.test(memberText) || (nowY > 0 && latestY >= nowY - 1);
    // Chemotherapy agents are completed courses, not the current med list.
    if (CHEMO.test(drug)) past.push({ drug, note: 'chemotherapy course' });
    else if (st === 'stopped') past.push({ drug, stopped: stoppedDate ?? undefined });
    else if (episodic && !continued) past.push({ drug, note: 'inpatient / one-time' });
    else current.push({ drug, dose, since: started ?? undefined });
  }

  // Key results: real laboratory results only, grouped by canonical analyte (same test/aliases
  // across dates -> one trend), latest value + trend.
  const obs = records.filter((r) => isLabObservation(r) && r.payload?.value != null && !isNaN(parseFloat(r.payload.value)));
  const obsGroups = new Map<string, Rec[]>();
  for (const r of obs) { const k = analyteKey(r); (obsGroups.get(k) ?? obsGroups.set(k, []).get(k)!).push(r); }
  const keyResults = [...obsGroups.entries()].map(([analyteName, msRaw]) => {
    // Collapse identical readings (same date+value) that recur across documents.
    const seen = new Set<string>();
    const ms = msRaw.filter((m) => { const sig = `${iso(m.effective)}|${m.payload?.value}`; if (seen.has(sig)) return false; seen.add(sig); return true; });
    const ordered = ms.filter((m) => m.effective).sort((a, b) => iso(a.effective)!.localeCompare(iso(b.effective)!));
    const cur = ordered[ordered.length - 1] ?? ms[0];
    const name = analyteDisplay(cur);
    return {
      analyte: name,
      latest: [cur.payload?.value, cur.payload?.unit].filter(Boolean).join(' '),
      date: iso(cur.effective) ?? undefined,
      flag: cur.payload?.flag ?? undefined,
      // Standard interpretation of the cited latest value (eGFR->CKD stage, HbA1c->control) — never replaces it.
      interpretation: labInterpretation(name, cur.payload?.value, cur.payload?.unit) ?? undefined,
      trend: ordered.length > 1 ? ordered.map((m) => `${m.payload?.value}${m.payload?.unit ? ' ' + m.payload.unit : ''}${iso(m.effective) ? ' (' + iso(m.effective) + ')' : ''}`) : undefined,
    };
  });

  const allergyRecs = records.filter((r) => r.type === 'ALLERGY');
  // Dedup allergens by RxNorm ingredient code first (co-trimoxazole = trimethoprim-sulfamethoxazole),
  // then by name. Same substance under any synonym = one allergy.
  const seenAllergen = new Set<string>();
  const allergies: string[] = [];
  for (const r of allergyRecs) {
    if (r.negated) continue;
    const nm = allergenName(r.coding?.display ?? r.coding?.label ?? 'allergy');
    const k = codeKey(r.coding, ['rxnorm', 'rxcui']) ?? norm(nm);
    if (seenAllergen.has(k)) continue;
    seenAllergen.add(k); allergies.push(nm);
  }
  const nkda = allergyRecs.some((r) => r.negated) && allergies.length === 0;

  const procGroups = new Map<string, Rec[]>();
  for (const r of records.filter((r) => r.type === 'PROCEDURE' && !r.negated)) { const k = conceptCore(r.coding || {}); (procGroups.get(k) ?? procGroups.set(k, []).get(k)!).push(r); }
  const procedures = [...procGroups.values()]
    .map((ms) => { const cur = latest(ms); return { name: titleCase(cur.coding?.display ?? cur.coding?.label ?? 'procedure'), date: earliest(ms) ?? undefined }; })
    .filter((p) => !GENERIC_PROC.test(norm(p.name))); // drop vague "surgical procedure"/"chemotherapy"/etc.

  const family = records.filter((r) => r.assertion === 'FAMILY_HISTORY').map((r) => titleCase(r.coding?.display ?? r.coding?.label ?? ''));

  return {
    demographics: { sex: demographics.sex ?? null, age: demographics.age ?? null },
    activeProblems: activeProblems.sort((a, b) => (b.chronic ? 1 : 0) - (a.chronic ? 1 : 0) || (b.since ?? '').localeCompare(a.since ?? '')),
    resolvedHistorical,
    symptoms: symptoms.slice(0, 20),
    medications: { current, past },
    keyResults,
    allergies: allergies.length ? allergies : nkda ? ['No known allergies'] : [],
    procedures,
    ruledOut,
    familyHistory: [...new Set(family)],
  };
}
