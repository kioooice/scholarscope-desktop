import { createServer, request as httpRequest } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, createReadStream, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const isWindows = process.platform === "win32";
const isDev = process.argv.includes("--dev");
const webHost = process.env.SCHOLARSCOPE_HOST || "127.0.0.1";
const webPort = Number(process.env.SCHOLARSCOPE_PORT || 5180);
const apiHost = process.env.SCHOLARSCOPE_API_HOST || "127.0.0.1";
const apiPort = Number(process.env.SCHOLARSCOPE_API_PORT || 5181);
const runtimeDir = path.join(rootDir, ".scansci-runtime");
const dataDir = path.resolve(process.env.SCHOLARSCOPE_DATA_DIR || path.join(rootDir, ".scholarscope-data"));
const bundledWorkerPath = path.join(rootDir, "engine", "worker.py");
const sourceWorkerPath = path.resolve(rootDir, "../../resources/engine/worker.py");
const workerPath = existsSync(bundledWorkerPath) ? bundledWorkerPath : sourceWorkerPath;

let frontendProcess;
let frontendServer;
let apiServer;
let engineWorker;
let enginePrepared;
let engineState = { status: "starting", sourceCount: 13 };
let shuttingDown = false;
const operationWorkers = new Set();
const locatedRoutes = new Map();
const LOCATED_ROUTE_TTL_MS = 30 * 60_000;

function log(message) {
  console.log(`[ScholarScope] ${message}`);
}

