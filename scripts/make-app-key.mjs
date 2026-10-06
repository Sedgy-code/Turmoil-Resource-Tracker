import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const key = randomBytes(48).toString("base64url");
console.log("\nTURMOIL - YOUR PRIVATE APP KEY\n");
console.log("Put the following value in Vercel's AUTH_SECRET setting:\n");
console.log(key);
console.log("\nKeep this value private. It belongs in your Vercel settings, not in chat.");
console.log("Once saved, keep the same AUTH_SECRET for future deployments.\n");

if (process.platform === "win32") {
  const clipboard = spawn("clip.exe", [], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
  clipboard.on("error", () => console.log("Select the key above and copy it manually."));
  clipboard.stdin.on("error", () => {});
  clipboard.on("exit", (code) => {
    console.log(code === 0 ? "The key is copied to your clipboard. Paste it into AUTH_SECRET using Ctrl+V." : "Select the key above and copy it manually.");
  });
  clipboard.stdin.end(key);
}
