require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');

const app = express();
const PORT = process.env.PORT || 8082;

// 1. PostgreSQL 연결 설정 [cite: 12]
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 2. RabbitMQ 연결 및 채널 생성 [cite: 138]
let channel;
async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL);
    channel = await connection.createChannel();
    console.log("✅ RabbitMQ Connected");
  } catch (error) {
    console.error("❌ RabbitMQ Connection Failed:", error);
  }
}

app.use(express.json());

// 기본 예약 API 예시
app.post('/reserve', async (req, res) => {
  const { userId, productId } = req.body;
  
  try {
    // DB 작업 예시
    // await pool.query('INSERT INTO reservations...');
    
    // RabbitMQ 메시지 전송 (비동기 처리)
    if (channel) {
      const msg = JSON.stringify({ userId, productId, status: 'PENDING' });
      channel.sendToQueue('reservation_queue', Buffer.from(msg));
    }
    
    res.status(201).json({ message: "Reservation request received" });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/health', (req, res) => res.send('Reservation Service is Running'));

app.listen(PORT, () => {
  console.log(`🚀 Reservation Service listening on port ${PORT}`);
  connectRabbitMQ();
});