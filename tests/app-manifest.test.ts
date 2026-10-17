import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import manifest from "../src/app/manifest";

// Tests run from the project folder (npm test).
const root = process.cwd();

function pngSize(file: string) {
  const bytes = readFileSync(file);
  assert.equal(bytes.toString("ascii", 1, 4), "PNG", `${file} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("the hub opens like an app from a phone's home screen", () => {
  const app = manifest();
  assert.equal(app.display, "standalone");
  assert.equal(app.start_url, "/");
  assert.equal(app.scope, "/");
  assert.equal(app.short_name, "Turmoil");
  assert.ok(app.icons?.some((icon) => icon.purpose === "maskable"), "Android needs a maskable icon");
  assert.ok(app.icons?.some((icon) => icon.purpose === "any" && icon.sizes === "512x512"), "install needs a 512px icon");
});

test("every home screen icon exists at the size the manifest promises", () => {
  for (const icon of manifest().icons ?? []) {
    const [width, height] = String(icon.sizes).split("x").map(Number);
    assert.deepEqual(pngSize(join(root, "public", icon.src)), { width, height }, icon.src);
  }
  assert.deepEqual(pngSize(join(root, "src/app/apple-icon.png")), { width: 180, height: 180 });
});
