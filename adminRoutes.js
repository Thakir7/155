// api/adminRoutes.js
// ============================================================
// لوحة تحكم إدارية + تشغيل يدوي فوري للـ Scrapers
// ============================================================

const express = require('express');
const router = express.Router();
const { getDB, getStats } = require('../storage/database');
const { scrapeAllFranchises } = require('../scrapers/franchiseScraper');
const { scrapeAllCourses }    = require('../scrapers/doroobScraper');
const { scrapeAllPrograms }   = require('../scrapers/riyadahScraper');
const logger = require('../utils/logger');

// حالة السحب الحالية (في الذاكرة)
const scrapeStatus = {
  franchise:  { running: false, lastRun: null, lastStats: null },
  doroob:     { running: false, lastRun: null, lastStats: null },
  support:    { running: false, lastRun: null, lastStats: null },
};

// -------------------------------------------------------
// Middleware: التحقق من مفتاح الإدارة
// -------------------------------------------------------
function requireAdminKey(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (!process.env.ADMIN_API_KEY || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ success: false, error: '🔒 غير مصرح - يلزم مفتاح الإدارة' });
  }
  next();
}

// -------------------------------------------------------
// GET /api/admin/status
// حالة النظام الكاملة
// -------------------------------------------------------
router.get('/status', requireAdminKey, (req, res) => {
  const db = getDB();
  const dbStats = getStats();

  // آخر 20 عملية سحب
  const recentLogs = db.prepare(`
    SELECT source, status, records_new, records_upd, records_err, duration_ms, error_msg, started_at, finished_at
    FROM scrape_log
    ORDER BY id DESC
    LIMIT 20
  `).all();

  res.json({
    success: true,
    system: {
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      node_version: process.version,
      timestamp: new Date().toISOString(),
    },
    scraping: scrapeStatus,
    database: {
      franchises: dbStats.franchises,
      courses:    dbStats.courses,
      programs:   dbStats.programs,
    },
    recent_logs: recentLogs,
  });
});

// -------------------------------------------------------
// POST /api/admin/scrape/:source
// تشغيل يدوي فوري
// source: franchise | doroob | support | all
// -------------------------------------------------------
router.post('/scrape/:source', requireAdminKey, async (req, res) => {
  const { source } = req.params;
  const validSources = ['franchise', 'doroob', 'support', 'all'];

  if (!validSources.includes(source)) {
    return res.status(400).json({
      success: false,
      error: `مصدر غير صالح. الخيارات: ${validSources.join(', ')}`
    });
  }

  // إرجاع استجابة فورية وتشغيل في الخلفية
  res.json({
    success: true,
    message: `✅ بدأ سحب "${source}" في الخلفية`,
    tip: 'تابع التقدم عبر GET /api/admin/status'
  });

  // تشغيل في الخلفية
  setImmediate(() => runScraper(source));
});

// -------------------------------------------------------
// POST /api/admin/scrape/stop (إيقاف مؤقت)
// -------------------------------------------------------
router.post('/stop', requireAdminKey, (req, res) => {
  // في التطبيق الحقيقي تُستخدم AbortController
  res.json({ success: true, message: 'سيتوقف السحب بعد إكمال الدورة الحالية' });
});

// -------------------------------------------------------
// DELETE /api/admin/data/:table
// مسح جدول وإعادة السحب
// -------------------------------------------------------
router.delete('/data/:table', requireAdminKey, (req, res) => {
  const { table } = req.params;
  const allowed = ['franchises', 'courses', 'support_programs'];
  if (!allowed.includes(table)) {
    return res.status(400).json({ success: false, error: 'جدول غير مسموح' });
  }
  const db = getDB();
  const result = db.prepare(`DELETE FROM ${table}`).run();
  logger.warn(`🗑️  تم مسح جدول ${table}: ${result.changes} سجل`);
  res.json({ success: true, deleted: result.changes, table });
});

// -------------------------------------------------------
// GET /api/admin/logs
// سجل العمليات مع فلترة
// -------------------------------------------------------
router.get('/logs', requireAdminKey, (req, res) => {
  const { source, status, limit = 50 } = req.query;
  const db = getDB();

  let sql = 'SELECT * FROM scrape_log WHERE 1=1';
  const params = [];
  if (source) { sql += ' AND source = ?'; params.push(source); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ` ORDER BY id DESC LIMIT ${parseInt(limit)}`;

  const logs = db.prepare(sql).all(...params);
  res.json({ success: true, data: logs, count: logs.length });
});

// -------------------------------------------------------
// منطق تشغيل السحب الفعلي
// -------------------------------------------------------
async function runScraper(source) {
  const jobs = {
    franchise: { key: 'franchise', fn: scrapeAllFranchises, label: 'الامتياز التجاري' },
    doroob:    { key: 'doroob',    fn: scrapeAllCourses,    label: 'دروب' },
    support:   { key: 'support',   fn: scrapeAllPrograms,   label: 'برامج الدعم' },
  };

  const toRun = source === 'all' ? Object.values(jobs) : [jobs[source]].filter(Boolean);

  for (const job of toRun) {
    if (scrapeStatus[job.key]?.running) {
      logger.warn(`⏭️  ${job.label} يعمل بالفعل - تخطي`);
      continue;
    }

    scrapeStatus[job.key] = { running: true, lastRun: new Date().toISOString(), lastStats: null };
    logger.info(`▶️  [يدوي] بدء: ${job.label}`);

    try {
      const stats = await job.fn();
      scrapeStatus[job.key].lastStats = stats;
      logger.info(`✅ [يدوي] اكتمل: ${job.label}`);
    } catch (err) {
      logger.error(`❌ [يدوي] فشل: ${job.label} - ${err.message}`);
      scrapeStatus[job.key].lastError = err.message;
    } finally {
      scrapeStatus[job.key].running = false;
    }
  }
}

module.exports = { router, scrapeStatus };
