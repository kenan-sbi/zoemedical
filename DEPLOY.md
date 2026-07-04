# Deploying Zoe Medical on the Hetzner box (alongside zoepulse.pro)

Goal: run Zoe Medical at **https://zm.zoepulse.pro** on the same server that already hosts
zoepulse.pro (88.99.192.23), **without touching the existing zoepulse.pro site**.

- **Database:** Supabase (external, already provisioned — schema is pushed).
- **App:** Docker Compose — Next.js web + BullMQ worker + Redis (this repo's `docker-compose.prod.yml`).
- **Files:** persist on a Docker volume (`uploads`) — local-disk backend, no cloud storage needed.
- **Reverse proxy:** a new subdomain block added to the box's existing nginx (or Caddy).

This runs as an **isolated subdomain**, so it can't interfere with zoepulse.pro.

---

## What the admin needs to do (≈15 min)

Prereq: Docker + the compose plugin on the box (`docker --version`, `docker compose version`).
If missing: `curl -fsSL https://get.docker.com | sh`.

```bash
# 1. Get the code
sudo git clone https://github.com/kenan-sbi/zoemedical.git /opt/zoemedical
cd /opt/zoemedical

# 2. Create the production env file from the template, then fill in real secrets
cp .env.production.example .env.production
sudo nano .env.production        # DATABASE_URL, GEMINI_API_KEY, SUPABASE_*, DOCTOR_PASSCODE

# 3. Build & start (web on 127.0.0.1:3010, worker, redis)
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl -sSI http://127.0.0.1:3010 | head -1      # expect HTTP 200/307

# 4. Add the reverse proxy for the subdomain (pick ONE):
#    nginx (matches the current zoepulse.pro setup):
#      see deploy/nginx-zm.zoepulse.pro.conf  (install steps are in that file)
#    Caddy (simpler, auto-HTTPS):
#      append deploy/Caddy-zm.snippet to the Caddyfile, then reload caddy
```

## What you (domain owner) do — in GoDaddy

Add a DNS record so the subdomain points at the box:

- Type **A**, Name **zm**, Value **88.99.192.23**  (TTL default)

(Do this once the app is up; it propagates in a few minutes. TLS is issued automatically by
certbot/Caddy after DNS resolves.)

Then visit **https://zm.zoepulse.pro/workspace** (and **/console** for the Doctor Console).

---

## Updating later

```bash
cd /opt/zoemedical && git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Notes / decisions
- **Auth:** ships with `DEV_NO_AUTH=1` (no login wall — keep the URL private for the demo). To lock
  it down, set `DEV_NO_AUTH=0` and wire Supabase Auth (follow-up task).
- **Schema changes:** the DB schema is already on Supabase. If models change later, run
  `npx prisma db push` from a machine with the session-pooler `DATABASE_URL`.
- **Rotate the Supabase DB password** after go-live (it was shared in plaintext during setup).
- **PDF export** works here (unlike serverless) — the image bundles Chromium.
