# MyGarage server: Node 22 (its own SQLite), no other dependencies. Data in /data (a folder of this computer).
FROM node:22-alpine
RUN apk add --no-cache tzdata
ENV NODE_ENV=production \
    TZ=Asia/Dubai \
    DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=8787 \
    ADMIN_HOST=0.0.0.0 \
    ADMIN_PORT=8788
WORKDIR /app
COPY package.json ./
COPY src ./src
EXPOSE 8787 8788
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.mjs"]
