// Simulates N phones playing one full Game against a running server, with an auto-advancing Host.
// Usage: HOST_PASSWORD=... node scripts/load.mjs [baseUrl=http://localhost:8787] [players=20]
// Exits non-zero if any invariant fails. Uses 1 successful Host login.
const base = process.argv[2] || "http://localhost:8787";
const N = Number(process.argv[3] || 20);
const password = process.env.HOST_PASSWORD;
const wsBase = base.replace(/^http/, "ws");

const CORRECT = [1, 0, 2, 1, 0]; // correct option per question (3 options each)
const SECONDS = 12;
const csv =
  "question,option_a,option_b,option_c,correct,seconds\n" +
  CORRECT.map((c, i) => `Question ${i + 1},A,B,C,${"ABC"[c]},${SECONDS}`).join("\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : NaN);
const stats = (xs) => `n=${xs.length} p50=${pct(xs, 50).toFixed(0)}ms p95=${pct(xs, 95).toFixed(0)}ms max=${Math.max(...xs).toFixed(0)}ms`;
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

const metrics = { join: [], broadcast: [[], [], [], [], []], ack: [], errors: [], rejoins: 0 };
let hostCmdAt = 0; // when the Host last sent start/next

class Bot {
  constructor(i) {
    this.i = i;
    this.name = `Bot${String(i + 1).padStart(2, "0")}`;
    this.skill = rand(0.4, 0.9);
    this.token = null;
    this.gained = []; // per question
    this.final = null;
    this.answeredQ = new Set();
    this.seenQ = new Set();
    this.dropsAtQ = i < 2 ? 1 : -1; // first two phones lose connection during question 2
    this.skipQ = i >= 2 && i < 4 ? 2 : -1; // next two never answer question 3
    this.sentAt = 0;
  }
  connect(firstMessage) {
    this.ws = new WebSocket(`${wsBase}/ws/${pin}?role=player`);
    this.ready = new Promise((res) => (this.ws.onopen = () => { this.ws.send(JSON.stringify(firstMessage)); res(); }));
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    this.ws.onerror = () => {};
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  onMessage(m) {
    if (m.type === "joined") { this.token = m.token; this.joinedAt = Date.now(); }
    else if (m.type === "error") metrics.errors.push(`${this.name}: ${m.message}`);
    else if (m.type === "join_error") metrics.errors.push(`${this.name} join: ${m.message}`);
    else if (m.type === "view") this.onView(m.view);
  }
  onView(v) {
    this.view = v;
    if (v.phase === "question") {
      const q = v.question.index;
      if (!this.seenQ.has(q)) {
        this.seenQ.add(q);
        metrics.broadcast[q].push(Date.now() - hostCmdAt);
        if (q === this.dropsAtQ) return this.dropAndRejoin(q);
        if (q !== this.skipQ) this.scheduleAnswer(q, v);
      }
      if (v.answered && this.sentAt) { metrics.ack.push(Date.now() - this.sentAt); this.sentAt = 0; }
    } else if (v.phase === "reveal") {
      const r = v.reveal;
      this.gained[v.question.index] = r.gained;
      this.lastReveal = { q: v.question.index, ...r, chosen: v.chosen };
    } else if (v.phase === "finished") {
      this.final = v.final;
    }
  }
  scheduleAnswer(q, v, delay = rand(300, 7000)) {
    const correct = Math.random() < this.skill;
    const wrong = [0, 1, 2].filter((o) => o !== CORRECT[q]);
    const option = correct ? CORRECT[q] : wrong[Math.floor(Math.random() * wrong.length)];
    setTimeout(() => {
      if (this.answeredQ.has(q) || this.ws.readyState !== 1) return;
      this.answeredQ.add(q);
      this.sentAt = Date.now();
      this.send({ type: "answer", option });
    }, delay);
  }
  async dropAndRejoin(q) {
    this.ws.close();
    await sleep(2500);
    metrics.rejoins++;
    this.connect({ type: "rejoin", token: this.token });
    await this.ready;
  }
}

if (!password && /localhost|127\.0\.0\.1/.test(base) === false) { console.error("Set HOST_PASSWORD"); process.exit(2); }
const created = await (await fetch(base + "/api/games", { method: "POST", body: JSON.stringify({ password: password || "dev-host-secret" }) })).json();
if (!created.pin) { console.error("Could not create game:", created); process.exit(2); }
const pin = created.pin;
console.log(`Game ${pin} on ${base} with ${N} simulated phones`);

// Host: auto-advance
const host = new WebSocket(`${wsBase}/ws/${pin}?role=host&token=${created.hostToken}`);
let hostView = null;
let advancing = false;
host.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type !== "view") return;
  hostView = m.view;
  if (m.view.phase === "reveal" && !advancing) {
    advancing = true;
    setTimeout(() => { hostCmdAt = Date.now(); advancing = false; host.send(JSON.stringify({ type: "next" })); }, 1500);
  }
};
await new Promise((r) => (host.onopen = r));
host.send(JSON.stringify({ type: "load_quiz", csv }));
for (let i = 0; i < 50 && !hostView?.quizLoaded; i++) await sleep(100);
check(hostView?.quizLoaded, "quiz loaded");

