import http from "node:http";
import { execGit, execGh, mergePullRequests, versionBump } from "./git";
import * as ai from "./ai";
import { getProjectFavicon } from "./favicon";
import { fixPath } from "./env";

// Resolve the user's full shell PATH before anything else — macOS GUI apps
// don't inherit the login shell's PATH, so tools like git, gh, claude won't
// be found without this. Matches hapcode's os-jank.fixPath().
fixPath();

const port = parseInt(process.env.BETTERGIT_SERVER_PORT ?? "0", 10);
const userDataPath = process.env.BETTERGIT_USER_DATA ?? "";

if (userDataPath) {
  ai.initModelPreference(userDataPath);
}

// ---------------------------------------------------------------------------
// HTTP server — plain Node, no dependencies
// ---------------------------------------------------------------------------

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function error(res: http.ServerResponse, message: string, status = 500) {
  json(res, { error: message }, status);
}

type RouteHandler = (body: unknown) => Promise<unknown>;

const routes: Record<string, RouteHandler> = {
  "POST /api/git/exec": async (body) => execGit(body as Parameters<typeof execGit>[0]),
  "POST /api/gh/exec": async (body) => execGh(body as Parameters<typeof execGh>[0]),
  "POST /api/git/merge-prs": async (body) => mergePullRequests(body as Parameters<typeof mergePullRequests>[0]),
  "POST /api/git/version-bump": async (body) => versionBump(body as Parameters<typeof versionBump>[0]),
  "POST /api/ai/commit-msg": async (body) => ai.generateCommitMessage(body as Parameters<typeof ai.generateCommitMessage>[0]),
  "POST /api/ai/pr-content": async (body) => ai.generatePrContent(body as Parameters<typeof ai.generatePrContent>[0]),
  "POST /api/ai/branch-name": async (body) => ai.generateBranchName(body as Parameters<typeof ai.generateBranchName>[0]),
  "POST /api/ai/set-model": async (body) => { ai.setModel((body as { model: string }).model); return { ok: true }; },
  "POST /api/project/favicon": async (body) => ({ favicon: await getProjectFavicon((body as { cwd: string }).cwd) }),
};

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const key = `${req.method} ${url.pathname}`;

  // Simple GET routes
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/api/ai/model") {
    return json(res, { model: ai.getModel() });
  }
  if (req.method === "GET" && url.pathname === "/api/ai/check-cli") {
    const cli = url.searchParams.get("cli") ?? "claude";
    return json(res, { available: await ai.checkCli(cli) });
  }
  const handler = routes[key];
  if (!handler) {
    return error(res, `Not found: ${key}`, 404);
  }

  try {
    const rawBody = await readBody(req);
    const body = rawBody.length > 0 ? JSON.parse(rawBody) : {};
    const result = await handler(body);
    json(res, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error(`[server] ${key} error:`, err instanceof Error ? err.stack ?? err.message : err);
    error(res, message);
  }
});

server.listen(port, "127.0.0.1", () => {
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  // Electron main reads this line to discover the port
  console.log(`BETTERGIT_SERVER_PORT=${actualPort}`);
});
