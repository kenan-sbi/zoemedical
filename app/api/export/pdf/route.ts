import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { caseForPatient } from '@/lib/review';
import { currentUser } from '@/lib/session';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const maxDuration = 60;

// PDF export renders HTML via headless Chromium (puppeteer). Serverless platforms (Vercel) don't
// ship Chromium and exceed the function size limit, so this is disabled there — the deliverable is
// still viewable in-app; only the downloadable PDF is unavailable until a serverless-Chromium
// (e.g. @sparticuz/chromium) or an external render service is wired up.
const PDF_DISABLED = !!process.env.VERCEL;

// Server-side HTML -> PDF of a generated deliverable. GATE: nothing clinical exports UNSIGNED — a
// case must be physician-signed first. Signed exports carry the physician stamp. RTL-aware (Arabic).
export async function POST(req: NextRequest) {
  if (PDF_DISABLED) return NextResponse.json({ error: 'PDF export is unavailable in this hosting environment. View the deliverable in-app instead.' }, { status: 501 });
  const { patientId, title, body, sourceRecordIds, dir } = await req.json().catch(() => ({} as any));
  if (!patientId || !body) return NextResponse.json({ error: 'patientId + body required' }, { status: 400 });

  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  const kase = await caseForPatient(patientId);
  const signOff = await prisma.signOff.findUnique({ where: { caseId: kase.id } });
  // SIGNED -> final PDF with the physician stamp. UNSIGNED -> a DRAFT, watermarked "not physician-
  // reviewed" (nothing clinical leaves as a *final* document until it is signed).
  const signer = signOff ? await prisma.user.findUnique({ where: { id: signOff.userId } }) : null;
  const me = await currentUser(req);
  await logAudit(me, 'EXPORT', patientId, { title: title || 'Clinical Document', signed: !!signOff });

  const html = renderHtml({
    patientName: patient?.displayName ?? patientId,
    caseId: kase.id,
    title: title || 'Clinical Document',
    body,
    dir: dir === 'rtl' ? 'rtl' : 'ltr',
    sourceRecordIds: Array.isArray(sourceRecordIds) ? sourceRecordIds : [],
    generatedAt: new Date().toLocaleString(),
    stamp: signOff ? { name: signer?.name ?? null, license: signOff.license ?? signer?.license ?? null, at: signOff.createdAt.toLocaleString() } : null,
  });

  const puppeteer = (await import('puppeteer')).default; // dynamic: keep Chromium out of the serverless bundle
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' },
    });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${signOff ? '' : 'DRAFT-'}${slug(title || 'document')}.pdf"`,
      },
    });
  } finally {
    await browser.close();
  }
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function slug(s: string) {
  return s.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'document';
}
// Minimal Markdown -> HTML for the body: **bold**, "- " bullets, and paragraphs. Escapes first.
function mdToHtml(body: string): string {
  const lines = body.split('\n');
  let html = '', inList = false;
  const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  for (const raw of lines) {
    const t = raw.trim();
    if (/^[-*•]\s+/.test(t)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(t.replace(/^[-*•]\s+/, ''))}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (!t) { html += ''; continue; }
    html += `<p>${inline(t)}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

function renderHtml(d: { patientName: string; caseId: string; title: string; body: string; dir: 'ltr' | 'rtl'; sourceRecordIds: string[]; generatedAt: string; stamp: { name: string | null; license: string | null; at: string } | null }) {
  // PROVENANCE (embedded): the exact record ids this deliverable drew from.
  const provenanceComment = `<!-- provenance: drew from record ids: ${d.sourceRecordIds.join(', ') || '(none reported)'} -->`;
  const bodyHtml = mdToHtml(d.body);
  const signed = !!d.stamp;
  const stampName = d.stamp?.name ? esc(d.stamp.name) : 'the reviewing physician';
  const stampLic = d.stamp?.license ? ` &nbsp;·&nbsp; Saudi license #${esc(d.stamp.license)}` : '';
  const arFont = "'Noto Naskh Arabic', 'Geeza Pro', 'Al Bayan', 'Segoe UI', 'Amiri', Tahoma, sans-serif";
  const stampBlock = signed
    ? `<div class="stamp">
    <div class="t">✓ Reviewed &amp; signed off by Dr. ${stampName}${stampLic}</div>
    <div class="s">Signed ${esc(d.stamp!.at)} · Case ${esc(d.caseId)} · 🔒 locked · This document is physician-approved for release.</div>
  </div>`
    : `<div class="draftbox">
    <div class="t">DRAFT — not physician-reviewed</div>
    <div class="s">This is an unsigned working copy. A physician must review and sign off before it can be used as a clinical document.</div>
  </div>`;
  const watermark = signed ? '' : `<div class="wm">DRAFT — NOT PHYSICIAN-REVIEWED</div>`;
  return `<!doctype html>
<html dir="${d.dir}" lang="${d.dir === 'rtl' ? 'ar' : 'en'}"><head><meta charset="utf-8">${provenanceComment}
<style>
  body { font-family: ${d.dir === 'rtl' ? arFont : "Georgia, 'Times New Roman', serif"}; color: #1a1a1a; line-height: 1.6; direction: ${d.dir}; }
  .hdr { border-bottom: 2px solid #0f4c5c; padding-bottom: 10px; margin-bottom: 22px; }
  .hdr h1 { font-size: 20px; margin: 0 0 4px; color: #0f4c5c; }
  .meta { font-size: 12px; color: #555; }
  .title { font-size: 17px; font-weight: bold; margin: 0 0 14px; }
  .body { font-size: 13.5px; }
  .body ul { margin: 4px 0 12px; padding-inline-start: 22px; }
  .body p { margin: 0 0 9px; }
  .stamp { margin-top: 34px; border: 1.5px solid #116b40; border-radius: 8px; padding: 12px 16px; background: #f2faf5; direction: ${d.dir}; }
  .stamp .t { font-size: 13px; font-weight: bold; color: #116b40; }
  .stamp .s { font-size: 12px; color: #333; margin-top: 3px; }
  .draftbox { margin-top: 34px; border: 1.5px dashed #b45309; border-radius: 8px; padding: 12px 16px; background: #fdf3e6; direction: ${d.dir}; }
  .draftbox .t { font-size: 13px; font-weight: bold; color: #b45309; letter-spacing: .5px; }
  .draftbox .s { font-size: 12px; color: #7a5a2a; margin-top: 3px; }
  .wm { position: fixed; top: 44%; left: 50%; transform: translate(-50%,-50%) rotate(-32deg); font-size: 58px; font-weight: 800; color: rgba(180,83,9,.12); white-space: nowrap; z-index: 0; pointer-events: none; }
  .foot { margin-top: 26px; font-size: 10px; color: #888; border-top: 1px solid #ddd; padding-top: 8px; direction: ltr; }
  .hdr, .title, .body, .stamp, .draftbox, .foot { position: relative; z-index: 1; }
</style></head>
<body>
  ${watermark}
  <div class="hdr" style="direction:ltr">
    <h1>Zoe Medical — Clinical Document</h1>
    <div class="meta">Patient: <strong>${esc(d.patientName)}</strong> &nbsp;·&nbsp; Case: ${esc(d.caseId)} &nbsp;·&nbsp; Generated: ${esc(d.generatedAt)}</div>
  </div>
  <div class="title">${esc(d.title)}</div>
  <div class="body">${bodyHtml}</div>
  ${stampBlock}
  <div class="foot">Generated by Zoe Medical from extracted, source-cited clinical records. Source: ${signed ? 'the signed clinical record — reviewed and signed off by a physician.' : 'the clinical record — UNSIGNED draft, pending physician review.'}</div>
</body></html>`;
}
