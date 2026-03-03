//src/messaging/listener/cencelConsumer.js

const amqp = require('amqplib');
const cancelService = require('../../services/cancelService');// 실제 로직은 여기서 처리

const startCancelConsumer = async () => {
    // 핵심 주석: 환경 변수 활용 (하드코딩 방지)
    const rabbitUrl = process.env.RABBITMQ_URL;
    if (!rabbitUrl) {
        console.error("❌ RABBITMQ_URL이 설정되지 않음.");
        return;
    }

    try {
        const connection = await amqp.connect(rabbitUrl);
        const channel = await connection.createChannel();
        
        const queueName = 'reservation_cancel_queue';
        await channel.assertQueue(queueName, { durable: true });
        
        console.log(`🎧 [보상 트랜잭션 대기 중] ${queueName} 감시 시작`);

        channel.consume(queueName, async (msg) => {
            if (!msg) return;

            try {
                const data = JSON.parse(msg.content.toString());
                
                // 핵심 주석: 복잡한 DB/Redis 롤백 로직은 서비스 레이어로 위임
                await cancelService.handleCompensation(data);
                
                console.log(`⏪ [롤백 완료] 티켓코드: ${data.ticket_code}`);
                channel.ack(msg); // 처리 완료 알림
            } catch (error) {
                console.error('❌ [보상 트랜잭션 실패]:', error);
                // 처리 실패 시 nack를 보내서 큐에 다시 넣거나(requeue), 별도 처리가 필요해
                channel.nack(msg, false, true); 
            }
        });
    } catch (error) {
        console.error("❌ RabbitMQ 연결 실패:", error);
    }
};

module.exports = startCancelConsumer;