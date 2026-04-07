import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
