# Dra. Flávia Curvello — Site da clínica

Site de alta conversão da clínica **Dra. Flávia Curvello – Estética corporal, facial e íntima**, no Centro de Florianópolis (Edifício Planet Tower).

- **Frontend:** HTML, CSS e JavaScript puros (sem frameworks): carrega rápido, funciona bem no celular e é fácil de manter.
- **Backend:** Node.js sem nenhuma dependência externa (nada de `npm install`, então não há pacotes de terceiros para auditar). Serve o site, recebe os leads do formulário e aplica as camadas de segurança.
- **Foco em conversão:** o WhatsApp é o canal principal, com o formulário de agendamento enviando a pessoa para o WhatsApp com a mensagem pronta.

## Como rodar

```bash
npm start            # http://localhost:3000
npm test             # 27 testes (validação, segurança, rotas)
npm run dev          # recarrega ao salvar
npm run start:env    # usa as variáveis do arquivo .env (copie de .env.example)
```

Requer Node.js 20 ou superior.

## Estrutura

```
public/                  → tudo o que vai para o navegador
  index.html             → página principal (landing page)
  politica-de-privacidade.html
  404.html
  assets/css/styles.css  → design system (cores, tipografia, componentes)
  assets/js/main.js      → menu, animações, máscara, formulário → WhatsApp
  assets/img/            → fotos otimizadas (WebP + JPG, sem metadados EXIF)
  assets/fonts/          → Playfair Display + Jost hospedadas localmente (licença OFL)
  _headers               → cabeçalhos de segurança para Netlify/Cloudflare Pages
server/
  index.js               → servidor HTTP + rota POST /api/lead
  security.js            → CSP, cabeçalhos, rate limit, verificação de origem
  lead.js                → validação e higienização dos dados do formulário
  config.js              → variáveis de ambiente
test/                    → testes automatizados (node:test)
Dockerfile               → imagem enxuta, usuário sem privilégios
vercel.json              → configuração para hospedagem estática na Vercel
```

## Estratégia de conversão

A página segue a ordem de uma landing page de serviço local:

1. **Hero:** promessa clara, foto real da Dra. Flávia, dois botões de ação (agendar ou WhatsApp) e a prova social (nota 4,9 com 153 avaliações no Google) logo na primeira tela.
2. **Barra de confiança:** nota, número de avaliações, especialidades e atendimento individual.
3. **"Você se identifica?":** as dores do público, para a pessoa se reconhecer.
4. **Tratamentos:** facial, corporal e íntimo. Cada card tem um botão que **já seleciona a área no formulário**.
5. **Como funciona:** quatro passos, para tirar a insegurança de quem nunca foi à clínica.
6. **A Doutora** e **A Clínica:** autoridade e ambiente, com as fotos reais.
7. **Avaliações reais do Google.**
8. **Nosso compromisso:** responde de forma direta à principal objeção encontrada nas avaliações (expectativa x resultado), com transparência e plano por escrito.
9. **Formulário curto:** nome, WhatsApp, área e período. Ao enviar, o lead é registrado e o WhatsApp abre com a mensagem pronta.
10. **FAQ** (preço, dor, tempo de resultado, discrição) e **localização** com o botão "Como chegar".

Também há uma barra fixa de agendamento/WhatsApp no celular e um botão flutuante no desktop. Os dados estruturados (Schema.org) ajudam no SEO local.

**Medição:** todo botão tem `data-track`. Se o Google Tag Manager for instalado, os eventos `cta_click`, `generate_lead`, `lead_form_error` e `map_open` chegam ao `dataLayer` automaticamente.

## Segurança (resumo)

| Camada | O que foi feito |
|---|---|
| Cabeçalhos | CSP restritiva (sem scripts inline ou de terceiros), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP |
| Formulário | Validação no cliente **e** no servidor, lista fechada de opções, limite de tamanho (8 KB), remoção de caracteres de controle/invisíveis |
| Anti-spam | Honeypot, tempo mínimo de preenchimento e limite de envios por IP (5 a cada 10 min), com resposta silenciosa para robôs |
| CSRF | Verificação de `Origin`/`Referer` (configure `ALLOWED_ORIGINS`) |
| Arquivos | Proteção contra path traversal, bloqueio de arquivos ocultos (`.env`, `.git`) e de configuração |
| Exportação | Neutralização de *CSV/Formula injection* (campos que começam com `=`, `+`, `-` ou `@`) |
| DoS | Timeouts de cabeçalho e de requisição (contra Slowloris), limite global por IP |
| LGPD | Consentimento explícito, IP guardado apenas como hash com sal, telefone mascarado nos logs, arquivo de leads com permissão `600`, mapa do Google carregado só após clique, nenhum cookie de rastreamento |
| Webhook | Somente HTTPS, timeout de 5 s, assinatura HMAC-SHA256 opcional (`X-Signature-SHA256`) |

## Para onde vão os leads

- **Arquivo** `data/leads.jsonl` (uma linha JSON por lead), fora da pasta pública.
- **Webhook** opcional (`LEAD_WEBHOOK_URL`): conecte ao n8n, Make, Zapier ou a um Google Apps Script para salvar numa planilha ou CRM e notificar a equipe.
- Mesmo sem backend (hospedagem estática), o formulário continua funcionando: a pessoa é levada ao WhatsApp da mesma forma.

## Deploy

**Opção A, servidor Node (recomendado, com captura de leads):** Render, Railway, Fly.io, uma VPS ou Docker.

```bash
docker build -t flavia-site .
docker run -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data flavia-site
```

Atrás de um proxy (Nginx, Render etc.), defina `TRUST_PROXY=1` e `ALLOWED_ORIGINS`.

**Opção B, estático:** Netlify, Cloudflare Pages ou Vercel publicando a pasta `public/`. Os cabeçalhos de segurança já estão em `public/_headers` e `vercel.json`.

## Checklist antes de publicar

- [ ] **Domínio:** substituir `https://www.draflaviacurvello.com.br` (canonical, Open Graph, Schema.org, `robots.txt`, `sitemap.xml`) pelo domínio real.
- [ ] **Instagram:** confirmar o @ oficial (rodapé de `index.html`; hoje aponta para `instagram.com/draflaviacurvello`).
- [ ] **Registro profissional:** incluir conselho e número de registro da Dra. Flávia (as normas de publicidade em saúde exigem isso). Os locais estão marcados com `TODO` no HTML.
- [ ] **Razão social e CNPJ** na Política de Privacidade.
- [ ] **Horário de funcionamento** completo (hoje o site diz apenas "fechamos às 18h", que é o dado do Google).
- [ ] Revisar a lista de tratamentos/queixas de cada card para refletir os protocolos oferecidos de fato.
- [ ] Gerar `IP_HASH_SALT` (`openssl rand -hex 32`) e configurar `ALLOWED_ORIGINS`.
- [ ] (Opcional) Instalar o Google Tag Manager/Meta Pixel **com banner de consentimento** e liberar os domínios correspondentes na CSP.

## Boas práticas de conteúdo

As avaliações exibidas são trechos reais e públicos do Google, com os nomes abreviados. O texto evita promessas de resultado e "antes e depois", em linha com as normas éticas de publicidade em saúde, e reforça que os resultados variam de pessoa para pessoa.
