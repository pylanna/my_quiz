import { resultsToCsv } from "./results";
import { rankPlayers, scoreAnswer, topRanks } from "./scoring";
import { DEFAULT_SETTINGS, validateSettings, type GameSettings } from "./settings";
import type { Question } from "./types";

export type Phase = "lobby" | "question" | "reveal" | "finished";
export type Result = { ok: true } | { ok: false; error: string };
export type JoinResult = { ok: true; playerId: string; token: string } | { ok: false; error: string };

export const MAX_NICKNAME = 20;
export const MAX_PLAYERS = 100;
export const BOARD_SIZE = 5;

export interface Player {
  id: string;
  token: string;
  nickname: string;
  score: number;
  correctCount: number;
  correctTimeMs: number;
  connected: boolean;
  lastGained: number;
  lastCorrect: boolean;
  lastAnswered: boolean;
}

interface Answer {
  option: number;
  elapsedMs: number;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Pure game state machine. Time is always passed in; nothing here touches I/O. */
export class Game {
  phase: Phase = "lobby";
  quiz: Question[] = [];
  settings: GameSettings = { ...DEFAULT_SETTINGS };
  players = new Map<string, Player>();
  questionIndex = -1;
  questionStartedAt = 0;
  deadline = 0;
  private answers = new Map<string, Answer>();
  private optionCounts: number[] = [];

  loadQuiz(questions: Question[]): Result {
    if (this.phase !== "lobby") return fail("เริ่มเกมไปแล้ว โหลดข้อสอบใหม่ไม่ได้");
    if (questions.length === 0) return fail("ไม่มีคำถาม");
    this.quiz = questions;
    return { ok: true };
  }

  setSettings(raw: unknown): Result {
    if (this.phase !== "lobby") return fail("เริ่มเกมไปแล้ว เปลี่ยนการตั้งค่าไม่ได้");
    const v = validateSettings(raw);
    if (!v.ok) return fail(v.error);
    this.settings = v.settings;
    return { ok: true };
  }

  private secondsFor(q: Question): number {
    return q.seconds ?? this.settings.defaultSeconds;
  }

  join(nickname: string): JoinResult {
    if (this.phase !== "lobby") return fail("เกมเริ่มไปแล้ว");
    const name = nickname.trim();
    if (name === "") return fail("กรุณาใส่ชื่อเล่น");
    if ([...name].length > MAX_NICKNAME) return fail(`ชื่อเล่นยาวเกิน ${MAX_NICKNAME} ตัวอักษร`);
    const key = name.toLowerCase();
    for (const p of this.players.values()) {
      if (p.nickname.toLowerCase() === key) return fail("ชื่อนี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น");
    }
    if (this.players.size >= MAX_PLAYERS) return fail("ห้องเต็มแล้ว");
    const player: Player = {
      id: crypto.randomUUID(),
      token: crypto.randomUUID(),
      nickname: name,
      score: 0,
      correctCount: 0,
      correctTimeMs: 0,
      connected: true,
      lastGained: 0,
      lastCorrect: false,
      lastAnswered: false,
    };
    this.players.set(player.id, player);
    return { ok: true, playerId: player.id, token: player.token };
  }

  rejoin(token: string): JoinResult {
    for (const p of this.players.values()) {
      if (p.token === token) return { ok: true, playerId: p.id, token: p.token };
    }
    return fail("ไม่พบผู้เล่นนี้ในเกม");
  }

  setConnected(playerId: string, connected: boolean): void {
    const p = this.players.get(playerId);
    if (p) p.connected = connected;
  }

  start(now: number): Result {
    if (this.phase !== "lobby") return fail("เกมเริ่มไปแล้ว");
    if (this.quiz.length === 0) return fail("ยังไม่ได้นำเข้าข้อสอบ");
    if (this.players.size === 0) return fail("ยังไม่มีผู้เล่น");
    this.questionIndex = 0;
    this.beginQuestion(now);
    return { ok: true };
  }

  private beginQuestion(now: number): void {
    const q = this.quiz[this.questionIndex];
    this.phase = "question";
    this.questionStartedAt = now;
    this.deadline = now + this.secondsFor(q) * 1000;
    this.answers = new Map();
    this.optionCounts = q.options.map(() => 0);
    for (const p of this.players.values()) {
      p.lastGained = 0;
      p.lastCorrect = false;
      p.lastAnswered = false;
    }
  }

  submitAnswer(playerId: string, option: number, now: number): Result {
    if (this.phase !== "question") return fail("ไม่ได้อยู่ในช่วงตอบคำถาม");
    if (!this.players.has(playerId)) return fail("ไม่พบผู้เล่น");
    if (now > this.deadline) return fail("หมดเวลาแล้ว");
    const q = this.quiz[this.questionIndex];
    if (!Number.isInteger(option) || option < 0 || option >= q.options.length) return fail("ตัวเลือกไม่ถูกต้อง");
    if (this.answers.has(playerId)) return fail("ตอบไปแล้ว");
    this.answers.set(playerId, { option, elapsedMs: now - this.questionStartedAt });
    return { ok: true };
  }

