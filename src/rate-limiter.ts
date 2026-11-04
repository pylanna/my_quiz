import { DurableObject } from "cloudflare:workers";
import { begin, isIdle, LIMITS, normalizeState, succeed, type LimiterState } from "./core/ratelimit";

/** One Durable Object per client IP. State is persisted so it survives eviction. */
export class RateLimiter extends DurableObject {
  private async load(): Promise<LimiterState> {
    return normalizeState(await this.ctx.storage.get("state"));
  }

  private async save(state: LimiterState): Promise<void> {
    await this.ctx.storage.put("state", state);
    const longest = Math.max(LIMITS.attemptWindowMs, LIMITS.creationWindowMs);
    await this.ctx.storage.setAlarm(Date.now() + longest + 1000); // tidy up once everything has expired
  }

  /** Reserve a login attempt. Everything inside a Durable Object runs one request at a time, so this is race-free. */
  async begin(): Promise<{ ok: true; ticket: number } | { ok: false; retryAfterSec: number }> {
    const r = begin(await this.load(), Date.now());
    if (!r.ok) return r;
    await this.save(r.state);
    return { ok: true, ticket: r.ticket };
  }

  async succeed(ticket: number): Promise<void> {
    await this.save(succeed(await this.load(), ticket, Date.now()));
  }

  async alarm(): Promise<void> {
    if (isIdle(await this.load(), Date.now())) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(Date.now() + 60_000);
  }
}
