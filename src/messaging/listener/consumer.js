// src/consumer.js
require('dotenv').config();
const amqp = require('amqplib');
const resService = require('../../services/resService');

async function startConsumer() {
    // 1. .env에서 접속 정보 가져오기
    const mqUser = process.env.RABBITMQ_USER || 'guest';
    const mqPass = process.env.RABBITMQ_PASSWORD || 'guest';
    const mqHost = process.env.RABBITMQ_HOST || 'localhost';
    const rabbitUrl = `amqp://${mqUser}:${mqPass}@${mqHost}:5672`;

    try {
        const connection = await amqp.connect(rabbitUrl);
        const channel = await connection.createChannel();
        // 핵심 주석: 컨슈머(직원)가 데이터를 꺼내올 예약 전용 우체통(큐) 이름
        const queue = 'reservation_queue';
        // 핵심 주석: 결제 요청을 보낼 우체통(큐) 이름을 먼저 변수로 선언
        const payQueue = 'payment_queue';

        // 큐가 없으면 생성
        await channel.assertQueue(queue, { durable: true });
        // 핵심 주석: 결제 큐도 미리 생성해둠 (durable: true로 설정하여 서버 재시작 시에도 유지)
        await channel.assertQueue(payQueue, { durable: true });

        console.log(`👷 [Consumer] 대기 중... (구독: ${queue}, 발행: ${payQueue})`);

        // 2. 큐에서 메세지 꺼내오기
        channel.consume(queue, async (msg) => {
            if (msg !== null) {
                const data = JSON.parse(msg.content.toString());
                console.log("📦 [수신] 큐에서 데이터 꺼냄:", data);

                try {
                    // 3. 서비스 계층의 DB 저장 로직(makeReservation) 호출!
                    // resRepository의 createReservationWithTransaction이 실행됨
                    await resService.makeReservation(data, data.member_id);
                    
                    console.log(`✅ [성공] DB 저장 완료! 티켓: ${data.ticket_code}`);
                    
                    // 4. Pay 서버로 결제(포인트 차감) 요청 메시지 전송
                    const paymentData = {
                        member_id: data.member_id,
                        amount: data.total_price,
                        reference_id: data.ticket_code, // 어떤 티켓 예매인지 증빙
                        type: 'PAYMENT'
                    };

                    // 핵심 주석: 결제 큐(payment_queue)에 차감 요청 데이터 발행
                    channel.sendToQueue(payQueue, Buffer.from(JSON.stringify(paymentData)));
                    console.log(`💸 [결제 요청] payment_queue로 메시지 전송 완료: ${data.total_price}원 차감 요청`);

                    // 4. 처리 끝났으니 큐에서 메세지 삭제하라고 RabbitMQ에 알림
                    channel.ack(msg);
                } catch (dbErr) {
                    console.error("❌ [실패] DB 저장 에러:", dbErr);
                    // 실패하면 나중에 다시 처리할 수 있게 보류 처리도 가능
                }
            }
        });
    } catch (err) {
        console.error("RabbitMQ 연결 실패:", err);
    }
}

// 직원 출근!
startConsumer();