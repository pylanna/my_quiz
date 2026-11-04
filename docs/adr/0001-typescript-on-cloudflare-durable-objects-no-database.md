# TypeScript on Cloudflare Workers + Durable Objects, no database

The project must run for free, so it targets the Cloudflare free tier: one Durable Object per Game holds all live state in memory and speaks WebSocket to the Host and Players (about 70 per Game). We chose TypeScript over Python because Python Workers are still beta and the browser client is JavaScript regardless; Python is limited to optional helper scripts such as CSV checking. No database is used: a Game exists only while it is live, and the Host downloads results as CSV from the browser at the end.

## Considered Options

- **Python Workers**: rejected for now; as of 2026-11 Cloudflare's Python docs list Durable Objects only as a reachable binding and don't mention WebSockets, so support for a realtime game room isn't established.
- **Python on a free host (Render, Fly)**: rejected; free instances sleep when idle, which breaks joining a Game.
- **D1 for persistent results**: rejected for the first version; fits the free tier but adds complexity (viewing past results without any login) for a feature nobody asked for.

## Consequences

- If a Game's Durable Object is lost mid-game, the Game is lost. Accepted.
- Past Games cannot be revisited after they end.
