const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const resService = require('../services/resService');
const redis = require('../config/redisClient'); // Redis 연결 설정
const amqp = require('amqplib'); // RabbitMQ 연결 설정

// 1. 모든 이벤트(공연) 목록 조회
exports.getAllEvents = async (req, res) => {
    try {
        // 1. Prisma를 사용하여 DB에서 모든 이벤트 조회 (날짜 오름차순)
        //Prisma의 findMany 메서드를 호출해서 event 테이블의 모든 레코드를 가져옴. select쿼리문처럼
        const events = await prisma.event.findMany({
            orderBy: { event_date: 'asc' } // 날짜순 정렬(오름차순)
        });
        // 2. 성공 시 데이터 반환 (조회가 성공하면 클라이언트에게 JSON 형태로 데이터 보냄)
        res.json(events);
    } catch (error) {
        // 3. 예외 발생 시 로그 출력 및 500 에러 응답
        console.error("이벤트 조회 오류:", error);
        res.status(500).json({ message: "공연 목록을 불러오지 못했습니다." });
    }
};

// 2. 예매 생성 (핵심 로직)
exports.createReservation = async (req, res) => {
    console.log("요청성공")
        // 1. 헤더에서 유저 ID 추출 (Nginx가 준 것)
    // const memberId = req.headers['x-user-id'];
    // //Nginx가 헤더를 코드 레벨에서 한 번 더 확인, memberId가 없을 경우를 대비
    // if (!memberId) {
    //     return res.status(401).json({ message: "인증 정보가 없습니다.!" });
    // }

    const { event_id, ticket_count } = req.body;
    console.log("이벤트아이디"+event_id+", 티켓카운트"+ticket_count)
    const count = parseInt(ticket_count, 10); // 숫자로 확실히 변환

   try {
        /**
         * [Step 1: Redis 재고 선점]
         * DB를 찌르기 전, Redis에서 원자적(Atomic) 연산인 DECRBY를 사용해 
         * 찰나의 순간에 몰리는 수만 명의 요청 중 선착순으로 재고를 차감함.
         */
        const remainingStock = await redis.decrby(`event:${event_id}:stock`, count);

        if (remainingStock < 0) {
            // 차감 후 음수라면 재고 부족이므로 즉시 복구(Rollback)하고 거절
            await redis.incrby(`event:${event_id}:stock`, count);
            return res.status(400).json({ message: "남은 티켓이 부족합니다." });
        }

        /**
         * [Step 2: 비즈니스 로직 및 포인트 검증]
         * 프론트엔드 로직에 맞춰 수수료(1,000원) 포함 금액을 계산하고
         * 유저의 포인트가 충분한지 확인하는 과정을 서비스 계층에서 수행.
         */
        const bookingDetail = await resService.validateAndPrepare(event_id, count, memberId);

        /**
         * [Step 3: RabbitMQ 비동기 메시지 전송]
         * 결제 확정 및 DB 저장(PostgreSQL)은 부하가 큰 작업이므로 
         * 메시지 큐에 던져서 비동기적으로 처리함.
         */
        const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
        const channel = await connection.createChannel();

        const msg = JSON.stringify({ 
            memberId, 
            event_id, 
            ticket_count: count,
            total_price: bookingDetail.totalPrice, // 계산된 최종 금액 포함
            ticket_code: bookingDetail.ticketCode  // 미리 생성된 티켓 ID
        });

        await channel.assertQueue('reservation_queue', { durable: true });
        await channel.sendToQueue('reservation_queue', Buffer.from(msg));

        // 4. 유저에게는 Step 3 완료 화면 구성을 위한 정보를 담아 빠르게 응답(Accepted)
        res.status(202).json({ 
            message: "예약 요청이 성공적으로 접수되었습니다.",
            ticket_id: bookingDetail.ticketCode,
            total_price: bookingDetail.totalPrice
        });

    } catch (error) {
       /**
         * [보상 트랜잭션]
         * 비즈니스 로직(포인트 부족 등) 중 에러가 나면 Redis 재고를 다시 돌려줌.
         */
        await redis.incrby(`event:${event_id}:stock`, count);
        console.error("예약 처리 중 오류:", error);
        res.status(error.status || 500).json({ message: error.message || "서버 오류가 발생했습니다." });
    }
};

// 특정 이벤트 상세 정보 조회
exports.getEventDetail = async (req, res) => {
    try {
        const { eventId } = req.params;
        const event = await prisma.event.findUnique({
            where: { event_id: parseInt(eventId) }
        });
        
        if (!event) return res.status(404).json({ message: "공연을 찾을 수 없습니다." });
        res.json(event);
    } catch (error) {
        res.status(500).json({ message: "상세 조회 중 오류 발생" });
    }
};

// 특정 유저의 예약 상태 확인
exports.getReservationStatus = async (req, res) => {
    try {
        const { userId } = req.params;
        // 로직 구현 필요 (예: DB에서 해당 유저의 최근 예약 상태 조회)
        res.json({ message: "조회 기능 준비 중", userId });
    } catch (error) {
        res.status(500).json({ message: "상태 조회 중 오류 발생" });
    }
};