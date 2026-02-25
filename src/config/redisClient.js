const Redis = require('ioredis');

// [1] 실제 연결은 여기서 딱 한 번만 수행
const redis = new Redis({
    host: process.env.REDIS_HOST || '34.158.208.117',
    port: 6379,
});

// [2] 연결 로그도 여기서 관리
redis.on('connect', () => console.log('✅ Redis connection established to Server 1'));
redis.on('error', (err) => console.error('❌ Redis connection error:', err));

// [3] 다른 파일들이 쓸 수 있게 내보내기
module.exports = redis;