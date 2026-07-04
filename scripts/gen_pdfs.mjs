// Dev-only helper: generate text-based clinical PDFs for testing bulk upload. Not part of the app.
import puppeteer from 'puppeteer';
const OUT = process.argv[2];
const docs = [
  ['patient_ahmed_discharge.pdf', `DISCHARGE SUMMARY — Patient: Ahmed K.  MRN: 10001
Admitted with acute abdominal pain. WBC 14.2 (elevated). Diagnosed with acute appendicitis.
Underwent laparoscopic appendectomy. Post-op recovery uneventful.
Discharge meds: Paracetamol 1g three times daily; Amoxicillin-clavulanate 625mg twice daily.
No known drug allergies. Follow-up with surgery in 10 days.`],
  ['patient_fatima_cardio.pdf', `CARDIOLOGY NOTE — Patient: Fatima S.  MRN: 10002
Presents with palpitations. ECG shows atrial fibrillation. No evidence of acute ischemia.
Started on Apixaban 5mg twice daily and Bisoprolol 2.5mg once daily.
PMH: hypertension since 2015. Allergic to sulfa drugs.
Plan: echocardiogram, thyroid function tests.`],
  ['patient_omar_labs.pdf', `LABORATORY REPORT — Patient: Omar T.  MRN: 10003
HbA1c 9.1% (high). Fasting glucose 186 mg/dL (elevated). Creatinine 1.3 mg/dL.
Impression: poorly controlled type 2 diabetes mellitus.
Recommend Metformin 1000mg twice daily and dietary counseling.`],
];
const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
for (const [name, text] of docs) {
  const p = await b.newPage();
  await p.setContent(`<pre style="font-family:Georgia;font-size:14px;white-space:pre-wrap">${text}</pre>`, { waitUntil: 'networkidle0' });
  await p.pdf({ path: OUT + '/' + name, format: 'A4' });
  console.log('wrote', name);
}
await b.close();
