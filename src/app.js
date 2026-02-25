require('dotenv').config();
const express = require('express');
const cors = require('cors');

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
app.use(cors()); 
app.use(express.json());

// [4] 라우터 연결
// Nginx에서 /api/res/ 경로를 제거하고 전달하므로 루트('/')에서 매핑 시작
const resRoutes = require('./routes/resRoutes');
app.use('/', resRoutes);

// [5] 시스템 헬스체크 및 메인 엔드포인트
app.get('/', (req, res) => {
    res.status(200).send({
        service: "LuminaPulse Reservation Service",
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

// [7] 서버 실행
app.listen(PORT, () => {
    console.log(`🚀 [Reservation] Service is running on port ${PORT}`);
});

// 다른 모듈에서 사용 가능하도록 내보내기
// module.exports = { redisClient };