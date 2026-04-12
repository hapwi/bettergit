import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type TerminalStatus = "starting" | "running" | "exited" | "error";

export interface TerminalSessionSnapshot {
  projectPath: string;
  tabId: string;
  cwd: string;
  status: TerminalStatus;
  pid: number | null;
  history: string;
  exitCode: number | null;
  exitSignal: number | null;
  updatedAt: string;
}

export interface TerminalSessionEvent {
  projectPath: string;
  tabId: string;
  createdAt: string;
  type: "output" | "exited" | "error";
  data?: string;
  exitCode?: number | null;
  exitSignal?: number | null;
  message?: string;
}

interface PersistedTerminalSession {
  cwd: string;
  status: TerminalStatus;
  history: string;
  exitCode: number | null;
  exitSignal: number | null;
  updatedAt: string;
}

interface LiveTerminalSession extends PersistedTerminalSession {
  projectPath: string;
  tabId: string;
  pid: number | null;
  cols: number;
  rows: number;
  process: import("node-pty").IPty | null;
  disposeData: (() => void) | null;
  disposeExit: (() => void) | null;
}

interface TerminalPersistenceShape {
  terminalSessions?: Record<string, Record<string, PersistedTerminalSession>>;
}

interface OpenTerminalSessionInput {
  projectPath: string;
  tabId: string;
  cwd: string;
  cols: number;
  rows: number;
}

const DEFAULT_HISTORY_LIMIT = 400_000;

function normalizePersistedSession(value: unknown): PersistedTerminalSession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PersistedTerminalSession>;
  if (typeof candidate.cwd !== "string" || candidate.cwd.trim().length === 0) return null;
  if (typeof candidate.history !== "string") return null;
  if (
    candidate.status !== "starting" &&
    candidate.status !== "running" &&
    candidate.status !== "exited" &&
    candidate.status !== "error"
  ) {
    return null;
  }

  return {
    cwd: candidate.cwd,
    status: candidate.status,
    history: candidate.history,
    exitCode: typeof candidate.exitCode === "number" ? candidate.exitCode : null,
    exitSignal: typeof candidate.exitSignal === "number" ? candidate.exitSignal : null,
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt.length > 0
        ? candidate.updatedAt
        : new Date(0).toISOString(),
  };
}

function normalizeTerminalPersistence(value: unknown): Record<string, Record<string, PersistedTerminalSession>> {
  if (!value || typeof value !== "object") return {};
  const candidate = value as TerminalPersistenceShape;
  const next: Record<string, Record<string, PersistedTerminalSession>> = {};
  for (const [projectPath, tabs] of Object.entries(candidate.terminalSessions ?? {})) {
    if (!projectPath.trim() || !tabs || typeof tabs !== "object") continue;
    const normalizedTabs = Object.fromEntries(
      Object.entries(tabs).flatMap(([tabId, session]) => {
        if (!tabId.trim()) return [];
        const normalized = normalizePersistedSession(session);
        return normalized ? [[tabId, normalized] as const] : [];
      }),
    );
    if (Object.keys(normalizedTabs).length > 0) {
      next[projectPath] = normalizedTabs;
    }
  }
  return next;
}

function trimHistory(history: string): string {
  if (history.length <= DEFAULT_HISTORY_LIMIT) return history;
  return history.slice(history.length - DEFAULT_HISTORY_LIMIT);
}

function resolveDefaultShell(): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return { shell: process.env.COMSPEC ?? "cmd.exe", args: [] };
  }
  return { shell: process.env.SHELL ?? "/bin/zsh", args: [] };
}

let didEnsureSpawnHelperExecutable = false;

function ensureNodePtySpawnHelperExecutable(): void {
  if (process.platform === "win32" || didEnsureSpawnHelperExecutable) return;
  didEnsureSpawnHelperExecutable = true;

  try {
    const requireForNodePty = createRequire(__filename);
    const packageJsonPath = requireForNodePty.resolve("node-pty/package.json");
    const packageDir = path.dirname(packageJsonPath);
    const candidates = [
      path.join(packageDir, "build", "Release", "spawn-helper"),
      path.join(packageDir, "build", "Debug", "spawn-helper"),
      path.join(packageDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    ];

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        fs.chmodSync(candidate, 0o755);
      } catch {
        // Best effort only. node-pty can still work if the helper already has
        // the expected mode.
      }
      return;
    }
  } catch {
    // Ignore resolution failures. The spawn itself will surface the real error.
  }
}

