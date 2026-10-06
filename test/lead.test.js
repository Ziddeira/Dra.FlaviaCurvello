"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateLead, cleanText, neutralizeFormula, normalizePhone, whatsappUrl, maskPhone } = require("../server/lead");

const valid = () => ({
  nome: "Maria da Silva",
  telefone: "(48) 98865-9104",
  area: "Estética corporal",
  periodo: "Manhã",
  mensagem: "Quero melhorar a flacidez",
  consentimento: true,
  site: "",
  ts: Date.now() - 10_000
});

test("aceita um lead válido e normaliza o telefone", () => {
  const r = validateLead(valid());
  assert.equal(r.ok, true);
  assert.equal(r.lead.telefone, "48988659104");
  assert.equal(r.lead.nome, "Maria da Silva");
});

test("aceita telefone com código do país", () => {
  assert.equal(normalizePhone("+55 (48) 98865-9104"), "48988659104");
});

test("rejeita campos inválidos", () => {
  const r = validateLead({ ...valid(), nome: "<script>", telefone: "123", area: "Outra", consentimento: false });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ["area", "consentimento", "nome", "telefone"]);
});

test("rejeita período fora da lista", () => {
  const r = validateLead({ ...valid(), periodo: "Madrugada" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.periodo);
});

test("honeypot preenchido é tratado como spam", () => {
  assert.equal(validateLead({ ...valid(), site: "http://spam" }).spam, true);
});

test("envio rápido demais é tratado como spam", () => {
  assert.equal(validateLead({ ...valid(), ts: Date.now() - 500 }).spam, true);
});

test("rejeita payloads que não são objetos", () => {
  for (const bad of [null, "x", 42, []]) assert.equal(validateLead(bad).ok, false);
});

test("remove caracteres de controle e invisíveis", () => {
  assert.equal(cleanText("  Ana\u0000​  Paula‮ ", 80), "Ana Paula");
});

test("neutraliza fórmulas de planilha", () => {
  assert.equal(neutralizeFormula("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"x\")");
  assert.equal(neutralizeFormula("Olá"), "Olá");
  const r = validateLead({ ...valid(), mensagem: "=1+1" });
  assert.equal(r.lead.mensagem, "'=1+1");
});

test("limita o tamanho da mensagem", () => {
  const r = validateLead({ ...valid(), mensagem: "a".repeat(2000) });
  assert.equal(r.lead.mensagem.length, 500);
});

test("gera link do WhatsApp com mensagem codificada", () => {
  const r = validateLead(valid());
  const url = whatsappUrl("5548988659104", r.lead);
  assert.match(url, /^https:\/\/wa\.me\/5548988659104\?text=/);
  assert.ok(decodeURIComponent(url).includes("Maria da Silva"));
});

test("mascara telefone para logs", () => {
  assert.equal(maskPhone("48988659104"), "48*******04");
});
