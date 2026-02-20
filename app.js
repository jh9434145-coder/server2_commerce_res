// app.js 수정
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');

const app = express();
const PORT = process.env.PORT || 8082;

// DB 및 MQ 설정은 기존과 동일...
const dbUrl = process.env.DATABASE_URL || `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@34.158.208.117:5432/msa_core_db`;
const pool = new Pool({ connectionString: dbUrl });

let channel;
async function connectMQ() {
  try {
    const conn = await amqp.connect(process.env.RABBITMQ_URL);
    channel = await conn.createChannel();
    console.log("✅ RabbitMQ 연결 성공");
  } catch (err) {
    console.error("❌ MQ 연결 실패 (5초 후 재시도):", err.message);
    setTimeout(connectMQ, 5000);
  }
}

app.use(express.json());

// [추가] 브라우저에서 접속했을 때 보여줄 화면
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Reservation Service</title>
      <style>
        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f0f2f5; }
        .container { text-align: center; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        h1 { color: #1a73e8; }
        .status { font-size: 1.2em; color: #5f6368; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Reservation Service</h1>
        <p class="status">서버가 정상적으로 실행 중입니다.</p>
        <p>포트: ${PORT}</p>
        <button onclick="location.reload()">새로고침</button>
      </div>
    </body>
    </html>
  `);
});

app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log(`🚀 Service running on port ${PORT}`);
  connectMQ();
});