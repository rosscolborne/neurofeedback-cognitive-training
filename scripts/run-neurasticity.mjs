import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { loadEnv } from "vite";

const localServiceUrl = "http://127.0.0.1:8000";
const configuredServiceUrl = loadEnv("development", process.cwd(), "")
  .VITE_BRAINFLOW_SERVICE_URL?.trim().replace(/\/+$/, "");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const execFileAsync = promisify(execFile);

async function isServiceHealthy(baseUrl, timeoutMs = 700) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return (await fetch(`${baseUrl}/health`, { signal: controller.signal })).ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function hasLocalService() {
  return isServiceHealthy(localServiceUrl);
}

async function listenerPids() {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "(Get-NetTCPConnection -LocalPort 8000 -State Listen).OwningProcess"]);
    return stdout.split(/\s+/).filter((value) => /^\d+$/.test(value));
  }
  const { stdout } = await execFileAsync("lsof", ["-tiTCP:8000", "-sTCP:LISTEN"]);
  return stdout.split(/\s+/).filter((value) => /^\d+$/.test(value));
}

async function restartExistingService() {
  if (!(await hasLocalService())) return;
  console.log("Restarting the existing local BrainFlow service on port 8000.");
  const pids = await listenerPids();
  if (pids.length === 0) throw new Error("A service answered on port 8000, but its listener process could not be identified.");
  for (const pid of pids) {
    if (process.platform === "win32") await execFileAsync("taskkill.exe", ["/PID", pid, "/T", "/F"]);
    else process.kill(Number(pid), "SIGTERM");
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!(await hasLocalService())) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The existing BrainFlow service did not stop within 5 seconds.");
}

function start(command, args) {
  return spawn(command, args, { detached: process.platform !== "win32", stdio: "inherit" });
}

function stop(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") child.kill("SIGTERM");
  else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
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

async function requireConfiguredService() {
  let parsedUrl;
  try {
    parsedUrl = new URL(configuredServiceUrl);
  } catch {
    throw new Error(`VITE_BRAINFLOW_SERVICE_URL is not a valid URL: ${configuredServiceUrl}`);
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('VITE_BRAINFLOW_SERVICE_URL must use HTTP or HTTPS.');
  }

  console.log(`Using configured BrainFlow service: ${configuredServiceUrl}`);
  console.log('The local BrainFlow service will not be started.');
  if (!(await isServiceHealthy(configuredServiceUrl, 30_000))) {
    throw new Error(`The configured BrainFlow service failed its health check: ${configuredServiceUrl}/health`);
  }
}

let backend;
let frontend;
let stopping = false;
function stopChildren(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  stop(frontend);
  stop(backend);
  process.exitCode = exitCode;
}
process.on("SIGINT", () => stopChildren());
process.on("SIGTERM", () => stopChildren());

try {
  if (configuredServiceUrl) {
    await requireConfiguredService();
  } else {
    await restartExistingService();
    console.log("Starting the local BrainFlow service on port 8000.");
    backend = start(npmCommand, ["run", "brainflow"]);
    backend.on("exit", (code) => {
      if (!stopping) { console.error(`BrainFlow service exited unexpectedly (code ${code ?? "unknown"}).`); stopChildren(1); }
    });
    await waitForLocalService();
  }
  frontend = start(npmCommand, ["run", "dev:web"]);
  frontend.on("exit", (code) => stopChildren(code ?? 1));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stopChildren(1);
}
