import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const execFileAsync = promisify(execFile);
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);

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
      env: getEnvWithPath(),
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

// ---------------------------------------------------------------------------
// Merge pull requests — runs entirely in main process so Vite HMR reloads
// in the renderer don't interrupt the git checkout / branch cleanup steps.
// ---------------------------------------------------------------------------

interface MergePullRequestsInput {
  cwd: string;
  scope: "current" | "stack";
  /** PR numbers to merge, ordered base→tip. For "current" this is a single element. */
  prs: Array<{
    number: number;
    headBranch: string;
    baseBranch: string;
  }>;
}

interface MergePullRequestsResult {
  merged: number[];
  finalBranch: string | null;
  error: string | null;
}

const PROTECTED_BRANCHES = ["main", "master", "pre-release"];

function isProtectedBranch(name: string) {
  return PROTECTED_BRANCHES.includes(name);
}

async function gitExec(cwd: string, args: string[], timeout = 30_000) {
  return runProcess("git", args, cwd, timeout);
}

async function ghExec(cwd: string, args: string[], timeout = 30_000) {
  return runProcess("gh", args, cwd, timeout);
}

function requireOk(result: ExecResult, label: string) {
  if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr}`);
  return result.stdout;
}

// After retargeting a PR, GitHub may temporarily report it as unmergeable
// while it recalculates. Retry with backoff (matches hapcode behaviour).
function shouldRetryMerge(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("pull request is not mergeable") ||
    msg.includes("is not mergeable") ||
    msg.includes("merge conflict") ||
    msg.includes("conflict") ||
    msg.includes("head branch was modified") ||
    msg.includes("base branch was modified") ||
    msg.includes("required status check") ||
    msg.includes("review required")
  );
}

const MERGE_RETRY_DELAYS = [250, 500, 1_000, 2_000];

async function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Resolve a git revision, trying multiple candidates. Returns null if none resolve.
async function resolveRevision(cwd: string, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const result = await gitExec(cwd, ["rev-parse", candidate]);
    const sha = result.stdout.trim();
    if (result.code === 0 && sha.length > 0) return sha;
  }
  return null;
}

// Check if branch exists locally / on origin.
async function readBranchPresence(cwd: string, branchName: string) {
  await gitExec(cwd, ["fetch", "--quiet", "--prune", "origin"]).catch(() => {});
  const result = await gitExec(cwd, ["branch", "-a", "--list", branchName, `remotes/origin/${branchName}`]);
  const lines = result.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    hasLocal: lines.some((l) => l === branchName || l === `* ${branchName}`),
    hasRemote: lines.some((l) => l === `remotes/origin/${branchName}`),
  };
}

// Delete a merged branch (local + remote) only if it actually exists.
async function deleteBranchIfPresent(cwd: string, branchName: string) {
  const presence = await readBranchPresence(cwd, branchName);
  if (!presence.hasLocal && !presence.hasRemote) return;
  if (presence.hasRemote) {
    await gitExec(cwd, ["push", "origin", "--delete", branchName]).catch(() => {});
  }
  if (presence.hasLocal) {
    await gitExec(cwd, ["branch", "-D", "--", branchName]).catch(() => {});
  }
}

ipcMain.handle(
  "git:mergePullRequests",
  async (_event, input: MergePullRequestsInput): Promise<MergePullRequestsResult> => {
    const { cwd, prs } = input;
    const mergeBaseBranch = prs[0].baseBranch;
    const isStack = prs.length > 1;
    const merged: Array<{ number: number; headBranch: string }> = [];
    const autoClosedBranches: string[] = [];
    let finalBranch: string | null = null;

    // -- Helpers ---------------------------------------------------------------

    async function readPr(number: number): Promise<{ state: string; baseRefName: string } | null> {
      const result = await ghExec(cwd, [
        "pr", "view", String(number), "--json", "state,baseRefName",
      ]);
      if (result.code !== 0) return null;
      return JSON.parse(result.stdout) as { state: string; baseRefName: string };
    }

    async function mergePrWithRetry(prNumber: number, headBranch: string, attempt = 0): Promise<void> {
      const mergeArgs = ["pr", "merge", String(prNumber), "--squash"];
      // NEVER --delete-branch during a stack merge. Deleting mid-stack triggers
      // GitHub's async retarget/auto-close on downstream PRs, racing with our
      // own retarget + rebase steps.
      if (!isStack && !isProtectedBranch(headBranch)) {
        mergeArgs.push("--delete-branch");
      }
      const result = await ghExec(cwd, mergeArgs, 60_000);
      if (result.code === 0) return;

      // Check if it was merged/closed externally while we waited
      const refreshed = await readPr(prNumber);
      if (refreshed && refreshed.state !== "OPEN") return;

      const error = new Error(`merge PR #${prNumber} failed: ${result.stderr}`);
      if (attempt < 4 && shouldRetryMerge(error)) {
        await sleep(MERGE_RETRY_DELAYS[attempt] ?? 2_000);
        return mergePrWithRetry(prNumber, headBranch, attempt + 1);
      }
      throw error;
    }

    // -- Phase 1: snapshot original branch tips --------------------------------
    // Hapcode records each branch's tip BEFORE the loop so the --onto rebase
    // knows exactly which commits belong to each stacked branch.

    async function mergeLoop() {
      await gitExec(cwd, ["fetch", "--quiet", "--prune", "origin"]);

      const originalBranchTips = new Map<string, string>();
      for (const pr of prs) {
        const tip = await resolveRevision(cwd, [
          `refs/remotes/origin/${pr.headBranch}`,
          `origin/${pr.headBranch}`,
          pr.headBranch,
        ]);
        if (tip) originalBranchTips.set(pr.headBranch, tip);
      }

      // -- Phase 2: merge loop (retarget → rebase → merge, no deletion) -------

      for (const [index, pr] of prs.entries()) {
        const reference = String(pr.number);

        // Re-check PR state — GitHub may have auto-closed it after a previous
        // merge or retarget.
        const currentPr = await readPr(pr.number);
        if (currentPr && currentPr.state !== "OPEN") {
          if (!isProtectedBranch(pr.headBranch)) {
            autoClosedBranches.push(pr.headBranch);
          }
          continue;
        }

        // Retarget to merge base if needed
        if (currentPr && currentPr.baseRefName !== mergeBaseBranch) {
          await ghExec(cwd, ["pr", "edit", reference, "--base", mergeBaseBranch]);

          // Re-check — retargeting can auto-close the PR
          const afterRetarget = await readPr(pr.number);
          if (afterRetarget && afterRetarget.state !== "OPEN") {
            if (!isProtectedBranch(pr.headBranch)) {
              autoClosedBranches.push(pr.headBranch);
            }
            continue;
          }
        }

        // Rebase: for stacked PRs after the first, use --onto with the previous
        // branch's original tip so we only replay commits unique to this branch.
        const previousPr = index > 0 ? prs[index - 1] : null;
        if (previousPr) {
          const previousBranchTip = originalBranchTips.get(previousPr.headBranch);
          if (!previousBranchTip) {
            throw new Error(
              `Failed to locate the original tip of ${previousPr.headBranch} before rebasing ${pr.headBranch}.`,
            );
          }

          await gitExec(cwd, ["fetch", "--quiet", "origin", mergeBaseBranch]);
          await gitExec(cwd, ["checkout", pr.headBranch]);

          // Check if the branch was already rewritten (no longer contains the
          // previous branch tip) — skip rebase if so.
          const ancestorCheck = await gitExec(cwd, [
            "merge-base", "--is-ancestor", previousBranchTip, "HEAD",
          ]);
          const needsRebase = ancestorCheck.code === 0;

          if (needsRebase) {
            const rebaseResult = await gitExec(cwd, [
              "rebase", "--onto", `origin/${mergeBaseBranch}`, previousBranchTip,
            ]);
            if (rebaseResult.code !== 0) {
              await gitExec(cwd, ["rebase", "--abort"]);
              throw new Error(
                `Rebase of ${pr.headBranch} onto ${mergeBaseBranch} failed — resolve conflicts manually.`,
              );
            }
            requireOk(
              await gitExec(cwd, ["push", "--force-with-lease", "-u", "origin", `HEAD:${pr.headBranch}`]),
              `push rebased ${pr.headBranch}`,
            );
          }
        }

        // Merge with retry (GitHub may need time to recalculate mergeability
        // after retarget).
        await mergePrWithRetry(pr.number, pr.headBranch);
        merged.push({ number: pr.number, headBranch: pr.headBranch });

        await gitExec(cwd, ["fetch", "--quiet", "--prune", "origin"]);
      }
    }

    // -- Phase 3: finalize (runs AFTER all merges complete) --------------------
    // Checkout merge base, pull, then clean up branches. Matches hapcode's
    // finalizeMergedPullRequests — all deletion happens here, never mid-loop.

    async function finalize() {
      if (merged.length === 0) return;

      // Detect what branch the user is currently on
      const headResult = await gitExec(cwd, ["branch", "--show-current"]);
      const currentBranch = headResult.stdout.trim();

      // Fetch to get the latest remote state after merges
      await gitExec(cwd, ["fetch", "--quiet", "--prune", "origin"]);

      // Check if any merged PR had a protected head branch (e.g. pre-release → main).
      // If so, we want to stay on that branch instead of checking out the merge base.
      const mergedProtectedHead = merged.find((m) => isProtectedBranch(m.headBranch));

      // Sync protected branches first — they stay alive, just get reset to match
      // the merge base. Do this WITHOUT checking out the merge base to avoid
      // unnecessary working-tree churn (which triggers Vite HMR reloads when
      // the app manages its own repo).
      for (const { headBranch } of merged) {
        if (!isProtectedBranch(headBranch)) continue;
        if (headBranch === mergeBaseBranch) continue;

        try {
          if (currentBranch === headBranch) {
            // We're already on this branch — reset in place, no checkout needed
            await gitExec(cwd, ["reset", "--hard", `origin/${mergeBaseBranch}`]);
          } else {
            // Update the branch ref without checking it out
            await gitExec(cwd, ["update-ref", `refs/heads/${headBranch}`, `origin/${mergeBaseBranch}`]);
          }
          requireOk(
            await gitExec(cwd, ["push", "--force-with-lease", "-u", "origin", `HEAD:${headBranch}`]),
            `sync ${headBranch}`,
          );
        } catch { /* best effort */ }
      }

      // Delete non-protected merged branches
      for (const { headBranch } of merged) {
        if (isProtectedBranch(headBranch)) continue;
        await deleteBranchIfPresent(cwd, headBranch);
      }

      // Clean up auto-closed branches
      for (const branch of autoClosedBranches) {
        await deleteBranchIfPresent(cwd, branch);
      }

      // Decide where to end up:
      // - If user was on a protected head branch (e.g. pre-release → main), stay there
      // - If user was on a deleted feature branch, go to merge base
      // - Otherwise stay where we are
      if (mergedProtectedHead && currentBranch === mergedProtectedHead.headBranch) {
        // Already on the protected branch, already synced above
        finalBranch = mergedProtectedHead.headBranch;
      } else if (merged.some((m) => m.headBranch === currentBranch && !isProtectedBranch(m.headBranch))) {
        // Was on a deleted feature branch — move to merge base
        await gitExec(cwd, ["checkout", mergeBaseBranch]);
        await gitExec(cwd, ["pull", "--ff-only"]).catch(() => {});
        finalBranch = mergeBaseBranch;
      } else {
        // On some other branch (e.g. already on merge base) — just pull
        await gitExec(cwd, ["pull", "--ff-only"]).catch(() => {});
        finalBranch = currentBranch;
      }
    }

    try {
      await mergeLoop();
      await finalize();
      return { merged: merged.map((m) => m.number), finalBranch, error: null };
    } catch (err) {
      // Best-effort cleanup even on partial failure
      try { await finalize(); } catch { /* ignore cleanup errors */ }
      return {
        merged: merged.map((m) => m.number),
        finalBranch,
        error: err instanceof Error ? err.message : "Merge failed.",
      };
    }
  },
);

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
// Project favicon resolution
// ---------------------------------------------------------------------------

