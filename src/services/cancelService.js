// src/services/cancelService.js

const resRepository = require('../repositories/resRepository');
const redis = require('../config/redisClient');

/**
 * [보상 트랜잭션 전담 서비스]
 */
const cancelService = {
    /**
     * 결제 실패 시 DB 상태 변경 및 Redis 재고 복구
     */
    handleCompensation: async ({ ticket_code, event_id, ticket_count }) => {
        try {
            // 1. DB 롤백: 예약 취소 상태 변경 및 DB 재고 증감
            // 핵심 주석: 이 메서드는 Repository에서 트랜잭션으로 처리되어야 함
            await resRepository.cancelReservationAndRestoreStock(ticket_code, event_id, ticket_count);
            
            // 2. Redis 롤백: 선차감했던 재고 다시 복구
            const stockKey = `event:stock:${event_id}`;
            await redis.incrBy(stockKey, ticket_count);
            
            console.log(`✅ [Rollback Success] 티켓:${ticket_code} / 복구수량:${ticket_count}`);
        } catch (error) {
            console.error('❌ [Rollback Fail] 보상 트랜잭션 중 치명적 에러:', error);
            throw error; // Consumer가 nack를 보낼 수 있도록 throw
        }
    }
};

module.exports = cancelService;