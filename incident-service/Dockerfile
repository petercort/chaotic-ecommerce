FROM node:20-alpine AS builder
RUN apk add --no-cache curl jq docker-cli bash
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json uuid.d.ts ./
COPY copilot ./copilot
COPY auth ./auth
COPY server.ts types.ts ./
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache curl jq docker-cli bash
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY --from=builder /app/dist ./dist
COPY public ./public
EXPOSE 8095
CMD ["node", "dist/server.js"]
