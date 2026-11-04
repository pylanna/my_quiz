(() => {
  const { el, optionButton, countdown, connect } = QZ;
  const app = document.getElementById("app");
  const params = new URLSearchParams(location.search);
  let conn = null;
  let stopTimer = null;
  let banner = null;
  let lastView = null;
  let session = null; // { pin, token, nickname }

  const storeKey = (pin) => `quiz-player-${pin}`;

  function setBanner(text) {
    banner = text;
    if (lastView) render(lastView);
  }

  function clear() {
    if (stopTimer) stopTimer();
    stopTimer = null;
    app.replaceChildren();
    if (banner) app.append(el("div", { class: "banner" }, banner));
  }

  function showConnecting() {
    clear();
    app.append(el("div", { class: "card center" }, el("p", {}, T.connecting)));
  }

  function showJoinForm(error) {
    clear();
    const pin = el("input", { type: "text", inputmode: "numeric", maxlength: 6, autocomplete: "off", value: params.get("pin") || "" });
    const nick = el("input", { type: "text", maxlength: 20, autocomplete: "off" });
    const err = el("div", { class: "error" }, error || "");
    const go = () => joinGame(pin.value.trim(), nick.value.trim(), err);
    app.append(
      el("div", { class: "card center" },
        el("h1", {}, T.appName),
        el("h2", {}, T.joinTitle),
        el("label", {}, T.pin, pin),
        el("label", {}, T.nickname, nick),
        err,
        el("button", { class: "primary", type: "button", onclick: go }, T.join),
      ),
    );
  }

  function joinGame(pin, nickname, errNode) {
    if (!/^\d{6}$/.test(pin) || !nickname) {
      errNode.textContent = !nickname ? "กรุณาใส่ชื่อเล่น" : "PIN ต้องเป็นตัวเลข 6 หลัก";
      return;
    }
    session = { pin, token: null, nickname };
    openSocket({ type: "join", nickname }, errNode);
  }

  function openSocket(firstMessage, errNode) {
    if (conn) conn.close();
    let joinedOnce = false;
    conn = connect({
      path: `/ws/${session.pin}?role=player`,
      onOpen: () => {
        const stored = session.token || localStorage.getItem(storeKey(session.pin));
        conn.send(joinedOnce || (stored && firstMessage.type !== "join") ? { type: "rejoin", token: stored } : firstMessage);
      },
      onStatus: (up) => setBanner(up ? null : T.reconnecting),
      onGiveUp: () => {
        localStorage.removeItem(storeKey(session.pin));
        showJoinForm(T.gameNotFound);
      },
      onMessage: (msg) => {
        if (msg.type === "joined") {
          joinedOnce = true;
          session.token = msg.token;
          localStorage.setItem(storeKey(session.pin), msg.token);
        } else if (msg.type === "join_error") {
          localStorage.removeItem(storeKey(session.pin));
          conn.close();
          showJoinForm(msg.message);
        } else if (msg.type === "view") {
          render(msg.view);
        } else if (msg.type === "error") {
          setBanner(msg.message);
          setTimeout(() => setBanner(null), 2500);
        }
      },
    });
  }

  function board(rows) {
    return el("ol", { class: "board" }, rows.map((r) =>
      el("li", {}, el("span", { class: "rank" }, r.rank), el("span", { class: "name" }, r.nickname), el("span", {}, r.score))));
  }

  function render(v) {
    lastView = v;
    clear();
    if (v.phase === "lobby") {
      app.append(el("div", { class: "card center" },
        el("h2", {}, v.nickname),
        el("p", {}, T.waitingHost),
        el("p", { class: "muted" }, T.playersInRoom(v.playerCount))));
    } else if (v.phase === "question") {
      const q = v.question;
      const timer = el("div", { class: "timer" });
      const buttons = q.options.map((text, i) =>
        optionButton(i, text, {
          disabled: v.answered,
          class: `opt opt${i}${v.answered && v.chosen === i ? " chosen" : v.answered ? " dim" : ""}`,
          onclick: () => conn.send({ type: "answer", option: i }),
        }));
      app.append(
        el("div", { class: "row" }, el("span", { class: "muted" }, T.questionOf(q.index + 1, q.total)), timer),
        el("div", { class: "card center" }, el("div", { class: "qtext" }, q.text)),
        el("div", { class: "opts stack" }, buttons),
        ...(v.answered ? [el("div", { class: "muted", style: "text-align:center" }, T.answered)] : []),
      );
      stopTimer = countdown(timer, v.deadline, v.serverNow);
    } else if (v.phase === "reveal") {
      const r = v.reveal;
      const title = !r.answered ? T.noAnswer : r.correct ? T.correct : T.wrong;
      app.append(el("div", { class: "card center" },
        el("div", { class: `big ${r.correct ? "good" : "bad"}` }, title),
        r.correct ? el("div", { class: "big" }, `+${r.gained}`) : null,
        el("p", {}, T.yourRank(r.rank)),
        el("p", {}, T.yourScore(r.score))));
    } else if (v.phase === "finished") {
      app.append(
        el("div", { class: "card center" },
          el("h2", {}, T.finalTitle),
          el("div", { class: "big" }, T.yourRank(v.final.rank)),
          el("p", {}, T.yourScore(v.final.score))),
        el("div", { class: "card center" }, el("h3", {}, T.podium), board(v.podium)),
      );
      localStorage.removeItem(storeKey(session.pin));
    }
  }

  // Resume automatically if this browser already joined the PIN in the URL.
  const pinParam = params.get("pin");
  const storedToken = pinParam && localStorage.getItem(storeKey(pinParam));
  if (storedToken) {
    session = { pin: pinParam, token: storedToken, nickname: "" };
    showConnecting();
    openSocket({ type: "rejoin", token: storedToken });
  } else {
    showJoinForm();
  }
})();
