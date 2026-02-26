const redis = require('redis');
const dotenv = require('dotenv');

dotenv.config();

// Redis 클라이언트 설정
const redisClient = redis.createClient({
    url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
    password: process.env.REDIS_PASSWORD || undefined
});

// 연결 상태 이벤트 리스너
redisClient.on('connect', () => {
    console.log('✅ Redis 연결 시도 중...');
});

redisClient.on('ready', () => {
    console.log('🚀 Redis 연결 성공!');
});

redisClient.on('error', (err) => {
    console.error('❌ Redis 연결 에러:', err);
});

redisClient.on('end', () => {
    console.log('Disconnected from Redis');
});

// 클라이언트 연결 실행 (Async)
(async () => {
    try {
        await redisClient.connect();
    } catch (err) {
        console.error('⚠️ Redis 초기 연결 실패:', err);
    }
})();

// 핵심 로직: 에러 방지를 위해 client 객체 내보내기
module.exports = redisClient;



// const Redis = require('ioredis');

// // [1] 실제 연결은 여기서 딱 한 번만 수행
// const redis = new Redis({
//     host: process.env.REDIS_HOST || '34.158.208.117',
//     port: 6379,
// });

// // [2] 연결 로그도 여기서 관리
// redis.on('connect', () => console.log('✅ Redis connection established to Server 1'));
// redis.on('error', (err) => console.error('❌ Redis connection error:', err));

// // [3] 다른 파일들이 쓸 수 있게 내보내기
// module.exports = redis;