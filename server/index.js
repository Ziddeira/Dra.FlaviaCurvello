"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { loadConfig } = require("./config");
const { securityHeaders, RateLimiter, clientIp, hashIp, isAllowedOrigin } = require("./security");
const { validateLead, whatsappUrl, maskPhone } = require("./lead");

const MAX_BODY_BYTES = 8 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".webmanifest", ".xml", ".txt", ".svg"]);

function cacheControl(ext) {
  if (ext === ".html") return "no-cache";
  if (ext === ".woff2") return "public, max-age=31536000, immutable";
  if ([".css", ".js"].includes(ext)) return "public, max-age=86400, stale-while-revalidate=604800";
  if ([".webp", ".jpg", ".jpeg", ".png", ".avif", ".svg", ".ico"].includes(ext)) return "public, max-age=2592000";
  return "public, max-age=3600";
}

function createApp(config = loadConfig()) {
  const baseHeaders = securityHeaders({ hsts: config.hsts });
  const leadLimiter = new RateLimiter(config.leadRateLimit);
  const globalLimiter = new RateLimiter(config.globalRateLimit);
  const salt = config.ipHashSalt || crypto.randomBytes(16).toString("hex");
  const publicDir = path.resolve(config.publicDir);
  const gzipCache = new Map();

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { ...baseHeaders, ...headers });
    res.end(body);
  }

  function sendJson(res, status, obj, headers = {}) {
    send(res, status, JSON.stringify(obj), {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    });
  }

  /** Resolve um caminho de URL para um arquivo dentro de /public, bloqueando path traversal. */
  function resolveStatic(urlPath) {
    let decoded;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return { error: 400 };
    }
    if (decoded.includes("\0") || decoded.includes("\\")) return { error: 400 };

    const segments = decoded.split("/").filter(Boolean);
    // Bloqueia arquivos ocultos (.env, .git) e de configuração (_headers)
    if (segments.some((s) => s === ".." || s.startsWith(".") || s.startsWith("_"))) return { error: 404 };

    let file = path.resolve(publicDir, ...segments);
    if (file !== publicDir && !file.startsWith(publicDir + path.sep)) return { error: 404 };
    if (decoded.endsWith("/") || file === publicDir) file = path.join(file, "index.html");
    else if (!path.extname(file)) file += ".html"; // URLs limpas: /politica-de-privacidade
    return { file };
  }

  async function serveFile(req, res, file, status = 200) {
    let stat;
    try {
      stat = await fsp.stat(file);
      if (!stat.isFile()) throw new Error("not a file");
    } catch {
      if (status === 404) return send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
      return serveFile(req, res, path.join(publicDir, "404.html"), 404);
    }

    const ext = path.extname(file).toLowerCase();
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": status === 404 ? "no-store" : cacheControl(ext),
      "Last-Modified": stat.mtime.toUTCString(),
      ETag: etag,
      Vary: "Accept-Encoding"
    };

    if (status === 200 && req.headers["if-none-match"] === etag) {
      return send(res, 304, null, headers);
    }

    const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
    if (COMPRESSIBLE.has(ext) && acceptsGzip) {
      let cached = gzipCache.get(file);
      if (!cached || cached.etag !== etag) {
        const raw = await fsp.readFile(file);
        cached = { etag, body: zlib.gzipSync(raw, { level: 9 }) };
        gzipCache.set(file, cached);
      }
      headers["Content-Encoding"] = "gzip";
      headers["Content-Length"] = cached.body.length;
      return send(res, status, req.method === "HEAD" ? null : cached.body, headers);
    }

    headers["Content-Length"] = stat.size;
    res.writeHead(status, { ...baseHeaders, ...headers });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const tooLarge = () => {
        // Descarta o restante do corpo (limitado pelo requestTimeout) e encerra a conexão após responder.
        req.resume();
        reject(Object.assign(new Error("too large"), { status: 413 }));
      };
      const declared = Number(req.headers["content-length"] || 0);
      if (declared > MAX_BODY_BYTES) return tooLarge();
      let size = 0;
      const chunks = [];
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.removeAllListeners("data");
          return tooLarge();
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  function parseBody(raw, contentType) {
    if (contentType.startsWith("application/json")) {
      const data = JSON.parse(raw);
      return { data, isForm: false };
    }
    if (contentType.startsWith("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(raw);
      const data = Object.create(null); // sem protótipo: imune a "__proto__"
      for (const [k, v] of params) if (!(k in data)) data[k] = v; // ignora parâmetros duplicados
      return { data, isForm: true };
    }
    throw Object.assign(new Error("unsupported"), { status: 415 });
  }

  async function storeLead(record) {
    const tasks = [];
    if (config.leadsFile) {
      tasks.push(
        (async () => {
          await fsp.mkdir(path.dirname(config.leadsFile), { recursive: true, mode: 0o700 });
          await fsp.appendFile(config.leadsFile, JSON.stringify(record) + "\n", { mode: 0o600 });
        })()
      );
    }
    if (config.webhookUrl) {
      const body = JSON.stringify(record);
      const headers = { "Content-Type": "application/json", "User-Agent": "draflaviacurvello-site/1.0" };
      if (config.webhookSecret) {
        // Assinatura HMAC para o receptor validar a autenticidade do envio
        headers["X-Signature-SHA256"] = crypto.createHmac("sha256", config.webhookSecret).update(body).digest("hex");
      }
      tasks.push(fetch(config.webhookUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) }));
    }
    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === "rejected") console.error("[lead] falha ao registrar:", r.reason && r.reason.message);
    }
  }

  async function handleLead(req, res, ip) {
    const wantsHtml = !String(req.headers.accept || "").includes("application/json");

    if (!isAllowedOrigin(req, config.allowedOrigins)) {
      return sendJson(res, 403, { ok: false, error: "Origem não permitida." });
    }

    const limit = leadLimiter.take(ip);
    if (!limit.allowed) {
      return sendJson(res, 429, { ok: false, error: "Muitas tentativas. Tente novamente em alguns minutos." }, {
        "Retry-After": String(limit.retryAfter)
      });
    }

    let parsed;
    try {
      const contentType = String(req.headers["content-type"] || "").toLowerCase();
      parsed = parseBody(await readBody(req), contentType);
    } catch (err) {
      const status = err.status || 400;
      const extra = status === 413 ? { Connection: "close" } : {};
      return sendJson(res, status, { ok: false, error: status === 413 ? "Envio muito grande." : "Dados inválidos." }, extra);
    }

    const result = validateLead(parsed.data);
    const isForm = parsed.isForm && wantsHtml;

    if (result.spam) {
      // Resposta indistinguível de sucesso para não ensinar o robô.
      if (isForm) return send(res, 303, null, { Location: whatsappUrl(config.whatsappNumber), "Cache-Control": "no-store" });
      return sendJson(res, 200, { ok: true });
    }

    if (!result.ok) {
      if (isForm) return serveFile(req, res, path.join(publicDir, "index.html"), 422);
      return sendJson(res, 422, { ok: false, errors: result.errors });
    }

    const record = {
      id: crypto.randomUUID(),
      recebidoEm: new Date().toISOString(),
      origem: "site",
      ...result.lead,
      ipHash: hashIp(ip, salt)
    };
    await storeLead(record);
    console.log(`[lead] ${record.id} ${record.area} ${maskPhone(record.telefone)}`);

    const location = whatsappUrl(config.whatsappNumber, result.lead);
    if (isForm) return send(res, 303, null, { Location: location, "Cache-Control": "no-store" });
    return sendJson(res, 201, { ok: true, whatsapp: location });
  }

  async function handler(req, res) {
    const ip = clientIp(req, config.trustProxy);

    if (!globalLimiter.take(ip).allowed) {
      return send(res, 429, "Too many requests", { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "60" });
    }

    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return send(res, 400, "Bad request", { "Content-Type": "text/plain; charset=utf-8" });
    }

    if (url.pathname === "/api/lead") {
      if (req.method !== "POST") return sendJson(res, 405, { ok: false }, { Allow: "POST" });
      return handleLead(req, res, ip);
    }

    if (url.pathname === "/healthz") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, "Method not allowed", { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
    }

    // Redireciona /index.html para a URL canônica
    if (url.pathname === "/index.html") {
      return send(res, 301, null, { Location: "/" + url.search });
    }

    const resolved = resolveStatic(url.pathname);
    if (resolved.error === 400) return send(res, 400, "Bad request", { "Content-Type": "text/plain; charset=utf-8" });
    if (resolved.error) return serveFile(req, res, path.join(publicDir, "404.html"), 404);
    return serveFile(req, res, resolved.file);
  }

  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error("[server] erro inesperado:", err);
      if (!res.headersSent) send(res, 500, "Internal error", { "Content-Type": "text/plain; charset=utf-8" });
      else res.destroy();
    });
  });

  // Proteções contra conexões lentas (Slowloris) e cabeçalhos abusivos
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.on("close", () => {
    leadLimiter.stop();
    globalLimiter.stop();
  });

  return server;
}

if (require.main === module) {
  const config = loadConfig();
  const server = createApp(config);
  server.listen(config.port, config.host, () => {
    console.log(`Site no ar em http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

module.exports = { createApp };
