FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
