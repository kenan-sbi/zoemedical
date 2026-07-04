# Deploying Zoe Medical on the Hetzner box (alongside zoepulse.pro)

Runs Zoe Medical at **https://med.zoepulse.pro** on the same server that hosts zoepulse.pro
(88.99.192.23), **without touching the existing sites**.

- **Database:** Supabase (external, already provisioned — schema is pushed).
- **App:** Docker Compose — Next.js web + BullMQ worker + Redis (`docker-compose.prod.yml`).
- **Files:** persist on a Docker volume (`uploads`) — local-disk backend, no cloud storage needed.
- **Reverse proxy:** the box's ONE shared Caddy (`ryansyria-caddy`) reaches the app container by
  name over the external `edge` docker network. No host ports are published.

## Why it's isolated (won't break Ryan's site)
- The compose project is named `zoe-med`; only the `web` container joins `edge` (as `zoe-med-web`).
  `redis` + `worker` stay on a private `internal` network.
- `med.zoepulse.pro` is NOT in the Caddyfile's layer4 SNI passthrough (only `zoepulse.pro`/`www`/
  `dev` are), so it's a normal Caddy TLS site — it does not touch the `zoe-nginx` passthrough.
- Caddy reload is graceful; the other sites stay up.

---

## What the admin does on the box (≈15 min)

Prereq: Docker + compose plugin, and the shared `edge` network (already exists — it fronts
ryansyria + seloflex). Confirm: `docker network ls | grep edge`.

```bash
# 1. Get the code
sudo git clone https://github.com/kenan-sbi/zoemedical.git /opt/zoe-med
cd /opt/zoe-med

# 2. Create the production env file, then fill in real secrets
cp .env.production.example .env.production
sudo nano .env.production        # DATABASE_URL, GEMINI_API_KEY, SUPABASE_*, DOCTOR_PASSCODE
                                 # leave REDIS_URL and SUPABASE_SERVICE_ROLE_KEY unset

# 3. Build & start (project name is pinned to zoe-med inside the compose file)
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps      # web, worker, redis = running

# 4. Add the reverse-proxy site block for med.zoepulse.pro (see deploy/Caddy-med.snippet):
#    - append that block to /opt/ryansyria/deploy/Caddyfile   (bind-mounted into caddy)
#    - docker exec ryansyria-caddy caddy validate --config /etc/caddy/Caddyfile
#    - docker exec ryansyria-caddy caddy reload   --config /etc/caddy/Caddyfile   # graceful
```

## What you (domain owner) do — in GoDaddy

- Type **A**, Name **med**, Value **88.99.192.23**

(Caddy issues the TLS cert automatically once DNS resolves.) Then visit
**https://med.zoepulse.pro/workspace** (and **/console** for the Doctor Console).

---

## Updating later

```bash
cd /opt/zoe-med && git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Notes / decisions
- **Auth:** ships with `DEV_NO_AUTH=1` (no login wall — keep the URL private for the demo). To lock
  it down, set `DEV_NO_AUTH=0` and wire Supabase Auth (follow-up task).
- **Schema changes:** the DB schema is already on Supabase. If models change later, run
  `npx prisma db push` from a machine with the session-pooler `DATABASE_URL`.
- **Rotate the Supabase DB password** after go-live (it was shared in plaintext during setup).
- **PDF export** works here (unlike serverless) — the image bundles Chromium.
