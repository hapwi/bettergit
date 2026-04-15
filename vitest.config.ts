import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "server/__tests__/**/*.test.ts",
      "src/__tests__/**/*.test.ts",
      "shared/__tests__/**/*.test.ts",
    ],
  },
})
