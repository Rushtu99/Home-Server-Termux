import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'app/**/*.test.ts',
      'app/**/*.test.tsx',
      'test/**/*.test.ts',
      'test/**/*.test.tsx',
    ],
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'app/dashboard-utils.ts',
        'app/v2/workspaceMap.ts',
        'app/v2/errors.ts',
        'app/v2/llm-stream.ts',
        'app/demo-mode.ts',
        'app/useGatewayBase.ts',
        'app/usePolling.ts',
      ],
      thresholds: {
        statements: 75,
        branches: 65,
        functions: 75,
        lines: 75,
      },
    },
  },
});
