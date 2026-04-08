/**
 * HMR pause/resume for dev mode.
 * Prevents Vite from triggering hot reloads when git operations
 * (checkout, merge, pull) modify source files in the working tree.
 */

export async function pauseHmr(): Promise<void> {
  if (!import.meta.env.DEV) return;
  await fetch("/__hmr/pause").catch(() => {});
}

export async function resumeHmr(): Promise<void> {
  if (!import.meta.env.DEV) return;
  // Brief delay so chokidar's pending file-system events drain before we
  // start listening again — avoids a stale change event sneaking through.
  await new Promise((r) => setTimeout(r, 150));
  await fetch("/__hmr/resume").catch(() => {});
}
