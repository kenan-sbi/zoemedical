/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // Don't bundle these heavy/native node modules into serverless functions — require them at
  // runtime instead. Keeps the PDF-export function under Vercel's size limit and avoids bundling
  // Chromium; bullmq/ioredis are native and only used by the local worker path.
  experimental: {
    serverComponentsExternalPackages: ['puppeteer', 'bullmq', 'ioredis', '@prisma/client', 'pdf-parse'],
  },
};
