# Stage 1: Build the Vite SPA
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vitest.config.ts vite.config.ts eslint.config.js ./
COPY src/ src/
COPY embed-proxy/ embed-proxy/
COPY style.css index.html ./

# SportSRC experiment: native HLS mint is Streamed-specific — keep iframe path.
# Do not set VITE_EMBED_PROXY=1 — rewriting embeds onto our origin can break players.
ENV VITE_HLS_NATIVE=0
RUN npm run build

# Stage 2: Node server (Playwright kept for optional HLS experiments).
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=80
ENV DIST_DIR=/app/dist
# Use the browser bundle shipped in this image (do not download at runtime).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/ /app/dist/
COPY embed-proxy/rewrite.mjs embed-proxy/server.mjs embed-proxy/hlsNative.mjs embed-proxy/sportsrc.mjs /app/embed-proxy/

EXPOSE 80

ENTRYPOINT ["node"]
CMD ["embed-proxy/server.mjs"]