  answeredCount(): number {
    return this.answers.size;
  }

  /** True when at least one player is connected and every connected player has answered. */
  allAnswered(): boolean {
    let connected = 0;
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      connected++;
      if (!this.answers.has(p.id)) return false;
    }
    return connected > 0;
  }

  closeQuestion(_now: number): Result {
    if (this.phase !== "question") return fail("ไม่ได้อยู่ในช่วงตอบคำถาม");
    const q = this.quiz[this.questionIndex];
    const limitMs = this.secondsFor(q) * 1000;
    for (const [id, a] of this.answers) {
      const p = this.players.get(id)!;
      const correct = a.option === q.correct;
      this.optionCounts[a.option]++;
      p.lastAnswered = true;
      p.lastCorrect = correct;
      p.lastGained = scoreAnswer({
        correct,
        elapsedMs: a.elapsedMs,
        limitMs,
        basePoints: this.settings.basePoints,
        maxSpeedBonus: this.settings.maxSpeedBonus,
      });
      p.score += p.lastGained;
      if (correct) {
        p.correctCount++;
        p.correctTimeMs += a.elapsedMs;
      }
    }
    this.phase = "reveal";
    return { ok: true };
  }

  next(now: number): Result {
    if (this.phase !== "reveal") return fail("ยังไปข้อถัดไปไม่ได้");
    if (this.questionIndex + 1 < this.quiz.length) {
      this.questionIndex++;
      this.beginQuestion(now);
    } else {
      this.phase = "finished";
    }
    return { ok: true };
  }

  private ranked() {
    return rankPlayers([...this.players.values()]);
  }

  /** Top of the Leaderboard: at most BOARD_SIZE (plus ties); players with no points are never shown. */
  private board() {
    return topRanks(this.ranked().filter((p) => p.score > 0), BOARD_SIZE);
  }

  private currentQuestionView() {
    const q = this.quiz[this.questionIndex];
    return {
      index: this.questionIndex,
      total: this.quiz.length,
      text: q.text,
      options: q.options,
      seconds: this.secondsFor(q),
    };
  }

  hostView(now: number): Record<string, unknown> {
    const base: Record<string, unknown> = {
      phase: this.phase,
      serverNow: now,
      playerCount: this.players.size,
      quizLoaded: this.quiz.length > 0,
      quizSize: this.quiz.length,
    };
    if (this.phase === "lobby") {
      base.players = [...this.players.values()].map((p) => p.nickname);
      base.settings = this.settings;
      return base;
    }
    if (this.phase === "question" || this.phase === "reveal") {
      base.question = this.currentQuestionView();
      base.deadline = this.deadline;
      base.answeredCount = this.answers.size;
    }
    if (this.phase === "reveal") {
      const q = this.quiz[this.questionIndex];
      base.reveal = {
        correctIndex: q.correct,
        optionCounts: this.optionCounts,
        leaderboard: this.board().map((p) => ({
          rank: p.rank,
          nickname: p.nickname,
          score: p.score,
        })),
        isLast: this.questionIndex + 1 >= this.quiz.length,
      };
    }
    if (this.phase === "finished") {
      const ranked = this.ranked();
      base.podium = this.board().map((p) => ({ rank: p.rank, nickname: p.nickname, score: p.score }));
      base.resultsCsv = resultsToCsv(
        ranked.map((p) => ({
          rank: p.rank,
          nickname: p.nickname,
          score: p.score,
          correctCount: p.correctCount,
          correctTimeMs: p.correctTimeMs,
        })),
      );
    }
    return base;
  }

  playerView(playerId: string, now: number): Record<string, unknown> {
    const p = this.players.get(playerId);
    if (!p) return { phase: "unknown" };
    const base: Record<string, unknown> = { phase: this.phase, serverNow: now, nickname: p.nickname };
    if (this.phase === "lobby") {
      base.playerCount = this.players.size;
      return base;
    }
    if (this.phase === "question" || this.phase === "reveal") {
      base.question = this.currentQuestionView();
      base.deadline = this.deadline;
      base.answered = this.answers.has(playerId);
      base.chosen = this.answers.get(playerId)?.option ?? null;
    }
    const me = this.ranked().find((r) => r.id === playerId)!;
    if (this.phase === "reveal") {
      base.reveal = {
        correctIndex: this.quiz[this.questionIndex].correct,
        correct: p.lastCorrect,
        answered: p.lastAnswered,
        gained: p.lastGained,
        score: p.score,
        rank: me.rank,
      };
    }
    if (this.phase === "finished") {
      base.final = { score: p.score, rank: me.rank, playerCount: this.players.size };
      base.podium = this.board().map((r) => ({ rank: r.rank, nickname: r.nickname, score: r.score }));
    }
    return base;
  }
}