// All phones join at once (worst case)
const bots = Array.from({ length: N }, (_, i) => new Bot(i));
const t0 = Date.now();
bots.forEach((b) => { b.connect({ type: "join", nickname: b.name }); });
for (let i = 0; i < 100 && bots.some((b) => !b.token); i++) await sleep(100);
bots.forEach((b) => b.joinedAt && metrics.join.push(b.joinedAt - t0));
check(bots.every((b) => b.token), "all phones joined");
for (let i = 0; i < 50 && hostView?.playerCount !== N; i++) await sleep(100);
check(hostView?.playerCount === N, `host sees ${N} players (saw ${hostView?.playerCount})`);

// A latecomer must be refused once the game has started
hostCmdAt = Date.now();
host.send(JSON.stringify({ type: "start" }));

// Wait for the end
const deadline = Date.now() + 4 * 60_000;
while (hostView?.phase !== "finished" && Date.now() < deadline) await sleep(250);
check(hostView?.phase === "finished", "game reached the end");
await sleep(800);

const late = new WebSocket(`${wsBase}/ws/${pin}?role=player`);
let lateMsg = null;
late.onopen = () => late.send(JSON.stringify({ type: "join", nickname: "Latecomer" }));
late.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "join_error") lateMsg = m.message; };
await sleep(800);
check(lateMsg, "a player joining after the game has started is refused");

// ---- invariants ----
const base_ = 1000, maxBonus = 500; // default settings
for (const b of bots) {
  check(b.final, `${b.name} received the final screen`);
  const total = b.gained.reduce((s, g) => s + (g || 0), 0);
  if (b.final) check(b.final.score === total, `${b.name}: final score ${b.final.score} equals the sum of per-question points ${total}`);
  for (let q = 0; q < CORRECT.length; q++) {
    const g = b.gained[q];
    if (g === undefined) { check(b.i < 2 && q === 1, `${b.name} got no reveal for Q${q + 1}`); continue; }
    check(g === 0 || (g >= base_ && g <= base_ + maxBonus), `${b.name} Q${q + 1}: points ${g} are 0 or within ${base_}-${base_ + maxBonus}`);
  }
}
for (const q of [1, 2]) check(bots.filter((b) => b.skipQ === q || b.dropsAtQ === q).every((b) => (b.gained[q] || 0) === 0), `phones that didn't answer Q${q + 1} scored 0 on it`);

const rows = hostView.resultsCsv.trim().split("\n").slice(1).map((l) => l.split(","));
check(rows.length === N, `results CSV lists all ${N} players (has ${rows.length})`);
for (const [rank, name, score] of rows) {
  const b = bots.find((x) => x.name === name);
  check(b && b.final && Number(score) === b.final.score && Number(rank) === b.final.rank, `${name}: CSV (${rank}, ${score}) matches the phone (${b?.final?.rank}, ${b?.final?.score})`);
}
const scores = rows.map((r) => Number(r[2]));
check(scores.every((s, i) => i === 0 || scores[i - 1] >= s), "results are sorted by score, highest first");
check(hostView.podium.length >= 5 && hostView.podium[0].rank === 1, "podium has the top 5 and starts at rank 1");
check(metrics.rejoins === 2, `2 phones reconnected (${metrics.rejoins})`);
check(bots.slice(0, 2).every((b) => b.final), "reconnected phones reached the final screen");
check(metrics.errors.length === 0, `no unexpected server errors (${metrics.errors.slice(0, 3).join("; ")})`);

console.log("\nLatency (client-measured, includes network):");
console.log("  join (all at once): " + stats(metrics.join));
metrics.broadcast.forEach((xs, q) => console.log(`  question ${q + 1} reaches phones: ${stats(xs)}`));
console.log("  answer → confirmation: " + stats(metrics.ack));
console.log(`\nTop 3: ${rows.slice(0, 3).map((r) => `${r[1]} ${r[2]}`).join(", ")}`);
console.log(failures.length ? `\nFAILED (${failures.length}):\n - ${failures.join("\n - ")}` : "\nAll checks passed.");
host.close();
bots.forEach((b) => b.ws.close());
process.exit(failures.length ? 1 : 0);
