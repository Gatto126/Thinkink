import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { builtinModules } from 'node:module';

const nodeImports = [
  ...new Set(
    builtinModules.flatMap((name) => [
      name,
      `node:${name.replace(/^node:/, '')}`,
    ]),
  ),
];
const sharedInternals = {
  group: ['**/packages/shared/**', '@thinkink/shared/src/**'],
  message:
    'Use a public @thinkink/shared export instead of reaching into its source directory.',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.wrangler/**',
      '**/.generated/**',
      '**/supabase/.temp/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/frontend/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: nodeImports,
          patterns: [
            sharedInternals,
            {
              group: [
                '@thinkink/backend',
                '@thinkink/backend/**',
                '**/backend/**',
                'cloudflare:*',
                'wrangler',
                'supabase',
                'node:*',
              ],
              message:
                'Frontend code can use shared contracts and HTTP/WebSockets, never backend code or server dependencies.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/backend/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            sharedInternals,
            {
              group: [
                '@thinkink/frontend',
                '@thinkink/frontend/**',
                '**/frontend/**',
                'react',
                'react/**',
                'react-dom',
                'react-dom/**',
                'vite',
                'vite/**',
              ],
              message:
                'Backend code must not depend on frontend code, React, or Vite.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: nodeImports,
          patterns: [
            {
              group: [
                '@thinkink/frontend',
                '@thinkink/frontend/**',
                '@thinkink/backend',
                '@thinkink/backend/**',
                '**/apps/**',
                'react',
                'react/**',
                'react-dom',
                'react-dom/**',
                'vite',
                'vite/**',
                'cloudflare:*',
                'node:*',
              ],
              message:
                'Shared contracts must be independent of both applications and their runtimes.',
            },
          ],
        },
      ],
    },
  },
);
