FROM node:20-alpine
RUN apk add --no-cache wget
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/app/data

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "src/index.js"]
