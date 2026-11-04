import { describe, expect, it } from "vitest";
import { resultsToCsv } from "../src/core/results";

describe("resultsToCsv", () => {
  it("writes header, escapes quotes/commas and neutralises formulas", () => {
    const csv = resultsToCsv([
      { rank: 1, nickname: 'A,"B"', score: 2500, correctCount: 2, correctTimeMs: 3456 },
      { rank: 2, nickname: "=SUM(1)", score: 10, correctCount: 0, correctTimeMs: 0 },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("rank,nickname,score,correct_answers,correct_time_seconds");
    expect(lines[1]).toBe('1,"A,""B""",2500,2,3.46');
    expect(lines[2]).toBe("2,'=SUM(1),10,0,0.00");
  });
});
