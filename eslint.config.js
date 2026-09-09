import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-empty-object-type': 'off', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', fetch: 'readonly', process: 'readonly' } },
  },
);
