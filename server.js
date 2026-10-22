"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const MAX_BODY_BYTES = 8 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_NAME_CHARACTERS = /[\p{Cc}\p{Cf}]/u;
const PUBLIC_DIR = path.join(__dirname, "public");
const TEMPLATE_FILE = path.join(__dirname, "views", "response.html");
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
  ["/dashboard.js", ["dashboard.js", "text/javascript; charset=utf-8"]],
  ["/assets/pink-teddy.png", ["assets/pink-teddy.png", "image/png"]],
  ["/assets/teddy-couple.png", ["assets/teddy-couple.png", "image/png"]],
  ["/assets/bow-kitty-pink.png", ["assets/bow-kitty-pink.png", "image/png"]],
  ["/assets/bow-kitty-rose.png", ["assets/bow-kitty-rose.png", "image/png"]]
]);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function normalizeName(value) {
  if (typeof value !== "string") throw new ClientError(400, "Name must be text.");
  const unicodeName = value.normalize("NFC");
  if (FORBIDDEN_NAME_CHARACTERS.test(unicodeName)) {
    throw new ClientError(400, "Name contains unsupported characters.");
  }
  const name = unicodeName.replace(/\s+/gu, " ").trim();
  if (!name) throw new ClientError(400, "Please enter a name.");
  if (Array.from(name).length > 60) throw new ClientError(400, "Name must be 60 characters or fewer.");
  return name;
}

