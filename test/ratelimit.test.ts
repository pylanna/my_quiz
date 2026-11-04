import { describe, expect, it } from "vitest";
import { begin, emptyState, LIMITS, normalizeState, succeed, type LimiterState } from "../src/core/ratelimit";

const MIN = 60_000;

/** Run n failed logins (begin without succeed) at time t. */
function fail(state: LimiterState, n: number, t: number): LimiterState {
  for (let i = 0; i < n; i++) {
    const r = begin(state, t + i);
    if (!r.ok) throw new Error("unexpectedly blocked");
    state = r.state;
  }
  return state;
}

describe("failed-login limit", () => {
  it("allows 5 failed attempts then blocks the 6th", () => {
    const s = fail(emptyState(), LIMITS.maxAttempts, 0);
    const r = begin(s, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it("reports when the oldest failure ages out", () => {
    const s = fail(emptyState(), LIMITS.maxAttempts, 0);
    const r = begin(s, 5 * MIN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSec).toBe(10 * 60); // oldest at t=0 expires at 15 min
  });

  it("allows attempts again once the window has passed", () => {
    const s = fail(emptyState(), LIMITS.maxAttempts, 0);
    expect(begin(s, 15 * MIN + 10).ok).toBe(true);
  });

  it("blocks a parallel burst because attempts are counted before the password is checked", () => {
    let s = emptyState();
    let allowed = 0;
    for (let i = 0; i < 50; i++) {
      const r = begin(s, 100); // none of them has finished yet
      if (r.ok) { s = r.state; allowed++; }
    }
    expect(allowed).toBe(LIMITS.maxAttempts);
  });
});

describe("successful login", () => {
  it("refunds the attempt so it does not count as a failure", () => {
    let s = emptyState();
    for (let i = 0; i < LIMITS.maxAttempts + 3; i++) {
      const r = begin(s, i);
      expect(r.ok).toBe(true);
      if (r.ok) s = succeed(r.state, r.ticket, i);
    }
    expect(s.attempts).toEqual([]);
  });

  it("caps game creation per hour", () => {
    let s = emptyState();
    for (let i = 0; i < LIMITS.maxCreations; i++) {
      const r = begin(s, i);
      if (!r.ok) throw new Error("blocked early");
      s = succeed(r.state, r.ticket, i);
    }
    const r = begin(s, 30 * MIN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSec).toBe(30 * 60 - 0); // oldest creation (t=0) frees up at 60 min
    expect(begin(s, 61 * MIN).ok).toBe(true);
  });

  it("does not let one IP's state affect a fresh one", () => {
    const s = fail(emptyState(), LIMITS.maxAttempts, 0);
    expect(begin(s, 1).ok).toBe(false);
    expect(begin(emptyState(), 1).ok).toBe(true);
  });
});

describe("normalizeState", () => {
  it("reads an object and a JSON string (the Python version stored a string)", () => {
    expect(normalizeState({ attempts: [1, 2], creations: [3] })).toEqual({ attempts: [1, 2], creations: [3] });
    expect(normalizeState('{"attempts": [1], "creations": []}')).toEqual({ attempts: [1], creations: [] });
  });

  it("starts fresh instead of crashing on anything unreadable", () => {
    for (const junk of [undefined, null, "", "not json", "[1,2]", 42, ["x"], { attempts: "oops" }, { attempts: [1, "a"] }]) {
      expect(normalizeState(junk)).toEqual(emptyState());
    }
  });
});
