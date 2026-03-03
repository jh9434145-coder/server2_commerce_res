// src/controller/resController.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const resService = require('../services/resService');
const resRepository = require('../repositories/resRepository'); 
const redis = require('../config/redisClient'); // Redis 연결 설정
const amqp = require('amqplib'); // RabbitMQ 연결 설정

// 1. 모든 이벤트(공연) 목록 조회
exports.getAllEvents = async (req, res) => {
    try {
        // 1. 레포지토리 함수 호출
        const events = await resRepository.findAllEvents(); 
        
        // 2. 데이터가 없을 경우 처리
        if (!events) return res.status(200).json([]);

        // 3. [핵심] BigInt 변환 (reservations 모델 등에 BigInt가 있어서 필수야)
        const safeEvents = JSON.parse(JSON.stringify(events, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        ));

        res.status(200).json(safeEvents);
    } catch (err) {
        console.error("이벤트 조회 컨트롤러 오류:", err); 
        res.status(500).json({ message: "공연 목록을 불러오지 못했습니다." });
    }
};

// 2. 예매 생성 (핵심 로직)
exports.createReservation = async (req, res) => {
    console.log("요청성공")

    // [1] 요청 본문(Body)에서 예약에 필요한 핵심 정보 추출
    const { event_id, ticket_count, member_id } = req.body;

    console.log("이벤트아이디"+event_id+", 티켓카운트"+ticket_count)
    // [2] 안전한 계산을 위해 티켓 수량을 10진수 정수로 명시적 형변환
    const count = parseInt(ticket_count, 10); // 숫자로 확실히 변환

   try {
        // 2. 토큰으로 Redis 조회해서 member_id 직접 찾기
        const clientToken = req.headers.authorization?.split(' ')[1];

        // const userData = await redis.get(`user:session:${token}`); 
       if (!clientToken) return res.status(401).json({ message: "토큰이 없습니다." });
        
        // 2. Redis에서 해당 유저의 정보(토큰 포함) 가져오기
        // (Hash 구조에 맞는 명령어 사용)
        const redisData = await redis.hGetAll(`AUTH:MEMBER:${member_id}`);
        
        if (!redisData || Object.keys(redisData).length === 0) {
            return res.status(401).json({ message: "존재하지 않는 유저 세션입니다." });
        }

        const serverData = redisData;
        
        // 3. Redis에 저장된 토큰과 클라이언트가 보낸 토큰 비교

        if (serverData.token !== clientToken) {
            console.log("❌ 토큰 불일치!");
            return res.status(401).json({ message: "유효하지 않은 토큰입니다." });
        }

        console.log(`✅ 인증 성공: 유저 ${member_id}`);
        // 4. 나머지 로직 (재고 차감 등)은 그대로 유지
        const remainingStock = await redis.decrBy(`event:stock:${event_id}`, ticket_count);

        if (remainingStock < 0) {
            // 차감 후 음수라면 재고 부족이므로 즉시 복구(Rollback)하고 거절
            await redis.incrBy(`event:stock:${event_id}`, ticket_count);
            return res.status(400).json({ message: "남은 티켓이 부족합니다." });
        }

        /**
         * [Step 2: 비즈니스 로직 및 포인트 검증]
         * 프론트엔드 로직에 맞춰 수수료(1,000원) 포함 금액을 계산하고
         * 유저의 포인트가 충분한지 확인하는 과정을 서비스 계층에서 수행.
         */
        const bookingDetail = await resService.validateAndPrepare(event_id, ticket_count, member_id);

        /**
         * [Step 3: RabbitMQ 비동기 메시지 전송]
         * 결제 확정 및 DB 저장(PostgreSQL)은 부하가 큰 작업이므로 
         * 메시지 큐에 던져서 비동기적으로 처리함.
         * .env의 msa_mq 계정 정보를 사용하여 접속 주소 생성
         */
        // 1. .env에서 계정 정보 읽어오기
        const mqUser = process.env.RABBITMQ_USER || 'guest';
        const mqPass = process.env.RABBITMQ_PASSWORD || 'guest';
        const mqHost = process.env.RABBITMQ_HOST || 'localhost';

        // 2. 인증 정보를 포함한 URL 생성 (amqp://msa_mq:mq1234@localhost:5672)
        const rabbitUrl = `amqp://${mqUser}:${mqPass}@${mqHost}:5672`;

        // 3. RabbitMQ 메시지 발행 (Message Queuing)
        // 핵심 주석: RabbitMQ 서버에 접속하여 채널을 생성함
        const connection = await amqp.connect(rabbitUrl);
        const channel = await connection.createChannel();

        // 핵심 주석: Consumer(일꾼)가 처리할 수 있도록 예약 데이터를 JSON 문자열로 변환
        const msg = JSON.stringify({ 
            member_id, 
            event_id, 
            ticket_count: count,
            total_price: bookingDetail.totalPrice, 
            ticket_code: bookingDetail.ticketCode  
        });

        // 핵심 주석: 'reservation_queue'라는 우체통이 있는지 확인 (durable: true는 서버 재시작 시에도 유지됨을 의미)
        await channel.assertQueue('reservation_queue', { durable: true });
        // 핵심 주석: 준비된 메시지를 큐에 버퍼 형태로 전송
        await channel.sendToQueue('reservation_queue', Buffer.from(msg));

        // 자원 관리: 메시지 전송 후 일정 시간 뒤에 연결을 안전하게 닫음 (선택 사항)
        setTimeout(() => connection.close(), 500);

        // 4. 응답 전송
        // 핵심 주석: 실제 DB 저장은 비동기로 처리되므로 유저에게는 접수 완료(202) 상태를 먼저 알림
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
        await redis.incrBy(`event:stock:${event_id}`, count);
        console.error("예약 처리 중 오류:", error);
        res.status(error.status || 500).json({ message: error.message || "서버 오류가 발생했습니다." });
    }
};

