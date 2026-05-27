# Stage 1: Build with Node.js + Vite
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source files
COPY tsconfig.json vite.config.ts ./
COPY src/ src/
COPY style.css ./
COPY index.html ./

# Build the app (typecheck + vite build)
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist/ /usr/share/nginx/html/

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