export class TerminalSessionManager {
  private readonly listeners = new Set<(event: TerminalSessionEvent) => void>();
  private readonly sessions = new Map<string, LiveTerminalSession>();
  private readonly persistedSessions: Record<string, Record<string, PersistedTerminalSession>>;
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly loadSettings: () => Record<string, unknown>,
    private readonly saveSettings: (data: Record<string, unknown>) => void,
  ) {
    this.persistedSessions = normalizeTerminalPersistence(this.loadSettings());
  }

  subscribe(listener: (event: TerminalSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  open(input: OpenTerminalSessionInput): TerminalSessionSnapshot {
    const sessionKey = this.getSessionKey(input.projectPath, input.tabId);
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      if (existing.cwd !== input.cwd) {
        this.stopSession(existing);
        existing.cwd = input.cwd;
        existing.history = "";
        existing.exitCode = null;
        existing.exitSignal = null;
      }
      existing.cols = input.cols;
      existing.rows = input.rows;
      if (!existing.process) {
        this.startSession(existing);
      } else {
        existing.process.resize(input.cols, input.rows);
      }
      return this.snapshot(existing);
    }

    const persisted = this.getPersistedSession(input.projectPath, input.tabId);
    const session: LiveTerminalSession = {
      projectPath: input.projectPath,
      tabId: input.tabId,
      cwd: input.cwd,
      status: persisted?.status ?? "starting",
      pid: null,
      history: persisted?.history ?? "",
      exitCode: persisted?.exitCode ?? null,
      exitSignal: persisted?.exitSignal ?? null,
      updatedAt: persisted?.updatedAt ?? new Date().toISOString(),
      cols: input.cols,
      rows: input.rows,
      process: null,
      disposeData: null,
      disposeExit: null,
    };
    this.sessions.set(sessionKey, session);
    this.persistSession(session);
    this.startSession(session);
    return this.snapshot(session);
  }

  write(projectPath: string, tabId: string, data: string): void {
    const session = this.requireSession(projectPath, tabId);
    if (!session.process || session.status !== "running") {
      throw new Error("Terminal is not running");
    }
    session.process.write(data);
  }

  resize(projectPath: string, tabId: string, cols: number, rows: number): void {
    const session = this.requireSession(projectPath, tabId);
    session.cols = cols;
    session.rows = rows;
    session.updatedAt = new Date().toISOString();
    if (session.process) {
      session.process.resize(cols, rows);
    }
    this.persistSession(session);
  }

  closeSession(projectPath: string, tabId: string, deleteHistory = true): void {
    const sessionKey = this.getSessionKey(projectPath, tabId);
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      this.sessions.delete(sessionKey);
      this.stopSession(existing);
    }
    if (deleteHistory) {
      this.deletePersistedSession(projectPath, tabId);
    } else if (existing) {
      existing.status = "exited";
      existing.pid = null;
      existing.updatedAt = new Date().toISOString();
      this.persistSession(existing);
    }
  }

  closeProject(projectPath: string, deleteHistory = true): void {
    const liveSessions = [...this.sessions.values()].filter((session) => session.projectPath === projectPath);
    for (const session of liveSessions) {
      this.closeSession(projectPath, session.tabId, deleteHistory);
    }

    if (deleteHistory) {
      delete this.persistedSessions[projectPath];
      this.schedulePersist();
    }
  }

  renameProject(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return;

    const liveSessions = [...this.sessions.entries()].filter(([, session]) => session.projectPath === oldPath);
    for (const [key, session] of liveSessions) {
      this.sessions.delete(key);
      session.projectPath = newPath;
      if (session.cwd === oldPath) {
        session.cwd = newPath;
      }
      this.sessions.set(this.getSessionKey(newPath, session.tabId), session);
      this.persistSession(session);
    }

    if (this.persistedSessions[oldPath]) {
      this.persistedSessions[newPath] = this.persistedSessions[oldPath]!;
      delete this.persistedSessions[oldPath];
      this.schedulePersist();
    }
  }

  shutdown(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    for (const session of this.sessions.values()) {
      session.status = "exited";
      session.pid = null;
      session.updatedAt = new Date().toISOString();
      this.persistSession(session);
      this.stopSession(session);
    }
    this.sessions.clear();
    this.flushPersistence();
  }

  private getSessionKey(projectPath: string, tabId: string): string {
    return `${projectPath}\u0000${tabId}`;
  }

  private requireSession(projectPath: string, tabId: string): LiveTerminalSession {
    const session = this.sessions.get(this.getSessionKey(projectPath, tabId));
    if (!session) {
      throw new Error("Unknown terminal session");
    }
    return session;
  }

  private getPersistedSession(projectPath: string, tabId: string): PersistedTerminalSession | null {
    return this.persistedSessions[projectPath]?.[tabId] ?? null;
  }

  private persistSession(session: LiveTerminalSession): void {
    if (!this.persistedSessions[session.projectPath]) {
      this.persistedSessions[session.projectPath] = {};
    }
    this.persistedSessions[session.projectPath]![session.tabId] = {
      cwd: session.cwd,
      status: session.status,
      history: trimHistory(session.history),
      exitCode: session.exitCode,
      exitSignal: session.exitSignal,
      updatedAt: session.updatedAt,
    };
    this.schedulePersist();
  }

  private deletePersistedSession(projectPath: string, tabId: string): void {
    const projectSessions = this.persistedSessions[projectPath];
    if (!projectSessions || !(tabId in projectSessions)) return;
    delete projectSessions[tabId];
    if (Object.keys(projectSessions).length === 0) {
      delete this.persistedSessions[projectPath];
    }
    this.schedulePersist();
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushPersistence();
    }, 150);
  }

  private flushPersistence(): void {
    this.saveSettings({ terminalSessions: this.persistedSessions });
  }

  private snapshot(session: LiveTerminalSession): TerminalSessionSnapshot {
    return {
      projectPath: session.projectPath,
      tabId: session.tabId,
      cwd: session.cwd,
      status: session.status,
      pid: session.pid,
      history: session.history,
      exitCode: session.exitCode,
      exitSignal: session.exitSignal,
      updatedAt: session.updatedAt,
    };
  }

  private stopSession(session: LiveTerminalSession): void {
    session.disposeData?.();
    session.disposeExit?.();
    session.disposeData = null;
    session.disposeExit = null;

    if (session.process) {
      try {
        session.process.kill();
      } catch {
        // Ignore shutdown errors from a dead PTY.
      }
    }

    session.process = null;
    session.pid = null;
  }

  private emit(event: TerminalSessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private startSession(session: LiveTerminalSession): void {
    ensureNodePtySpawnHelperExecutable();

    const requireForNodePty = createRequire(__filename);
    const nodePty = requireForNodePty("node-pty") as typeof import("node-pty");
    const { shell, args } = resolveDefaultShell();

    try {
      session.status = "running";
      session.exitCode = null;
      session.exitSignal = null;
      session.updatedAt = new Date().toISOString();

      const processRef = nodePty.spawn(shell, args, {
        cwd: session.cwd,
        cols: session.cols,
        rows: session.rows,
        env: {
          ...process.env,
          TERM: process.platform === "win32" ? "xterm-color" : "xterm-256color",
        },
        name: process.platform === "win32" ? "xterm-color" : "xterm-256color",
      });

      session.process = processRef;
      session.pid = processRef.pid;
      this.persistSession(session);

      session.disposeData = (() => {
        const disposable = processRef.onData((data) => {
          session.history = trimHistory(session.history + data);
          session.updatedAt = new Date().toISOString();
          this.persistSession(session);
          this.emit({
            projectPath: session.projectPath,
            tabId: session.tabId,
            createdAt: new Date().toISOString(),
            type: "output",
            data,
          });
        });
        return () => {
          disposable.dispose();
        };
      })();

      session.disposeExit = (() => {
        const disposable = processRef.onExit((event) => {
          if (this.sessions.get(this.getSessionKey(session.projectPath, session.tabId)) !== session) {
            return;
          }
          session.process = null;
          session.pid = null;
          session.status = "exited";
          session.exitCode = event.exitCode;
          session.exitSignal = event.signal ?? null;
          session.updatedAt = new Date().toISOString();
          this.persistSession(session);
          this.emit({
            projectPath: session.projectPath,
            tabId: session.tabId,
            createdAt: new Date().toISOString(),
            type: "exited",
            exitCode: event.exitCode,
            exitSignal: event.signal ?? null,
          });
        });
        return () => {
          disposable.dispose();
        };
      })();
    } catch (error) {
      session.process = null;
      session.pid = null;
      session.status = "error";
      session.updatedAt = new Date().toISOString();
      this.persistSession(session);
      this.emit({
        projectPath: session.projectPath,
        tabId: session.tabId,
        createdAt: new Date().toISOString(),
        type: "error",
        message: error instanceof Error ? error.message : "Failed to start terminal session",
      });
    }
  }
}
