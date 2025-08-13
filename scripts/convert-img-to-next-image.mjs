#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { globSync } from "glob";
import babelTs from "recast/parsers/babel-ts.js"; // ← 拡張子 .js を明示
import recast from "recast";

const exts = ["tsx", "jsx"]; // 必要に応じて "ts","js" も追加
const b = recast.types.builders;

const files = globSync(`**/*.+(${exts.join("|")})`, {
  ignore: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/build/**"],
});

if (files.length === 0) {
  console.log("対象ファイルが見つかりませんでした。");
  process.exit(0);
}

let totalConverted = 0;
const dimWarnings = [];
const externalHosts = new Set();
const parseFailures = [];

for (const file of files) {
  const code = fs.readFileSync(file, "utf8");

  let ast;
  try {
    ast = recast.parse(code, { parser: babelTs }); // TS/JSX対応パーサ
  } catch (e) {
    parseFailures.push({ file, message: e?.message || String(e) });
    continue;
  }

  let changed = false;
  let hasNextImageImport = false;

  recast.types.visit(ast, {
    visitImportDeclaration(p) {
      if (p.node.source?.value === "next/image") hasNextImageImport = true;
      this.traverse(p);
    },
  });

  recast.types.visit(ast, {
    visitJSXOpeningElement(p) {
      const node = p.node;
      if (node.name?.type === "JSXIdentifier" && node.name.name === "img") {
        node.name = b.jsxIdentifier("Image");
        changed = true;
        totalConverted++;

        let hasWidth = false;
        let hasHeight = false;
        let hasFill = false;

        node.attributes = node.attributes.map((attr) => {
          if (!attr || attr.type !== "JSXAttribute") return attr;

          if (attr.name?.name === "class") attr.name.name = "className";

          if (attr.name?.name === "width" || attr.name?.name === "height") {
            const v = attr.value;
            if (v && v.type === "StringLiteral" && /^\d+$/.test(v.value)) {
              attr.value = b.jsxExpressionContainer(
                b.numericLiteral(parseInt(v.value, 10))
              );
            }
            if (attr.name.name === "width") hasWidth = true;
            if (attr.name.name === "height") hasHeight = true;
          }

          if (attr.name?.name === "fill") hasFill = true;

          if (attr.name?.name === "src") {
            let raw = null;
            if (attr.value?.type === "StringLiteral") raw = attr.value.value;
            if (attr.value?.type === "JSXExpressionContainer") {
              const expr = attr.value.expression;
              if (expr?.type === "StringLiteral") raw = expr.value;
            }
            if (typeof raw === "string" && /^https?:\/\//.test(raw)) {
              try {
                const u = new URL(raw);
                externalHosts.add(u.host);
              } catch {}
            }
          }
          return attr;
        });

        if (!hasWidth && !hasHeight && !hasFill) {
          dimWarnings.push(file);
        }
      }
      this.traverse(p);
    },

    visitJSXClosingElement(p) {
      if (p.node.name?.type === "JSXIdentifier" && p.node.name.name === "img") {
        p.node.name = b.jsxIdentifier("Image");
        changed = true;
      }
      this.traverse(p);
    },
  });

  if (changed && !hasNextImageImport) {
    const importDecl = b.importDeclaration(
      [b.importDefaultSpecifier(b.identifier("Image"))],
      b.stringLiteral("next/image")
    );
    ast.program.body.unshift(importDecl);
  }

  if (changed) {
    try {
      const output = recast.print(ast).code;
      fs.writeFileSync(file, output, "utf8");
      console.log(`Converted: ${file}`);
    } catch (e) {
      parseFailures.push({ file, message: "print failed: " + (e?.message || e) });
    }
  }
}

console.log("\n--- 変換サマリ ---");
console.log(`変換ファイル数: ${totalConverted}`);

if (dimWarnings.length) {
  console.log("\n[要対応] width/height もしくは fill が未指定のファイル:");
  [...new Set(dimWarnings)].forEach((w) => console.log(" - " + w));
  console.log("\n→ next/image は width/height か fill が必要です。該当ファイル内の <Image> に指定してください。");
}

if (externalHosts.size) {
  console.log("\n[要設定] 外部ドメイン (next.config.js の images.domains へ追加):");
  externalHosts.forEach((h) => console.log(" - " + h));
}

if (parseFailures.length) {
  console.log("\n[スキップしたファイル] 解析に失敗:");
  parseFailures.forEach((f) => console.log(` - ${f.file}: ${f.message}`));
}

console.log("\n完了。");
