import { GameRoom } from "./game-room";
import { RateLimiter } from "./rate-limiter";

export { GameRoom, RateLimiter };

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  HOST_PASSWORD?: string;
}

const PIN_RE = /^\d{6}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function randomPin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900_000;
  return String(100_000 + n);
}

async function createGame(request: Request, env: Env): Promise<Response> {
  if (!env.HOST_PASSWORD) return json({ error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า HOST_PASSWORD" }, 500);

  // Rate limit per client IP. The attempt is reserved before the password is checked (see core/ratelimit.ts).
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const limiter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(ip));
  const slot = await limiter.begin();
  if (!slot.ok) {
    const minutes = Math.ceil(slot.retryAfterSec / 60);
    return new Response(JSON.stringify({ error: `ลองมากเกินไป กรุณารอประมาณ ${minutes} นาที` }), {
      status: 429,
      headers: { "content-type": "application/json; charset=utf-8", "retry-after": String(slot.retryAfterSec) },
    });
  }

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "คำขอไม่ถูกต้อง" }, 400);
  }
  if (typeof body.password !== "string" || !(await passwordMatches(body.password, env.HOST_PASSWORD))) {
    return json({ error: "รหัสผ่านไม่ถูกต้อง" }, 401);
  }
  await limiter.succeed(slot.ticket);

  const hostToken = crypto.randomUUID();
  for (let attempt = 0; attempt < 8; attempt++) {
    const pin = randomPin();
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(pin));
    const res = await stub.fetch("https://game-room/init", { method: "POST", body: JSON.stringify({ hostToken }) });
    if (res.ok) return json({ pin, hostToken });
  }
  return json({ error: "สร้างเกมไม่สำเร็จ ลองใหม่อีกครั้ง" }, 503);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/games" && request.method === "POST") {
      return createGame(request, env);
    }

    const ws = url.pathname.match(/^\/ws\/(\d{6})$/);
    if (ws) {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      const origin = request.headers.get("Origin");
      if (origin && new URL(origin).host !== url.host) return new Response("Forbidden", { status: 403 });
      if (!PIN_RE.test(ws[1])) return new Response("Bad PIN", { status: 400 });
      return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(ws[1])).fetch(request);
    }

    // Static files are served by the assets layer before reaching this Worker.
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