function commandPath(command) {
  if (path.isAbsolute(command) && existsSync(command)) return command;
  const locator = isWindows ? "where.exe" : "which";
  const result = spawnSync(locator, [command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (result.status !== 0) return undefined;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function pythonCommand() {
  const configured = process.env.PYTHON;
  if (configured) {
    const resolved = commandPath(configured);
    if (resolved) return { command: resolved, prefix: [] };
  }
  const python = commandPath("python");
  if (python) return { command: python, prefix: [] };
  const launcher = commandPath("py");
  return launcher ? { command: launcher, prefix: ["-3"] } : undefined;
}

function runtimePythonPath() {
  return isWindows
    ? path.join(runtimeDir, "Scripts", "python.exe")
    : path.join(runtimeDir, "bin", "python");
}

function moduleAvailable(python) {
  const result = spawnSync(python, ["-c", "import scansci_pdf, requests"], { stdio: "ignore" });
  return result.status === 0;
}

function runSync(command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

function prepareEngine() {
  if (!existsSync(workerPath)) throw new Error(`内部引擎 worker 不存在：${workerPath}`);

  const configuredPython = process.env.SCHOLARSCOPE_ENGINE_PYTHON;
  if (configuredPython) {
    const resolved = commandPath(configuredPython);
    if (!resolved || !moduleAvailable(resolved)) throw new Error(`内部引擎 Python 不可用：${configuredPython}`);
    return { command: resolved, args: [] };
  }

  const bundledPython = runtimePythonPath();
  if (existsSync(bundledPython) && moduleAvailable(bundledPython)) {
    return { command: bundledPython, args: [] };
  }

  const systemPython = pythonCommand();
  if (!systemPython) return undefined;

  if (!existsSync(bundledPython)) {
    log("Preparing the integrated Python runtime...");
    runSync(systemPython.command, [...systemPython.prefix, "-m", "venv", runtimeDir]);
  }

  if (!moduleAvailable(bundledPython)) {
    log("Installing the integrated paper engine on first launch...");
    runSync(bundledPython, ["-m", "pip", "install", "--disable-pip-version-check", "--upgrade", "scansci-pdf[web]", "mcp<2"]);
  }

  return { command: bundledPython, args: [] };
}

class EngineWorker {
  constructor(prepared, { reportAvailability = true } = {}) {
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = "";
    this.reportAvailability = reportAvailability;
    this.stopped = false;
    this.child = spawn(prepared.command, [...prepared.args, workerPath], {
      cwd: rootDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        SCANSCI_PDF_DATA_DIR: dataDir,
        SCHOLARSCOPE_DATA_DIR: dataDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.handleOutput(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) log(`engine: ${message}`);
    });
    this.child.once("error", (error) => {
      if (!shuttingDown && !this.stopped && this.reportAvailability) {
        engineState = { ...engineState, status: "unavailable", error: error instanceof Error ? error.message : String(error) };
        log(`Internal engine process failed: ${engineState.error}`);
      }
      this.failPending(error);
    });
    this.child.once("exit", (code, signal) => {
      if (!shuttingDown && !this.stopped && this.reportAvailability) {
        engineState = { ...engineState, status: "unavailable", error: `engine exited (${code ?? signal ?? "unknown"})` };
      }
      this.failPending(new Error("内部下载引擎已退出"));
    });
  }

  handleOutput(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        log(`engine returned invalid JSON: ${line.slice(0, 180)}`);
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    }
  }

  failPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(method, payload = {}, timeoutMs = 60_000) {
    if (!this.child || this.child.exitCode !== null) return Promise.reject(new Error("内部下载引擎未就绪"));
    const id = String(this.nextId++);
    const request = { id, method, ...payload };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("内部下载引擎请求超时"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  stop() {
    this.stopped = true;
    this.failPending(new Error("内部下载引擎已停止"));
    if (!this.child || this.child.exitCode !== null) return;
    if (isWindows && this.child.pid) {
      spawnSync("taskkill", ["/pid", String(this.child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    } else {
      this.child.kill("SIGTERM");
    }
  }
}

function boundedTimeout(value, fallbackMs, minimumMs, maximumMs) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallbackMs;
  return Math.max(minimumMs, Math.min(maximumMs, Math.round(parsed)));
}

function normalizeLocatedRoute(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = (typeof value.source === "string" ? value.source.trim().slice(0, 120) : "") || "下载来源";
  const rawUrl = typeof value.url === "string" ? value.url.trim() : "";
  if (!rawUrl || rawUrl.length > 4_000) return undefined;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const probeStatus = typeof value.probeStatus === "string" ? value.probeStatus.trim().slice(0, 40) : "";
    const probeError = typeof value.probeError === "string" ? value.probeError.trim().slice(0, 240) : "";
    return {
      source,
      url: url.toString(),
      isPdf: value.isPdf === true,
      ...(probeStatus ? { probeStatus } : {}),
      ...(probeError ? { probeError } : {}),
    };
  } catch {
    return undefined;
  }
}

function pruneLocatedRoutes() {
  const now = Date.now();
  for (const [id, entry] of locatedRoutes) {
    if (entry.expiresAt <= now) locatedRoutes.delete(id);
  }
}

function rememberLocatedRoute(result) {
  const primaryRoute = normalizeLocatedRoute(result?.route);
  const listedRoutes = Array.isArray(result?.routes)
    ? result.routes.map(normalizeLocatedRoute).filter(Boolean)
    : [];
  if (!primaryRoute && listedRoutes.length === 0) return result;
  pruneLocatedRoutes();
  const remembered = new Map();
  const storeRoute = (route) => {
    // Several providers can discover the same underlying PDF URL. Keep the
    // first source label, but never download the identical URL repeatedly.
    const key = route.url;
    const existing = remembered.get(key);
    if (existing) return existing;
    const routeId = randomUUID();
    const stored = { ...route, routeId };
    remembered.set(key, stored);
    locatedRoutes.set(routeId, { route, expiresAt: Date.now() + LOCATED_ROUTE_TTL_MS });
    return stored;
  };
  const route = primaryRoute ? storeRoute(primaryRoute) : undefined;
  const routes = [];
  if (route) routes.push(route);
  for (const listedRoute of listedRoutes) {
    const stored = storeRoute(listedRoute);
    if (!routes.some((item) => item.routeId === stored.routeId)) routes.push(stored);
  }
  const selectedRoute = route || routes[0];
  return selectedRoute ? { ...result, route: selectedRoute, routes, routeId: selectedRoute.routeId } : result;
}

function getLocatedRoute(routeId) {
  pruneLocatedRoutes();
  if (typeof routeId !== "string") return undefined;
  return locatedRoutes.get(routeId)?.route;
}

function getLocatedRoutes(routeIds) {
  if (!Array.isArray(routeIds)) return [];
  pruneLocatedRoutes();
  const routes = [];
  const seen = new Set();
  for (const routeId of routeIds) {
    const route = getLocatedRoute(routeId);
    if (!route) continue;
    const key = route.url;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push(route);
  }
  return routes;
}

async function requestIsolatedEngine(method, payload, timeoutMs) {
  if (!enginePrepared) throw new Error("内部下载引擎未就绪");
  const worker = new EngineWorker(enginePrepared, { reportAvailability: false });
  operationWorkers.add(worker);
  try {
    return await worker.request(method, payload, timeoutMs);
  } finally {
    operationWorkers.delete(worker);
    worker.stop();
  }
}

function jsonResponse(response, status, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("请求体过大"));
    });
    request.on("end", () => {
      try {
        resolve(body.trim() ? JSON.parse(body) : {});
      } catch {
        reject(new Error("请求不是有效 JSON"));
      }
    });
    request.on("error", reject);
  });
}

function engineSettings(body) {
  const settings = body && typeof body.settings === "object" && body.settings ? body.settings : {};
  return {
    email: typeof body?.email === "string" ? body.email.trim() : typeof settings.email === "string" ? settings.email.trim() : "",
    // The desktop flow should inspect every configured source by default.
    // Callers can still opt out explicitly with scihubEnabled: false.
    scihubEnabled: settings.scihubEnabled !== false,
    useTor: settings.useTor === true,
    strategy: typeof settings.strategy === "string" ? settings.strategy : "fastest",
  };
}

function safeEngineResult(result) {
  return result && typeof result === "object" ? result : { status: "error", error: "内部下载引擎返回了空结果" };
}

async function handleApi(request, response) {
  const requestUrl = new URL(request.url || "/", `http://${apiHost}:${apiPort}`);
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Expose-Headers", "X-ScholarScope-Source");
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method === "GET" && requestUrl.pathname === "/api/status") {
    if (!engineWorker) {
      jsonResponse(response, 503, { status: "unavailable", engine: engineState, sourceCount: engineState.sourceCount || 13 });
      return;
    }
    try {
      const result = safeEngineResult(await engineWorker.request("status", {}, 20_000));
      engineState = { ...engineState, ...result, status: result.status === "ready" ? "ready" : "error" };
      jsonResponse(response, 200, { status: "ok", engine: engineState, sourceCount: result.sourceCount || 13 });
    } catch (error) {
      engineState = { ...engineState, status: "error", error: error instanceof Error ? error.message : String(error) };
      jsonResponse(response, 503, { status: "error", engine: engineState, sourceCount: engineState.sourceCount || 13 });
    }
    return;
  }

  if (!request.method?.startsWith("POST")) {
    jsonResponse(response, 404, { error: "Not found" });
    return;
  }
  if (!engineWorker || !enginePrepared) {
    jsonResponse(response, 503, { status: "unavailable", error: "内部下载引擎未就绪" });
    return;
  }

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    jsonResponse(response, 400, { status: "error", error: error instanceof Error ? error.message : String(error) });
    return;
  }

  try {
    if (requestUrl.pathname === "/api/papers/search") {
      const result = safeEngineResult(await engineWorker.request("search", {
        query: body.query,
        filters: body.filters,
        email: body.email,
        timeoutMs: body.timeoutMs,
      }, 90_000));
      jsonResponse(response, result.diagnostic?.status === "error" ? 502 : 200, result);
      return;
    }
    if (requestUrl.pathname === "/api/papers/locate") {
      const locateTimeoutMs = boundedTimeout(body.timeoutMs, 20_000, 5_000, 45_000);
      const result = rememberLocatedRoute(safeEngineResult(await requestIsolatedEngine("locate", {
        identifier: body.identifier,
        title: body.title,
        email: body.email,
        timeoutMs: locateTimeoutMs,
        settings: engineSettings(body),
      }, locateTimeoutMs + 5_000)));
      jsonResponse(response, result.status === "error" ? 502 : 200, result);
      return;
    }
    if (requestUrl.pathname === "/api/papers/download") {
      const downloadTimeoutMs = boundedTimeout(body.timeoutMs, 60_000, 15_000, 90_000);
      const requestedRouteIds = Array.isArray(body.routeIds)
        ? body.routeIds.filter((value) => typeof value === "string").slice(0, 128)
        : typeof body.routeId === "string" ? [body.routeId] : [];
      const routes = getLocatedRoutes(requestedRouteIds);
      if (routes.length === 0) {
        jsonResponse(response, 409, { status: "error", error: "下载候选已过期，请重新检索来源" });
        return;
      }
      mkdirSync(path.join(dataDir, "papers"), { recursive: true });
      const result = safeEngineResult(await requestIsolatedEngine("download", {
        identifier: body.identifier,
        title: body.title,
        email: body.email,
        settings: engineSettings(body),
        routes,
        outputDir: path.join(dataDir, "papers"),
        timeoutMs: downloadTimeoutMs,
      }, downloadTimeoutMs + 5_000));
      if (result.status !== "downloaded" || !result.filePath) {
        jsonResponse(response, 404, result);
        return;
      }
      const filePath = path.resolve(result.filePath);
      const allowedRoot = path.resolve(path.join(dataDir, "papers")) + path.sep;
      if (!filePath.startsWith(allowedRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        jsonResponse(response, 500, { status: "error", error: "下载文件路径无效" });
        return;
      }
      const filename = path.basename(filePath).replace(/[<>:"/\\|?*]/g, " ").trim() || "paper.pdf";
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      response.setHeader("X-ScholarScope-Source", String(result.source || "下载引擎"));
      createReadStream(filePath).on("error", () => {
        if (!response.headersSent) jsonResponse(response, 500, { status: "error", error: "读取下载文件失败" });
        else response.destroy();
      }).pipe(response);
      return;
    }
  } catch (error) {
    jsonResponse(response, 500, { status: "error", error: error instanceof Error ? error.message : String(error) });
    return;
  }
  jsonResponse(response, 404, { error: "Not found" });
}

function startApiServer() {
  apiServer = createServer((request, response) => {
    void handleApi(request, response).catch((error) => {
      jsonResponse(response, 500, { status: "error", error: error instanceof Error ? error.message : String(error) });
    });
  });
  apiServer.on("error", (error) => {
    log(`API server failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  apiServer.listen(apiPort, apiHost, () => log(`Internal engine API: http://${apiHost}:${apiPort}`));
}

function startEngine() {
  let prepared;
  enginePrepared = undefined;
  engineState = { status: "starting", sourceCount: 13 };
  try {
    mkdirSync(dataDir, { recursive: true });
    prepared = prepareEngine();
  } catch (error) {
    engineState = { status: "unavailable", sourceCount: 13, error: error instanceof Error ? error.message : String(error) };
    log(`Internal engine preparation failed: ${engineState.error}`);
    return;
  }
  if (!prepared) {
    engineState = { status: "unavailable", sourceCount: 13, error: "没有可用的 Python 运行时" };
    log("Python runtime is unavailable; search and download engine is disabled.");
    return;
  }
  try {
    enginePrepared = prepared;
    engineWorker = new EngineWorker(prepared);
    log("Internal paper engine process started.");
  } catch (error) {
    engineState = { status: "unavailable", sourceCount: 13, error: error instanceof Error ? error.message : String(error) };
    log(`Internal engine failed to start: ${engineState.error}`);
  }
}

function startFrontend() {
  if (process.env.SCHOLARSCOPE_API_ONLY === "1") {
    log("Desktop mode: internal API only; Tauri owns the application window.");
    return;
  }
  if (!isDev) {
    startStaticServer();
    return;
  }
  const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
  const args = isDev
    ? [viteBin, "--host", webHost, "--port", String(webPort), "--strictPort"]
    : [viteBin, "preview", "--host", webHost, "--port", String(webPort), "--strictPort"];
  frontendProcess = spawn(process.execPath, args, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  frontendProcess.once("exit", (code) => {
    if (!shuttingDown) process.exit(code ?? 0);
  });
  log(`${isDev ? "Development" : "Preview"} web app: http://${webHost}:${webPort}`);
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  }[extension] || "application/octet-stream";
}

function startStaticServer() {
  const distDir = path.resolve(rootDir, "dist");
  frontendServer = createServer((request, response) => {
    const requestPath = new URL(request.url || "/", `http://${webHost}:${webPort}`).pathname;
    if (requestPath.startsWith("/api/")) {
      const proxy = httpRequest({
        hostname: apiHost,
        port: apiPort,
        path: request.url,
        method: request.method,
        headers: { ...request.headers, host: `${apiHost}:${apiPort}` },
      }, (proxyResponse) => {
        response.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
        proxyResponse.pipe(response);
      });
      proxy.on("error", (error) => jsonResponse(response, 502, { status: "error", error: error.message }));
      request.pipe(proxy);
      return;
    }

    let relativePath;
    try {
      relativePath = decodeURIComponent(requestPath);
    } catch {
      jsonResponse(response, 400, { status: "error", error: "无效路径" });
      return;
    }
    const requestedFile = path.resolve(distDir, `.${relativePath}`);
    const safeRoot = `${distDir}${path.sep}`;
    const filePath = requestedFile.startsWith(safeRoot) && existsSync(requestedFile) && statSync(requestedFile).isFile()
      ? requestedFile
      : path.join(distDir, "index.html");
    if (!existsSync(filePath)) {
      jsonResponse(response, 500, { status: "error", error: "前端构建文件不存在" });
      return;
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", contentType(filePath));
    response.setHeader("Cache-Control", path.basename(filePath) === "index.html" ? "no-store" : "public, max-age=31536000, immutable");
    createReadStream(filePath).on("error", () => response.destroy()).pipe(response);
  });
  frontendServer.on("error", (error) => log(`Static web server failed: ${error.message}`));
  frontendServer.listen(webPort, webHost, () => log(`Portable web app: http://${webHost}:${webPort}`));
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  if (isWindows && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (apiServer) apiServer.close();
  if (frontendServer) frontendServer.close();
  if (engineWorker) engineWorker.stop();
  for (const worker of operationWorkers) worker.stop();
  operationWorkers.clear();
  locatedRoutes.clear();
  stopProcess(frontendProcess);
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (error) => {
  console.error(error);
  shutdown(1);
});

startApiServer();
startFrontend();
setImmediate(startEngine);
