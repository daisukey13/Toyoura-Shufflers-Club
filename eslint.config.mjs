// eslint.config.mjs
import '@rushstack/eslint-patch/modern-module-resolution.js'; // ★ 追加/修正
import next from 'eslint-config-next';

export default [
  { ignores: ['node_modules/**', '.next/**', 'supabase/**', 'audit/**'] },
  ...next,
  {
    rules: {
      // パスエイリアス(@/...)の誤検知を最小回避（将来resolver導入で外せます）
      'import/no-unresolved': ['error', { ignore: ['^@/'] }],
      'no-restricted-imports': ['warn', { patterns: ['../*', './*../*'] }],
    },
  },
];