class ClientError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class ResponseStore {
  constructor(file) {
    this.file = path.resolve(file);
    this.records = [];
    this.requestIds = new Set();
    this.queue = Promise.resolve();
    this.ready = this.initialize();
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const handle = await fs.open(this.file, "a", 0o600);
    await handle.close();
    await fs.chmod(this.file, 0o600);
    const content = await fs.readFile(this.file, "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record && record.accepted === true && typeof record.name === "string" && UUID_PATTERN.test(record.requestId)) {
          this.records.push(record);
          this.requestIds.add(record.requestId.toLowerCase());
        }
      } catch {
        console.warn("Skipped a malformed response record while loading the response file.");
      }
    }
  }

  append(record) {
    const operation = this.queue.then(async () => {
      await this.ready;
      const key = record.requestId.toLowerCase();
      if (this.requestIds.has(key)) return false;
      const handle = await fs.open(this.file, "a", 0o600);
      try {
        await handle.appendFile(`${JSON.stringify(record)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.requestIds.add(key);
      this.records.push(record);
      return true;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async allNewestFirst() {
    await this.ready;
    await this.queue;
    return this.records.slice().reverse();
  }

  async drain() {
    await this.ready;
    await this.queue;
  }
}

function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function getClientAddress(request, trustLoopbackProxy) {
  const socketAddress = request.socket.remoteAddress || "unknown";
  if (!trustLoopbackProxy || !isLoopback(socketAddress)) return socketAddress;
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || socketAddress;
}

function createRateLimiter({ windowMs = 60_000, limit = 12, trustLoopbackProxy = false } = {}) {
  const clients = new Map();
  const secret = crypto.randomBytes(32);
  let checks = 0;
  return (request) => {
    const address = getClientAddress(request, trustLoopbackProxy);
    const key = crypto.createHmac("sha256", secret).update(address).digest("base64url");
    const now = Date.now();
    const current = clients.get(key);
    const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    entry.count += 1;
    clients.set(key, entry);
    checks += 1;
    if (checks % 100 === 0) {
      for (const [clientKey, value] of clients) if (value.resetAt <= now) clients.delete(clientKey);
    }
    return { allowed: entry.count <= limit, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  };
}

function secureEqual(actual, expected) {
  const actualDigest = crypto.createHash("sha256").update(actual).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

function isAuthorized(request, username, password) {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Basic ")) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  return Boolean(
    secureEqual(decoded.slice(0, separator), username) &
    secureEqual(decoded.slice(separator + 1), password)
  );
}

function setSecurityHeaders(response) {
  response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function send(response, status, body, contentType = "text/plain; charset=utf-8", method = "GET") {
  const payload = Buffer.from(body);
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", payload.length);
  response.end(method === "HEAD" ? undefined : payload);
}

function sendJson(response, status, value, method = "GET") {
  send(response, status, JSON.stringify(value), "application/json; charset=utf-8", method);
}

function methodNotAllowed(response, allowed, method) {
  response.setHeader("Allow", allowed.join(", "));
  sendJson(response, 405, { error: "Method not allowed." }, method);
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new ClientError(413, "Request body is too large.");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ClientError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ClientError(400, "Request body must be valid JSON.");
  }
}

function requestOriginMatches(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const forwardedProtocol = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProtocol || (request.socket.encrypted ? "https" : "http");
  const host = request.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

function formatUtc(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return "Unknown time";
  return `${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}

function renderRows(records) {
  if (records.length === 0) {
    return '<div class="empty-garden" role="status"><span aria-hidden="true">🌷</span><h2>The garden is waiting</h2><p>Accepted invitations will bloom here.</p></div>';
  }
  return records.map((record) => {
    const name = escapeHtml(record.name);
    const timestamp = escapeHtml(record.timestamp);
    const utc = escapeHtml(formatUtc(record.timestamp));
    return `<article class="response-card" role="listitem"><div class="response-avatar" aria-hidden="true">♥</div><div class="response-details"><h2>${name}</h2><p class="accepted-label">Accepted <span aria-hidden="true">♡</span></p><time datetime="${timestamp}"><span>${utc}</span><small data-local-time="${timestamp}">Local time available with JavaScript</small></time></div></article>`;
  }).join("");
}

function createServer(options = {}) {
  const adminUser = options.adminUser ?? process.env.ADMIN_USER;
  const adminPassword = options.adminPassword ?? process.env.ADMIN_PASSWORD;
  if (!adminUser || !adminPassword) {
    throw new Error("ADMIN_USER and ADMIN_PASSWORD are required. Set both before starting the server.");
  }
  if (adminUser.includes(":")) throw new Error("ADMIN_USER cannot contain a colon.");

  const responseFile = options.responseFile ?? process.env.RESPONSE_FILE ?? path.join(process.cwd(), "data", "responses.jsonl");
  const trustLoopbackProxy = options.trustProxy ?? process.env.TRUST_PROXY === "loopback";
  const store = new ResponseStore(responseFile);
  const checkRateLimit = createRateLimiter({ ...options.rateLimit, trustLoopbackProxy });
  const checkAuthRateLimit = createRateLimiter({ windowMs: 5 * 60_000, limit: 30, trustLoopbackProxy });

  const server = http.createServer(async (request, response) => {
    setSecurityHeaders(response);
    let pathname;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      sendJson(response, 400, { error: "Invalid request URL." }, request.method);
      return;
    }

    try {
      if (pathname === "/health") {
        if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, ["GET", "HEAD"], request.method);
        response.setHeader("Cache-Control", "no-store");
        await store.ready;
        return sendJson(response, 200, { status: "ok" }, request.method);
      }

      if (pathname === "/api/responses") {
        if (request.method !== "POST") return methodNotAllowed(response, ["POST"], request.method);
        const rate = checkRateLimit(request);
        if (!rate.allowed) {
          response.setHeader("Retry-After", rate.retryAfter);
          return sendJson(response, 429, { error: "Please wait a moment before trying again." });
        }
        if (!requestOriginMatches(request)) return sendJson(response, 403, { error: "Origin not allowed." });
        const mediaType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
        if (mediaType !== "application/json") return sendJson(response, 415, { error: "Content-Type must be application/json." });
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new ClientError(400, "Request body must be a JSON object.");
        const keys = Object.keys(body);
        if (keys.some((key) => key !== "name" && key !== "requestId")) throw new ClientError(400, "Request contains unsupported fields.");
        const name = normalizeName(body.name);
        if (typeof body.requestId !== "string" || !UUID_PATTERN.test(body.requestId)) throw new ClientError(400, "requestId must be a valid UUID.");
        const created = await store.append({ name, requestId: body.requestId.toLowerCase(), accepted: true, timestamp: new Date().toISOString() });
        response.setHeader("Cache-Control", "no-store");
        return sendJson(response, created ? 201 : 200, { accepted: true, duplicate: !created });
      }

      if (pathname === "/response" || pathname === "/response/") {
        if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, ["GET", "HEAD"], request.method);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Robots-Tag", "noindex, nofollow");
        if (!isAuthorized(request, adminUser, adminPassword)) {
          const rate = checkAuthRateLimit(request);
          if (!rate.allowed) {
            response.setHeader("Retry-After", rate.retryAfter);
            return send(response, 429, "Too many authentication attempts.\n", "text/plain; charset=utf-8", request.method);
          }
          response.setHeader("WWW-Authenticate", 'Basic realm="Private responses", charset="UTF-8"');
          return send(response, 401, "Authentication required.\n", "text/plain; charset=utf-8", request.method);
        }
        const [template, records] = await Promise.all([fs.readFile(TEMPLATE_FILE, "utf8"), store.allNewestFirst()]);
        const html = template
          .replaceAll("{{TOTAL}}", String(records.length))
          .replaceAll("{{TOTAL_SUFFIX}}", records.length === 1 ? "" : "es")
          .replace("{{ROWS}}", renderRows(records));
        return send(response, 200, html, "text/html; charset=utf-8", request.method);
      }

      const staticFile = STATIC_FILES.get(pathname);
      if (staticFile) {
        if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, ["GET", "HEAD"], request.method);
        const [relativeFile, contentType] = staticFile;
        const content = await fs.readFile(path.join(PUBLIC_DIR, relativeFile));
        response.setHeader("Cache-Control", contentType === "image/png" ? "public, max-age=604800" : "no-cache");
        return send(response, 200, content, contentType, request.method);
      }

      sendJson(response, 404, { error: "Not found." }, request.method);
    } catch (error) {
      if (error instanceof ClientError) return sendJson(response, error.status, { error: error.message });
      console.error("Request failed without logging request content:", error.message);
      sendJson(response, 500, { error: "Internal server error." });
    }
  });

  server.responseStore = store;
  server.ready = store.ready;
  server.drain = () => store.drain();
  return server;
}

async function start() {
  try {
    const host = process.env.HOST || "127.0.0.1";
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
    const server = createServer();
    await server.ready;
    server.listen(port, host, () => console.log(`For You is listening on http://${host}:${port}`));

    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${signal} received; finishing active requests.`);
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await server.drain();
    };
    process.once("SIGTERM", () => shutdown("SIGTERM").catch((error) => { console.error(`Shutdown failed: ${error.message}`); process.exitCode = 1; }));
    process.once("SIGINT", () => shutdown("SIGINT").catch((error) => { console.error(`Shutdown failed: ${error.message}`); process.exitCode = 1; }));
  } catch (error) {
    console.error(`Unable to start: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) start();

module.exports = { createServer, normalizeName };
