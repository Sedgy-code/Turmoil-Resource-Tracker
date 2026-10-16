// Lists every English text the interface translates, and reports any that
// are missing a Traditional Chinese, Simplified Chinese or Korean version.
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

const messagesSource = readFileSync(join(root, "src/lib/i18n/messages.ts"), "utf8");
const missing = [...keys].filter((key) => !messagesSource.includes(JSON.stringify(key) + ":"));
if (process.argv.includes("--list")) console.log(JSON.stringify([...keys].sort(), null, 1));
console.log(`${keys.size} texts, ${missing.length} without translations`);
for (const key of missing) console.log("  MISSING:", key);
process.exitCode = missing.length ? 1 : 0;
