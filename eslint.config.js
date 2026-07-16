import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'coverage/**',
      '**/*.config.{js,ts,mjs,cjs}',
      'apps/**/e2e/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-undef': 'off', // TypeScript handles undefined names
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
