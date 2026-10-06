"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server/index");
const { loadConfig } = require("../server/config");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "leads-"));
const leadsFile = path.join(tmp, "leads.jsonl");
let server;
let base;

function request(method, pathname, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + pathname, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const lead = (extra = {}) =>
  JSON.stringify({
    nome: "Joana Souza",
    telefone: "48999998888",
    area: "Estética facial",
    periodo: "Tarde",
    consentimento: true,
    site: "",
    ts: Date.now() - 10_000,
    ...extra
  });

test.before(async () => {
  const config = { ...loadConfig({ LEADS_FILE: leadsFile, IP_HASH_SALT: "test", LEAD_RATE_MAX: "20" }) };
  server = createApp(config);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("serve a home com cabeçalhos de segurança", async () => {
  const res = await request("GET", "/");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.headers["content-security-policy"], /default-src 'self'/);
  assert.match(res.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.ok(res.headers["strict-transport-security"]);
  assert.equal(res.headers["x-powered-by"], undefined);
  assert.ok(res.body.includes("Dra. Flávia Curvello"));
});

test("suporta URL limpa para a política de privacidade", async () => {
  const res = await request("GET", "/politica-de-privacidade");
  assert.equal(res.status, 200);
  assert.ok(res.body.includes("LGPD"));
});

test("responde 304 quando o ETag confere", async () => {
  const first = await request("GET", "/assets/css/styles.css");
  const second = await request("GET", "/assets/css/styles.css", { headers: { "If-None-Match": first.headers.etag } });
  assert.equal(second.status, 304);
});

test("comprime texto com gzip", async () => {
  const res = await request("GET", "/assets/js/main.js", { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(res.headers["content-encoding"], "gzip");
});

test("bloqueia path traversal e arquivos ocultos", async () => {
  for (const p of ["/../package.json", "/%2e%2e/package.json", "/assets/%2e%2e/%2e%2e/server/index.js", "/.env", "/_headers", "/..%5cpackage.json"]) {
    const res = await request("GET", p);
    assert.ok([400, 404].includes(res.status), `${p} retornou ${res.status}`);
    assert.ok(!res.body.includes("createApp"), `${p} vazou código`);
  }
});

test("rejeita URL malformada", async () => {
  const res = await request("GET", "/%E0%A4%A");
  assert.equal(res.status, 400);
});

test("retorna 404 personalizado", async () => {
  const res = await request("GET", "/nao-existe");
  assert.equal(res.status, 404);
  assert.ok(res.body.includes("não foi encontrada"));
});

test("bloqueia métodos não permitidos", async () => {
  assert.equal((await request("DELETE", "/")).status, 405);
  assert.equal((await request("GET", "/api/lead")).status, 405);
});

test("registra lead válido via JSON", async () => {
  const res = await request("POST", "/api/lead", {
    headers: { "Content-Type": "application/json", Accept: "application/json", Origin: base },
    body: lead()
  });
  assert.equal(res.status, 201);
  const json = JSON.parse(res.body);
  assert.match(json.whatsapp, /^https:\/\/wa\.me\//);
  const saved = fs.readFileSync(leadsFile, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(saved.at(-1).nome, "Joana Souza");
  assert.equal(saved.at(-1).ip, undefined, "não deve guardar o IP em claro");
  assert.match(saved.at(-1).ipHash, /^[a-f0-9]{32}$/);
  if (process.platform !== "win32") assert.equal(fs.statSync(leadsFile).mode & 0o777, 0o600);
});

test("formulário sem JS redireciona para o WhatsApp", async () => {
  const body = new URLSearchParams({ nome: "Ana Lima", telefone: "(48) 99999-1111", area: "Estética íntima", periodo: "Manhã", consentimento: "sim" }).toString();
  const res = await request("POST", "/api/lead", {
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html", Origin: base },
    body
  });
  assert.equal(res.status, 303);
  assert.match(res.headers.location, /^https:\/\/wa\.me\/5548988659104\?text=/);
});

test("rejeita origem externa (CSRF)", async () => {
  const res = await request("POST", "/api/lead", {
    headers: { "Content-Type": "application/json", Accept: "application/json", Origin: "https://evil.example" },
    body: lead()
  });
  assert.equal(res.status, 403);
});

test("rejeita corpo grande demais e content-type inesperado", async () => {
  const big = await request("POST", "/api/lead", {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ x: "a".repeat(20_000) })
  });
  assert.equal(big.status, 413);
  const xml = await request("POST", "/api/lead", {
    headers: { "Content-Type": "text/xml", Accept: "application/json" },
    body: "<a/>"
  });
  assert.equal(xml.status, 415);
});

test("retorna erros de validação", async () => {
  const res = await request("POST", "/api/lead", {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: lead({ telefone: "1" })
  });
  assert.equal(res.status, 422);
  assert.ok(JSON.parse(res.body).errors.telefone);
});

test("aplica limite de tentativas por IP", async () => {
  const limited = createApp(loadConfig({ LEADS_FILE: "", LEAD_RATE_MAX: "2" }));
  await new Promise((r) => limited.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${limited.address().port}`;
  const statuses = [];
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url + "/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: lead()
    });
    statuses.push(res.status);
    if (res.status === 429) assert.ok(Number(res.headers.get("retry-after")) > 0);
  }
  limited.close();
  assert.deepEqual(statuses, [201, 201, 429]);
});

test("CSP da hospedagem estática é igual à do servidor", () => {
  const { CSP } = require("../server/security");
  const headersFile = fs.readFileSync(path.join(__dirname, "..", "public", "_headers"), "utf8");
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.ok(headersFile.includes(`Content-Security-Policy: ${CSP}\n`));
  const vercelCsp = vercel.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.equal(vercelCsp, CSP);
});
