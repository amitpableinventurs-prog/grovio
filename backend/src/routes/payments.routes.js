const router = require('express').Router();
const express = require('express');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/payments/payments.controller');
const gatewaysCtrl = require('../controllers/payments/gateways.controller');

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

// PayU: hosted form + callback (PayU posts form-encoded results back to us)
router.post('/payu/create', express.json(), authenticate, authorize('customer'), gatewaysCtrl.createPayu);
router.post('/payu/callback', express.urlencoded({ extended: false }), gatewaysCtrl.payuCallback);
router.post('/payu/webhook', express.urlencoded({ extended: false }), express.json(), gatewaysCtrl.payuWebhook);

// PhonePe: redirect checkout, status check on return, webhook
router.post('/phonepe/create', express.json(), authenticate, authorize('customer'), gatewaysCtrl.createPhonepe);
router.post('/phonepe/verify', express.json(), authenticate, authorize('customer'), gatewaysCtrl.verifyPhonepe);
router.post('/phonepe/webhook', express.json(), gatewaysCtrl.phonepeWebhook);

module.exports = router;
