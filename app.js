// app.js 수정
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

/* [RabbitMQ 관련] amqplib 라이브러리 로드
RabbitMQ 서버와 AMQP(Advanced Message Queuing Protocol) 방식으로 통신하기 위한 핵심 모듈*/
// const amqp = require('amqplib');

const app = express();
const PORT = process.env.PORT || 8082;

// DB 및 MQ 설정은 기존과 동일...
const dbUrl = process.env.DATABASE_URL || `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@34.158.208.117:5432/msa_core_db`;
const pool = new Pool({ connectionString: dbUrl });

/* [RabbitMQ 관련] 채널 변수 선언
 실제 메시지를 주고받는 논리적인 통로(Channel)를 저장하는 변수*/
// let channel;


 /* [RabbitMQ 관련] 연결 및 채널 생성 함수
1. process.env.RABBITMQ_URL에 설정된 주소로 연결 시도
2. 연결 성공 시 메시지 전송을 위한 채널 생성
3. 연결 실패 시 에러를 로그에 찍고 5초 뒤에 재연결을 시도함 (재귀 호출)*/
/*async function connectMQ() {
  try {
    const conn = await amqp.connect(process.env.RABBITMQ_URL);
    channel = await conn.createChannel();
    console.log("✅ RabbitMQ 연결 성공");
  } catch (err) {
    console.error("❌ MQ 연결 실패 (5초 후 재시도):", err.message);
    setTimeout(connectMQ, 5000);
  }
}*/

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

/*[RabbitMQ 관련] 서비스 시작 시 연결 함수 호출
서버가 구동되자마자 RabbitMQ 브로커와 연결을 맺기 위해 실행함
현재 사용하지 않으므로 실행되지 않도록 주석 처리*/
  // connectMQ();
});