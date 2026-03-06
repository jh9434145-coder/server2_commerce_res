// src/repositories/eventRepository.js

/**
 * FanVerse - Event Repository Layer
 * 담당: Prisma를 이용한 공연 관련 PostgreSQL(Server 1) 데이터 제어
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL, 
    },
  },
});

/**
 * [추가: Redis Warm-up용 DB 재고 조회]
 * Prisma는 pool.query 대신 모델 메서드를 사용해
 */
exports.getEventStock = async (eventId) => {
    try {
        const targetEvent = await prisma.events.findUnique({
            where: { event_id: parseInt(eventId, 10) },
            select: { available_seats: true }
        });

        // 핵심 주석: Prisma events 모델을 통해 재고 조회 수행
        return targetEvent ? targetEvent.available_seats : 0;
    } catch (err) {
        console.error("❌ [getEventStock Error]:", err.message);
        throw err;
    }
};

/**
 * [특정 공연 조회]
 * 서비스 계층에서 가격 계산 및 포인트 검증을 위해 호출함
 */
exports.findEventById = async (eventId) => {
    // 특정 ID에 해당하는 공연 정보만 쏙 뽑아옴
    return await prisma.events.findUnique({
        where: { event_id: parseInt(eventId, 10) }
    });
};

/**
 * [공연 목록 조회]
 * 일반적인 단순 조회는 Pool에서 비어있는 클라이언트를 자동으로 하나 써서 결과를 가져옴
 * **"요청이 올 때마다 DB에서 꺼내오는 방식"**
 */
exports.findAllEvents = async () => {
    try {
        return await prisma.events.findMany({ 
            include: {
                event_locations: true,
                event_images: true // 사진 정보도 한꺼번에 가져오기!
            },
            orderBy: { event_date: 'asc' }
        });
    } catch (err) {
        console.error("❌ Repository findAllEvents 에러:", err);
        throw err;
    }
};