"use strict";

const AREAS = Object.freeze([
  "Estética facial",
  "Estética corporal",
  "Estética íntima",
  "Ainda não sei — quero orientação"
]);
const PERIODOS = Object.freeze(["Manhã", "Tarde", "Qualquer horário"]);
const MIN_FILL_MS = 2500; // envios mais rápidos que isso são de robôs

const NAME_RE = /^[\p{L}][\p{L}\p{M}' .-]{1,79}$/u;
const PHONE_RE = /^[1-9]{2}9?\d{8}$/;

/** Remove caracteres de controle/invisíveis e normaliza espaços. */
function cleanText(value, max) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/**
 * Evita "CSV/Formula injection" quando os leads forem exportados para planilhas
 * (Excel/Google Sheets executam células que começam com = + - @).
 */
function neutralizeFormula(value) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function normalizePhone(value) {
  let digits = String(value ?? "").replace(/\D+/g, "");
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  return digits;
}

/**
 * Valida e higieniza o lead recebido.
 * @returns {{ ok: true, lead: object } | { ok: false, errors: object } | { ok: false, spam: true }}
 */
function validateLead(input, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: { form: "Dados inválidos." } };
  }

  // Anti-spam: honeypot preenchido ou envio rápido demais => descarta em silêncio.
  if (cleanText(input.site, 200)) return { ok: false, spam: true };
  const ts = Number(input.ts);
  if (Number.isFinite(ts) && ts > 0 && (now - ts < MIN_FILL_MS || ts > now + 60_000)) {
    return { ok: false, spam: true };
  }

  const errors = {};
  const nome = cleanText(input.nome, 80).replace(/\s+/g, " ");
  const telefone = normalizePhone(input.telefone);
  const area = cleanText(input.area, 60);
  const periodo = cleanText(input.periodo, 30) || "Qualquer horário";
  const mensagem = cleanText(input.mensagem, 500);
  const consent = input.consentimento === true || input.consentimento === "sim" || input.consentimento === "on";

  if (!NAME_RE.test(nome)) errors.nome = "Informe seu nome (apenas letras).";
  if (!PHONE_RE.test(telefone)) errors.telefone = "Informe um WhatsApp válido com DDD.";
  if (!AREAS.includes(area)) errors.area = "Escolha uma área de interesse.";
  if (!PERIODOS.includes(periodo)) errors.periodo = "Período inválido.";
  if (!consent) errors.consentimento = "É necessário autorizar o contato.";

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    lead: {
      nome: neutralizeFormula(nome),
      telefone,
      area,
      periodo,
      mensagem: neutralizeFormula(mensagem),
      consentimento: true
    }
  };
}

function whatsappMessage(lead) {
  const lines = [
    "Olá! Vim pelo site e gostaria de agendar uma avaliação.",
    "",
    `*Nome:* ${lead.nome.replace(/^'/, "")}`,
    `*Área de interesse:* ${lead.area}`,
    `*Melhor período:* ${lead.periodo}`
  ];
  if (lead.mensagem) lines.push(`*Objetivo:* ${lead.mensagem.replace(/^'/, "")}`);
  return lines.join("\n");
}

function whatsappUrl(number, lead) {
  const text = lead ? whatsappMessage(lead) : "Olá! Vim pelo site e gostaria de agendar uma avaliação.";
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** Mascara o telefone para logs: 48988659104 -> 48*******04 */
function maskPhone(phone) {
  return phone.length > 4 ? phone.slice(0, 2) + "*".repeat(phone.length - 4) + phone.slice(-2) : "****";
}

module.exports = { AREAS, PERIODOS, MIN_FILL_MS, validateLead, cleanText, neutralizeFormula, normalizePhone, whatsappUrl, whatsappMessage, maskPhone };
