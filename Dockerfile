FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
# 배포용이므로 --only=production 권한 권장
RUN npm install --only=production
COPY . .
EXPOSE 8082
CMD ["node", "app.js"]