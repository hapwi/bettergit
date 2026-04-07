import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { getEnvWithPath, execFileAsync } from "./env";

const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);

// ---------------------------------------------------------------------------
// Model preference
// ---------------------------------------------------------------------------

let modelPrefPath = "";
let aiModel = "claude-haiku-4-5";

export function initModelPreference(userDataPath: string) {
  modelPrefPath = path.join(userDataPath, "ai-model.txt");
  try {
    aiModel = fs.readFileSync(modelPrefPath, "utf-8").trim() || "claude-haiku-4-5";
  } catch {
    aiModel = "claude-haiku-4-5";
  }
}

export function getModel(): string {
  return aiModel;
}

export function setModel(model: string) {
  aiModel = model;
  if (modelPrefPath) {
    fs.writeFileSync(modelPrefPath, model, "utf-8");
  }
}

export async function checkCli(cli: string): Promise<boolean> {
  try {
    await execFileAsync(cli, ["--version"], {
      timeout: 5_000,
      env: getEnvWithPath(),
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Text generation
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
        "exec", "--ephemeral", "-s", "read-only",
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
        if (code !== 0) { reject(new Error(`Codex failed (exit ${code}): ${stderr}`)); return; }
        try {
          const output = await readFileAsync(outputPath, "utf-8");
          const result = output.trim();
          if (!result) { reject(new Error("Codex returned empty output")); return; }
          resolve(result);
        } catch (err) { reject(err); }
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CommitMessageInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  includeBranch?: boolean;
}

export interface CommitMessageResult {
  subject: string;
  body: string;
  branch?: string;
}

export async function generateCommitMessage(input: CommitMessageInput): Promise<CommitMessageResult> {
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
}

export interface PrContentInput {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
}

export interface PrContentResult {
  title: string;
  body: string;
}

export async function generatePrContent(input: PrContentInput): Promise<PrContentResult> {
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
}

export interface BranchNameInput {
  message: string;
}

export interface BranchNameResult {
  branch: string;
}

export async function generateBranchName(input: BranchNameInput): Promise<BranchNameResult> {
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
}
