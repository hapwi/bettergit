import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

/**
 * Vite plugin that exposes /__hmr/pause and /__hmr/resume endpoints.
 * When paused, chokidar file-change events are suppressed so that git
 * operations (checkout, merge, pull) that modify the working tree don't
 * trigger HMR reloads — critical when bettergit manages its own repo in dev.
 */
function hmrPause(): Plugin {
  let paused = false
  return {
    name: "hmr-pause",
    apply: "serve",
    configureServer(server) {
      const watcher = server.watcher
      const origEmit = watcher.emit.bind(watcher) as (
        event: string,
        ...args: unknown[]
      ) => boolean
      const patchedWatcher = watcher as typeof watcher & {
        emit: (event: string, ...args: unknown[]) => boolean
      }
      patchedWatcher.emit = function (event: string, ...args: unknown[]) {
        if (paused && (event === "change" || event === "add" || event === "unlink")) {
          return false
        }
        return origEmit(event, ...args)
      }
      server.middlewares.use((req, res, next) => {
        if (req.url === "/__hmr/pause") {
          paused = true
          res.writeHead(200, { "Access-Control-Allow-Origin": "*" })
          res.end("ok")
          return
        }
        if (req.url === "/__hmr/resume") {
          paused = false
          res.writeHead(200, { "Access-Control-Allow-Origin": "*" })
          res.end("ok")
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), hmrPause()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Recharts hits a Rolldown/CJS interop bug unless Decimal resolves to its ESM entry.
      "decimal.js-light": path.resolve(
        __dirname,
        "./node_modules/decimal.js-light/decimal.mjs",
      ),
    },
  },
  // Build for Electron — use relative paths so file:// loading works
  base: "./",
  // Prevent full-page reloads when git operations (checkout, pull) modify
  // non-source files in the project root during merge flows.
  server: {
    watch: {
      ignored: ["**/package.json", "**/package-lock.json"],
    },
  },
})
