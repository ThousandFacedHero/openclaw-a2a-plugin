import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    tsconfig: "./tsconfig.test.json",
  },
});
