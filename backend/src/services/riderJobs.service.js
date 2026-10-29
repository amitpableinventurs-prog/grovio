// Background upkeep for delivery partner programs, every few minutes: freeze the results of gigs
// that have ended (services/gig.service.js), lift account holds whose time is up
// (services/accountHold.service.js), pay out incentive offers that have ended
// (services/offer.service.js), settle partners' daily / weekly incentives (services/riderPay.service.js)
// and start Monday's weekly payouts (services/pocket.service.js).
// Gigs and offers are also settled on demand when the app reads them; this is what makes
// payouts happen without anyone opening the app. RIDER_JOBS_DISABLED=true turns it off (e.g. on
// extra API instances).
const { logServerError } = require('./errorLog.service');

const INTERVAL_MS = 5 * 60 * 1000;

function startRiderJobs() {
  if (process.env.RIDER_JOBS_DISABLED === 'true') return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await require('./gig.service').finalizeDue();
      await require('./accountHold.service').releaseDueHolds();
      // Push scheduled notices whose time has come.
      await require('./announcement.service').notifyDue();
      await require('./offer.service').settleDueOffers();
      // Picker day / week bonuses and minimum guarantee, once each day is over.
      await require('./pickerPay.service').settleDue();
      // Delivery partner daily / weekly incentives and minimum guarantee, once each period is over.
      await require('./riderPay.service').settleDue();
      // No-op except on Monday after the payout hour, and once per partner per week.
      await require('./pocket.service').runWeeklyPayouts();
    } catch (err) {
      logServerError('Rider jobs failed', err);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 10_000).unref();
  setInterval(tick, INTERVAL_MS).unref();
}

module.exports = { startRiderJobs };