// 특정 이벤트 상세 정보 조회
exports.getEventDetail = async (req, res) => {
    try {
        const { eventId } = req.params;
        // 핵심 주석: Prisma를 사용하여 DB에서 특정 공연의 상세 정보를 단건 조회
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
        // [To-do] 핵심 주석: 비동기 처리 특성상 유저가 자신의 예약 성공 여부를 확인할 수 있는 조회 로직 필요
        // 로직 구현 필요 (예: DB에서 해당 유저의 최근 예약 상태 조회)
        res.json({ message: "조회 기능 준비 중", userId });
    } catch (error) {
        res.status(500).json({ message: "상태 조회 중 오류 발생" });
    }
};

// 환불 요청 접수
exports.requestRefund = async (req, res) => {
    const { ticket_code, member_id } = req.body; // 누구의 어떤 티켓인지 확인

    try {
        // 1. 예약 정보 확인 (본인 확인 및 취소 가능 상태인지 체크)
        const reservation = await resRepository.findReservationByCode(ticket_code);
        
        // [수정 포인트] reservation.member_id와 비교할 때 타입을 맞춤
        // DB의 member_id와 요청의 member_id를 둘 다 숫자로 변환해서 비교!
        if (!reservation || Number(reservation.member_id) !== Number(member_id)) {
            console.log(`❌ 불일치 발생: DB(${reservation?.member_id}) vs 요청(${member_id})`);
            return res.status(404).json({ message: "예약 정보를 찾을 수 없습니다." });
        }
        
        if (reservation.status === 'CANCELED') {
            return res.status(400).json({ message: "이미 취소된 티켓입니다." });
        }

        // 2. 환불 서비스 호출
        // (내부적으로 포인트 복구 요청 메시지를 Spring으로 던지거나 DB 처리를 함)
        await resService.processRefund(reservation);

        res.status(200).json({ message: "환불 요청이 성공적으로 처리되었습니다." });
    } catch (error) {
        console.error("환불 처리 중 오류:", error);
        res.status(500).json({ message: "환불 처리 중 오류가 발생했습니다." });
    }
};