# Stage 1: Build with Node.js + Vite
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vitest.config.ts vite.config.ts eslint.config.js ./
COPY src/ src/
COPY embed-proxy/ embed-proxy/
COPY style.css index.html ./

# Do not set VITE_EMBED_PROXY=1 — rewriting embeds onto our origin breaks playback.
RUN npm run build

# Stage 2: Node static server + embed rewrite proxy
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=80
ENV DIST_DIR=/app/dist

COPY --from=builder /app/dist/ /app/dist/
COPY embed-proxy/rewrite.mjs embed-proxy/server.mjs embed-proxy/hlsNative.mjs /app/embed-proxy/

# Non-root (port 80 needs cap; compose maps host 8080 → container 8080).
ENV PORT=8080
USER node
EXPOSE 8080

# Explicit entrypoint so a stale nginx-era `/docker-entrypoint.sh` on an old
# container config cannot shadow the Node image (that path does not exist here).
ENTRYPOINT ["node"]
CMD ["embed-proxy/server.mjs"]
