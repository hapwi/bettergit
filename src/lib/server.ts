/**
 * HTTP client for the bettergit server process.
 * All git, AI, and favicon operations go through here.
 */

let _port: number | null = null;
const SERVER_FETCH_TIMEOUT_MS = 15_000;

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

function isRetryableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error instanceof TypeError;
}

async function requestServer<T>(path: string, body?: unknown): Promise<T> {
  const port = await getServerPort();
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), SERVER_FETCH_TIMEOUT_MS)

  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  }).finally(() => window.clearTimeout(timeout))

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
  try {
    return await requestServer<T>(path, body)
  } catch (error) {
    if (!isRetryableConnectionError(error)) {
      throw error
    }

    await restartServerPort()
    return requestServer<T>(path, body)
  }
}
