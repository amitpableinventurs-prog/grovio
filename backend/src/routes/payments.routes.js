const router = require('express').Router();
const express = require('express');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/payments/payments.controller');

// This router is mounted BEFORE the app-wide express.json() in server.js so the
// webhook route below can access the raw body for signature verification; the other
// routes here parse JSON themselves.
router.post('/razorpay/create', express.json(), authenticate, authorize('customer'), ctrl.createRazorpayOrder);
router.post('/razorpay/verify', express.json(), authenticate, authorize('customer'), ctrl.verifyRazorpayPayment);
router.post('/razorpay/failure', express.json(), authenticate, authorize('customer'), ctrl.reportRazorpayFailure);

router.post('/razorpay/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  req.rawBody = req.body;
  req.body = JSON.parse(req.body.toString('utf8'));
  next();
}, ctrl.razorpayWebhook);

module.exports = router;
