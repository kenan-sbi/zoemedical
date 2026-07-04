# One image, two roles (web + worker) — see docker-compose.prod.yml.
# Debian base so puppeteer's Chromium (PDF export) has its runtime libraries.
FROM node:20-bookworm-slim

# Chromium runtime deps for puppeteer (server-side PDF export of signed deliverables).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libglib2.0-0 \
    libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxrandr2 libxkbcommon0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching). npm ci runs postinstall -> prisma generate,
# and downloads Chromium for puppeteer.
COPY package.json package-lock.json ./
RUN npm ci

# App source, then production build.
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Default role = web. The worker service overrides this command in compose.
CMD ["npm", "start"]
