// Lists every English text the interface translates, and reports any that
// are missing from a language file in src/lib/i18n/locales.
// Run: node scripts/i18n-keys.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(tsx?|mjs)$/.test(name) && !path.includes("/i18n/")) files.push(path);
  }
};
walk(join(root, "src"));

const keys = new Set();
const literal = /\bt\(\s*"((?:[^"\\]|\\.)*)"/g;
const ternary = /\bt\(\s*[^()"]*?\?\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(literal)) keys.add(JSON.parse(`"${match[1]}"`));
  for (const match of text.matchAll(ternary)) { keys.add(JSON.parse(`"${match[1]}"`)); keys.add(JSON.parse(`"${match[2]}"`)); }
  // Multi-branch t(a ? "x" : b ? "y" : "z") blocks: collect every quoted string inside t( ... )
  for (const block of text.matchAll(/\bt\((\s*[a-zA-Z.!=<>&|\s]+\?[\s\S]*?)\)\}/g)) {
    for (const m of block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const value = JSON.parse(`"${m[1]}"`);
      if (/[A-Za-z]{2}/.test(value) && !/^(dashboard|resources|members|war|snipes|store|weeks|yes|no|history|ADMIN|all|submitted|pending|mine|clan|member)$/.test(value)) keys.add(value);
    }
  }
}
const { INDIRECT_KEYS } = await import(join(root, "src/lib/i18n/indirect-keys.mjs"));
for (const key of INDIRECT_KEYS) keys.add(key);

const localesDir = join(root, "src/lib/i18n/locales");
let missingTotal = 0;
if (process.argv.includes("--list")) console.log(JSON.stringify([...keys].sort(), null, 1));
for (const file of readdirSync(localesDir).filter((name) => name.endsWith(".json")).sort()) {
  const dictionary = JSON.parse(readFileSync(join(localesDir, file), "utf8"));
  const missing = [...keys].filter((key) => typeof dictionary[key] !== "string" || !dictionary[key].trim());
  // Placeholders such as {count} must survive translation.
  const broken = [...keys].filter((key) => typeof dictionary[key] === "string" &&
    (key.match(/\{\w+\}/g) ?? []).some((name) => !dictionary[key].includes(name)));
  missingTotal += missing.length + broken.length;
  console.log(`${file}: ${keys.size} texts, ${missing.length} missing, ${broken.length} with a broken {placeholder}`);
  for (const key of missing) console.log("  MISSING:", key);
  for (const key of broken) console.log("  PLACEHOLDER:", key);
}
process.exitCode = missingTotal ? 1 : 0;
