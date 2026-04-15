import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run tests from the tests/ directory
    include: ["tests/**/*.test.ts"],
    // Increase timeout for integration tests
    testTimeout: 30_000,
    // Use threads (default) for isolation
    pool: "threads",
  },
});
