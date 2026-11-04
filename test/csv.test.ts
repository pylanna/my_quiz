import { describe, expect, it } from "vitest";
import { parseQuiz } from "../src/core/csv";

const header = "question,option_a,option_b,option_c,option_d,correct,seconds";

describe("parseQuiz", () => {
  it("parses a valid quiz with 4 options", () => {
    const r = parseQuiz(`${header}\n2+2?,3,4,5,6,B,15`);
    expect(r.errors).toEqual([]);
    expect(r.questions).toEqual([
      { text: "2+2?", options: ["3", "4", "5", "6"], correct: 1, seconds: 15 },
    ]);
  });

  it("accepts 2 or 3 options when trailing ones are blank", () => {
    const r = parseQuiz(`${header}\nจริงไหม?,จริง,เท็จ,,,a,\nx,1,2,3,,3,10`);
    expect(r.errors).toEqual([]);
    expect(r.questions[0].options).toEqual(["จริง", "เท็จ"]);
    expect(r.questions[1].options).toEqual(["1", "2", "3"]);
    expect(r.questions[1].correct).toBe(2);
  });

  it("leaves seconds unset when blank so the Game's default applies", () => {
    const r = parseQuiz(`${header}\nq,a,b,,,A,`);
    expect(r.errors).toEqual([]);
    expect(r.questions[0].seconds).toBeNull();
  });

  it("strips a UTF-8 BOM and handles CRLF", () => {
    const r = parseQuiz(`﻿${header}\r\nq,a,b,,,1,10\r\n`);
    expect(r.errors).toEqual([]);
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].correct).toBe(0);
  });

  it("handles quoted fields with commas, quotes and newlines", () => {
    const r = parseQuiz(`${header}\n"a, ""b""\nc",x,y,,,A,10`);
    expect(r.errors).toEqual([]);
    expect(r.questions[0].text).toBe('a, "b"\nc');
  });

  it("matches headers case-insensitively and ignores blank lines", () => {
    const r = parseQuiz(`Question, Option_A,OPTION_B,Option_C,Option_D,Correct,Seconds\n\nq,a,b,,,b,10\n\n`);
    expect(r.errors).toEqual([]);
    expect(r.questions).toHaveLength(1);
  });

  it("reports a missing header column", () => {
    const r = parseQuiz("question,option_a,option_b\nq,a,b");
    expect(r.questions).toEqual([]);
    expect(r.errors[0]).toMatch(/correct/);
  });

  it("reports row-level errors with the row number", () => {
    const r = parseQuiz(
      [
        header,
        ",a,b,,,A,10", // row 2: empty question
        "q,a,,,,A,10", // row 3: fewer than 2 options
        "q,a,b,,d,A,10", // row 4: gap in options
        "q,a,b,,,C,10", // row 5: correct points to missing option
        "q,a,b,,,Z,10", // row 6: bad correct
        "q,a,b,,,A,1", // row 7: seconds too small
        "q,a,b,,,A,abc", // row 8: seconds not a number
      ].join("\n"),
    );
    expect(r.questions).toEqual([]);
    expect(r.errors).toHaveLength(7);
    for (let row = 2; row <= 8; row++) {
      expect(r.errors.some((e) => e.includes(`แถว ${row}`))).toBe(true);
    }
  });

  it("rejects a file with no questions", () => {
    const r = parseQuiz(header);
    expect(r.questions).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
