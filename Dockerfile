FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY LICENSE NOTICE README.md ./
RUN npm run build && npm prune --omit=dev --ignore-scripts
COPY dist/portable/ /incoming/downloads/
RUN node scripts/stage-connector-downloads.mjs /incoming dist/web/downloads
FROM node:24.19.0-bookworm-slim
ENV NODE_ENV=production RELAY_HOST=0.0.0.0 PORT=3180 RELAY_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/LICENSE /app/NOTICE ./
USER node
EXPOSE 3180
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3180/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","dist/server/main.js"]
