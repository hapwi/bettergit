/**
 * HTTP client for the bettergit server process.
 * All git, AI, and favicon operations go through here.
 */

let _port: number | null = null;

async function getServerPort(): Promise<number> {
  if (_port !== null) return _port;
  _port = (await window.electronAPI?.server.getPort()) ?? 4321;
  return _port;
}

export async function serverFetch<T>(path: string, body?: unknown): Promise<T> {
  const port = await getServerPort();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
