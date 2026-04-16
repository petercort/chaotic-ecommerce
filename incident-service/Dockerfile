FROM node:20-alpine
RUN apk add --no-cache curl jq docker-cli bash
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE 8095
CMD ["node", "server.js"]
