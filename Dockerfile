FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Sem dependências externas: apenas o código do site
COPY package.json ./
COPY server ./server
COPY public ./public

# Usuário sem privilégios; somente /app/data é gravável
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server/index.js"]
