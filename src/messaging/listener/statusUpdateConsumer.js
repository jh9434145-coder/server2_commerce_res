require('dotenv').config();
const amqp = require('amqplib');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const redis = require('../../config/redisClient');

async function startStatusUpdateConsumer() {
    const mqUser = process.env.RABBITMQ_USER || 'guest';
    const mqPass = process.env.RABBITMQ_PASSWORD || 'guest';
    const mqHost = process.env.RABBITMQ_HOST || 'localhost';
    const rabbitUrl = `amqp://${mqUser}:${mqPass}@${mqHost}:5672`;

    try {
        const connection = await amqp.connect(rabbitUrl);
        const channel = await connection.createChannel();

        const EXCHANGE_NAME = "msa.direct.exchange"; // Spring과 동일한 익스체인지
        const UPDATE_QUEUE = "res.status.update.queue";
        const ROUTING_KEY = "res.status.update"; // Spring에서 회신하는 replyRoutingKey

        // 1. 익스체인지 선언 (Spring에서 이미 만들었지만 Node에서도 확인 차원)
        await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });

        // 2. 수신용 큐 선언
        await channel.assertQueue(UPDATE_QUEUE, { durable: true });

        // ⭐ 3. [핵심 수정] 익스체인지와 큐를 바인딩 (연결)
        // msa.direct.exchange에 res.status.update 키로 들어오는 메시지를 UPDATE_QUEUE로 넣음
        await channel.bindQueue(UPDATE_QUEUE, EXCHANGE_NAME, ROUTING_KEY);

        console.log(`📩 [Status Consumer] 통합 결과 수신 대기 중 (Exchange: ${EXCHANGE_NAME}, Queue: ${UPDATE_QUEUE})...`);

        // 4. 메시지 구독(Consume) 시작
        channel.consume(UPDATE_QUEUE, async (msg) => {
            if (msg !== null) {
                const response = JSON.parse(msg.content.toString());
                
                console.log("-----------------------------------------");
                console.log("📩 [수신 데이터 확인]:", response); 
                console.log("-----------------------------------------");

                const { orderId, status, type } = response; 

                try {
                    if (status === 'COMPLETE' || status === 'SUCCESS' || status === 'REFUNDED') {
                        if (type === 'REFUND' || status === 'REFUNDED') {
                            console.log(`♻️ [환불 확정] DB 업데이트 시작: ${orderId}`);

                            const reservation = await prisma.reservations.findUnique({
                                where: { ticket_code: orderId }
                            });

                            if (reservation && reservation.status !== 'REFUNDED') {
                                await prisma.$transaction(async (tx) => {
                                    await tx.reservations.update({
                                        where: { ticket_code: orderId },
                                        data: { status: 'REFUNDED' }
                                    });
                                    await tx.events.update({
                                        where: { event_id: reservation.event_id },
                                        data: { available_seats: { increment: reservation.ticket_count } }
                                    });
                                });

                                const stockKey = `event:stock:${reservation.event_id}`;
                                await redis.incrBy(stockKey, reservation.ticket_count);
                                
                                console.log(`🚀 [복구 완료] 주문 ${orderId} -> REFUNDED 변경 및 재고 환원 완료`);
                            }
                        } else {
                            await prisma.reservations.update({
                                where: { ticket_code: orderId },
                                data: { status: 'CONFIRMED' }
                            });
                            console.log(`✅ [결제 완료] 주문 ${orderId} -> CONFIRMED 변경`);
                        }
                    }
                    
                    channel.ack(msg);
                } catch (error) {
                    console.error("❌ 컨슈머 내부 처리 에러:", error.message);
                    channel.nack(msg, false, false);
                }
            }
        });

    } catch (error) {
        console.error("❌ RabbitMQ 연결 또는 채널 생성 에러:", error.message);
    }
}

module.exports = startStatusUpdateConsumer;