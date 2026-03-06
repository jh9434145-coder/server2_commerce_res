// src/repositories/resRepository.js

/**
 * FanVerse - Reservation Repository Layer
 * 담당: Prisma를 이용한 예약 관련 PostgreSQL(Server 1) 데이터 제어
 */

const { PrismaClient } = require('@prisma/client');
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
 * [예약 생성 트랜잭션]
 * 선착순 예약의 핵심인 '조회 후 업데이트' 과정을 하나의 작업 단위로 묶음
 */
exports.createReservationWithTransaction = async (data) => {
    return await prisma.$transaction(async (tx) => {
        // 1. 재고 확인 및 행 잠금
        const event = await tx.events.findUnique({
            where: { event_id: data.event_id }
        });

        if (!event) throw new Error("존재하지 않는 공연입니다.");
        if (event.available_seats < data.ticket_count) {
            throw new Error("잔여석이 부족하여 예매할 수 없습니다.");
        }

        // 2. 재고 차감 (Update)
        await tx.events.update({
            where: { event_id: data.event_id },
            data: {
                available_seats: {
                    decrement: data.ticket_count // 원자적 차감 수행
                }
            }
        });

        // 3. 예약 데이터 삽입 (Insert)
        const reservation = await tx.reservations.create({
            data: {
                event_id: data.event_id,
                member_id: data.member_id,
                ticket_count: data.ticket_count,
                total_price: data.total_price,
                ticket_code: data.ticket_code,
                status: 'PENDING' 
            }
        });

        // 핵심 주석: Prisma 트랜잭션 성공 시 자동 COMMIT, 에러 시 자동 ROLLBACK
        return reservation;
    });
};

/**
 * [보상 트랜잭션] 결제 실패 시 예약 취소 및 DB 재고 원복
 */
exports.cancelReservationAndRestoreStock = async (ticket_code, event_id, ticket_count) => {
    return await prisma.$transaction(async (tx) => {
        // 1. 현재 예약 상태 확인
        const reservation = await tx.reservations.findFirst({
            where: { ticket_code: ticket_code }
        });

        if (!reservation) {
            console.log(`⚠️ [Skip] 이미 취소되었거나 없는 예약입니다: ${ticket_code}`);
            return null; 
        }

        // 2. 예약 상태 변경
        const updatedRes = await tx.reservations.update({
            where: { reservation_id: reservation.reservation_id },
            data: { status: 'FAILED' }
        });

        // 3. DB 재고 원복
        await tx.events.update({
            where: { event_id: event_id },
            data: { available_seats: { increment: ticket_count } }
        });

        // 핵심 주석: 상태 체크 후 취소 처리함으로써 재고 중복 복구 방지
        return updatedRes;
    });
};

/**
 * 1. [조회] 티켓 존재 여부 및 정보 확인
 */
exports.findReservationByCode = async (ticket_code) => {
    return await prisma.reservations.findUnique({
        where: { ticket_code: ticket_code }
    });
};

/**
 * 2. [수정] 환불 확정 및 좌석 복구 (트랜잭션)
 */
exports.completeRefund = async (ticket_code, event_id, ticket_count) => {
    return await prisma.$transaction(async (tx) => {
        // [Step 1] 예약 상태 변경
        const updatedRes = await tx.reservations.update({
            where: { ticket_code: ticket_code },
            data: { status: 'REFUNDED' } 
        });

        // [Step 2] DB 좌석 수 복구 (+ 수량만큼 늘려줌)
        await tx.events.update({
            where: { event_id: event_id },
            data: { 
                available_seats: { 
                    increment: ticket_count 
                } 
            }
        });

        return updatedRes;
    });
};
