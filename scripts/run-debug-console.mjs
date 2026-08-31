import { spawn } from "node:child_process";

const serviceUrl = "http://127.0.0.1:8000/health";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

async function hasLocalService() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 700);

  try {
    const response = await fetch(serviceUrl, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function start(command, args) {
  return spawn(command, args, {
    detached: process.platform !== "win32",
    stdio: "inherit",
  });
}

function stop(child) {
  if (!child?.pid) return;

  if (process.platform === "win32") {
    child.kill("SIGTERM");
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function waitForLocalService() {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (await hasLocalService()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("The local BrainFlow service did not become ready within 20 seconds.");
}

let backend;
let consoleServer;
let stopping = false;

function stopChildren(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  stop(consoleServer);
  stop(backend);
  process.exitCode = exitCode;
}

process.on("SIGINT", () => stopChildren());
process.on("SIGTERM", () => stopChildren());

try {
  if (await hasLocalService()) {
    console.log("Using the existing local BrainFlow service on port 8000.");
  } else {
    console.log("Starting the local BrainFlow service on port 8000.");
    backend = start(npmCommand, ["run", "brainflow"]);
    backend.on("exit", (code) => {
      if (!stopping) {
        console.error(`BrainFlow service exited unexpectedly (code ${code ?? "unknown"}).`);
        stopChildren(1);
      }
    });
    await waitForLocalService();
  }

  consoleServer = start(npmCommand, ["run", "debug_console:web"]);
  consoleServer.on("exit", (code) => stopChildren(code ?? 1));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stopChildren(1);
}
