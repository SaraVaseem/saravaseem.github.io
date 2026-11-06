# Wind Truth (React + Cloudflare Worker + KV)
## Backend
cd worker && npx wrangler kv namespace create HIST   # paste id into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY            # powers the chat panel
npx wrangler deploy                                  # cron ingests hourly; GET /api/ingest to seed now
## Frontend
cd web && cp .env.example .env   # set VITE_API to your worker URL
npm i && npm run dev             # or: npm run build  -> deploy dist/ to Netlify/Vercel/Pages
