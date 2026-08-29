import { defineConfig } from 'vitest/config';

// Deliberately separate from vite.config.js rather than a `test` key inside it.
// Vitest reads this file and the production build keeps reading vite.config.js,
// so nothing here can affect what ships.
//
// environment: 'node' because everything under test in src/utils/helpers.js is
// a pure function — no DOM, no React. That keeps jsdom/happy-dom out of the
// dependency tree entirely; Vitest lists them as optional peers precisely so a
// suite like this one does not have to install them.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    setupFiles: ['./vitest.setup.js'],
  },
});
