// routes/users.js
// ⚠️ קובץ חדש - יש להוסיף לתיקיית routes/ ולחבר ב-server.js:
//   app.use('/api/users', require('./routes/users'));

const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const { requireAuth } = require('./auth');

// 🛡️ מגן אמיתי, לא קוסמטי - חוסם בשרת כל בקשה ממשתמש שאינו Admin (קוד 1),
// גם אם היא מגיעה ישירות ל-API ולא דרך הממשק (למשל מקונסול הדפדפן)
const requireAdmin = (req, res, next) => {
    if (req.session?.user?.permissionCode !== 1) {
        return res.status(403).json({ error: 'פעולה זו מותרת למנהלי מערכת (Admin) בלבד.' });
    }
    next();
};

// יוצרת סיסמה זמנית אקראית וקריאה (לא כוללת תווים מבלבלים כמו 0/O, 1/l)
function generateTempPassword() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pass = '';
    for (let i = 0; i < 10; i++) pass += chars[Math.floor(Math.random() * chars.length)];
    return pass;
}

// =========================================================================
// GET /api/users - רשימת כל המשתמשים (אדמין בלבד)
// =========================================================================
router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT u.UserId, u.EmployeeId, u.UserName, u.UserLastName, u.Email,
                   u.PermissionCode, p.PremmisionName AS PermissionName, u.DepartmentCode, d.DepartmentName,
                   u.MustChangePassword
            FROM users u
            LEFT JOIN permission p ON u.PermissionCode = p.PermissionCode
            LEFT JOIN department d ON u.DepartmentCode = d.DepartmentCode
            ORDER BY u.UserLastName, u.UserName
        `);
        res.json(rows);
    } catch (error) {
        console.error('שגיאה בשליפת משתמשים:', error);
        res.status(500).json({ error: 'שגיאה בטעינת המשתמשים' });
    }
});

// =========================================================================
// POST /api/users - יצירת משתמש חדש (אדמין בלבד)
// מייצרת סיסמה זמנית, מגדירה MustChangePassword=1 - המשתמש יוגדר לבחור
// סיסמה משלו בכניסה הראשונה (אותו מנגנון שכבר קיים ב-auth.js)
// =========================================================================
router.post('/', requireAuth, requireAdmin, async (req, res) => {
    const { EmployeeId, UserName, UserLastName, Email, IdNumber, PermissionCode, DepartmentCode } = req.body;

    if (!EmployeeId || !UserName || !UserLastName || !Email || !PermissionCode || !DepartmentCode) {
        return res.status(400).json({ error: 'חסרים שדות חובה ליצירת משתמש' });
    }

    try {
        const [[existing]] = await db.query('SELECT UserId FROM users WHERE EmployeeId = ?', [EmployeeId]);
        if (existing) {
            return res.status(409).json({ error: 'כבר קיים משתמש עם מספר עובד זה' });
        }

        const tempPassword = generateTempPassword();
        const passwordHash = await bcrypt.hash(tempPassword, 10);

        await db.query(`
            INSERT INTO users (EmployeeId, UserName, UserLastName, Email, IdNumber, PermissionCode, DepartmentCode, PasswordHash, MustChangePassword)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [EmployeeId, UserName, UserLastName, Email, IdNumber || null, PermissionCode, DepartmentCode, passwordHash]);

        // ⚠️ הסיסמה הזמנית מוחזרת פעם אחת בלבד כאן, בתגובה הזו - היא לא נשמרת בשום מקום כטקסט גלוי.
        // חובה למסור אותה לעובד בערוץ מאובטח (לא צ'אט/מייל רגיל) - היא לא תוצג שוב אחרי הרגע הזה.
        res.status(201).json({
            success: true,
            employeeId: EmployeeId,
            tempPassword
        });

    } catch (error) {
        console.error('שגיאה ביצירת משתמש:', error);
        res.status(500).json({ error: 'שגיאה ביצירת המשתמש' });
    }
});

module.exports = router;
