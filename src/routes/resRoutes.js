const express = require('express');
const router = express.Router();
const resController = require('../controllers/resController');

// [GET] http://localhost:8082/events -> 목록 조회
router.get('/events', resController.getAllEvents);

// [POST] http://localhost:8082/reserve -> 예약 생성
router.post('/reserve', resController.createReservation);

module.exports = router;