/**
 * FanVerse - Reservation Service Layer
 * 수정 사항: Redis 기반 실시간 재고(event) 검증 및 차감 로직 추가
 */

const resRepository = require('../repositories/resRepository');
const redis = require('../config/redisClient');

/**
 * [관리자용 또는 서버 시작용: Redis 재고 초기 세팅]
 * 이 코드가 실행되어야 Redis에 'event' 메모리가 생성됨
 */
exports.initEventStock = async (eventId, stockCount) => {
    const key = `event:stock:${eventId}`;
    await redis.set(key, stockCount);
    // 핵심 주석: 초기 재고 데이터를 Redis에 세팅 (이벤트 시작 전 필수)
    return { eventId, stockCount };
};

exports.validateAndPrepare = async (eventId, count, memberId) => {
    // 1. Redis에서 실시간 재고 확인 및 선차감 (핵심!)
    const stockKey = `event:stock:${eventId}`;
    
    // DECRBY를 사용하여 요청 수량만큼 즉시 차감
    const remainingStock = await redis.decrby(stockKey, count);

    // 재고가 부족하면 즉시 예외 발생 (DB까지 안 가고 여기서 컷)
    if (remainingStock < 0) {
        // 깎았던 수량 다시 복구 (Rollback)
        await redis.incrby(stockKey, count);
        throw { status: 400, message: "선착순 마감되었습니다. 재고가 부족합니다." };
    }

    // 2. 유저 포인트 정보 조회 (Server 3 Redis 활용)
    const cachedUser = await redis.get(`user:${memberId}`);
    const userProfile = cachedUser ? JSON.parse(cachedUser) : null;

    // 3. 이벤트 상세 정보 조회 (금액 계산용)
    const event = await resRepository.findEventById(eventId);
    if (!event) {
        // 이벤트가 없으면 깎았던 재고 복구
        await redis.incrby(stockKey, count);
        throw { status: 404, message: "공연 정보를 찾을 수 없습니다." };
    }

    const totalPrice = (event.price * count) + (count * 1000);

    // 4. 포인트 잔액 검증
    if (userProfile && userProfile.points < totalPrice) {
        // 포인트 부족 시 깎았던 재고 복구
        await redis.incrby(stockKey, count);
        throw { status: 400, message: "포인트가 부족합니다." };
    }

    const ticketCode = `TKT-${Math.floor(Math.random() * 90000) + 10000}`;

    return {
        totalPrice,
        ticketCode,
        eventTitle: event.title,
        remainingStock // 현재 남은 재고 반환 가능
    };
};

/**
 * [티켓 예매 실행]
 */
exports.makeReservation = async (resData, memberId) => {
    const dbData = {
        event_id: parseInt(resData.event_id, 10),
        ticket_count: parseInt(resData.ticket_count, 10),
        member_id: memberId,
        total_price: resData.total_price,
        ticket_code: resData.ticket_code
    };

    // DB 저장 (이미 Redis에서 재고 검증이 끝났으므로 안전하게 입력)
    const dbResult = await resRepository.createReservationWithTransaction(dbData);

    return JSON.parse(JSON.stringify(dbResult, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value
    ));
};