# TypeScript on Cloudflare Workers + Durable Objects, no database

The project must run for free, so it targets the Cloudflare free tier: one Durable Object per Game holds all live state in memory and speaks WebSocket to the Host and Players (about 70 per Game). We chose TypeScript over Python Workers after trying both (see Considered Options); the browser client is JavaScript regardless. No database is used: a Game exists only while it is live, and the Host downloads results as CSV from the browser at the end.

## Considered Options

- **Python Workers**: built and deployed briefly on 2026-11-04, then rolled back. It works: Cloudflare's own Durable Objects WebSocket example has a Python version, the game logic ported 1:1 with 72 pytest tests, and a full end-to-end run passed locally. Measured on the live Free plan it was worse: Worker CPU 11-33 ms per request against Free's 10 ms limit, 0.7-1.2 s Worker startup (TypeScript: 2 ms), and one 18 s cold request. Too risky for a live room of ~70 phones; revisit if Cloudflare's Python startup and CPU improve, and measure under a real Game first. The Python version lived on a branch that has since been deleted.
- **Python on a free host (Render, Fly)**: rejected; free instances sleep when idle, which breaks joining a Game.
- **D1 for persistent results**: rejected for the first version; fits the free tier but adds complexity (viewing past results without any login) for a feature nobody asked for.

## Consequences

- If a Game's Durable Object is lost mid-game, the Game is lost. Accepted.
- Past Games cannot be revisited after they end.
- Durable Object storage outlives deploys. Whenever a deploy changes what a Durable Object stores, the new code must still read the old format (the Python experiment and its rollback each hit this with the RateLimiter; see `normalizeState`).
