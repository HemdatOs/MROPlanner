const express = require('express');
const path = require('path');
const session = require('express-session');

const app = express();

// =========================================================================
// 1. Middlewares בסיסיים
// =========================================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================================
// 2. הגדרת Session (40 דקות + ניתוק אוטומטי באיפוס שרת)
// =========================================================================
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  rolling: true, // 👈 מחדש את הטיימר של ה-Cookie בכל בקשה מהלקוח!
  cookie: { 
    maxAge: 40 * 60 * 1000 // 40 דקות
  }
}));

// =========================================================================
// 3. טעינת הראוטרים והמיידלוור (תיקון הייבוא)
// =========================================================================
const authRouter = require('./routes/auth');
const requireAuth = authRouter.requireAuth; // שליפת פונקציית האבטחה

const visitsRouter = require('./routes/visits');
const maintanaceCallsRouter = require('./routes/maintanace_calls');
const lookupsRouter = require('./routes/lookups');

// =========================================================================
// 4. נתיבים פתוחים (Public Routes - ללא בדיקת התחברות)
// =========================================================================

// נתיבי התחברות/התנתקות (Auth)
app.use('/api/auth', authRouter);

// הצגת מסך פתיחת התקלה
app.get('/maintenance/new', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'maintenanceissue.html'));
});

// =========================================================================
// 5. נתיבים מוגנים (Protected API Endpoints - דורשים requireAuth)
// =========================================================================

// טעינת נתוני Dropdowns (מתוך routes/lookups.js)
app.use('/api/lookups', requireAuth, lookupsRouter);

// ניהול ביקורים (מוגן)
app.use('/api/visits', requireAuth, visitsRouter);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// ניהול קריאות תקלות, עריכה ולוגים (מוגן)
app.use('/api/maintanace_calls', requireAuth, maintanaceCallsRouter);
app.use('/api/attachments', require('./routes/attachments'));
// קבלת נתוני התקלה והפעולות ושמירתם (מוגן)
app.post('/api/issues', requireAuth, async (req, res) => {
    const { issue, actions } = req.body;
    console.log('Received new maintenance issue:', issue?.Title);
    console.log('Number of actions attached:', actions?.length || 0);
    
    res.status(201).json({ success: true, message: "Issue saved successfully" });
});


app.use('/api/missions', require('./routes/missions'));
app.use('/api/hangar', require('./routes/hangar'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/aircraft', require('./routes/aircraft'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/users', require('./routes/users'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/changelog', require('./routes/changelog'));
// =========================================================================
// 6. הרצת השרת
// =========================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 השרת רץ בהצלחה על פורט ${PORT}`);
});