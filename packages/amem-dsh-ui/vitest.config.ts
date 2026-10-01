import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["client/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
