import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const outDir = join(process.cwd(), "audit");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
function run(cmd, outfile) {
  try {
    const out = execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] });
    if (outfile) writeFileSync(join(outDir, outfile), out);
    console.log(`✔ ${cmd}`);
  } catch (e) {
    if (outfile) writeFileSync(
      join(outDir, outfile),
      (e.stdout?.toString() ?? "") + "\n--- STDERR ---\n" + (e.stderr?.toString() ?? "")
    );
    console.log(`✖ ${cmd} (logged to ${outfile})`);
  }
}
run("tsc -p tsconfig.json --noEmit", "typecheck.txt");
run("eslint . --ext .ts,.tsx", "eslint.txt");
run("prettier -c .", "prettier.txt");
run("next build", "next-build.txt");
run("depcheck --json", "depcheck.json");
run("knip --reporter json", "knip.json");
run("madge --circular --extensions ts,tsx --json .", "madge.json");
run("grep -RIn \"Module not found\" .next || true", "next-module-errors.txt");
run("ls -la .env* || true", "env-files.txt");
console.log("\nAudit complete. See ./audit/");
