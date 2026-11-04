import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, validateSettings } from "../src/core/settings";

describe("validateSettings", () => {
  it("has the agreed defaults", () => {
    expect(DEFAULT_SETTINGS).toEqual({ defaultSeconds: 20, basePoints: 1000, maxSpeedBonus: 500 });
  });

  it("accepts valid values", () => {
    const r = validateSettings({ defaultSeconds: 30, basePoints: 2000, maxSpeedBonus: 0 });
    expect(r).toEqual({ ok: true, settings: { defaultSeconds: 30, basePoints: 2000, maxSpeedBonus: 0 } });
  });

  it("accepts a bonus equal to the base", () => {
    expect(validateSettings({ defaultSeconds: 20, basePoints: 500, maxSpeedBonus: 500 }).ok).toBe(true);
  });

  it.each([
    [{ defaultSeconds: 4, basePoints: 1000, maxSpeedBonus: 500 }, "seconds too small"],
    [{ defaultSeconds: 121, basePoints: 1000, maxSpeedBonus: 500 }, "seconds too large"],
    [{ defaultSeconds: 20.5, basePoints: 1000, maxSpeedBonus: 500 }, "seconds not an integer"],
    [{ defaultSeconds: 20, basePoints: 50, maxSpeedBonus: 0 }, "base too small"],
    [{ defaultSeconds: 20, basePoints: 5100, maxSpeedBonus: 0 }, "base too large"],
    [{ defaultSeconds: 20, basePoints: 1050, maxSpeedBonus: 0 }, "base not a multiple of 100"],
    [{ defaultSeconds: 20, basePoints: 1000, maxSpeedBonus: -1 }, "bonus negative"],
    [{ defaultSeconds: 20, basePoints: 1000, maxSpeedBonus: 1001 }, "bonus above base"],
    [{ defaultSeconds: "20", basePoints: 1000, maxSpeedBonus: 0 }, "wrong type"],
    [null, "not an object"],
    [{ basePoints: 1000, maxSpeedBonus: 0 }, "missing field"],
  ] as [unknown, string][])("rejects %j (%s)", (input) => {
    expect(validateSettings(input).ok).toBe(false);
  });
});
