const express = require('express');
const router = express.Router();
const controller = require('./analytics.controller');

router.get('/overview', controller.getOverview);
router.get('/providers', controller.getProviders);
router.get('/models', controller.getModels);
router.get('/history', controller.getHistory);
router.get('/live', controller.getLive);

module.exports = router;
