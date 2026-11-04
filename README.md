# Live Quiz

Kahoot-style live quiz on the Cloudflare free tier: Players join with a PIN, the Host imports questions from CSV, each question has a server-side countdown, and the top 5 are shown at the end. See [CONTEXT.md](CONTEXT.md) for the vocabulary and [docs/adr](docs/adr) for decisions.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # set HOST_PASSWORD
npm run dev                      # http://localhost:8787  (Host: /host)
npm test                         # unit tests (pure game logic)
HOST_PASSWORD=... node scripts/smoke.mjs   # end-to-end check against the running dev server
# add SMOKE_RATE_LIMIT=1 to also test the login lockout (locks you out for 15 min; reset with: rm -rf .wrangler/state)
```

## Deploy (free)

```bash
npx wrangler login
npx wrangler secret put HOST_PASSWORD
npm run deploy                   # → https://my-quiz.<your-subdomain>.workers.dev
```

## CSV format

`question,option_a,option_b,option_c,option_d,correct,seconds` — 2–4 options (fill from A, no gaps), `correct` is A–D or 1–4, `seconds` is 5–120 and optional (blank → the Host's default seconds, 20 unless changed). UTF-8 only. See `public/sample.csv`.

## Free-tier budget (checked against Cloudflare docs, 2026-11-04)

- Durable Objects on the Free plan must be SQLite-backed (this project's migration already is): 100,000 requests/day, 13,000 GB-s duration/day. Incoming WebSocket messages bill at 20:1.
- Rough cost of one 30-minute Game with 70 Players: ~6,500 incoming messages (answers + 25s keep-alive pings) ≈ 330 billed requests, and ~225 GB-s of duration (non-hibernating, 128 MB). That's a few percent of the daily allowance.
- Workers Free: 100,000 requests/day. Exceeding any limit makes further operations fail until 00:00 UTC.
- Deploying new code, or a restart, ends any live Game (state is in memory — see ADR 0001). Don't deploy mid-game.

## Host login protection

`POST /api/games` is rate limited per client IP by a Durable Object (`RateLimiter`): at most 5 wrong/pending password attempts per 15 minutes and 10 created games per hour. The attempt is counted before the password is checked, so parallel guessing can't bypass it. Limits live in [src/core/ratelimit.ts](src/core/ratelimit.ts).

## Game settings

In the Host lobby, before starting: default seconds per question (5–120), points for a correct answer (100–5000, steps of 100) and maximum speed bonus (0 up to the base points; 0 turns the bonus off). The browser remembers the last accepted values for the next Game; they're locked once the Game starts. Defaults and limits live in [src/core/settings.ts](src/core/settings.ts).
