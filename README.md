# Zoe Medical — MVP starter

The **one loop**: upload a patient document → extract clinical facts → **cite every fact to its
source** → score completeness → physician reviews, corrects, and signs. Built deep, not wide.

## Why this is SOLID, not a demo
The heart is `lib/llm/reader.ts`. Its contract:
1. Every extracted fact must quote verbatim source text; **facts whose citation is not found in the
   document are dropped** (hallucination blocked at the door).
2. Negation ("no evidence of…") is captured, never silently flipped.
3. Low-confidence facts are flagged `NEEDS_REVIEW`, never silently trusted.
4. `lib/pipeline/persist.ts` cannot write a record without a `Provenance` row — enforced by schema.

Prove it with no keys, no DB: `npm run prove`

## Architecture (build order)
**Skeleton (build once):** auth (`lib/auth`) · DB (`prisma/schema.prisma`) · upload
(`app/api/upload`) · queue (`lib/queue`).
**Slice 1 (the MVP feature):** extraction worker (`workers/extract.worker.ts`) → Reader
(`lib/llm/reader.ts`) → persist with provenance (`lib/pipeline/persist.ts`).
**Next slices bolt onto the same skeleton:** completeness scoring · Verifier (second model) ·
review UI · timeline. Finish one slice 100% before starting the next.

## Run locally (synthetic data only — no real PHI until in-Kingdom hosting)
```
docker compose up -d              # Postgres + Redis
cp .env.example .env              # fill DATABASE_URL, SUPABASE_*, GEMINI_API_KEY
npm install
npm run db:push                   # create tables
npm run worker                    # start the extraction worker
npm run dev                       # start the app
```

## Your stack mapping
- **DB:** Supabase Postgres now → in-Kingdom Postgres at the PHI boundary (data migrates cleanly).
- **Auth:** Supabase behind `lib/auth` → swap to self-hosted later; app code unchanged.
- **Queue/app host:** Hetzner + BullMQ/Redis now → Saudi region at the PHI boundary.
- **The residency line is "real Saudi patient data flows," not "first customer."** Demo on synthetic
  data, win the yes, then upgrade hosting.

## Deliberately NOT built yet (don't let these creep into the MVP)
Verifier (2nd model), full SNOMED, Arabic-OCR tuning, identity matching, timeline, chat, imaging,
comms/WhatsApp, multi-site workflow, billing. All later. The one loop first.

## What still needs wiring (marked TODO in code)
- Real OCR at the OCR stage (currently expects text on `doc.ocrBlocks.text`).
- Object storage upload in `app/api/upload/route.ts`.
- OpenAI Verifier adapter in `lib/llm/index.ts`.
- Completeness scoring + review UI (next slice).
