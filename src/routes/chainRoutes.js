const express = require('express');
const router = express.Router();
const chainController = require('../controllers/chainController');

router.get('/chains', chainController.getAllChains);
router.get('/chains/:chainId', chainController.getChainById);
router.get('/chains/:chainId/validators', chainController.getChainValidators);

module.exports = router;
