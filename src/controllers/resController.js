const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
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
    // 1. 헤더에서 유저 ID 추출 (Nginx가 준 것)
    const memberId = req.headers['x-user-id'];
    //Nginx가 헤더를 코드 레벨에서 한 번 더 확인, memberId가 없을 경우를 대비
    if (!memberId) {
        return res.status(401).json({ message: "인증 정보가 없습니다.!" });
    }

    const { event_id, ticket_count } = req.body;
    const count = parseInt(ticket_count); // 숫자로 확실히 변환

    try {
        // 2. Redis에서 재고 확인 및 원자적(Atomic) 차감
        // DECRBY를 사용하면 여러 명이 동시에 붙어도 중복 차감이 방지돼
        const remainingStock = await redis.decrby(`event:${event_id}:stock`, count);

        if (remainingStock < 0) {
            // 재고가 없으면 즉시 다시 복구하고 꽝!
            await redis.incrby(`event:${event_id}:stock`, count);
            return res.status(400).json({ message: "남은 티켓이 부족합니다." });
        }

        // 3. 재고 차감 성공 시, RabbitMQ로 예약 상세 정보 전송 (비동기 처리)
        // 실제 DB(PostgreSQL) 저장은 가용량이 남을 때 천천히 수행함
        const connection = await amqp.connect('amqp://server1-ip');
        const channel = await connection.createChannel();

        const msg = JSON.stringify({ memberId, event_id, ticket_count: count });

        await channel.assertQueue('reservation_queue');
        await channel.sendToQueue('reservation_queue', Buffer.from(msg));

        // 4. 일단 유저에게는 성공했다고 빠르게 응답
        res.status(202).json({ message: "예약 요청이 접수됐습니다. 잠시만 기다려주세요." });

    } catch (error) {
        console.error("예약 처리 중 오류:", error);
        res.status(500).json({ message: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
    }
};