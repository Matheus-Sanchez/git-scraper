const sharedGlobals = {
  AbortController: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  process: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
};

export default [
  {
    ignores: [
      '.cache/**',
      'data/**',
      'docs/data/**',
      'docs/vendor/**',
      'node_modules/**',
    ],
  },
  {
    files: [
      '.github/scripts/**/*.mjs',
      'eslint.config.js',
      'scripts/**/*.mjs',
      'src/**/*.js',
      'test/**/*.js',
      'test_support/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: sharedGlobals,
    },
    rules: {
      'array-callback-return': 'error',
      eqeqeq: ['error', 'always'],
      'no-constant-binary-expression': 'error',
      'no-dupe-else-if': 'error',
      'no-empty-pattern': 'error',
      'no-irregular-whitespace': 'error',
      'no-loss-of-precision': 'error',
      'no-self-assign': 'error',
      'no-template-curly-in-string': 'error',
      'no-unreachable-loop': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
];
