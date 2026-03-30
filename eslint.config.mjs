// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/apps/*/src/**',
                '**/chat-core/src/**',
                '**/conversation-service/src/**',
                '**/friendship-service/src/**',
                '**/gateway/src/**',
                '**/media-service/src/**',
                '**/media-worker/src/**',
                '**/message-store/src/**',
                '**/presence-service/src/**',
                '**/realtime-gateway/src/**',
                '**/users/src/**',
              ],
              message:
                'Do not import from app source directories directly. Use @app/* shared libraries, service contracts, or message patterns instead.',
            },
          ],
        },
      ],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
);
