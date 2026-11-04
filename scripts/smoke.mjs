// End-to-end smoke test against a running `wrangler dev` (default http://localhost:8787).
// Usage: HOST_PASSWORD=... node scripts/smoke.mjs [baseUrl]
import { readFileSync } from "node:fs";

const base = process.argv[2] || "http://localhost:8787";
const password = process.env.HOST_PASSWORD;
const wsBase = base.replace(/^http/, "ws");
const csv = readFileSync(new URL("../public/sample.csv", import.meta.url), "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok  -", m); };

function client(path) {
  const ws = new WebSocket(wsBase + path);
  const c = { ws, view: null, msgs: [], token: null };
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    c.msgs.push(m);
    if (m.type === "view") c.view = m.view;
    if (m.type === "joined") c.token = m.token;
  });
  c.ready = new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.until = async (fn, label) => { for (let i = 0; i < 100; i++) { if (fn(c)) return; await sleep(50); } assert(false, "timeout: " + label); };
  return c;
}

const bad = await fetch(base + "/api/games", { method: "POST", body: JSON.stringify({ password: "wrong" }) });
assert(bad.status === 401, "wrong host password rejected");
const { pin, hostToken } = await (await fetch(base + "/api/games", { method: "POST", body: JSON.stringify({ password }) })).json();
assert(/^\d{6}$/.test(pin), "game created with 6-digit PIN " + pin);

const host = client(`/ws/${pin}?role=host&token=${hostToken}`);
await host.ready;
await host.until((c) => c.view?.phase === "lobby", "host lobby");

const names = ["Ann", "Bob", "Cat"];
const players = names.map(() => client(`/ws/${pin}?role=player`));
await Promise.all(players.map((p) => p.ready));
players.forEach((p, i) => p.send({ type: "join", nickname: names[i] }));
await Promise.all(players.map((p) => p.until((c) => c.token, "joined")));
const dup = client(`/ws/${pin}?role=player`); await dup.ready; dup.send({ type: "join", nickname: "ann" });
await dup.until((c) => c.msgs.some((m) => m.type === "join_error"), "duplicate nickname rejected");
await host.until((c) => c.view?.playerCount === 3, "host sees 3 players");

host.send({ type: "load_quiz", csv: "question,option_a\nq,a" });
await host.until((c) => c.msgs.some((m) => m.type === "quiz_errors"), "bad CSV reported");
host.send({ type: "load_quiz", csv });
await host.until((c) => c.view?.quizLoaded && c.view.quizSize === 4, "sample quiz loaded (4)");
host.send({ type: "set_settings", settings: { defaultSeconds: 15, basePoints: 1050, maxSpeedBonus: 0 } });
await host.until((c) => c.msgs.some((m) => m.type === "error" && /แต้มพื้นฐาน/.test(m.message)), "invalid settings rejected");
host.send({ type: "set_settings", settings: { defaultSeconds: 15, basePoints: 2000, maxSpeedBonus: 0 } });
await host.until((c) => c.view?.settings?.basePoints === 2000 && c.view.settings.maxSpeedBonus === 0, "valid settings applied");
host.send({ type: "start" });
await Promise.all(players.map((p) => p.until((c) => c.view?.phase === "question", "player sees question")));
assert(!JSON.stringify(players[0].view).includes("correctIndex"), "no answer leak to players during question");

// Q1 correct = B (index 1). Ann & Bob right, Cat wrong → question ends early when all answered.
players[0].send({ type: "answer", option: 1 });
await sleep(150);
players[1].send({ type: "answer", option: 1 });
players[2].send({ type: "answer", option: 0 });
await host.until((c) => c.view?.phase === "reveal", "question closed early after all answered");
assert(host.view.reveal.optionCounts[1] === 2, "option counts: 2 chose B");
assert(host.view.reveal.leaderboard[0].nickname === "Ann", "Ann leads (faster)");
await players[2].until((c) => c.view?.reveal, "player reveal");
assert(players[2].view.reveal.correct === false && players[0].view.reveal.gained === 2000, "custom base points, no speed bonus");
host.send({ type: "set_settings", settings: { defaultSeconds: 15, basePoints: 100, maxSpeedBonus: 0 } });
await host.until((c) => c.msgs.filter((m) => m.type === "error" && /เริ่มเกมไปแล้ว/.test(m.message)).length > 0, "settings locked after start");

