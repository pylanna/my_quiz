import { DurableObject } from "cloudflare:workers";
import { parseQuiz } from "./core/csv";
import { Game } from "./core/game";

const MAX_HOST_MSG = 256 * 1024;
const MAX_PLAYER_MSG = 1024;

interface Conn {
  role: "host" | "player";
  playerId?: string;
}

/** One Durable Object per Game PIN. All live state is in memory (see ADR 0001). */
export class GameRoom extends DurableObject {
  private game = new Game();
  private hostToken: string | null = null;
  private conns = new Map<WebSocket, Conn>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      if (this.hostToken) return new Response("exists", { status: 409 });
      const { hostToken } = (await request.json()) as { hostToken: string };
      this.hostToken = hostToken;
      return new Response("ok");
    }

    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    if (!this.hostToken) return new Response("ไม่พบเกมนี้", { status: 404 });

    const role = url.searchParams.get("role");
    if (role === "host") {
      if (url.searchParams.get("token") !== this.hostToken) return new Response("Forbidden", { status: 403 });
    } else if (role !== "player") {
      return new Response("Bad role", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    this.conns.set(server, { role: role as "host" | "player" });
    server.addEventListener("message", (e) => this.onMessage(server, e.data));
    server.addEventListener("close", () => this.onClose(server));
    server.addEventListener("error", () => this.onClose(server));
    if (role === "host") this.sendView(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- messaging -------------------------------------------------------

  private send(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket already closed; onClose will clean up
    }
  }

  private sendView(ws: WebSocket): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    const now = Date.now();
    if (conn.role === "host") {
      this.send(ws, { type: "view", view: this.game.hostView(now) });
    } else if (conn.playerId) {
      this.send(ws, { type: "view", view: this.game.playerView(conn.playerId, now) });
    }
  }

  private broadcastHosts(): void {
    for (const [ws, c] of this.conns) if (c.role === "host") this.sendView(ws);
  }

  private broadcastAll(): void {
    for (const ws of this.conns.keys()) this.sendView(ws);
  }

  private onMessage(ws: WebSocket, data: unknown): void {
    const conn = this.conns.get(ws);
    if (!conn || typeof data !== "string") return;
    if (data.length > (conn.role === "host" ? MAX_HOST_MSG : MAX_PLAYER_MSG)) {
      this.send(ws, { type: "error", message: "ข้อความใหญ่เกินไป" });
      return;
    }
    let msg: { type?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === "ping") return void this.send(ws, { type: "pong" });
    if (conn.role === "host") this.onHost(ws, msg);
    else this.onPlayer(ws, conn, msg);
  }

  private onHost(ws: WebSocket, msg: { type?: string; [k: string]: unknown }): void {
    const now = Date.now();
    switch (msg.type) {
      case "load_quiz": {
        if (typeof msg.csv !== "string") return;
        const parsed = parseQuiz(msg.csv);
        if (parsed.errors.length > 0) return void this.send(ws, { type: "quiz_errors", errors: parsed.errors.slice(0, 30) });
        const r = this.game.loadQuiz(parsed.questions);
        if (!r.ok) return void this.send(ws, { type: "error", message: r.error });
        this.broadcastHosts();
        return;
      }
      case "set_settings": {
        const r = this.game.setSettings(msg.settings);
        if (!r.ok) this.send(ws, { type: "error", message: r.error });
        this.broadcastHosts(); // also resets a Host's form to the stored values after a rejection
        return;
      }
      case "start": {
        const r = this.game.start(now);
        if (!r.ok) return void this.send(ws, { type: "error", message: r.error });
        this.armTimer();
        this.broadcastAll();
        return;
      }
      case "next": {
        const r = this.game.next(now);
        if (!r.ok) return void this.send(ws, { type: "error", message: r.error });
        this.armTimer();
        this.broadcastAll();
        return;
      }
    }
  }

  private onPlayer(ws: WebSocket, conn: Conn, msg: { type?: string; [k: string]: unknown }): void {
    if (msg.type === "join" || msg.type === "rejoin") {
      if (conn.playerId) return;
      const r =
        msg.type === "join"
          ? this.game.join(String(msg.nickname ?? ""))
          : this.game.rejoin(String(msg.token ?? ""));
      if (!r.ok) return void this.send(ws, { type: "join_error", message: r.error });
      // A player has one live socket: drop any older one for the same id.
      for (const [other, c] of this.conns) {
        if (other !== ws && c.playerId === r.playerId) {
          this.conns.delete(other);
          try {
            other.close(1000, "replaced");
          } catch {}
        }
      }
      conn.playerId = r.playerId;
      this.game.setConnected(r.playerId, true);
      this.send(ws, { type: "joined", token: r.token });
      this.sendView(ws);
      this.broadcastHosts();
      return;
    }
    if (!conn.playerId) return;
    if (msg.type === "answer") {
      const r = this.game.submitAnswer(conn.playerId, Number(msg.option), Date.now());
      if (!r.ok) return void this.send(ws, { type: "error", message: r.error });
      this.sendView(ws);
      this.broadcastHosts();
      this.closeIfAllAnswered();
    }
  }

  private onClose(ws: WebSocket): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    this.conns.delete(ws);
    if (conn.playerId) {
      this.game.setConnected(conn.playerId, false);
      this.broadcastHosts();
      this.closeIfAllAnswered();
    }
  }

  // ---- question timing ---------------------------------------------------

  private armTimer(): void {
    this.clearTimer();
    if (this.game.phase !== "question") return;
    const delay = Math.max(0, this.game.deadline - Date.now());
    this.timer = setTimeout(() => this.closeNow(), delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private closeIfAllAnswered(): void {
    if (this.game.phase === "question" && this.game.allAnswered()) this.closeNow();
  }

  private closeNow(): void {
    this.clearTimer();
    if (this.game.closeQuestion(Date.now()).ok) this.broadcastAll();
  }
}
