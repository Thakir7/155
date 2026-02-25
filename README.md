# 🕷️ نظام سحب البيانات - منصة ريادة عسير

## البنية الكاملة

```
scraper/
├── index.js                    ← نقطة الدخول الرئيسية
├── package.json
├── .env.example               ← انسخه إلى .env
│
├── scrapers/
│   ├── franchiseScraper.js    ← منصة الامتياز التجاري
│   ├── doroobScraper.js       ← دورات دروب
│   └── riyadahScraper.js      ← معهد ريادة + جنى + جميل
│
├── scheduler/
│   └── cronScheduler.js       ← المجدول التلقائي
│
├── storage/
│   └── database.js            ← SQLite + جميع الجداول
│
├── api/
│   └── server.js              ← REST API للـ Frontend
│
├── utils/
│   ├── browser.js             ← إدارة Puppeteer
│   └── logger.js              ← نظام السجلات
│
├── data/                      ← قاعدة البيانات (تُنشأ تلقائياً)
│   └── aseer_platform.db
│
└── logs/                      ← ملفات السجلات (تُنشأ تلقائياً)
    ├── scraper.log
    └── errors.log
```

---

## التثبيت والتشغيل

```bash
# 1. تثبيت المكتبات
npm install

# 2. إعداد المتغيرات البيئية
cp .env.example .env
# عدّل .env بحسب بيئتك

# 3. تشغيل النظام (الـ API + المجدول + السحب الأولي)
npm start

# أو بوضع التطوير (مع إعادة تشغيل تلقائية)
npm run dev
```

---

## تشغيل السحابات منفردة

```bash
# سحب الامتياز التجاري فقط
npm run scrape:franchise

# سحب دروب فقط
npm run scrape:doroob

# سحب برامج الدعم فقط
npm run scrape:riyadah

# سحب الكل دفعة واحدة
npm run scrape:all
```

---

## API Endpoints

```
# الامتياز التجاري
GET  /api/franchises?sector=مطاعم&capital_max=100000&page=1
GET  /api/franchises/42
GET  /api/franchises/meta/sectors

# الدورات
GET  /api/courses?license_type=مطعم&is_free=1
GET  /api/courses/required-for/مطعم

# برامج الدعم
GET  /api/support-programs?provider=ريادة
POST /api/support-programs/match
     Body: { gender, business_type, has_family, capital }

# الإدارة
GET  /api/stats
POST /api/admin/scrape
     Header: x-admin-key: YOUR_KEY
     Body: { source: "all" | "franchise" | "doroob" | "support" }
```

---

## جدول التشغيل التلقائي

| المصدر | التكرار | الوقت |
|--------|---------|-------|
| منصة الامتياز التجاري | يومياً | 02:00 KSA |
| دورات دروب | كل يومين | 03:00 KSA |
| برامج الدعم | أسبوعياً (أحد) | 04:00 KSA |
| فحص الصحة | يومياً | 06:00 KSA |

---

## الانتقال لـ API رسمي مستقبلاً

عند الحصول على API رسمي من أي جهة، فقط عدّل الـ Scraper المقابل:

```javascript
// مثال: استبدال franchise scraper بـ API رسمي
async function scrapeAllFranchises() {
  // قبل: puppeteer scraping
  // بعد: استدعاء API مباشر
  const response = await axios.get('https://api.mci.gov.sa/franchises', {
    headers: { 'Authorization': `Bearer ${process.env.MCI_API_KEY}` }
  });
  
  for (const item of response.data) {
    upsertFranchise(transformMCIData(item)); // نفس الـ upsert
  }
}
```

**لا يتغير شيء في الـ API أو قاعدة البيانات أو الـ Frontend!** 🎯
