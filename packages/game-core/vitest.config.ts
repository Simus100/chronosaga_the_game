import { configDefaults, defineConfig } from 'vitest/config';

// Vitest 4 dropped '**/dist/**' from its default exclude list, so the compiled
// copy of a test in dist/ is collected as a second, duplicate test file. The
// test count then depends on whether `pnpm build` has already run, which breaks
// reproducible P0 validation. Build output is never test source.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});
