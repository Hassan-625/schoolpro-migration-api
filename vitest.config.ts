import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // TypeScript tests are compiled into dist by the build command. Run each
    // source test once; never rediscover the compiled copies.
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Tests must not inherit Render's real DATABASE_URL (or a malformed value).
    // The suite uses mocked DB clients and must never connect to this URL.
    setupFiles: ['./tests/setup-env.ts']
  }
});
