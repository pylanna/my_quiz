// Tiny DOM + socket helpers shared by host.html and index.html. No framework, no build step.
window.QZ = (() => {
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const SHAPES = ["▲", "◆", "●", "■"];

  function optionButton(i, text, props) {
    return el("button", { class: `opt opt${i}`, type: "button", ...props }, el("span", { class: "shape" }, SHAPES[i]), el("span", { class: "label" }, text));
  }

  // Countdown driven by the server's deadline, corrected for clock skew.
  function countdown(node, deadline, serverNow) {
    const offset = serverNow - Date.now();
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000));
      node.textContent = String(left);
      node.classList.toggle("urgent", left <= 5);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }

  // WebSocket with automatic reconnect. onGiveUp fires after repeated failures to even open.
  function connect({ path, onOpen, onMessage, onStatus, onGiveUp }) {
    let ws;
    let attempts = 0;
    let everOpened = false;
    let closedByUs = false;
    let pingTimer;
    const url = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;
    const open = () => {
      ws = new WebSocket(url());
      ws.addEventListener("open", () => {
        attempts = 0;
        everOpened = true;
        onStatus && onStatus(true);
        onOpen && onOpen();
        clearInterval(pingTimer);
        pingTimer = setInterval(() => send({ type: "ping" }), 25000);
      });
      ws.addEventListener("message", (e) => onMessage(JSON.parse(e.data)));
      ws.addEventListener("close", () => {
        clearInterval(pingTimer);
        if (closedByUs) return;
        onStatus && onStatus(false);
        attempts++;
        if (attempts >= 8) return onGiveUp && onGiveUp(everOpened);
        setTimeout(open, Math.min(500 * attempts, 4000));
      });
    };
    const send = (msg) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    open();
    return { send, close: () => { closedByUs = true; ws && ws.close(); } };
  }

  return { el, optionButton, countdown, connect, SHAPES };
})();
