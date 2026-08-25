import { configDefaults, defineConfig } from 'vitest/config';

// Same reason as the other packages: Vitest 4 no longer excludes dist/, so the
// compiled copy of a test would be collected twice and the count would depend
// on whether a build had run.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});
