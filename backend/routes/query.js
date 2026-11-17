// This file defines the /query endpoint route and delegates handling to the controller.



const express = require('express');
const router = express.Router();
const { handleQuery } = require('../controllers/queryController');



// Define the POST /query endpoint
router.post('/', handleQuery);

module.exports = router;
