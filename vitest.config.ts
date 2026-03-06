import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["Tests/**/*.test.ts"],
    environment: "node"
  }
});
