import * as pty from "node-pty";
import { WebSocketServer, WebSocket } from "ws";
import type http from "node:http";
import { getEnvWithPath } from "./env";

// ---------------------------------------------------------------------------
// Multi-session PTY manager over WebSocket
// ---------------------------------------------------------------------------

interface PtySession {
  id: string;
  process: pty.IPty;
  ws: WebSocket;
  cwd: string;
}

const sessions = new Map<string, PtySession>();
let nextId = 1;

function createSession(ws: WebSocket, cwd: string): PtySession {
  const id = String(nextId++);
  const shell =
    process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");

  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cwd,
    env: getEnvWithPath() as Record<string, string>,
    cols: 80,
    rows: 24,
  });

  const session: PtySession = { id, process: proc, ws, cwd };
  sessions.set(id, session);

  // PTY output → WebSocket (binary)
  proc.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "output", sessionId: id, data }));
    }
  });

  proc.onExit(({ exitCode }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "exit", sessionId: id, code: exitCode }));
    }
    sessions.delete(id);
  });

  return session;
}

function destroySession(id: string) {
  const session = sessions.get(id);
  if (session) {
    session.process.kill();
    sessions.delete(id);
  }
}

// ---------------------------------------------------------------------------
// WebSocket server — attaches to the existing HTTP server
// ---------------------------------------------------------------------------

export function attachPtyWebSocket(server: http.Server): void {
  const wss = new WebSocketServer({ server, path: "/ws/pty" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    const cwd = url.searchParams.get("cwd") || process.env.HOME || "/";

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          case "create": {
            const session = createSession(ws, msg.cwd || cwd);
            ws.send(
              JSON.stringify({
                type: "created",
                sessionId: session.id,
                cols: 80,
                rows: 24,
              }),
            );
            break;
          }

          case "input": {
            const session = sessions.get(msg.sessionId);
            session?.process.write(msg.data);
            break;
          }

          case "resize": {
            const session = sessions.get(msg.sessionId);
            if (session) {
              try {
                session.process.resize(msg.cols, msg.rows);
              } catch {
                // Ignore resize errors on dead PTY
              }
            }
            break;
          }

          case "destroy": {
            destroySession(msg.sessionId);
            break;
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      // Clean up all sessions owned by this connection
      for (const [id, session] of sessions) {
        if (session.ws === ws) {
          session.process.kill();
          sessions.delete(id);
        }
      }
    });
  });
}
