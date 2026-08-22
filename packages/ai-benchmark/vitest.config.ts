import { configDefaults, defineConfig } from 'vitest/config';

// Vitest 4 dropped '**/dist/**' from its default exclude list. Build output is
// never test source, whatever tsconfig emits later.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});
