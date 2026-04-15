import { app } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

const isDev = !app.isPackaged;

let serverProcess: ChildProcess | null = null;
let serverPort = 0;
let serverLogStream: fs.WriteStream | null = null;
let serverStartPromise: Promise<number> | null = null;
let serverRestartTimer: ReturnType<typeof setTimeout> | null = null;
let _appIsQuitting = false;

export function setAppIsQuitting(value: boolean): void {
  _appIsQuitting = value;
}

function appendMainLog(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  if (serverLogStream) {
    serverLogStream.write(line);
  }
  process.stderr.write(line);
}

function ensurePackagedLogging(): void {
  if (!app.isPackaged || serverLogStream) return;
  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });
  serverLogStream = fs.createWriteStream(path.join(userDataDir, "server-child.log"), {
    flags: "a",
  });
}

function clearServerRestartTimer(): void {
  if (!serverRestartTimer) return;
  clearTimeout(serverRestartTimer);
  serverRestartTimer = null;
}

function isServerProcessAlive(processRef: ChildProcess | null = serverProcess): boolean {
  return Boolean(processRef && !processRef.killed && processRef.exitCode === null);
}

function scheduleServerRestart(reason: string): void {
  if (_appIsQuitting || serverStartPromise || serverRestartTimer) return;
  appendMainLog(`scheduling server restart (${reason})`);
  serverRestartTimer = setTimeout(() => {
    serverRestartTimer = null;
    void ensureServerRunning(`restart:${reason}`).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      appendMainLog(`server restart failed (${reason}): ${message}`);
    });
  }, 1_000);
  serverRestartTimer.unref();
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

async function startServer(): Promise<number> {
  const requestedPort = await findFreePort();
  ensurePackagedLogging();
  const serverEntry = isDev
    ? path.join(__dirname, "../dist-server/main.mjs")
    : path.join(__dirname, "../dist-server/main.mjs");

  const child = spawn(process.execPath, [serverEntry], {
    cwd: isDev ? path.join(__dirname, "..") : os.homedir(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      BETTERGIT_SERVER_PORT: String(requestedPort),
      BETTERGIT_USER_DATA: app.getPath("userData"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess = child;

  return new Promise((resolve, reject) => {
    let stdout = "";
    let ready = false;
    const timer = setTimeout(() => reject(new Error("Server startup timed out")), 10_000);

    child.stdout!.on("data", (chunk: Buffer) => {
      if (serverLogStream) serverLogStream.write(chunk);
      stdout += chunk.toString();
      const match = stdout.match(/BETTERGIT_SERVER_PORT=(\d+)/);
      if (match) {
        clearTimeout(timer);
        serverPort = parseInt(match[1], 10);
        ready = true;
        resolve(serverPort);
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      if (serverLogStream) serverLogStream.write(chunk);
      process.stderr.write(`[server] ${chunk.toString()}`);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (serverProcess === child) {
        serverProcess = null;
        serverPort = 0;
      }
      appendMainLog(`server process error: ${err.message}`);
      scheduleServerRestart(`error:${err.message}`);
      reject(err);
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (serverProcess === child) {
        serverProcess = null;
        serverPort = 0;
      }
      const detail = code !== null ? `code ${code}` : signal ? `signal ${signal}` : "unknown";
      appendMainLog(`server process exited (${detail})`);
      if (!ready) {
        reject(new Error(`Server exited with ${detail}`));
      }
      if (!_appIsQuitting) {
        scheduleServerRestart(`exit:${detail}`);
      }
    });
  });
}

export function stopServer(): void {
  clearServerRestartTimer();
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  serverPort = 0;
  if (serverLogStream) {
    serverLogStream.end();
    serverLogStream = null;
  }
}

export async function ensureServerRunning(reason: string): Promise<number> {
  clearServerRestartTimer();

  if (isServerProcessAlive() && serverPort !== 0) {
    return serverPort;
  }
  if (serverStartPromise) {
    return serverStartPromise;
  }

  appendMainLog(`starting server (${reason})`);
  serverStartPromise = startServer()
    .finally(() => {
      serverStartPromise = null;
    });
  return serverStartPromise;
}

export async function restartServer(reason: string): Promise<number> {
  appendMainLog(`restarting server (${reason})`);
  stopServer();
  return ensureServerRunning(`forced:${reason}`);
}

export function getServerPort(): number {
  return serverPort;
}
