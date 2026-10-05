import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
let activeChild;
let stopping = false;

const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

function stop() {
  if (stopping) return;
  stopping = true;
  if (!activeChild?.pid || activeChild.exitCode !== null || activeChild.signalCode !== null) return;
  if (windows) {
    const shutdown = spawn("taskkill.exe", ["/PID", String(activeChild.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    shutdown.on("error", () => { activeChild?.kill(); });
    shutdown.on("exit", (code) => { if (code && activeChild?.exitCode === null && activeChild?.signalCode === null) activeChild.kill(); });
  } else {
    try { process.kill(-activeChild.pid, "SIGTERM"); } catch { activeChild.kill("SIGTERM"); }
  }
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

function launch(command, args, env) {
  const child = spawn(command, args, { cwd: project, env, stdio: "inherit", detached: !windows });
  activeChild = child;
  const exited = new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => done({ code, signal }));
  });
  // Attach a handler immediately while readiness is polled.
  exited.catch(() => {});
  return { child, exited };
}

async function availablePort() {
  for (let port = 3000; port <= 3010; port++) {
    const free = await new Promise((done) => {
      const probe = createServer();
      probe.once("error", () => done(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => done(true)));
    });
    if (free) return port;
  }
  throw new Error("The app's ports are already in use. Close another running copy of the tracker and try again.");
}

function browser(url) {
  if (process.env.TURMOIL_NO_BROWSER === "true") return;
  const command = windows ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = windows ? ["/d", "/s", "/c", `start "" "${url}"`] : [url];
  const opener = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: windows });
  opener.on("error", () => console.log(`Open your browser and type: ${url}`));
  opener.on("exit", (code) => { if (code) console.log(`Open your browser and type: ${url}`); });
  opener.unref();
}

async function main() {
  console.log("\nTURMOIL RESOURCE TRACKER\n");
  console.log("Starting the demo on your computer.\n");
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Please install Node.js 22 or newer, then open START-TURMOIL.bat again.");

  const env = {
    ...process.env,
    NODE_ENV: "development",
    DEMO_MODE: "true",
    LOCAL_DATABASE_PATH: join(project, ".data", "turmoil-demo"),
    npm_config_cache: join(tmpdir(), "turmoil-npm-cache"),
  };
  const lockHash = createHash("sha256").update(readFileSync(join(project, "package-lock.json"))).digest("hex");
  const receipt = join(project, ".data", "demo-install.sha256");
  const next = join(project, "node_modules", "next", "dist", "bin", "next");
  const installedHash = existsSync(receipt) ? readFileSync(receipt, "utf8").trim() : "";
  if (!existsSync(next) || installedHash !== lockHash) {
    console.log("First-time setup: downloading the app's required files.");
    console.log("This may take a few minutes. Please keep this window open.\n");
    const nodeDirectory = dirname(process.execPath);
    const npmCli = [
      join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
      resolve(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    ].find((candidate) => existsSync(candidate));
    const install = npmCli
      ? launch(process.execPath, [npmCli, "ci", "--loglevel=error", "--no-fund"], env)
      : windows
        ? launch("cmd.exe", ["/d", "/s", "/c", "npm ci --loglevel=error --no-fund"], env)
        : launch("npm", ["ci", "--loglevel=error", "--no-fund"], env);
    const result = await install.exited;
    if (stopping) return;
    if (result.code !== 0) {
      process.exitCode = result.code || 1;
      throw new Error("Setup could not finish. Check your internet connection, then double-click START-TURMOIL.bat to try again.");
    }
    mkdirSync(dirname(receipt), { recursive: true });
    writeFileSync(receipt, lockHash);
  }
  if (stopping) return;

  const port = await availablePort();
  if (stopping) return;
  const url = `http://localhost:${port}`;
  env.APP_URL = url;
  console.log("\nOpening the tracker. Please wait…\n");
  const server = launch(process.execPath, [next, "dev", "--hostname", "127.0.0.1", "--port", String(port)], env);
  let started = false;
  let earlyExit = false;
  server.exited.then(() => { earlyExit = true; }, () => { earlyExit = true; });
  const deadline = Date.now() + 120000;
  while (!stopping && !earlyExit && Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/session`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const session = await response.json();
        if (session.demo === true && session.user) { started = true; break; }
      }
    } catch { /* The server is still starting. */ }
    await pause(500);
  }
  if (stopping) { await server.exited; return; }
  if (!started) {
    stop();
    await server.exited;
    throw new Error("The tracker could not start. Close any other copy of the tracker, then try again.");
  }
  console.log("\nYour tracker is ready. Your browser will open automatically.");
  console.log(`If it does not open, type ${url} in your browser.`);
  console.log("Keep this window open while using the app.");
  console.log("This demo uses sample clan members and saves changes on this computer.\n");
  browser(url);
  const result = await server.exited;
  if (!stopping && result.code !== 0) throw new Error("The tracker stopped unexpectedly. Open START-TURMOIL.bat to try again.");
  console.log("\nTracker closed. Open START-TURMOIL.bat whenever you want to use it again.");
}

main().catch((error) => {
  stop();
  console.error(`\n${error instanceof Error ? error.message : "The tracker could not start. Please try again."}\n`);
  if (!process.exitCode) process.exitCode = 1;
});
