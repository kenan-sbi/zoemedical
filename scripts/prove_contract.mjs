const norm = s => s.replace(/\s+/g,' ').trim().toLowerCase();
const inDoc = (src,doc) => norm(doc).includes(norm(src));
const THRESH = 0.75;
const DOC = `DISCHARGE SUMMARY
Pt admitted with chest pain. Troponin 0.9 ng/mL (elevated).
Started on Aspirin 75mg once daily. No evidence of myocardial infarction on serial ECG.
PMH: Type 2 diabetes since 2018. Allergic to penicillin.`;
const modelOutput = [
  { display:"Troponin", negated:false, sourceText:"Troponin 0.9 ng/mL (elevated)", confidence:0.96 },
  { display:"Myocardial infarction", negated:true, sourceText:"No evidence of myocardial infarction", confidence:0.9 },
  { display:"Type 2 diabetes", negated:false, sourceText:"Type 2 diabetes since 2018", confidence:0.6 },
  { display:"Metformin", negated:false, sourceText:"Started on Metformin 500mg", confidence:0.88 },
];
const facts=[], dropped=[];
for (const f of modelOutput) {
  if (!inDoc(f.sourceText, DOC)) { dropped.push({reason:"citation-not-found-in-source", display:f.display}); continue; }
  facts.push({...f, needsReview: f.confidence < THRESH || f.negated});
}
console.log("=== KEPT (cited -> stored with provenance) ===");
for (const f of facts) console.log(
  ` ${f.needsReview?"REVIEW":"ok    "}  ${f.display.padEnd(24)} ${f.negated?"[NEGATED]":"         "} conf=${f.confidence}  <- "${f.sourceText}"`);
console.log("\n=== DROPPED (refused -- not a toy) ===");
for (const d of dropped) console.log(` XX ${d.display}  (${d.reason})`);
