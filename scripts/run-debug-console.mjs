import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const serviceUrl = "http://127.0.0.1:8000/health";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const execFileAsync = promisify(execFile);

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

async function listenerPids() {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile", "-Command",
      "(Get-NetTCPConnection -LocalPort 8000 -State Listen).OwningProcess",
    ]);
    return stdout.split(/\s+/).filter((value) => /^\d+$/.test(value));
  }
  const { stdout } = await execFileAsync("lsof", ["-tiTCP:8000", "-sTCP:LISTEN"]);
  return stdout.split(/\s+/).filter((value) => /^\d+$/.test(value));
}

async function restartExistingService() {
  if (!(await hasLocalService())) return;

  console.log("Restarting the existing local BrainFlow service on port 8000.");
  const pids = await listenerPids();
  if (pids.length === 0) {
    throw new Error("A service answered on port 8000, but its listener process could not be identified.");
  }

  for (const pid of pids) {
    if (process.platform === "win32") {
      await execFileAsync("taskkill.exe", ["/PID", pid, "/T", "/F"]);
    } else {
      process.kill(Number(pid), "SIGTERM");
    }
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!(await hasLocalService())) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The existing BrainFlow service did not stop within 5 seconds.");
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
  await restartExistingService();
  console.log("Starting the local BrainFlow service on port 8000.");
  backend = start(npmCommand, ["run", "brainflow"]);
  backend.on("exit", (code) => {
    if (!stopping) {
      console.error(`BrainFlow service exited unexpectedly (code ${code ?? "unknown"}).`);
      stopChildren(1);
    }
  });
  await waitForLocalService();

  consoleServer = start(npmCommand, ["run", "debug_console:web"]);
  consoleServer.on("exit", (code) => stopChildren(code ?? 1));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stopChildren(1);
}
