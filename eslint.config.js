import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.context/**',
      'packages/cli/README.md',
      'packages/cli/LICENSE',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
      sourceType: 'module',
    },
    rules: {
      // ANSI escape sequences are matched intentionally when parsing terminal output.
      'no-control-regex': 'off',
      // Existing adapter/test code uses dynamic parsed JSON shapes. Typecheck still
      // enforces the surrounding contracts; tightening these is a separate cleanup.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['packages/web/src/**/*.{ts,tsx}', 'packages/web/*.{ts,mts}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.browser,
        ...globals.node,
        ...globals.vitest,
      },
    },
  },
);
