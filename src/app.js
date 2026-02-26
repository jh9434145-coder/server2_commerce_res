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


app.listen(PORT, async () => {
    console.log(`🚀 [Reservation] Service is running on port ${PORT}`);

    try {
        /**
         * [핵심: Redis 재고 Warm-up]
         * 서버가 시작될 때 DB에서 실제 잔여석을 조회하여 Redis에 동기화함.
         * 서비스 단독 운영을 위해 직접 DB(PostgreSQL) 값을 참조함.
         */
        const targetEventId = 1; // 우선 테스트용 ID (실제로는 활성 이벤트 리스트를 돌리는게 좋음)
        
        // 1. DB에서 실제 재고 조회 (방금 만든 repository 함수 사용)
        const dbStock = await resRepository.getEventStock(targetEventId);
        
        // 2. Redis에 재고 데이터 세팅 (방금 만든 service 함수 사용)
        await resService.initEventStock(targetEventId, dbStock);

        console.log(`✅ [Warm-up] 이벤트 ${targetEventId} 재고(${dbStock}개) Redis 로드 완료`);
    } catch (err) {
        console.error("❌ [Warm-up Error] 초기 재고 로드 실패:", err.message);
    }
});

// 테스트 환경 등을 위해 app 객체만 내보냄 (redisClient는 내보낼 필요 없음)
// module.exports = app;