import type { Question } from "./types";

export const MIN_SECONDS = 5;
export const MAX_SECONDS = 120;
export const MAX_QUESTIONS = 100;

export interface ParseResult {
  questions: Question[];
  errors: string[];
}

/** RFC 4180-style parser. Returns one array of fields per record. */
function parseRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += c;
    }
    i++;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

function parseCorrect(raw: string): number | null {
  const v = raw.trim().toUpperCase();
  if (/^[A-D]$/.test(v)) return v.charCodeAt(0) - 65;
  if (/^[1-4]$/.test(v)) return Number(v) - 1;
  return null;
}

export function parseQuiz(text: string): ParseResult {
  const records = parseRecords(text.replace(/^﻿/, ""));
  const errors: string[] = [];

  if (records.length === 0) {
    return { questions: [], errors: ["ไฟล์ว่างเปล่า"] };
  }

  const header = records[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const required = ["question", "option_a", "option_b", "correct"];
  const missing = required.filter((n) => col(n) === -1);
  if (missing.length > 0) {
    return { questions: [], errors: [`หัวตารางขาดคอลัมน์: ${missing.join(", ")}`] };
  }
  const optCols = ["option_a", "option_b", "option_c", "option_d"].map(col);
  const textCol = col("question");
  const correctCol = col("correct");
  const secondsCol = col("seconds");

  const questions: Question[] = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.every((f) => f.trim() === "")) continue;
    const row = r + 1; // 1-based, header is row 1
    const problems: string[] = [];
    const get = (c: number) => (c >= 0 && c < rec.length ? rec[c].trim() : "");

    const qText = get(textCol);
    if (qText === "") problems.push("ไม่มีคำถาม");

    const opts4 = optCols.map((c) => get(c));
    let count = 0;
    while (count < 4 && opts4[count] !== "") count++;
    const options = opts4.slice(0, count);
    if (opts4.slice(count).some((o) => o !== "")) {
      problems.push("ตัวเลือกต้องเรียงต่อกันจาก A โดยไม่เว้นช่อง");
    } else if (count < 2) {
      problems.push("ต้องมีตัวเลือกอย่างน้อย 2 ข้อ");
    }

    const correct = parseCorrect(get(correctCol));
    if (correct === null) {
      problems.push("คอลัมน์ correct ต้องเป็น A-D หรือ 1-4");
    } else if (count >= 2 && correct >= count) {
      problems.push("คำตอบที่ถูกชี้ไปยังตัวเลือกที่ไม่มี");
    }

    let seconds: number | null = null;
    const rawSeconds = get(secondsCol);
    if (rawSeconds !== "") {
      const n = Number(rawSeconds);
      if (!Number.isInteger(n)) {
        problems.push("seconds ต้องเป็นจำนวนเต็ม");
      } else if (n < MIN_SECONDS || n > MAX_SECONDS) {
        problems.push(`seconds ต้องอยู่ระหว่าง ${MIN_SECONDS}-${MAX_SECONDS}`);
      } else {
        seconds = n;
      }
    }

    if (problems.length > 0) {
      for (const p of problems) errors.push(`แถว ${row}: ${p}`);
    } else {
      questions.push({ text: qText, options, correct: correct as number, seconds });
    }
  }

  if (errors.length === 0 && questions.length === 0) {
    errors.push("ไม่พบคำถามในไฟล์");
  }
  if (questions.length > MAX_QUESTIONS) {
    errors.push(`มีคำถามได้ไม่เกิน ${MAX_QUESTIONS} ข้อ`);
  }
  return errors.length > 0 ? { questions: [], errors } : { questions, errors };
}
