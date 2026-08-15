import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'coverage/**',
      '**/*.config.{js,ts,mjs,cjs}',
      'apps/**/e2e/**',
      '.claude/**', // agent worktrees carry their own checkout — never lint them
    ],
  },
  ...tseslint.configs.recommended,
  {
    // Explicit root: with agent worktrees under .claude/, tsconfigRootDir
    // inference sees two candidate roots and errors on every file.
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
    rules: {
      'no-undef': 'off', // TypeScript handles undefined names
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
