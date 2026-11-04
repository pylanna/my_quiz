import { describe, expect, it } from "vitest";
import { BASE_POINTS, MAX_SPEED_BONUS, scoreAnswer, rankPlayers, topRanks } from "../src/core/scoring";

describe("scoreAnswer with custom settings", () => {
  it("uses the given base and bonus", () => {
    expect(scoreAnswer({ correct: true, elapsedMs: 0, limitMs: 10_000, basePoints: 2000, maxSpeedBonus: 1000 })).toBe(3000);
    expect(scoreAnswer({ correct: true, elapsedMs: 5_000, limitMs: 10_000, basePoints: 2000, maxSpeedBonus: 1000 })).toBe(2500);
  });
  it("gives a flat score when the bonus is 0", () => {
    expect(scoreAnswer({ correct: true, elapsedMs: 0, limitMs: 10_000, basePoints: 300, maxSpeedBonus: 0 })).toBe(300);
    expect(scoreAnswer({ correct: true, elapsedMs: 9_999, limitMs: 10_000, basePoints: 300, maxSpeedBonus: 0 })).toBe(300);
  });
});

describe("scoreAnswer", () => {
  it("gives 0 for a wrong answer", () => {
    expect(scoreAnswer({ correct: false, elapsedMs: 0, limitMs: 10_000 })).toBe(0);
  });
  it("gives base + full bonus for an instant correct answer", () => {
    expect(scoreAnswer({ correct: true, elapsedMs: 0, limitMs: 10_000 })).toBe(BASE_POINTS + MAX_SPEED_BONUS);
  });
  it("gives only base at the deadline", () => {
    expect(scoreAnswer({ correct: true, elapsedMs: 10_000, limitMs: 10_000 })).toBe(BASE_POINTS);
  });
  it("scales the bonus linearly", () => {
    expect(scoreAnswer({ correct: true, elapsedMs: 5_000, limitMs: 10_000 })).toBe(BASE_POINTS + MAX_SPEED_BONUS / 2);
  });
  it("clamps elapsed outside [0, limit]", () => {
    expect(scoreAnswer({ correct: true, elapsedMs: -50, limitMs: 10_000 })).toBe(BASE_POINTS + MAX_SPEED_BONUS);
    expect(scoreAnswer({ correct: true, elapsedMs: 99_999, limitMs: 10_000 })).toBe(BASE_POINTS);
  });
});

const p = (id: string, score: number, correctTimeMs: number) => ({ id, score, correctTimeMs });

describe("rankPlayers", () => {
  it("orders by score desc", () => {
    const r = rankPlayers([p("a", 100, 0), p("b", 300, 0), p("c", 200, 0)]);
    expect(r.map((x) => [x.id, x.rank])).toEqual([["b", 1], ["c", 2], ["a", 3]]);
  });
  it("breaks ties by lower correct time", () => {
    const r = rankPlayers([p("slow", 100, 9000), p("fast", 100, 3000)]);
    expect(r.map((x) => [x.id, x.rank])).toEqual([["fast", 1], ["slow", 2]]);
  });
  it("shares a rank when score and time are equal (competition ranking)", () => {
    const r = rankPlayers([p("a", 100, 5), p("b", 100, 5), p("c", 50, 1)]);
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3]);
  });
});

describe("topRanks", () => {
  it("returns the first N", () => {
    const r = rankPlayers([1, 2, 3, 4, 5, 6, 7].map((n) => p(String(n), 100 - n, n)));
    expect(topRanks(r, 5)).toHaveLength(5);
  });
  it("includes players tied with the Nth", () => {
    const r = rankPlayers([p("a", 500, 1), p("b", 400, 1), p("c", 300, 1), p("d", 200, 1), p("e", 100, 1), p("f", 100, 1), p("g", 50, 1)]);
    expect(topRanks(r, 5).map((x) => x.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
  it("returns everyone when fewer than N", () => {
    expect(topRanks(rankPlayers([p("a", 1, 1)]), 5)).toHaveLength(1);
  });
});
