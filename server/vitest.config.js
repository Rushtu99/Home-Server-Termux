const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.js'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'lib/**/*.js',
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
