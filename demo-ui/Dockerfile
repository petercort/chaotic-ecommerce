FROM node:25-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json server.ts ./
RUN npm run build

FROM node:25-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY public ./public

ENV PORT=8090
ENV API_GATEWAY_URL=http://localhost:8080

EXPOSE 8090

CMD ["node", "dist/server.js"]
