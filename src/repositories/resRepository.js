/**
 * FanVerse - Reservation Repository Layer
 * 담당: Prisma를 이용한 PostgreSQL(Server 1) 데이터 제어
 */

const { PrismaClient } = require('@prisma/client');
// process.env.DATABASE_URL이 제대로 들어오는지 확인하고 Prisma에 전달
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL, 
    },
  },
});

// [디버깅 로그] 서버 켤 때 주소가 localhost인지 34.158...인지 바로 확인 가능
console.log("📡 현재 연결 시도 중인 DB 주소:", process.env.DATABASE_URL?.split('@')[1] || "주소 없음");
/**
 * [추가: Redis Warm-up용 DB 재고 조회]
 * Prisma는 pool.query 대신 모델 메서드를 사용해
 */
exports.getEventStock = async (eventId) => {
    try {
        // [핵심] 만약 prisma.event가 undefined라면 prisma['event']로 강제 접근 시도
        const eventModel = prisma.event || prisma.events;

        if (!eventModel) {
            console.error("❌ [Prisma Error] 모델을 찾을 수 없음. 모델 리스트:", Object.keys(prisma));
            throw new Error("Prisma 모델(event/events)이 클라이언트에 정의되지 않았어.");
        }

        const targetEvent = await eventModel.findUnique({
            where: { event_id: parseInt(eventId, 10) },
            select: { available_seats: true }
        });

        // 핵심 주석: Prisma 인스턴스에서 유효한 모델을 찾아 재고 조회 수행
        return targetEvent ? targetEvent.available_seats : 0;
    } catch (err) {
        // 상세 에러 로깅
        console.error("❌ [getEventStock Error]:", err.message);
        throw err;
    }
};
// exports.getEventStock = async (eventId) => {
//     // prisma.events가 정의되어 있어야 함 (schema.prisma 모델명 확인)
//     const event = await prisma.event.findUnique({
//         where: { event_id: parseInt(eventId, 10) },
//         select: { available_seats: true }
//     });

//     // 핵심 주석: Prisma findUnique를 통해 DB 재고를 안전하게 가져옴
//     return event ? event.available_seats : 0;
// };

/**
 * [특정 공연 조회]
 * 서비스 계층에서 가격 계산 및 포인트 검증을 위해 호출함
 */
exports.findEventById = async (eventId) => {
    // 특정 ID에 해당하는 공연 정보만 쏙 뽑아옴
    return await prisma.event.findUnique({
        where: { event_id: parseInt(eventId, 10) }
    });
};
/**
 * [공연 목록 조회]
 * 일반적인 단순 조회는 Pool에서 비어있는 클라이언트를 자동으로 하나 써서 결과를 가져옴
 */
exports.findAllEvents = async () => {
    // res 스키마의 events 테이블에서 날짜 오름차순으로 전체 데이터 조회
    return await prisma.event.findMany({
        orderBy: { event_date: 'asc' }
    });
};

/**
 * [예약 생성 트랜잭션]
 * 선착순 예약의 핵심인 '조회 후 업데이트' 과정을 하나의 작업 단위로 묶음
 */
exports.createReservationWithTransaction = async (data) => {
    return await prisma.$transaction(async (tx) => {
        // 1. 재고 확인 및 행 잠금 (Prisma는 기본적으로 업데이트 시 락을 활용함)
        const event = await tx.event.findUnique({
            where: { event_id: data.event_id }
        });

        if (!event) throw new Error("존재하지 않는 공연입니다.");
        if (event.available_seats < data.ticket_count) {
            throw new Error("잔여석이 부족하여 예매할 수 없습니다.");
        }

        // 2. 재고 차감 (Update)
        await tx.event.update({
            where: { event_id: data.event_id },
            data: {
                available_seats: {
                    decrement: data.ticket_count // 원자적 차감 수행
                }
            }
        });

        // 3. 예약 데이터 삽입 (Insert)
        const reservation = await tx.reservation.create({
            data: {
                event_id: data.event_id,
                member_id: data.member_id,
                ticket_count: data.ticket_count,
                total_price: data.total_price,
                ticket_code: data.ticket_code,
                status: 'CONFIRMED'
            }
        });

        // 핵심 주석: Prisma 트랜잭션 성공 시 자동 COMMIT, 에러 시 자동 ROLLBACK
        return reservation;
    });
};