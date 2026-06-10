import globals from 'globals';

// Correctness-focused lint: every rule here catches a real runtime failure mode.
// The 2025 ESM migration left free-variable references that crashed the game at
// runtime (see falling.js getTile bug); no-undef is the regression guard for that.
export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, MM: 'readonly' },
    },
    rules: {
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-cond-assign': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-fallthrough': 'error',
      'no-unsafe-negation': 'error',
      'no-redeclare': 'error',
      'no-func-assign': 'error',
      'no-const-assign': 'error',
      'no-import-assign': 'error',
      'no-setter-return': 'error',
      'getter-return': 'error',
      'for-direction': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    },
  },
];
