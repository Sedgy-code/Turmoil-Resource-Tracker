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
/**
 * Every quoted text in the first argument of each t( ... ) call, including both sides of a
 * condition such as t(answer === "yes" ? "On the list." : "Saved."), but not the values being
 * compared ("yes") or anything inside a nested call.
 */
function firstArgument(text, from) {
  let depth = 1;
  let index = from;
  for (; index < text.length && depth > 0; index++) {
    const character = text[index];
    if (character === "(" || character === "[" || character === "{") depth++;
    else if (character === ")" || character === "]" || character === "}") depth--;
    else if (character === "," && depth === 1) break;
    else if (character === '"' || character === "'" || character === "`") {
      for (index++; index < text.length && text[index] !== character; index++) if (text[index] === "\\") index++;
    }
  }
  return text.slice(from, index);
}
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const call of text.matchAll(/\bt\(/g)) {
    const argument = firstArgument(text, call.index + call[0].length);
    for (const m of argument.matchAll(/((?:[!=]==?|\?\?)\s*)?"((?:[^"\\]|\\.)*)"/g)) {
      if (m[1]) continue; // a value being compared, not text to show
      const value = JSON.parse(`"${m[2]}"`);
      if (/[A-Za-z]{2}|[^\x00-\x7F]/.test(value)) keys.add(value);
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
