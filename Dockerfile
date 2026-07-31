FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PORT=3001
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node backend ./backend
COPY --chown=node:node frontend ./frontend
COPY --chown=node:node package.json ./
RUN mkdir -p backend/data backend/public/uploads backend/.wwebjs_auth_tenant_default \
    && chown -R node:node backend/data backend/public/uploads backend/.wwebjs_auth_tenant_default
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "backend/server.js"]
