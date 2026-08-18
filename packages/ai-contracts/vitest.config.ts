import { configDefaults, defineConfig } from 'vitest/config';

// Vitest 4 dropped '**/dist/**' from its default exclude list. This package does
// not currently emit its tests into dist/, but the guarantee must hold here too:
// build output is never test source, whatever tsconfig emits later.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});
