FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
# 배포용이므로 --only=production 권한 권장
RUN npm install --only=production
COPY . .
EXPOSE 8082
# 실행 경로를 src/app.js로 변경! [cite: 2026-02-23]
CMD ["node", "src/app.js"]