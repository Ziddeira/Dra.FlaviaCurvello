"use strict";

const crypto = require("node:crypto");

/**
 * Content-Security-Policy restritiva: nenhum script inline nem de terceiros.
 * O único conteúdo externo é o iframe do Google Maps, carregado após clique.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src https://www.google.com https://maps.google.com",
  "manifest-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'self' https://wa.me https://api.whatsapp.com",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests"
].join("; ");

function securityHeaders({ hsts = true } = {}) {
  const headers = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Origin-Agent-Cluster": "?1",
    "X-DNS-Prefetch-Control": "off",
    "X-Permitted-Cross-Domain-Policies": "none"
  };
  if (hsts) headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
  return headers;
}

/**
 * Limitador de requisições em memória (janela deslizante simples por chave).
 * Suficiente para uma instância; com várias instâncias, use Redis ou o WAF do provedor.
 */
class RateLimiter {
  constructor({ max, windowMs }) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
    this.timer = setInterval(() => this.sweep(), Math.min(windowMs, 60_000));
    this.timer.unref();
  }

  /** @returns {{ allowed: boolean, retryAfter: number }} */
  take(key, now = Date.now()) {
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) || []).filter((t) => t > cutoff);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return { allowed: false, retryAfter: Math.ceil((list[0] + this.windowMs - now) / 1000) };
    }
    list.push(now);
    this.hits.set(key, list);
    return { allowed: true, retryAfter: 0 };
  }

  sweep(now = Date.now()) {
    const cutoff = now - this.windowMs;
    for (const [key, list] of this.hits) {
      if (!list.length || list[list.length - 1] <= cutoff) this.hits.delete(key);
    }
  }

  stop() {
    clearInterval(this.timer);
  }
}

/** IP do cliente. Só confia em X-Forwarded-For quando explicitamente configurado. */
function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // O último IP é o adicionado pelo proxy confiável; os anteriores podem ser forjados.
    if (xff.length) return xff[xff.length - 1];
  }
  return req.socket.remoteAddress || "unknown";
}

/** Hash do IP com sal: permite detectar abuso sem armazenar o IP (minimização, LGPD). */
function hashIp(ip, salt) {
  return crypto.createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32);
}

/**
 * Verifica se a requisição POST vem do próprio site (proteção CSRF/abuso).
 * Sem cabeçalho Origin (navegadores antigos/envio sem JS), usa o Referer; sem ambos, permite.
 */
function isAllowedOrigin(req, allowedOrigins) {
  const origin = req.headers.origin || refererOrigin(req.headers.referer);
  if (!origin) return true;
  if (origin === "null") return false;
  if (allowedOrigins.length) return allowedOrigins.includes(origin);
  // Sem lista configurada: aceita apenas o mesmo host da requisição.
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function refererOrigin(referer) {
  if (!referer) return "";
  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}

module.exports = { CSP, securityHeaders, RateLimiter, clientIp, hashIp, isAllowedOrigin };