const FAVICON_CANDIDATES = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "app/favicon.ico",
  "app/favicon.png",
  "app/icon.svg",
  "app/icon.png",
  "app/icon.ico",
  "src/favicon.ico",
  "src/favicon.svg",
  "src/app/favicon.ico",
  "src/app/icon.svg",
  "src/app/icon.png",
  "assets/icon.svg",
  "assets/icon.png",
  "assets/logo.svg",
  "assets/logo.png",
  "build/icon.png",
  "build/icon.svg",
  "resources/icon.png",
  "resources/icon.svg",
];

const ICON_SOURCE_FILES = [
  "index.html",
  "public/index.html",
  "app/routes/__root.tsx",
  "src/routes/__root.tsx",
  "app/root.tsx",
  "src/root.tsx",
  "src/index.html",
];

const LINK_ICON_HTML_RE =
  /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/i;
const LINK_ICON_OBJ_RE =
  /(?=[^}]*\brel\s*:\s*["'](?:icon|shortcut icon)["'])(?=[^}]*\bhref\s*:\s*["']([^"'?]+))[^}]*/i;

const FAVICON_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function isPathWithinProject(projectCwd: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(projectCwd), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveProjectFavicon(cwd: string): Promise<string | null> {
  // Check well-known paths
  for (const candidate of FAVICON_CANDIDATES) {
    const full = path.join(cwd, candidate);
    if (!isPathWithinProject(cwd, full)) continue;
    try {
      const stat = await fs.promises.stat(full);
      if (stat.isFile()) return full;
    } catch {}
  }

  // Parse source files for <link rel="icon">
  for (const sourceFile of ICON_SOURCE_FILES) {
    const full = path.join(cwd, sourceFile);
    try {
      const content = await fs.promises.readFile(full, "utf8");
      const htmlMatch = content.match(LINK_ICON_HTML_RE);
      const href = htmlMatch?.[1] ?? content.match(LINK_ICON_OBJ_RE)?.[1];
      if (!href) continue;
      const clean = href.replace(/^\//, "");
      for (const resolved of [path.join(cwd, "public", clean), path.join(cwd, clean)]) {
        if (!isPathWithinProject(cwd, resolved)) continue;
        try {
          const stat = await fs.promises.stat(resolved);
          if (stat.isFile()) return resolved;
        } catch {}
      }
    } catch {}
  }

  return null;
}

ipcMain.handle("project:favicon", async (_event, cwd: string): Promise<string | null> => {
  const filePath = await resolveProjectFavicon(cwd);
  if (!filePath) return null;

  const ext = path.extname(filePath).toLowerCase();
  const mime = FAVICON_MIME[ext] ?? "application/octet-stream";
  const data = await fs.promises.readFile(filePath);
  return `data:${mime};base64,${data.toString("base64")}`;
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

// Resolve shell PATH for GUI apps on macOS (which don't inherit shell PATH)
function getEnvWithPath(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (process.platform === "darwin") {
    // Common locations for CLI tools installed via brew, npm, etc.
    const extraPaths = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      `${process.env.HOME}/.local/bin`,
      `${process.env.HOME}/.npm-global/bin`,
      `${process.env.HOME}/.cargo/bin`,
    ];
    const currentPath = env.PATH ?? "";
    const missing = extraPaths.filter((p) => !currentPath.includes(p));
    if (missing.length > 0) {
      env.PATH = [...missing, currentPath].join(":");
    }
  }
  return env;
}

const MODEL_PREF_PATH = path.join(app.getPath("userData"), "ai-model.txt");

function loadSavedModel(): string {
  try { return fs.readFileSync(MODEL_PREF_PATH, "utf-8").trim() || "claude-haiku-4-5"; }
  catch { return "claude-haiku-4-5"; }
}

let aiModel = loadSavedModel();

ipcMain.handle("ai:setModel", (_event, model: string) => {
  aiModel = model;
  fs.writeFileSync(MODEL_PREF_PATH, model, "utf-8");
});

ipcMain.handle("ai:getModel", () => aiModel);

ipcMain.handle("ai:checkCli", async (_event, cli: string): Promise<boolean> => {
  try {
    await execFileAsync(cli, ["--version"], {
      timeout: 5_000,
      env: getEnvWithPath(),
    });
    return true;
  } catch {
    return false;
  }
});

function isCodexModel(model: string): boolean {
  return model.startsWith("gpt-") || model.startsWith("o");
}

async function runClaudeSDK(prompt: string, model: string): Promise<string> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 60_000);

  try {
    const queryRun = query({
      prompt,
      options: {
        model,
        maxTurns: 1,
        effort: "low",
        persistSession: false,
        env: getEnvWithPath(),
        abortController,
        canUseTool: () => Promise.resolve({ behavior: "deny" as const, message: "No tools." }),
        pathToClaudeCodeExecutable: "claude",
      },
    });

    let resultText = "";
    for await (const message of queryRun as AsyncIterable<SDKMessage>) {
      if (message.type === "result" && message.subtype === "success") {
        resultText = message.result ?? "";
      }
    }

    if (!resultText) throw new Error("Claude SDK returned empty result");
    return resultText;
  } finally {
    clearTimeout(timeout);
  }
}

async function runCodexCLI(prompt: string, model: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const outputPath = path.join(tmpDir, `bettergit-codex-${Date.now()}.json`);
  await writeFileAsync(outputPath, "", "utf-8");

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn("codex", [
        "exec",
        "--ephemeral",
        "-s", "read-only",
        "--model", model,
        "--config", 'model_reasoning_effort="low"',
        "--output-last-message", outputPath,
        "-",
      ], {
        env: getEnvWithPath(),
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timer = setTimeout(() => { child.kill(); reject(new Error("Codex timed out")); }, 120_000);

      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
      child.on("close", async (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`Codex failed (exit ${code}): ${stderr}`));
          return;
        }
        try {
          const output = await readFileAsync(outputPath, "utf-8");
          const result = output.trim();
          if (!result) { reject(new Error("Codex returned empty output")); return; }
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  } finally {
    try { await unlinkAsync(outputPath); } catch { /* ignore */ }
  }
}

async function runAi(prompt: string): Promise<string> {
  if (isCodexModel(aiModel)) {
    return runCodexCLI(prompt, aiModel);
  }
  return runClaudeSDK(prompt, aiModel);
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
      limitSection(input.stagedSummary, 3_000),
      "",
      "Staged patch:",
      limitSection(input.stagedPatch, 8_000),
    ].join("\n");

    const text = await runAi(prompt);
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
      limitSection(input.commitSummary, 3_000),
      "",
      "Diff stat:",
      limitSection(input.diffSummary, 3_000),
      "",
      "Diff patch:",
      limitSection(input.diffPatch, 8_000),
    ].join("\n");

    const text = await runAi(prompt);
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

    const text = await runAi(prompt);
    const generated = extractJson<{ branch: string }>(text);
    return { branch: (generated.branch ?? "update").trim() };
  },
);
