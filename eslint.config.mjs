// eslint.config.mjs
import next from "eslint-config-next";

export default [
  ...next,
  {
    rules: {
      // import解決の失敗を検知
      "import/no-unresolved": "error",
      // 相対パスの ../* を警告
      "no-restricted-imports": [
        "warn",
        { patterns: ["../*", "./*../*"] }
      ]
    }
  }
];
