FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /app/uploads

ENV NODE_ENV=production

EXPOSE 6000

CMD ["node", "app/server.js"]
