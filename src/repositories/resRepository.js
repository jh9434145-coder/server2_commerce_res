/**
 * FanVerse - Reservation Repository Layer
 * 담당: PostgreSQL(Server 1) 직접 접근 및 트랜잭션 제어
 */

const { pool } = require('../../app'); // app.js에서 설정한 공용 DB Connection Pool 로드

/**
 * [공연 목록 조회]
 * 일반적인 단순 조회는 Pool에서 비어있는 클라이언트를 자동으로 하나 써서 결과를 가져옴
 */
exports.findAllEvents = async () => {
    // res 스키마의 events 테이블에서 날짜 오름차순으로 전체 데이터 조회
    const query = 'SELECT * FROM res.events ORDER BY event_date ASC';
    const { rows } = await pool.query(query);
    return rows;
};

/**
 * [예약 생성 트랜잭션]
 * 선착순 예약의 핵심인 '조회 후 업데이트' 과정을 하나의 작업 단위로 묶음
 */
exports.createReservationWithTransaction = async (data) => {
    /**
     * [💡 핵심: 클라이언트 대여]
     * pool.query()를 쓰면 쿼리마다 클라이언트를 빌리고 반납하는 과정이 자동으로 일어나서
     * BEGIN - COMMIT 사이의 연속된 상태를 유지할 수 없음.
     * 따라서 pool.connect()로 명시적으로 '전용 클라이언트'를 하나 빌려와야 트랜잭션 유지가 가능함.
     */
    const client = await pool.connect(); 

    try {
        // 1. 트랜잭션 시작 (이 클라이언트는 이제 이 작업이 끝날 때까지 독점됨)
        await client.query('BEGIN'); 

        /**
         * 2. 좌석 확인 및 행 잠금 (Row-level Lock)
         * 'FOR UPDATE'를 붙여서 다른 트랜잭션이 이 행을 수정하거나 읽지 못하게 막음 (선착순 중복 방지)
         * 
         */
        const checkQuery = `
            SELECT available_seats, price FROM res.events 
            WHERE event_id = $1 FOR UPDATE
        `;
        const eventRes = await client.query(checkQuery, [data.event_id]);

        if (eventRes.rows.length === 0) throw new Error("존재하지 않는 공연입니다.");
        const event = eventRes.rows[0];

        // 비즈니스 로직 검증: 잔여석 체크
        if (event.available_seats < data.ticket_count) {
            throw new Error("잔여석이 부족하여 예매할 수 없습니다.");
        }

        // 3. 재고 차감 (Update)
        const updateQuery = `
            UPDATE res.events 
            SET available_seats = available_seats - $1 
            WHERE event_id = $2
        `;
        await client.query(updateQuery, [data.ticket_count, data.event_id]);

        // 4. 예약 데이터 삽입 (Insert)
        const insertQuery = `
            INSERT INTO res.reservations 
            (event_id, member_id, ticket_count, total_price, ticket_code, status)
            VALUES ($1, $2, $3, $4, $5, 'CONFIRMED')
            RETURNING *
        `;
        // 화면에 보여줄 고유 티켓 코드 생성 (난수 기반)
        const ticketCode = `TKT-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        
        const insertRes = await client.query(insertQuery, [
            data.event_id,
            data.member_id,
            data.ticket_count,
            event.price * data.ticket_count, // 서버 측 계산으로 금액 위변조 방지
            ticketCode
        ]);

        // 5. 모든 작업 성공 시 실제 DB에 반영
        await client.query('COMMIT'); 
        return insertRes.rows[0];

    } catch (err) {
        // 과정 중 하나라도 에러 발생 시(예: 잔여석 부족 등) 이전 상태로 모두 되돌림
        await client.query('ROLLBACK'); 
        console.error("[Transaction Error] 예매 롤백 실행:", err.message);
        throw err;
    } finally {
        /**
         * [💡 중요: 클라이언트 반납]
         * 빌려온 클라이언트를 반드시 Pool에 돌려줘야 함. 
         * 반납 안 하면 커넥션 풀이 말라서 서버가 멈춤 (Connection Leak 방지)
         */
        client.release(); 
    }
};