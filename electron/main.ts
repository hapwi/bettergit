import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: process.platform === "darwin" ? "#00000000" : "#0a0a0a",
    ...(process.platform === "darwin"
      ? {
          transparent: true,
          vibrancy: "under-window" as const,
          visualEffectState: "active" as const,
        }
      : {}),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

interface ExecInput {
  cwd: string;
  args: string[];
  timeoutMs?: number;
}

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (err: unknown) {
    const error = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message ?? "Unknown error",
    };
  }
}

ipcMain.handle("git:exec", async (_event, input: ExecInput): Promise<ExecResult> => {
  return runProcess("git", input.args, input.cwd, input.timeoutMs);
});

ipcMain.handle("gh:exec", async (_event, input: ExecInput): Promise<ExecResult> => {
  return runProcess("gh", input.args, input.cwd, input.timeoutMs);
});

ipcMain.handle("dialog:openDirectory", async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Open Repository",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("shell:openExternal", async (_event, url: string): Promise<void> => {
  await shell.openExternal(url);
});

// ---------------------------------------------------------------------------
// AI text generation via Claude CLI
// ---------------------------------------------------------------------------

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutPeriod.length === 0) return "Update project files";
  return withoutPeriod.length <= 72 ? withoutPeriod : withoutPeriod.slice(0, 72).trimEnd();
}

function extractJson<T>(text: string): T {
  let stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  if (!stripped.startsWith("{") && !stripped.startsWith("[")) {
    const jsonStart = stripped.indexOf("{");
    if (jsonStart !== -1) {
      let depth = 0;
      let jsonEnd = -1;
      for (let i = jsonStart; i < stripped.length; i++) {
        if (stripped[i] === "{") depth++;
        else if (stripped[i] === "}") {
          depth--;
          if (depth === 0) { jsonEnd = i; break; }
        }
      }
      if (jsonEnd !== -1) stripped = stripped.slice(jsonStart, jsonEnd + 1);
    }
  }

  return JSON.parse(stripped) as T;
}

async function runClaude(prompt: string, timeoutMs = 60_000): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    "claude",
    ["--print", "--model", "claude-haiku-4-5", prompt],
    {
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env },
    },
  );
  const result = stdout.trim();
  if (!result) throw new Error(`Claude returned empty output. stderr: ${stderr}`);
  return result;
}

interface CommitMessageInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  includeBranch?: boolean;
}

interface CommitMessageResult {
  subject: string;
  body: string;
  branch?: string;
}

ipcMain.handle(
  "ai:generateCommitMessage",
  async (_event, input: CommitMessageInput): Promise<CommitMessageResult> => {
    const wantsBranch = input.includeBranch === true;
    const jsonShape = wantsBranch
      ? '{"subject":"...","body":"...","branch":"..."}'
      : '{"subject":"...","body":"..."}';

    const prompt = [
      "You write concise git commit messages.",
      `Respond with ONLY valid JSON matching: ${jsonShape}`,
      "Rules:",
      "- subject must be imperative, <= 72 chars, no trailing period",
      "- body can be an empty string or short bullet points",
      ...(wantsBranch ? ["- branch must be a short semantic git branch fragment for this change"] : []),
      "- capture the primary user-visible or developer-visible change",
      "",
      `Branch: ${input.branch ?? "(detached)"}`,
      "",
      "Staged files:",
      limitSection(input.stagedSummary, 6_000),
      "",
      "Staged patch:",
      limitSection(input.stagedPatch, 40_000),
    ].join("\n");

    const text = await runClaude(prompt);
    const generated = extractJson<{ subject: string; body: string; branch?: string }>(text);

    return {
      subject: sanitizeCommitSubject(generated.subject ?? ""),
      body: (generated.body ?? "").trim(),
      ...(wantsBranch && typeof generated.branch === "string" ? { branch: generated.branch } : {}),
    };
  },
);

interface PrContentInput {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
}

interface PrContentResult {
  title: string;
  body: string;
}

ipcMain.handle(
  "ai:generatePrContent",
  async (_event, input: PrContentInput): Promise<PrContentResult> => {
    const prompt = [
      "You write GitHub pull request content.",
      'Respond with ONLY valid JSON matching: {"title":"...","body":"..."}',
      "Rules:",
      "- title should be concise and specific",
      "- body must be markdown with headings '## Summary' and '## Testing'",
      "- under Summary, provide short bullet points",
      "- under Testing, include bullet points or 'Not tested' where appropriate",
      "",
      `Base branch: ${input.baseBranch}`,
      `Head branch: ${input.headBranch}`,
      "",
      "Commits:",
      limitSection(input.commitSummary, 8_000),
      "",
      "Diff stat:",
      limitSection(input.diffSummary, 8_000),
      "",
      "Diff patch:",
      limitSection(input.diffPatch, 20_000),
    ].join("\n");

    const text = await runClaude(prompt);
    const generated = extractJson<{ title: string; body: string }>(text);

    const title = (generated.title ?? "").trim().split(/\r?\n/g)[0]?.trim() ?? "Update";
    return { title, body: (generated.body ?? "").trim() };
  },
);

interface BranchNameInput {
  message: string;
}

interface BranchNameResult {
  branch: string;
}

ipcMain.handle(
  "ai:generateBranchName",
  async (_event, input: BranchNameInput): Promise<BranchNameResult> => {
    const prompt = [
      "You generate concise git branch names.",
      'Respond with ONLY valid JSON matching: {"branch":"..."}',
      "Rules:",
      "- Describe the requested work.",
      "- Keep it short and specific (2-6 words).",
      "- Use plain words only, no punctuation.",
      "",
      "User message:",
      limitSection(input.message, 8_000),
    ].join("\n");

    const text = await runClaude(prompt);
    const generated = extractJson<{ branch: string }>(text);
    return { branch: (generated.branch ?? "update").trim() };
  },
);
