// src/messaging/listener/statusUpdateConsumer.js
require('dotenv').config();
const amqp = require('amqplib');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const cancelService = require('../../services/cancelService'); // [추가] 보상 서비스 불러오기

async function startStatusUpdateConsumer() {
    const mqUser = process.env.RABBITMQ_USER || 'guest';
    const mqPass = process.env.RABBITMQ_PASSWORD || 'guest';
    const mqHost = process.env.RABBITMQ_HOST || 'localhost';
    const rabbitUrl = `amqp://${mqUser}:${mqPass}@${mqHost}:5672`;

    try {
        const connection = await amqp.connect(rabbitUrl);
        const channel = await connection.createChannel();

        const EXCHANGE_NAME = "msa.direct.exchange";
        const UPDATE_QUEUE = "res.status.update.queue";
        const UPDATE_ROUTING_KEY = "res.status.update";

        await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
        await channel.assertQueue(UPDATE_QUEUE, { durable: true });
        await channel.bindQueue(UPDATE_QUEUE, EXCHANGE_NAME, UPDATE_ROUTING_KEY);

        console.log(`📩 [Status Consumer] 결제 결과 수신 대기 중...`);

        channel.consume(UPDATE_QUEUE, async (msg) => {
            if (msg !== null) {
                const response = JSON.parse(msg.content.toString());
                const { orderId, status, message: logMsg } = response;

                try {
                    if (status === 'COMPLETE') {
                        // 1. 결제 성공 시: 예약 확정
                        await prisma.reservations.update({
                            where: { ticket_code: orderId },
                            data: { status: 'CONFIRMED' }
                        });
                        console.log(`✅ [결제 완료] 주문 ${orderId} 상태를 CONFIRMED로 변경함`);
                    } 
                    else if (status === 'FAIL') {
                        // 2. 결제 실패 시: 보상 트랜잭션(Rollback) 실행
                        // 핵심 주석: 먼저 DB에서 예약 정보를 조회해 복구에 필요한 데이터를 가져옴
                        const reservation = await prisma.reservations.findUnique({
                            where: { ticket_code: orderId }
                        });

                        if (reservation) {
                            // 미리 만들어둔 cancelService를 호출해서 DB + Redis를 한 번에 복구!
                            await cancelService.handleCompensation({
                                ticket_code: orderId,
                                event_id: reservation.event_id,
                                ticket_count: reservation.ticket_count,
                            });
                            console.log(`❌ [보상 완료] 결제 실패로 인해 재고가 원복되었습니다: ${orderId}`);
                        }
                    }
                    channel.ack(msg);
                } catch (err) {
                    console.error("❌ 응답 처리 중 에러:", err.message);
                    // 에러 시 nack를 보내 재시도하게 하거나 로그를 남김
                }
            }
        });
    } catch (err) {
        console.error("❌ RabbitMQ 연결 오류:", err);
    }
}

module.exports = startStatusUpdateConsumer;