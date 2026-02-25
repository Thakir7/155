// index.js
// ============================================================
// نقطة الدخول الرئيسية - يشغّل كل شيء معاً
// ============================================================

require('dotenv').config();
const logger = require('./utils/logger');
const { startScheduler, runAllNow } = require('./scheduler/cronScheduler');
const { startServer } = require('./api/server');
const { getStats } = require('./storage/database');

async function main() {
  logger.info('');
  logger.info('╔══════════════════════════════════════════════════╗');
  logger.info('║       منصة ريادة عسير - نظام سحب البيانات       ║');
  logger.info('╚══════════════════════════════════════════════════╝');
  logger.info('');

  // 1. تشغيل الـ API
  const PORT = process.env.PORT || 3001;
  startServer(PORT);

  // 2. تشغيل المجدول التلقائي
  startScheduler();

  // 3. فحص إن كانت قاعدة البيانات فارغة → سحب فوري
  const stats = getStats();
  const isEmpty = stats.franchises.count === 0 && stats.courses.count === 0;
  
  if (isEmpty || process.env.FORCE_INITIAL_SCRAPE === 'true') {
    logger.info('');
    logger.info('📭 قاعدة البيانات فارغة - بدء السحب الأولي...');
    logger.info('   (هذا قد يأخذ بضع دقائق)');
    logger.info('');
    
    // سحب أولي في الخلفية بعد 2 ثانية
    setTimeout(() => {
      runAllNow().catch(err => logger.error(`خطأ في السحب الأولي: ${err.message}`));
    }, 2000);
  } else {
    logger.info('');
    logger.info('📊 البيانات الحالية:');
    logger.info(`   🏪 الامتيازات: ${stats.franchises.count}`);
    logger.info(`   📚 الدورات:    ${stats.courses.count}`);
    logger.info(`   🤝 البرامج:    ${stats.programs.count}`);
  }

  logger.info('');
  logger.info('🟢 النظام يعمل. اضغط Ctrl+C للإيقاف.');
}

main().catch(err => {
  logger.error(`💥 خطأ فادح: ${err.message}`);
  process.exit(1);
});

// معالجة الإيقاف النظيف
process.on('SIGINT', () => {
  logger.info('\n👋 إيقاف النظام...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  logger.info('\n👋 إيقاف النظام...');
  process.exit(0);
});
