const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');

// 🛡️ Middleware לבדיקת התחברות (מנתק במידה והשרת אופס או שעברו 40 דקות)
const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ 
            error: 'פג תוקף החיבור או שהשרת אופס. נא להתחבר מחדש.',
            unauthorized: true 
        });
    }
    next();
};

// =========================================================================
// 1. התחברות למערכת (Login)
// =========================================================================
router.post('/login', async (req, res) => {
    const { employeeId, password } = req.body;

    if (!employeeId || !password) {
        return res.status(400).json({ error: 'חובה להזין מספר עובד וסיסמה' });
    }

    try {
        const [users] = await db.query('SELECT * FROM Users WHERE EmployeeId = ?', [employeeId]);
        
        if (users.length === 0) {
            return res.status(401).json({ error: 'מספר עובד או סיסמה שגויים' });
        }

        const user = users[0];

        // אימות סיסמה מול ה-Hash
        const isPasswordValid = await bcrypt.compare(password, user.PasswordHash || '');
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'מספר עובד או סיסמה שגויים' });
        }

        // 🟢 חדש: סיסמה זמנית שהוקצתה ע"י מנהל - מחייבים החלפה לפני כניסה, באמצעות אותה זרימה בדיוק
        if (user.MustChangePassword) {
            return res.status(403).json({
                error: 'זו סיסמה זמנית - יש להגדיר סיסמה חדשה לפני הכניסה הראשונה.',
                requirePasswordReset: true
            });
        }

        // בדיקת תוקף סיסמה (6 חודשים = 180 ימים)
        const lastChange = new Date(user.LastPasswordChangeDate);
        const now = new Date();
        const diffInDays = Math.floor((now - lastChange) / (1000 * 60 * 60 * 24));

        if (diffInDays >= 180) {
            return res.status(403).json({ 
                error: 'תוקף הסיסמה פג (עברו 6 חודשים). חובה לבצע איפוס סיסמה.',
                requirePasswordReset: true 
            });
        }
        
        // 🟢 הוספה: שמירת פרטי המשתמש ב-Session של השרת
        req.session.userId = user.UserId;
        req.session.user = {
            userId: user.UserId,
            employeeId: user.EmployeeId,
            fullName: `${user.UserName} ${user.UserLastName}`,
            permissionCode: user.PermissionCode,
            departmentCode: user.DepartmentCode
        };

        // החזרת פרטי המשתמש לשמירה ב-Frontend
        res.json({
            success: true,
            user: req.session.user
        });

    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'שגיאה בשרת בזמן התחברות' });
    }
});

// =========================================================================
// 2. איפוס סיסמה יזום ב-2 גורמי אימות (Reset Password)
// =========================================================================
router.post('/reset-password', async (req, res) => {
    const { employeeId, idNumber, oldPassword, newPassword, confirmPassword } = req.body;

    if (!employeeId || !idNumber || !oldPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: 'חובה למלא את כל שדות האימות' });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'הסיסמה החדשה ואימות הסיסמה אינם תואמים' });
    }

    try {
        const [users] = await db.query('SELECT * FROM Users WHERE EmployeeId = ?', [employeeId]);
        if (users.length === 0) {
            return res.status(400).json({ error: 'פרטי האימות שגויים' });
        }

        const user = users[0];

        // אימות תעודת זהות
        if (user.IdNumber !== idNumber) {
            return res.status(400).json({ error: 'מספר תעודת זהות אינו תואם' });
        }

        // אימות סיסמה ישנה
        const isOldPasswordValid = await bcrypt.compare(oldPassword, user.PasswordHash || '');
        if (!isOldPasswordValid) {
            return res.status(400).json({ error: 'הסיסמה הישנה אינה נכונה' });
        }

        // הצפנת הסיסמה החדשה ב-Hash
        const newHash = await bcrypt.hash(newPassword, 10);

        // עדכון הסיסמה, איפוס התאריך להיום, וכיבוי דגל הסיסמה הזמנית (אם היה דלוק)
        await db.query(
            'UPDATE Users SET PasswordHash = ?, LastPasswordChangeDate = NOW(), MustChangePassword = 0 WHERE EmployeeId = ?',
            [newHash, employeeId]
        );

        res.json({ success: true, message: 'הסיסמה עודכנה בהצלחה! כעת ניתן להתחבר.' });

    } catch (error) {
        console.error('Reset Error:', error);
        res.status(500).json({ error: 'שגיאה בעיבוד איפוס הסיסמה' });
    }
});

// =========================================================================
// 3. פרופיל אישי - פרטי המשתמש המחובר כרגע (לשימוש ב"אזור האישי")
// =========================================================================
router.get('/profile', requireAuth, async (req, res) => {
    try {
        const [[profile]] = await db.query(`
            SELECT u.UserName, u.UserLastName, u.EmployeeId, u.Email, d.DepartmentName
            FROM users u
            LEFT JOIN department d ON u.DepartmentCode = d.DepartmentCode
            WHERE u.UserId = ?
        `, [req.session.userId]);

        if (!profile) return res.status(404).json({ error: 'המשתמש לא נמצא' });
        res.json(profile);

    } catch (error) {
        console.error('שגיאה בשליפת פרופיל אישי:', error);
        res.status(500).json({ error: 'שגיאה בטעינת הפרופיל' });
    }
});

// ייצוא ה-router יחד עם ה-requireAuth כדי שנוכל לייבא אותו בקבצים אחרים
router.requireAuth = requireAuth;
module.exports = router;