// src/app.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan'); // [추가] 로그 확인용

// [1] 앱 초기화 및 기본 설정
const app = express();
const PORT = process.env.PORT || 8082;

/**
 * [2] 인프라 연결 설정 (Redis)
 * Server 1의 Redis와 연결하여 선착순 재고를 관리함
 * 별도의 설정 파일에서 생성된 연결 객체를 가져와서 재사용 (중복 연결 방지)
 */
const redisClient = require('./config/redisClient');

// [3] 미들웨어 설정
// 배포 시에는 특정 도메인만 허용하도록 corsOptions를 적용하는 것이 좋음
app.use(morgan('dev')); // 요청 로그를 콘솔에 찍어줌 (디버깅 용이)
app.use(cors()); 
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // [추가] URL 인코딩 데이터 파싱

// [4] 라우터 연결
// Nginx에서 /api/res/ 경로를 제거하고 전달하므로 루트('/')에서 매핑 시작
const resRoutes = require('./routes/resRoutes');
app.use('/', resRoutes);

// [5] 시스템 헬스체크 및 메인 엔드포인트
app.get('/', (req, res) => {
    res.status(200).send({
        service: "Reservation Service",
        status: "Running",
        port: PORT,
        infrastructure: {
            database: "PostgreSQL Connected",
            cache: "Redis Connected"
        }
    });
});

app.get('/health', (req, res) => res.status(200).send('OK'));

// [6] 전역 에러 핸들러
app.use((err, req, res, next) => {
    console.error(`[Internal Error] ${err.stack}`);
    res.status(500).json({ message: "Internal Server Error" });
});

// [7] 서버 실행 및 초기 데이터 로드 (Warm-up)
const resRepository = require('./repositories/resRepository'); // Repository 불러오기
const resService = require('./services/resService'); // Service 불러오기

// 👇 핵심 주석: Node.js 서버가 켜질 때 RabbitMQ Consumer(직원)도 자동으로 백그라운드에서 실행됨
require('./messaging/listener/consumer');

// 👇 [추가] 핵심 주석: 결제 실패 시 보상 트랜잭션을 처리할 취소 전담 Consumer 실행
// (주의: cancelConsumer.js 파일이 있는 실제 경로에 맞게 맞춰줘!)
const startCancelConsumer = require('./messaging/listener/cancelConsumer');
startCancelConsumer().catch(err => console.error("❌ [Cancel Consumer Error] 실행 실패:", err));

// 👇 [추가] 결제 상태 업데이트(응답 수신) Consumer 실행
const startStatusUpdateConsumer = require('./messaging/listener/statusUpdateConsumer'); // [추가]
startStatusUpdateConsumer().catch(err => console.error("❌ [Status Update Consumer Error] 실행 실패:", err)); // [추가]

app.listen(PORT, async () => {
    console.log(`🚀 [Reservation] Service is running on port ${PORT}`);

    try {
        /**
         * [핵심: Redis 재고 Warm-up]
         * 하드코딩된 ID 대신, DB의 모든 이벤트를 조회하여 Redis에 동기화함.
         */
        await resService.warmupAllEventsToRedis();
        
        console.log(`✅ [Warm-up] 모든 이벤트 재고 Redis 동기화 완료`);
    } catch (err) {
        console.error("❌ [Warm-up Error] 초기 재고 로드 실패:", err.message);
    }
});



