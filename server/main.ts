import http from "node:http";
import {
  execGit,
  execGh,
  listBranches,
  getDefaultBranch,
  getCurrentBranch,
  checkoutBranch,
  createBranch,
  deleteBranch,
  getLog,
  stageFiles,
  stageAll,
  unstageFiles,
  createCommit,
  getDiff,
  discardAllChanges,
  getFullDiffPatch,
  getDiffStat,
  listOpenPullRequests,
  getPullRequest,
  createPullRequest,
  mergePullRequest,
  createGhRepo,
  getGhDefaultBranch,
  push,
  pull,
  fetch,
  hasOriginRemote,
  getOriginRepoSlugValue,
  getRecentCommits,
  getOpenPrs,
  getMergedPrs,
  getForkParent,
  getGhAuthStatus,
  switchToMain,
  setupRepository,
  renameMasterToMain,
  createPreReleaseBranch,
  getPreReleaseAheadCount,
  getCurrentVersion,
  createReleasePullRequest,
  runStackedAction,
  getRepoStats,
  getStatus,
  mergePullRequests,
  versionBump,
} from "./git";
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
  "POST /api/git/status": async (body) => getStatus(body as Parameters<typeof getStatus>[0]),
  "POST /api/git/stats": async (body) => getRepoStats(body as Parameters<typeof getRepoStats>[0]),
  "POST /api/git/branches/list": async (body) => listBranches(body as Parameters<typeof listBranches>[0]),
  "POST /api/git/branches/default": async (body) => getDefaultBranch(body as Parameters<typeof getDefaultBranch>[0]),
  "POST /api/git/branches/current": async (body) => getCurrentBranch(body as Parameters<typeof getCurrentBranch>[0]),
  "POST /api/git/branches/checkout": async (body) => checkoutBranch(body as Parameters<typeof checkoutBranch>[0]),
  "POST /api/git/branches/create": async (body) => createBranch(body as Parameters<typeof createBranch>[0]),
  "POST /api/git/branches/delete": async (body) => deleteBranch(body as Parameters<typeof deleteBranch>[0]),
  "POST /api/git/commits/log": async (body) => getLog(body as Parameters<typeof getLog>[0]),
  "POST /api/git/commits/stage-files": async (body) => stageFiles(body as Parameters<typeof stageFiles>[0]),
  "POST /api/git/commits/stage-all": async (body) => stageAll(body as Parameters<typeof stageAll>[0]),
  "POST /api/git/commits/unstage-files": async (body) => unstageFiles(body as Parameters<typeof unstageFiles>[0]),
  "POST /api/git/commits/create": async (body) => createCommit(body as Parameters<typeof createCommit>[0]),
  "POST /api/git/commits/diff": async (body) => getDiff(body as Parameters<typeof getDiff>[0]),
  "POST /api/git/commits/discard-all": async (body) => discardAllChanges(body as Parameters<typeof discardAllChanges>[0]),
  "POST /api/git/commits/full-diff-patch": async (body) => getFullDiffPatch(body as Parameters<typeof getFullDiffPatch>[0]),
  "POST /api/git/commits/diff-stat": async (body) => getDiffStat(body as Parameters<typeof getDiffStat>[0]),
  "POST /api/github/prs/open": async (body) => listOpenPullRequests(body as Parameters<typeof listOpenPullRequests>[0]),
  "POST /api/github/pr": async (body) => getPullRequest(body as Parameters<typeof getPullRequest>[0]),
  "POST /api/github/pr/create": async (body) => createPullRequest(body as Parameters<typeof createPullRequest>[0]),
  "POST /api/github/pr/merge": async (body) => mergePullRequest(body as Parameters<typeof mergePullRequest>[0]),
  "POST /api/github/repo/create": async (body) => createGhRepo(body as Parameters<typeof createGhRepo>[0]),
  "POST /api/github/repo/default-branch": async (body) => getGhDefaultBranch(body as Parameters<typeof getGhDefaultBranch>[0]),
  "POST /api/github/repo/fork-parent": async (body) => getForkParent(body as Parameters<typeof getForkParent>[0]),
  "POST /api/github/auth-status": async (body) => getGhAuthStatus(body as Parameters<typeof getGhAuthStatus>[0]),
  "POST /api/git/remote/push": async (body) => push(body as Parameters<typeof push>[0]),
  "POST /api/git/remote/pull": async (body) => pull(body as Parameters<typeof pull>[0]),
  "POST /api/git/remote/fetch": async (body) => fetch(body as Parameters<typeof fetch>[0]),
  "POST /api/git/remote/has-origin": async (body) => hasOriginRemote(body as Parameters<typeof hasOriginRemote>[0]),
  "POST /api/git/remote/origin-slug": async (body) => getOriginRepoSlugValue(body as Parameters<typeof getOriginRepoSlugValue>[0]),
  "POST /api/git/setup/switch-main": async (body) => switchToMain(body as Parameters<typeof switchToMain>[0]),
  "POST /api/git/setup/repository": async (body) => setupRepository(body as Parameters<typeof setupRepository>[0]),
  "POST /api/git/setup/rename-master-main": async (body) => renameMasterToMain(body as Parameters<typeof renameMasterToMain>[0]),
  "POST /api/git/setup/pre-release": async (body) => createPreReleaseBranch(body as Parameters<typeof createPreReleaseBranch>[0]),
  "POST /api/git/release/pre-release-ahead": async (body) => getPreReleaseAheadCount(body as Parameters<typeof getPreReleaseAheadCount>[0]),
  "POST /api/git/release/current-version": async (body) => getCurrentVersion(body as Parameters<typeof getCurrentVersion>[0]),
  "POST /api/git/release/create-pr": async (body) => createReleasePullRequest(body as Parameters<typeof createReleasePullRequest>[0]),
  "POST /api/git/dashboard/recent-commits": async (body) => getRecentCommits(body as Parameters<typeof getRecentCommits>[0]),
  "POST /api/git/dashboard/open-prs": async (body) => getOpenPrs(body as Parameters<typeof getOpenPrs>[0]),
  "POST /api/git/dashboard/merged-prs": async (body) => getMergedPrs(body as Parameters<typeof getMergedPrs>[0]),
  "POST /api/git/actions/stacked": async (body) => runStackedAction(body as Parameters<typeof runStackedAction>[0]),
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
