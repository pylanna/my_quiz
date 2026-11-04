import { MAX_SECONDS, MIN_SECONDS } from "./csv";

export interface GameSettings {
  /** Time limit for Questions whose CSV row has no `seconds`. */
  defaultSeconds: number;
  /** Points for a correct Answer. */
  basePoints: number;
  /** Extra points for an instant correct Answer, shrinking linearly to 0 at the deadline. 0 turns the bonus off. */
  maxSpeedBonus: number;
}

export const DEFAULT_SETTINGS: GameSettings = { defaultSeconds: 20, basePoints: 1000, maxSpeedBonus: 500 };

export const MIN_BASE_POINTS = 100;
export const MAX_BASE_POINTS = 5000;
export const BASE_POINTS_STEP = 100;

export type SettingsResult = { ok: true; settings: GameSettings } | { ok: false; error: string };

export function validateSettings(raw: unknown): SettingsResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const { defaultSeconds, basePoints, maxSpeedBonus } = r;
  if (typeof defaultSeconds !== "number" || !Number.isInteger(defaultSeconds) || defaultSeconds < MIN_SECONDS || defaultSeconds > MAX_SECONDS) {
    return { ok: false, error: `เวลาเริ่มต้นต่อข้อต้องเป็นจำนวนเต็ม ${MIN_SECONDS}-${MAX_SECONDS} วินาที` };
  }
  if (
    typeof basePoints !== "number" ||
    !Number.isInteger(basePoints) ||
    basePoints < MIN_BASE_POINTS ||
    basePoints > MAX_BASE_POINTS ||
    basePoints % BASE_POINTS_STEP !== 0
  ) {
    return { ok: false, error: `แต้มพื้นฐานต้องอยู่ระหว่าง ${MIN_BASE_POINTS}-${MAX_BASE_POINTS} และเป็นพหุคูณของ ${BASE_POINTS_STEP}` };
  }
  if (typeof maxSpeedBonus !== "number" || !Number.isInteger(maxSpeedBonus) || maxSpeedBonus < 0 || maxSpeedBonus > basePoints) {
    return { ok: false, error: "โบนัสความเร็วต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึงเท่าแต้มพื้นฐาน" };
  }
  return { ok: true, settings: { defaultSeconds, basePoints, maxSpeedBonus } };
}
