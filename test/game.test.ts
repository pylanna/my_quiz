import { describe, expect, it } from "vitest";
import { Game } from "../src/core/game";
import type { Question } from "../src/core/types";

const qs: Question[] = [
  { text: "Q1", options: ["a", "b", "c"], correct: 1, seconds: 10 },
  { text: "Q2", options: ["x", "y"], correct: 0, seconds: 10 },
];

function setup(names: string[] = ["Ann", "Bob"]) {
  const g = new Game();
  g.loadQuiz(qs);
  const ids = names.map((n) => {
    const r = g.join(n);
    if (!r.ok) throw new Error(r.error);
    return r.playerId;
  });
  return { g, ids };
}

describe("lobby", () => {
  it("rejects duplicate nicknames case-insensitively and blank/long names", () => {
    const g = new Game();
    expect(g.join("Mon").ok).toBe(true);
    expect(g.join(" mon ").ok).toBe(false);
    expect(g.join("   ").ok).toBe(false);
    expect(g.join("x".repeat(21)).ok).toBe(false);
  });

  it("cannot start without a quiz or without players", () => {
    const g = new Game();
    expect(g.start(0).ok).toBe(false);
    g.loadQuiz(qs);
    expect(g.start(0).ok).toBe(false);
    g.join("A");
    expect(g.start(0).ok).toBe(true);
  });

  it("closes joining once started, but a token can reconnect", () => {
    const { g } = setup(["Ann"]);
    const first = g.join("Zed");
    expect(first.ok).toBe(true);
    g.start(0);
    expect(g.join("Late").ok).toBe(false);
    const ann = [...g.players.values()][0];
    const re = g.rejoin(ann.token);
    expect(re.ok && re.playerId).toBe(ann.id);
  });

  it("cannot reload the quiz after start", () => {
    const { g } = setup();
    g.start(0);
    expect(g.loadQuiz(qs).ok).toBe(false);
  });
});

describe("settings", () => {
  it("applies the default seconds to questions without their own limit, and keeps explicit ones", () => {
    const g = new Game();
    g.loadQuiz([
      { text: "A", options: ["x", "y"], correct: 0, seconds: null },
      { text: "B", options: ["x", "y"], correct: 0, seconds: 30 },
    ]);
    g.join("p");
    expect(g.setSettings({ defaultSeconds: 45, basePoints: 1000, maxSpeedBonus: 500 }).ok).toBe(true);
    g.start(1000);
    expect(g.deadline).toBe(1000 + 45_000);
    expect((g.hostView(1000) as any).question.seconds).toBe(45);
    g.closeQuestion(2000);
    g.next(2000);
    expect(g.deadline).toBe(2000 + 30_000);
  });

  it("changing the default after loading the quiz still takes effect", () => {
    const g = new Game();
    g.loadQuiz([{ text: "A", options: ["x", "y"], correct: 0, seconds: null }]);
    g.join("p");
    g.setSettings({ defaultSeconds: 60, basePoints: 1000, maxSpeedBonus: 500 });
    g.start(0);
    expect(g.deadline).toBe(60_000);
  });

  it("uses custom points when scoring", () => {
    const g = new Game();
    g.loadQuiz(qs);
    const id = (g.join("p") as any).playerId;
    g.setSettings({ defaultSeconds: 20, basePoints: 2000, maxSpeedBonus: 0 });
    g.start(0);
    g.submitAnswer(id, 1, 0);
    g.closeQuestion(10_000);
    expect(g.players.get(id)!.score).toBe(2000);
  });

  it("rejects invalid settings and locks them once the game starts", () => {
    const { g } = setup();
    expect(g.setSettings({ defaultSeconds: 1, basePoints: 1000, maxSpeedBonus: 0 } as any).ok).toBe(false);
    g.start(0);
    expect(g.setSettings({ defaultSeconds: 20, basePoints: 1000, maxSpeedBonus: 0 }).ok).toBe(false);
  });

  it("exposes the settings to the host in the lobby", () => {
    const g = new Game();
    expect((g.hostView(0) as any).settings).toEqual({ defaultSeconds: 20, basePoints: 1000, maxSpeedBonus: 500 });
  });
});

