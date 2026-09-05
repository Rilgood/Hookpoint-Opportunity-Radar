import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    // The Express app and the radar core it mounts keep a process-wide
    // database singleton, so the suite runs in a single worker.
    fileParallelism: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
