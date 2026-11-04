export interface Limits {
  /** Failed (or still-pending) Host logins allowed per window. */
  maxAttempts: number;
  attemptWindowMs: number;
  /** Games a client may create per window. */
  maxCreations: number;
  creationWindowMs: number;
}

export const LIMITS: Limits = {
  maxAttempts: 5,
  attemptWindowMs: 15 * 60_000,
  maxCreations: 10,
  creationWindowMs: 60 * 60_000,
};

export interface LimiterState {
  attempts: number[]; // timestamps of failed/pending logins
  creations: number[]; // timestamps of created games
}

export type BeginResult =
  | { ok: true; state: LimiterState; ticket: number }
  | { ok: false; retryAfterSec: number };

export const emptyState = (): LimiterState => ({ attempts: [], creations: [] });

const isTimes = (v: unknown): v is number[] => Array.isArray(v) && v.every((t) => typeof t === "number" && Number.isFinite(t));

/**
 * Read whatever storage holds: an object, a JSON string (what the Python version stored), or garbage.
 * Anything unreadable starts fresh rather than breaking Host logins.
 */
export function normalizeState(raw: unknown): LimiterState {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return emptyState();
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyState();
  const { attempts = [], creations = [] } = value as Record<string, unknown>;
  return isTimes(attempts) && isTimes(creations) ? { attempts, creations } : emptyState();
}

const recent = (times: number[], now: number, windowMs: number) => times.filter((t) => now - t < windowMs);

function waitSec(times: number[], now: number, windowMs: number): number {
  return Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000));
}

/**
 * Start a login attempt. The attempt is counted immediately, before the password is checked,
 * so a burst of parallel guesses can't all slip through. Call `succeed` with the ticket on success.
 */
export function begin(state: LimiterState, now: number, limits: Limits = LIMITS): BeginResult {
  const attempts = recent(state.attempts, now, limits.attemptWindowMs);
  const creations = recent(state.creations, now, limits.creationWindowMs);
  const waits: number[] = [];
  if (attempts.length >= limits.maxAttempts) waits.push(waitSec(attempts, now, limits.attemptWindowMs));
  if (creations.length >= limits.maxCreations) waits.push(waitSec(creations, now, limits.creationWindowMs));
  if (waits.length > 0) return { ok: false, retryAfterSec: Math.max(...waits) };
  return { ok: true, state: { attempts: [...attempts, now], creations }, ticket: now };
}

/** Password was correct: refund the attempt and count a created game instead. */
export function succeed(state: LimiterState, ticket: number, now: number, limits: Limits = LIMITS): LimiterState {
  const i = state.attempts.indexOf(ticket);
  const attempts = i === -1 ? state.attempts : [...state.attempts.slice(0, i), ...state.attempts.slice(i + 1)];
  return { attempts, creations: [...recent(state.creations, now, limits.creationWindowMs), now] };
}

export const isIdle = (state: LimiterState, now: number, limits: Limits = LIMITS): boolean =>
  recent(state.attempts, now, limits.attemptWindowMs).length === 0 &&
  recent(state.creations, now, limits.creationWindowMs).length === 0;
