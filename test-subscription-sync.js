const authService = require('./src/services/auth/auth.service');
const db = require('./src/db/database');

async function testSubscriptionSync() {
  console.log('--- Testing Subscription Sync & Plan Upgrades ---');

  const testEmail = `subtest_${Date.now()}@flipviewpdf.com`;
  const regResult = await authService.register({
    email: testEmail,
    password: 'Password123!',
    name: 'Subscription Test User'
  });

  const userId = regResult.user.id;
  console.log(`1. Created Free User: ${userId} (${testEmail})`);

  let user = db.getUserById(userId);
  let plan = db.getPlanById(user.plan_id);
  console.log(`   Initial Plan: ${user.plan_id} (max_publications: ${plan.max_publications}, has_branding: ${plan.has_branding})`);
  if (user.plan_id !== 'free' || plan.has_branding !== 1) {
    throw new Error('Expected initial plan to be free with branding enabled');
  }

  // 2. Sync to Pro
  console.log('2. Syncing subscription to PRO (flipview_pro_annual)...');
  const syncPro = await authService.syncSubscription({
    userId,
    planId: 'pro',
    storeProductId: 'flipview_pro_annual',
    isActive: true
  });

  user = db.getUserById(userId);
  plan = db.getPlanById(user.plan_id);
  console.log(`   Updated User Plan: ${user.plan_id}, status: ${user.subscription_status}, storeProductId: ${user.store_product_id}`);
  console.log(`   Plan details: max_publications=${plan.max_publications}, max_pages=${plan.max_pages_per_doc}, has_branding=${plan.has_branding}`);
  
  if (user.plan_id !== 'pro' || plan.has_branding !== 0 || plan.max_publications !== 250) {
    throw new Error('PRO plan sync assertion failed');
  }

  // 3. Sync to Business
  console.log('3. Syncing subscription to BUSINESS (flipview_business_annual)...');
  const syncBus = await authService.syncSubscription({
    userId,
    planId: 'business',
    storeProductId: 'flipview_business_annual',
    isActive: true
  });

  user = db.getUserById(userId);
  plan = db.getPlanById(user.plan_id);
  console.log(`   Updated User Plan: ${user.plan_id}, max_publications: ${plan.max_publications}`);
  if (user.plan_id !== 'business' || plan.max_publications !== 1000) {
    throw new Error('BUSINESS plan sync assertion failed');
  }

  // 4. Cancel / Expire Subscription
  console.log('4. Syncing expired/cancelled subscription...');
  const syncExp = await authService.syncSubscription({
    userId,
    planId: 'pro',
    storeProductId: 'flipview_pro_annual',
    isActive: false
  });

  user = db.getUserById(userId);
  plan = db.getPlanById(user.plan_id);
  console.log(`   Expired subscription result: plan=${user.plan_id}, status=${user.subscription_status}`);
  if (user.plan_id !== 'free' || user.subscription_status !== 'EXPIRED') {
    throw new Error('Expired subscription should revert active plan to free');
  }

  console.log('\n🎉 ALL SUBSCRIPTION SYNC TESTS PASSED 100%!');
  process.exit(0);
}

testSubscriptionSync().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
