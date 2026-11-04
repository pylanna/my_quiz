(() => {
  const { el, optionButton, countdown, connect } = QZ;
  const app = document.getElementById("app");
  const KEY = "quiz-host";
  let conn = null;
  let stopTimer = null;
  let banner = null;
  let lastView = null;
  let quizErrors = null;
  let toast = null;
  let game = null; // { pin, hostToken }
  let storedSettingsSent = false;
  const SETTINGS_KEY = "quiz-host-settings";

  function clear() {
    if (stopTimer) stopTimer();
    stopTimer = null;
    app.replaceChildren();
    if (banner) app.append(el("div", { class: "banner" }, banner));
    if (toast) app.append(el("div", { class: "banner" }, toast));
  }

  function showConnecting() {
    clear();
    app.append(el("div", { class: "card center" }, el("p", {}, T.connecting)));
  }

  function showLogin(error) {
    clear();
    const pw = el("input", { type: "password", autocomplete: "current-password" });
    const err = el("div", { class: "error" }, error || "");
    const go = async () => {
      err.textContent = "";
      try {
        const res = await fetch("/api/games", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw.value }) });
        const data = await res.json();
        if (!res.ok) return void (err.textContent = data.error || T.error);
        game = data;
        localStorage.setItem(KEY, JSON.stringify(game));
        open();
      } catch {
        err.textContent = T.error;
      }
    };
    pw.addEventListener("keydown", (e) => e.key === "Enter" && go());
    app.append(el("div", { class: "card center" },
      el("h1", {}, `${T.appName} – ${T.hostTitle}`),
      el("label", {}, T.hostPassword, pw),
      err,
      el("button", { class: "primary", type: "button", onclick: go }, T.createGame)));
  }

  function open() {
    if (conn) conn.close();
    conn = connect({
      path: `/ws/${game.pin}?role=host&token=${encodeURIComponent(game.hostToken)}`,
      onStatus: (up) => { banner = up ? null : T.reconnecting; if (lastView) render(lastView); },
      onGiveUp: () => { localStorage.removeItem(KEY); lastView = null; showLogin(T.gameNotFound); },
      onMessage: (msg) => {
        if (msg.type === "view") {
          if (msg.view.phase === "lobby") {
            if (!storedSettingsSent) {
              storedSettingsSent = true; // restore the Host's last settings into this new Game
              const saved = localStorage.getItem(SETTINGS_KEY);
              if (saved) { try { conn.send({ type: "set_settings", settings: JSON.parse(saved) }); } catch {} }
            } else if (msg.view.settings) {
              // Remember only what the server accepted.
              localStorage.setItem(SETTINGS_KEY, JSON.stringify(msg.view.settings));
            }
          }
          quizErrors = msg.view.phase === "lobby" ? quizErrors : null; render(msg.view);
        }
        else if (msg.type === "quiz_errors") { quizErrors = msg.errors; if (lastView) render(lastView); }
        else if (msg.type === "error") { toast = msg.message; if (lastView) render(lastView); setTimeout(() => { toast = null; if (lastView) render(lastView); }, 2500); }
      },
    });
  }

  async function onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      quizErrors = null;
      conn.send({ type: "load_quiz", csv: text });
    } catch {
      quizErrors = [T.badEncoding];
      if (lastView) render(lastView);
    }
  }

  function settingsCard(st) {
    const num = (value, attrs) => el("input", { type: "number", value, ...attrs, onchange: save });
    const seconds = num(st.defaultSeconds, { min: 5, max: 120, step: 1 });
    const base = num(st.basePoints, { min: 100, max: 5000, step: 100 });
    const bonus = num(st.maxSpeedBonus, { min: 0, max: 5000, step: 50 });
    function save() {
      const settings = { defaultSeconds: Number(seconds.value), basePoints: Number(base.value), maxSpeedBonus: Number(bonus.value) };
      conn.send({ type: "set_settings", settings });
    }
    return el("div", { class: "card" },
      el("h3", {}, T.settings),
      el("label", {}, T.settingSeconds, seconds, el("small", { class: "muted" }, T.settingSecondsHint)),
      el("label", {}, T.settingBase, base),
      el("label", {}, T.settingBonus, bonus, el("small", { class: "muted" }, T.settingBonusHint)));
  }

  function board(rows) {
    return el("ol", { class: "board" }, rows.map((r) =>
      el("li", {}, el("span", { class: "rank" }, r.rank), el("span", { class: "name" }, r.nickname), el("span", {}, `${r.score} ${T.points}`))));
  }

  function download(name, text) {
    const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
  }

  function render(v) {
    lastView = v;
    clear();
    if (v.phase === "lobby") {
      const joinUrl = `${location.origin}/?pin=${game.pin}`;
      const file = el("input", { type: "file", accept: ".csv,text/csv", onchange: onFile });
      app.append(
        el("div", { class: "card center" },
          el("div", { class: "muted" }, `${T.joinAt} ${joinUrl}`),
          el("div", { class: "pin" }, game.pin)),
        el("div", { class: "card" },
          el("h3", {}, T.importCsv),
          file,
          el("a", { href: "/sample.csv", download: "sample.csv", class: "muted" }, T.sampleCsv),
          el("div", {}, v.quizLoaded ? T.quizLoaded(v.quizSize) : T.quizNotLoaded),
          quizErrors ? el("div", { class: "error" }, quizErrors.join("\n")) : null),
        settingsCard(v.settings),
        el("div", { class: "card center" },
          el("p", {}, T.playersInRoom(v.playerCount)),
          el("div", { class: "names" }, v.players.map((n) => el("span", {}, n))),
          el("button", { class: "primary", type: "button", disabled: !v.quizLoaded || v.playerCount === 0, onclick: () => conn.send({ type: "start" }) }, T.start)),
      );
    } else if (v.phase === "question") {
      const q = v.question;
      const timer = el("div", { class: "timer" });
      app.append(
        el("div", { class: "row" }, el("span", { class: "muted" }, T.questionOf(q.index + 1, q.total)), el("span", {}, T.answeredCount(v.answeredCount, v.playerCount)), timer),
        el("div", { class: "card center" }, el("div", { class: "qtext" }, q.text)),
        el("div", { class: "opts" }, q.options.map((t, i) => optionButton(i, t, { disabled: true }))),
      );
      stopTimer = countdown(timer, v.deadline, v.serverNow);
    } else if (v.phase === "reveal") {
      const q = v.question, r = v.reveal;
      app.append(
        el("div", { class: "card center" }, el("div", { class: "qtext" }, q.text)),
        el("div", { class: "opts" }, q.options.map((t, i) => {
          const b = optionButton(i, t, { disabled: true, class: `opt opt${i}${i === r.correctIndex ? "" : " dim"}` });
          b.append(el("span", { class: "count" }, `${i === r.correctIndex ? "✔ " : ""}${r.optionCounts[i]}`));
          return b;
        })),
        el("div", { class: "card center" }, el("h3", {}, T.leaderboard), board(r.leaderboard)),
        el("div", { class: "center", style: "text-align:center" },
          el("button", { class: "primary", type: "button", onclick: () => conn.send({ type: "next" }) }, r.isLast ? T.showResults : T.next)),
      );
    } else if (v.phase === "finished") {
      app.append(
        el("div", { class: "card center" }, el("h2", {}, T.finalTitle), el("h3", {}, T.podium), board(v.podium)),
        el("div", { class: "center", style: "text-align:center; display:flex; gap:12px; justify-content:center" },
          el("button", { class: "primary", type: "button", onclick: () => download(`results-${game.pin}.csv`, v.resultsCsv) }, T.downloadResults),
          el("button", { class: "primary", type: "button", onclick: () => { conn.close(); localStorage.removeItem(KEY); lastView = null; showLogin(); } }, T.newGame)),
      );
    }
  }

  const saved = localStorage.getItem(KEY);
  if (saved) {
    try { game = JSON.parse(saved); showConnecting(); open(); } catch { showLogin(); }
  } else {
    showLogin();
  }
})();
