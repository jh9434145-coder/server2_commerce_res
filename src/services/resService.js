/**
 * FanVerse - Reservation Service Layer
 * 담당: 예약 비즈니스 로직 및 외부 마이크로서비스(Redis) 연동
 */

const resRepository = require('../repositories/resRepository');
const { redisClient } = require('../../app'); // Server 2 메인 app에서 생성한 Redis 인스턴스

/**
 * [핵심] 티켓 예매 실행 프로세스
 * @param {Object} resData - 클라이언트로부터 전달받은 예약 정보 (event_id, ticket_count)
 * @param {String} memberId - Nginx Gateway(Lua)에서 검증 후 헤더로 넘겨준 유저 식별자 (PK)
 * @returns {Object} DB 예약 결과와 Redis 유저 프로필이 결합된 객체
 */
exports.makeReservation = async (resData, memberId) => {
    
    // 1. [외부 서비스 연동] Server 3 Redis에서 유저 세션/프로필 정보 조회
    // MSA 환경에서 Core DB를 직접 조인하지 않고, 캐시 저장소를 공유하여 성능 최적화
    let userProfile = null;
    try {
        // Nginx Lua 스크립트가 로그인 시 저장한 키 형식(user:ID)과 매칭
        // 예: memberId가 1이면 'user:1' 조회 -> 결과: { nickname: '화니', email: '...' }
        const cachedData = await redisClient.get(`user:${memberId}`);
        
        if (cachedData) {
            userProfile = JSON.parse(cachedData);
            console.log(`[Cache Hit] User ${memberId} 프로필 획득 성공`);
        } else {
            // Redis에 정보가 없더라도 예약은 진행될 수 있도록 예외처리(Soft-fail)
            console.warn(`[Cache Miss] 유저 ID ${memberId}에 대한 세션 캐시가 존재하지 않음`);
        }
    } catch (err) {
        // 인프라 장애(Redis Down) 발생 시 로깅 후 다음 단계로 진행 (서비스 가용성 확보)
        console.error("❌ Redis Connection Error (Server 3):", err.message);
    }

    // 2. [데이터 전처리] DB 입력을 위한 파라미터 정제
    const dbData = {
        event_id: parseInt(resData.event_id, 10),
        ticket_count: parseInt(resData.ticket_count, 10),
        member_id: memberId // PostgreSQL BIGINT로 들어갈 원본 ID (1, 2 등)
    };

    // 3. [DB 트랜잭션] Repository 계층을 통한 물리적 저장 수행
    // 좌석 조회 -> 차감 -> 예약 생성이 원자적(Atomic)으로 처리됨 (선착순 이슈 방지)
    const dbResult = await resRepository.createReservationWithTransaction(dbData);

    // 4. [데이터 포맷팅] JavaScript의 BigInt 직렬화 이슈 해결
    // PostgreSQL의 BIGINT는 JSON으로 변환 시 에러가 나므로 문자열(String)로 캐스팅
    const cleanDbResult = JSON.parse(JSON.stringify(dbResult, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value
    ));

    // 5. [결과 병합] 예약 정보와 유저 정보를 통합하여 컨트롤러에 반환
    return {
        ...cleanDbResult,
        // Redis에서 가져온 '화니' 혹은 '쩡'의 닉네임을 응답에 포함
        booker_name: userProfile ? userProfile.nickname : "미인증 사용자",
        user_meta: userProfile || { status: "Guest" }
    };
};

/**
 * [공연 목록 조회 서비스]
 */
exports.findAllEvents = async () => {
    // Repository에서 모든 공연 정보를 가져옴
    const events = await resRepository.findAllEvents();
    
    // 리스트 내 BigInt 필드 조작 방지를 위한 안정적 직렬화 처리
    return JSON.parse(JSON.stringify(events, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value
    ));
};