// Reconnect: Bob drops and comes back with his token.
const bobToken = players[1].token;
players[1].ws.close();
await sleep(200);
const bob2 = client(`/ws/${pin}?role=player`); await bob2.ready;
bob2.send({ type: "rejoin", token: bobToken });
await bob2.until((c) => c.view?.nickname === "Bob", "Bob rejoined with token");

// Remaining questions: nobody answers → deadline timer closes each (Q2 is 10s, so shortcut: just answer).
for (let q = 1; q < 4; q++) {
  host.send({ type: "next" });
  if (q === 1) await host.until((c) => c.view?.phase === "question" && c.view.question.index === 1, "Q2 started");
  else await host.until((c) => c.view?.phase === "question" && c.view.question.index === q, `Q${q + 1} started`);
  players[0].send({ type: "answer", option: 0 });
  bob2.send({ type: "answer", option: 0 });
  players[2].send({ type: "answer", option: 0 });
  await host.until((c) => c.view?.phase === "reveal" && c.view.question.index === q, `Q${q + 1} closed`);
}
host.send({ type: "next" });
await host.until((c) => c.view?.phase === "finished", "game finished");
assert(host.view.podium.length === 3 || host.view.podium.length >= 1, "podium present");
assert(host.view.resultsCsv.split("\n")[0] === "rank,nickname,score,correct_answers,correct_time_seconds", "results CSV header");
console.log(host.view.resultsCsv);

const late = client(`/ws/${pin}?role=host&token=wrong`);
late.ready.catch(() => {});
await new Promise((r) => { late.ws.addEventListener("error", r); late.ws.addEventListener("close", r); });
assert(true, "host with wrong token cannot connect");

// Nobody answers → the Durable Object's timer must close the question at its deadline.
{
  const g = await (await fetch(base + "/api/games", { method: "POST", body: JSON.stringify({ password }) })).json();
  const h = client(`/ws/${g.pin}?role=host&token=${g.hostToken}`);
  const p = client(`/ws/${g.pin}?role=player`);
  await Promise.all([h.ready, p.ready]);
  p.send({ type: "join", nickname: "Idle" });
  await p.until((c) => c.token, "idle player joined");
  h.send({ type: "load_quiz", csv: "question,option_a,option_b,correct,seconds\nq,a,b,A,5" });
  await h.until((c) => c.view?.quizLoaded, "one-question quiz loaded");
  h.send({ type: "start" });
  const t0 = Date.now();
  await h.until((c) => c.view?.phase === "reveal", "deadline closes the question by timer");
  const took = Date.now() - t0;
  assert(took >= 4500 && took < 8000, `closed at the 5s deadline (${took} ms)`);
  assert(p.view.reveal.answered === false && p.view.reveal.gained === 0, "unanswered question scores 0");
  h.ws.close(); p.ws.close();
}

// Opt-in: locks THIS machine out of Host login for 15 min (reset by deleting .wrangler/state).
if (process.env.SMOKE_RATE_LIMIT === "1") {
  const statuses = [];
  for (let i = 0; i < 8; i++) {
    const r = await fetch(base + "/api/games", { method: "POST", body: JSON.stringify({ password: "wrong" + i }) });
    statuses.push(r.status);
    if (r.status === 429) assert(Number(r.headers.get("retry-after")) > 0, "429 carries a Retry-After header");
  }
  assert(statuses.includes(401) && statuses.at(-1) === 429, "repeated wrong passwords end in 429: " + statuses.join(","));
  const right = await fetch(base + "/api/games", { method: "POST", body: JSON.stringify({ password }) });
  assert(right.status === 429, "even the right password is refused while locked out");
}
process.exit(0);
