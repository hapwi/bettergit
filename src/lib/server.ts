/**
 * HTTP client for the bettergit server process.
 * All git, AI, and favicon operations go through here.
 */

let _port: number | null = null;
const SERVER_FETCH_TIMEOUT_MS = 15_000;
const LONG_RUNNING_FETCH_TIMEOUT_MS = 10 * 60_000;

interface ServerRequestOptions {
  timeoutMs?: number;
  retryOnConnectionError?: boolean;
}

function getRequestOptions(path: string): ServerRequestOptions {
  if (
    path === "/api/git/remote/push" ||
    path === "/api/git/remote/pull" ||
    path === "/api/git/remote/fetch" ||
    path === "/api/git/actions/stacked" ||
    // Release PR creation can include AI generation before `gh pr create`.
    path === "/api/git/release/create-pr" ||
    path === "/api/git/merge-prs" ||
    path === "/api/github/pr/merge"
  ) {
    return {
      timeoutMs: LONG_RUNNING_FETCH_TIMEOUT_MS,
      retryOnConnectionError: false,
    };
  }

  return {
    timeoutMs: SERVER_FETCH_TIMEOUT_MS,
    retryOnConnectionError: true,
  };
}

async function getServerPort(): Promise<number> {
  if (_port !== null) return _port;
  _port = (await window.electronAPI?.server.getPort()) ?? 4321;
  return _port;
}

function clearServerPort(): void {
  _port = null;
}

async function restartServerPort(): Promise<void> {
  clearServerPort();
  _port = (await window.electronAPI?.server.restart?.()) ?? (await getServerPort());
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isRetryableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error instanceof TypeError;
}

async function requestServer<T>(
  path: string,
  body?: unknown,
  options?: ServerRequestOptions,
): Promise<T> {
  const port = await getServerPort();
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? SERVER_FETCH_TIMEOUT_MS
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: body !== undefined ? "POST" : "GET",
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s. The operation may still be running.`,
        { cause: error },
      )
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }

  if (!res.ok) {
    const text = await res.text();
    let message: string;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      message = parsed.error ?? text;
    } catch {
      message = text;
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function serverFetch<T>(path: string, body?: unknown): Promise<T> {
  const options = getRequestOptions(path)
  try {
    return await requestServer<T>(path, body, options)
  } catch (error) {
    if (!options.retryOnConnectionError || !isRetryableConnectionError(error)) {
      throw error
    }

    await restartServerPort()
    return requestServer<T>(path, body, options)
  }
}
