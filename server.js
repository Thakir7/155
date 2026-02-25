// api/server.js
// ============================================================
// REST API - يعرض البيانات المسحوبة لمنصة ريادة عسير
// الاستخدام: Frontend & Mobile يستدعيان هذا الـ API
// ============================================================

const express = require('express');
const path = require('path');
const { getDB, getStats } = require('../storage/database');
const logger = require('../utils/logger');
const { router: adminRouter } = require('./adminRoutes');

const app = express();
app.use(express.json());

// ── لوحة التحكم المرئية ──
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ── مسارات الإدارة ──
app.use('/api/admin', adminRouter);

// CORS للسماح للـ Frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// ===================================================
// 🏪 API الامتياز التجاري
// ===================================================

/**
 * GET /api/franchises
 * البحث والفلترة في الامتيازات التجارية
 *
 * Query Params:
 *   - sector: القطاع (مطاعم, تجزئة...)
 *   - capital_max: الحد الأعلى لرأس المال المتاح
 *   - region: المنطقة (عسير, أبها...)
 *   - q: بحث نصي في الاسم والوصف
 *   - page, limit: التصفح
 */
app.get('/api/franchises', (req, res) => {
  try {
    const db = getDB();
    const { sector, capital_max, region, q, page = 1, limit = 12 } = req.query;

    let sql = 'SELECT * FROM franchises WHERE is_active = 1';
    const params = [];

    if (sector) {
      sql += ' AND sector LIKE ?';
      params.push(`%${sector}%`);
    }
    if (capital_max) {
      sql += ' AND (capital_min IS NULL OR capital_min <= ?)';
      params.push(parseInt(capital_max));
    }
    if (region) {
      sql += ' AND regions LIKE ?';
      params.push(`%${region}%`);
    }
    if (q) {
      sql += ' AND (name_ar LIKE ? OR description LIKE ? OR sector LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    // إجمالي النتائج للـ Pagination
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
    const { total } = db.prepare(countSql).get(...params);

    // البيانات مع Pagination
    sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const franchises = db.prepare(sql).all(...params);

    res.json({
      success: true,
      data: franchises.map(f => ({
        ...f,
        regions: safeParseJSON(f.regions, []),
      })),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    logger.error(`API Error /franchises: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/franchises/:id
 * تفاصيل امتياز واحد
 */
app.get('/api/franchises/:id', (req, res) => {
  try {
    const db = getDB();
    const franchise = db.prepare('SELECT * FROM franchises WHERE id = ? AND is_active = 1').get(req.params.id);
    if (!franchise) return res.status(404).json({ success: false, error: 'غير موجود' });
    
    res.json({
      success: true,
      data: { ...franchise, regions: safeParseJSON(franchise.regions, []) }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/franchises/sectors
 * قائمة القطاعات المتاحة
 */
app.get('/api/franchises/meta/sectors', (req, res) => {
  const db = getDB();
  const sectors = db.prepare('SELECT DISTINCT sector, COUNT(*) as count FROM franchises WHERE is_active=1 AND sector IS NOT NULL GROUP BY sector ORDER BY count DESC').all();
  res.json({ success: true, data: sectors });
});

// ===================================================
// 📚 API الدورات التدريبية
// ===================================================

/**
 * GET /api/courses
 * Query Params:
 *   - category: الفئة
 *   - license_type: نوع الترخيص لإيجاد الدورات المطلوبة
 *   - is_free: 1 أو 0
 *   - q: بحث نصي
 */
app.get('/api/courses', (req, res) => {
  try {
    const db = getDB();
    const { category, license_type, is_free, q, page = 1, limit = 20 } = req.query;

    let sql = 'SELECT * FROM courses WHERE is_active = 1';
    const params = [];

    if (category) {
      sql += ' AND category LIKE ?';
      params.push(`%${category}%`);
    }
    if (license_type) {
      sql += ' AND is_required_for LIKE ?';
      params.push(`%${license_type}%`);
    }
    if (is_free !== undefined) {
      sql += ' AND is_free = ?';
      params.push(parseInt(is_free));
    }
    if (q) {
      sql += ' AND (title_ar LIKE ? OR description LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }

    const { total } = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as total')).get(...params);
    
    sql += ' ORDER BY is_certified DESC, rating DESC, students_count DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const courses = db.prepare(sql).all(...params);

    res.json({
      success: true,
      data: courses.map(c => ({
        ...c,
        is_required_for: safeParseJSON(c.is_required_for, []),
      })),
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/courses/required-for/:licenseType
 * الدورات المطلوبة لنوع ترخيص معين
 */
app.get('/api/courses/required-for/:licenseType', (req, res) => {
  const db = getDB();
  const { licenseType } = req.params;
  const courses = db.prepare(
    'SELECT * FROM courses WHERE is_active=1 AND is_required_for LIKE ? ORDER BY is_certified DESC'
  ).all(`%${licenseType}%`);
  res.json({ success: true, data: courses, license_type: licenseType });
});

// ===================================================
// 🤝 API برامج الدعم
// ===================================================

/**
 * GET /api/support-programs
 * Query Params:
 *   - provider: الجهة (ريادة، جنى، جميل)
 *   - program_type: نوع (تمويل، تدريب...)
 *   - target_group: الفئة المستهدفة
 */
app.get('/api/support-programs', (req, res) => {
  try {
    const db = getDB();
    const { provider, program_type, target_group, q, page = 1, limit = 20 } = req.query;

    let sql = 'SELECT * FROM support_programs WHERE is_active = 1';
    const params = [];

    if (provider) { sql += ' AND provider LIKE ?'; params.push(`%${provider}%`); }
    if (program_type) { sql += ' AND program_type LIKE ?'; params.push(`%${program_type}%`); }
    if (target_group) { sql += ' AND target_group LIKE ?'; params.push(`%${target_group}%`); }
    if (q) { sql += ' AND (name_ar LIKE ? OR description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

    const { total } = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as total')).get(...params);
    sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const programs = db.prepare(sql).all(...params);

    res.json({
      success: true,
      data: programs.map(p => ({
        ...p,
        benefits: safeParseJSON(p.benefits, []),
        regions: safeParseJSON(p.regions, []),
      })),
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/support-programs/match
 * مطابقة المستخدم ببرامج الدعم المناسبة
 * Body: { age, gender, business_type, has_family, capital, region }
 */
app.post('/api/support-programs/match', (req, res) => {
  const db = getDB();
  const { gender, business_type, has_family, capital } = req.body;
  
  // منطق المطابقة الذكية
  const programs = db.prepare('SELECT * FROM support_programs WHERE is_active = 1').all();
  
  const scored = programs.map(prog => {
    let score = 0;
    const text = `${prog.name_ar} ${prog.description} ${prog.target_group}`.toLowerCase();
    
    if (has_family && text.includes('أسرة')) score += 30;
    if (gender === 'female' && text.includes('مرأة')) score += 25;
    if (business_type && text.includes(business_type)) score += 20;
    if (capital && prog.amount_min && capital >= prog.amount_min) score += 15;
    score += 5; // نقطة أساسية لكل البرامج
    
    return { ...prog, match_score: score, benefits: safeParseJSON(prog.benefits, []) };
  });

  scored.sort((a, b) => b.match_score - a.match_score);

  res.json({ success: true, data: scored.filter(p => p.match_score >= 5).slice(0, 10) });
});

// ===================================================
// 📊 API الإحصائيات ولوحة التحكم
// ===================================================

app.get('/api/stats', (req, res) => {
  try {
    const stats = getStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// تشغيل سحب يدوي (محمي بـ API Key)
app.post('/api/admin/scrape', async (req, res) => {
  const apiKey = req.headers['x-admin-key'];
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ success: false, error: 'غير مصرح' });
  }
  
  const { source } = req.body;
  const { runAllNow } = require('../scheduler/cronScheduler');
  
  res.json({ success: true, message: 'بدأ السحب في الخلفية' });
  
  // تشغيل في الخلفية
  setImmediate(() => runAllNow().catch(logger.error));
});

// ===================================================
// دوال مساعدة
// ===================================================
function safeParseJSON(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; }
  catch { return fallback; }
}

function startServer(port = 3001) {
  app.listen(port, () => {
    logger.info(`🌐 API يعمل على: http://localhost:${port}`);
    logger.info(`   GET  /api/franchises`);
    logger.info(`   GET  /api/courses`);
    logger.info(`   GET  /api/support-programs`);
    logger.info(`   POST /api/support-programs/match`);
    logger.info(`   GET  /api/stats`);
  });
  return app;
}

module.exports = { app, startServer };
