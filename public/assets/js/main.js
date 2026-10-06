/* Dra. Flávia Curvello — interações do site (sem dependências) */
(function () {
  "use strict";

  var doc = document.documentElement;
  doc.classList.add("js");

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Rastreamento de conversões ----------
     Envia eventos para o dataLayer (Google Tag Manager) apenas se ele
     existir. Nenhum script de terceiros é carregado por padrão. */
  function track(event, data) {
    if (Array.isArray(window.dataLayer)) {
      var payload = { event: event };
      if (data) for (var k in data) payload[k] = data[k];
      window.dataLayer.push(payload);
    }
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-track]");
    if (el && el.tagName !== "BUTTON") track("cta_click", { cta: el.getAttribute("data-track") });
  });

  /* ---------- Cabeçalho e barra fixa no celular ---------- */
  var header = document.querySelector(".site-header");
  var mobileCta = document.querySelector(".mobile-cta");
  var booking = document.getElementById("agendar");
  var bookingVisible = false;

  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    if (header) header.classList.toggle("is-scrolled", y > 8);
    if (mobileCta) mobileCta.classList.toggle("is-visible", y > 480 && !bookingVisible);
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  if ("IntersectionObserver" in window && booking) {
    new IntersectionObserver(function (entries) {
      bookingVisible = entries[0].isIntersecting;
      onScroll();
    }, { threshold: 0.15 }).observe(booking);
  }
  onScroll();

  /* ---------- Menu mobile ---------- */
  var toggle = document.querySelector(".menu-toggle");
  var nav = document.getElementById("menu");

  function setMenu(open) {
    if (!toggle || !nav) return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.querySelector(".sr-only").textContent = open ? "Fechar menu" : "Abrir menu";
    nav.classList.toggle("is-open", open);
  }
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      setMenu(toggle.getAttribute("aria-expanded") !== "true");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) { setMenu(false); toggle.focus(); }
    });
  }

  /* ---------- Animação de entrada ---------- */
  if (!reduceMotion && "IntersectionObserver" in window) {
    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealIO.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px" });

    document.querySelectorAll(
      ".section-head, .card, .steps li, .about-copy, .about-media, .review, .promise-box, .lead-form, .accordion details, .contact-info, .map"
    ).forEach(function (el) {
      el.classList.add("reveal");
      revealIO.observe(el);
    });
  }

  /* ---------- Mapa sob demanda ---------- */
  var facade = document.querySelector(".map-facade");
  if (facade) {
    facade.addEventListener("click", function () {
      var src = facade.getAttribute("data-src");
      if (!/^https:\/\/www\.google\.com\/maps/.test(src)) return;
      var iframe = document.createElement("iframe");
      iframe.src = src;
      iframe.title = "Mapa: localização da clínica no Edifício Planet Tower";
      iframe.loading = "lazy";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.allowFullscreen = true;
      facade.replaceWith(iframe);
      track("map_open");
    });
  }

  /* ---------- Ano no rodapé ---------- */
  document.querySelectorAll(".js-year").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---------- Formulário de agendamento ---------- */
  var form = document.getElementById("lead-form");
  if (!form) return;

  var fields = {
    nome: form.elements.nome,
    telefone: form.elements.telefone,
    area: form.elements.area,
    consentimento: form.elements.consentimento
  };
  var statusEl = form.querySelector(".form-status");
  var submitBtn = form.querySelector('button[type="submit"]');
  form.elements.ts.value = String(Date.now());

  // Botões dos tratamentos pré-selecionam a área de interesse
  document.querySelectorAll(".js-area").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var area = btn.getAttribute("data-area");
      if (area) fields.area.value = area;
      setTimeout(function () { fields.nome.focus({ preventScroll: true }); }, reduceMotion ? 0 : 500);
    });
  });

  // Máscara de telefone brasileiro: (48) 98865-9104
  function onlyDigits(v) { return String(v || "").replace(/\D+/g, ""); }
  function formatPhone(v) {
    var d = onlyDigits(v);
    if (d.length > 11 && d.indexOf("55") === 0) d = d.slice(2);
    d = d.slice(0, 11);
    if (d.length <= 2) return d.length ? "(" + d : "";
    if (d.length <= 6) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  }
  fields.telefone.addEventListener("input", function () {
    fields.telefone.value = formatPhone(fields.telefone.value);
  });

  var NAME_RE = /^[\p{L}][\p{L}\p{M}' .-]{1,79}$/u;

  function validate() {
    var errors = {};
    var nome = fields.nome.value.trim().replace(/\s+/g, " ");
    var tel = onlyDigits(fields.telefone.value);

    if (!NAME_RE.test(nome)) errors.nome = "Informe seu nome (apenas letras).";
    if (!/^[1-9]{2}9?\d{8}$/.test(tel)) errors.telefone = "Informe um WhatsApp válido com DDD.";
    if (!fields.area.value) errors.area = "Escolha uma opção.";
    if (!fields.consentimento.checked) errors.consentimento = "Precisamos da sua autorização para entrar em contato.";

    setError(fields.nome, "f-nome-err", errors.nome);
    setError(fields.telefone, "f-tel-err", errors.telefone);
    setError(fields.area, "f-area-err", errors.area);
    setError(fields.consentimento, "f-consent-err", errors.consentimento);
    return errors;
  }

  function setError(input, id, msg) {
    var el = document.getElementById(id);
    if (msg) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", id);
    } else {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    }
    if (el) el.textContent = msg || "";
  }

  function buildMessage(data) {
    var lines = [
      "Olá! Vim pelo site e gostaria de agendar uma avaliação.",
      "",
      "*Nome:* " + data.nome,
      "*Área de interesse:* " + data.area,
      "*Melhor período:* " + data.periodo
    ];
    if (data.mensagem) lines.push("*Objetivo:* " + data.mensagem);
    return lines.join("\n");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var errors = validate();
    var keys = Object.keys(errors);
    if (keys.length) {
      fields[keys[0]].focus();
      statusEl.className = "form-status is-error";
      statusEl.textContent = "Confira os campos destacados.";
      track("lead_form_error", { fields: keys.join(",") });
      return;
    }

    var periodo = form.querySelector('input[name="periodo"]:checked');
    var data = {
      nome: fields.nome.value.trim().replace(/\s+/g, " "),
      telefone: onlyDigits(fields.telefone.value),
      area: fields.area.value,
      periodo: periodo ? periodo.value : "Qualquer horário",
      mensagem: form.elements.mensagem.value.trim().slice(0, 500),
      consentimento: true,
      site: form.elements.site.value,
      ts: Number(form.elements.ts.value) || 0
    };

    submitBtn.disabled = true;
    statusEl.className = "form-status is-success";
    statusEl.textContent = "Tudo certo! Abrindo o WhatsApp…";

    // Registra o lead no servidor (se houver backend). keepalive garante o envio
    // mesmo com a navegação para o WhatsApp. Falhas não bloqueiam a pessoa.
    var endpoint = form.getAttribute("action");
    try {
      if (window.fetch && endpoint) {
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify(data),
          keepalive: true,
          credentials: "same-origin"
        }).catch(function () {});
      }
    } catch (err) { /* segue para o WhatsApp */ }

    track("generate_lead", { area: data.area, periodo: data.periodo });

    var number = form.getAttribute("data-whatsapp");
    var url = "https://wa.me/" + number + "?text=" + encodeURIComponent(buildMessage(data));

    setTimeout(function () {
      window.location.href = url;
      submitBtn.disabled = false;
      statusEl.innerHTML = "";
      var link = document.createElement("a");
      link.href = url;
      link.rel = "noopener noreferrer";
      link.textContent = "Clique aqui se o WhatsApp não abrir.";
      statusEl.append("Obrigada! ", link);
    }, 350);
  });
})();
