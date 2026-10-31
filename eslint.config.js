import regexp from 'eslint-plugin-regexp';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'coverage/**',
      '**/*.config.{js,ts,mjs,cjs}',
      'apps/**/e2e/**',
      // Vendored three/emscripten decoder — not ours to lint.
      'apps/playground/public/draco/**',
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
  {
    // The class CodeQL reports as js/polynomial-redos, caught at lint time: twice it reached a release PR and blocked it
    // (#359's scalar-bound hint, #383's choreography cue pattern). Two quantifiers that can trade the same characters.
    files: ['**/*.ts'],
    ignores: ['**/*.test.ts'], // a test's own pattern never sees outside input
    plugins: { regexp },
    rules: { 'regexp/no-super-linear-backtracking': 'error' },
  },
);
