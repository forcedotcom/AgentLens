import { defineConfig } from 'vitest/config';

// Tests drive the real index.html through jsdom (constructed per-test in the
// harness), so the default Node environment is all Vitest itself needs.
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
});