describe("answering", () => {
  it("scores a correct answer with a speed bonus and ignores late/duplicate ones", () => {
    const { g, ids } = setup();
    g.start(1000);
    expect(g.phase).toBe("question");
    expect(g.submitAnswer(ids[0], 1, 1000).ok).toBe(true); // instant
    expect(g.submitAnswer(ids[0], 0, 1500).ok).toBe(false); // duplicate
    expect(g.submitAnswer(ids[1], 1, 11_001).ok).toBe(false); // after 10s deadline
    g.closeQuestion(11_001);
    expect(g.players.get(ids[0])!.score).toBe(1500);
    expect(g.players.get(ids[1])!.score).toBe(0);
  });

  it("rejects out-of-range option", () => {
    const { g, ids } = setup();
    g.start(0);
    expect(g.submitAnswer(ids[0], 3, 10).ok).toBe(false);
    expect(g.submitAnswer(ids[0], -1, 10).ok).toBe(false);
  });

  it("reports allAnswered only counting connected players", () => {
    const { g, ids } = setup();
    g.start(0);
    g.submitAnswer(ids[0], 1, 100);
    expect(g.allAnswered()).toBe(false);
    g.setConnected(ids[1], false);
    expect(g.allAnswered()).toBe(true);
  });

  it("does not leak the correct option before reveal", () => {
    const { g, ids } = setup();
    g.start(0);
    const pv = JSON.stringify(g.playerView(ids[0], 0));
    expect(pv).not.toContain("correctIndex");
    const hv = JSON.stringify(g.hostView(0));
    expect(hv).not.toContain("correctIndex");
  });
});

describe("flow", () => {
  it("question → reveal → next question → finished", () => {
    const { g, ids } = setup();
    g.start(0);
    g.submitAnswer(ids[0], 1, 0);
    g.closeQuestion(10_000);
    expect(g.phase).toBe("reveal");
    expect(g.next(10_000).ok).toBe(true);
    expect(g.phase).toBe("question");
    expect(g.questionIndex).toBe(1);
    g.closeQuestion(20_000);
    expect(g.phase).toBe("reveal");
    g.next(20_000);
    expect(g.phase).toBe("finished");
  });

  it("closeQuestion is a no-op outside the question phase", () => {
    const { g } = setup();
    expect(g.closeQuestion(0).ok).toBe(false);
  });

  it("reveal view includes correct option, per-option counts and top 5", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const { g, ids } = setup(names);
    g.start(0);
    ids.forEach((id, i) => g.submitAnswer(id, i % 2 === 0 ? 1 : 0, i * 100));
    g.closeQuestion(5000);
    const hv = g.hostView(5000) as any;
    expect(hv.reveal.correctIndex).toBe(1);
    expect(hv.reveal.optionCounts).toEqual([3, 4, 0]);
    expect(hv.reveal.leaderboard.map((p: any) => p.nickname)).toEqual(["a", "c", "e", "g"]); // zero-score players hidden
    const pv = g.playerView(ids[1], 5000) as any;
    expect(pv.reveal.correct).toBe(false);
    expect(pv.reveal.gained).toBe(0);
    const pa = g.playerView(ids[0], 5000) as any;
    expect(pa.reveal.correct).toBe(true);
    expect(pa.reveal.gained).toBe(1500);
    expect(pa.reveal.rank).toBe(1);
  });

  it("shows at most 5 on the host leaderboard", () => {
    const { g, ids } = setup(["a", "b", "c", "d", "e", "f", "g"]);
    g.start(0);
    ids.forEach((id, i) => g.submitAnswer(id, 1, i * 100));
    g.closeQuestion(5000);
    const hv = g.hostView(5000) as any;
    expect(hv.reveal.leaderboard).toHaveLength(5);
    expect(hv.reveal.leaderboard.map((p: any) => p.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("finished view has podium and a results CSV", () => {
    const { g, ids } = setup();
    g.start(0);
    g.submitAnswer(ids[0], 1, 0);
    g.closeQuestion(10_000);
    g.next(10_000);
    g.closeQuestion(20_000);
    g.next(20_000);
    const hv = g.hostView(20_000) as any;
    expect(hv.phase).toBe("finished");
    expect(hv.podium[0].nickname).toBe("Ann");
    expect(hv.podium[0].score).toBe(1500);
    expect(hv.resultsCsv.startsWith("rank,nickname,score")).toBe(true);
  });

  it("tie-break uses total time on correct answers", () => {
    const { g, ids } = setup();
    g.start(0);
    g.submitAnswer(ids[0], 1, 5000);
    g.submitAnswer(ids[1], 1, 5000);
    g.closeQuestion(10_000);
    const hv = g.hostView(10_000) as any;
    expect(hv.reveal.leaderboard.map((p: any) => p.rank)).toEqual([1, 1]);
  });
});
