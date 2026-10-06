"use strict";

const path = require("node:path");

function bool(v) {
  return /^(1|true|yes|on)$/i.test(String(v || ""));
}

function int(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function list(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function loadConfig(env = process.env) {
  const root = path.resolve(__dirname, "..");
  const webhook = env.LEAD_WEBHOOK_URL || "";
  if (webhook && !/^https:\/\//i.test(webhook)) {
    throw new Error("LEAD_WEBHOOK_URL precisa usar https://");
  }
  return {
    host: env.HOST || "0.0.0.0",
    port: int(env.PORT, 3000),
    publicDir: path.join(root, "public"),
    // Origens autorizadas a enviar o formulário (ex.: https://www.draflaviacurvello.com.br)
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    // Use TRUST_PROXY=1 somente atrás de um proxy reverso confiável (Nginx, Render, Fly, etc.)
    trustProxy: bool(env.TRUST_PROXY),
    leadsFile: env.LEADS_FILE === "" ? "" : env.LEADS_FILE || path.join(root, "data", "leads.jsonl"),
    webhookUrl: webhook,
    webhookSecret: env.LEAD_WEBHOOK_SECRET || "",
    ipHashSalt: env.IP_HASH_SALT || "",
    whatsappNumber: (env.WHATSAPP_NUMBER || "5548988659104").replace(/\D+/g, ""),
    hsts: env.HSTS === undefined ? true : bool(env.HSTS),
    leadRateLimit: { max: int(env.LEAD_RATE_MAX, 5), windowMs: int(env.LEAD_RATE_WINDOW_MS, 10 * 60 * 1000) },
    globalRateLimit: { max: int(env.GLOBAL_RATE_MAX, 600), windowMs: 60 * 1000 }
  };
}

module.exports = { loadConfig };
