// routes/notifications.js
// ⚠️ קובץ חדש - יש להוסיף לתיקיית routes/ ולחבר ב-server.js:
//   app.use('/api/notifications', require('./routes/notifications'));

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');
const { sendEmail } = require('../mailer');

// =========================================================================
// פונקציית עזר - יוצרת התראה פנימית + שולחת מייל, בקריאה אחת.
// מיוצאת כדי שנתיבים אחרים (תקלות, משימות) יוכלו לקרוא לה ישירות בעת
// יצירה/הקצאה, בלי לשכפל את הלוגיקה בכל מקום.
// =========================================================================
async function notifyUser(userId, message, link) {
    if (!userId) return;

    try {
        await db.query(
            'INSERT INTO notifications (UserId, Message, Link) VALUES (?, ?, ?)',
            [userId, message, link || null]
        );

        const [[user]] = await db.query('SELECT Email, UserName FROM users WHERE UserId = ?', [userId]);
        if (user?.Email) {
            const html = `
                <p>שלום ${user.UserName || ''},</p>
                <p>${message}</p>
                ${link ? `<p><a href="${link}">מעבר למערכת</a></p>` : ''}
                <p style="color:#888; font-size:0.85em;">התראה אוטומטית ממערכת MRO Planner</p>
            `;
            await sendEmail(user.Email, 'MRO Planner - התראה חדשה', html);
        }
    } catch (error) {
        // כשל בהתראה לא אמור להפיל את הפעולה שקראה לה (יצירת תקלה וכו') - רק לוג
        console.error('שגיאה ביצירת התראה:', error);
    }
}

// =========================================================================
// GET /api/notifications - כל ההתראות של המשתמש המחובר, החדשות קודם
// =========================================================================
router.get('/', requireAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM notifications WHERE UserId = ? ORDER BY CreatedAt DESC LIMIT 30',
            [req.session.userId]
        );
        res.json(rows);
    } catch (error) {
        console.error('שגיאה בשליפת התראות:', error);
        res.status(500).json({ error: 'שגיאה בטעינת ההתראות' });
    }
});

// =========================================================================
// GET /api/notifications/unread-count - כמה התראות לא נקראו (למספר על הפעמון)
// =========================================================================
router.get('/unread-count', requireAuth, async (req, res) => {
    try {
        const [[row]] = await db.query(
            'SELECT COUNT(*) AS cnt FROM notifications WHERE UserId = ? AND IsRead = 0',
            [req.session.userId]
        );
        res.json({ count: row.cnt });
    } catch (error) {
        console.error('שגיאה בספירת התראות:', error);
        res.status(500).json({ error: 'שגיאה' });
    }
});

// =========================================================================
// POST /api/notifications/:id/read - סימון התראה בודדת כנקראה
// 🛡️ מוודא שההתראה שייכת למשתמש המחובר - אי אפשר לסמן התראות של מישהו אחר
// =========================================================================
router.post('/:id/read', requireAuth, async (req, res) => {
    try {
        await db.query(
            'UPDATE notifications SET IsRead = 1 WHERE NotificationId = ? AND UserId = ?',
            [req.params.id, req.session.userId]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('שגיאה בסימון התראה:', error);
        res.status(500).json({ error: 'שגיאה' });
    }
});

// =========================================================================
// POST /api/notifications/read-all - סימון כל ההתראות של המשתמש כנקראו
// =========================================================================
router.post('/read-all', requireAuth, async (req, res) => {
    try {
        await db.query('UPDATE notifications SET IsRead = 1 WHERE UserId = ? AND IsRead = 0', [req.session.userId]);
        res.json({ success: true });
    } catch (error) {
        console.error('שגיאה בסימון כל ההתראות:', error);
        res.status(500).json({ error: 'שגיאה' });
    }
});

// =========================================================================
// בדיקת חריגת זמן טיפול - רצה תקופתית (לא בכל בקשה), לא בקריאת API.
// מיוצאת ונקראת מ-server.js דרך setInterval (ראו הערה בסוף הקובץ).
// כדי לא "להציף" באותה התראה שוב ושוב, בודקת קודם שלא כבר נשלחה התראה
// דומה לאותה תקלה לפני שיוצרת חדשה.
// =========================================================================
const SLA_HOURS = 48; // סף חריגה בשעות - אפשר לשנות למספר שמתאים לך

async function checkOverdueSLA() {
    try {
        const [overdueIssues] = await db.query(`
            SELECT i.IssueNumber, i.Title, i.assingTo
            FROM maintenanceissue i
            LEFT JOIN issuestatus s ON i.StatusID = s.StatusID
            WHERE (s.StatusName IS NULL OR s.StatusName NOT LIKE '%סגר%')
              AND i.CreatedAt < DATE_SUB(NOW(), INTERVAL ? HOUR)
              AND i.assingTo IS NOT NULL
        `, [SLA_HOURS]);

        for (const issue of overdueIssues) {
            // מניעת ספאם - לא שולחים שוב אם כבר נשלחה התראת חריגה לתקלה הזו בעבר
            const [[existing]] = await db.query(
                'SELECT NotificationId FROM notifications WHERE UserId = ? AND Message LIKE ?',
                [issue.assingTo, `%חריגת זמן טיפול: #${issue.IssueNumber} %`]
            );
            if (existing) continue;

            await notifyUser(
                issue.assingTo,
                `חריגת זמן טיפול: #${issue.IssueNumber} - ${issue.Title} עדיין פתוחה מעל ${SLA_HOURS} שעות`,
                `manage_issues.html?issueNumber=${issue.IssueNumber}`
            );
        }
    } catch (error) {
        console.error('שגיאה בבדיקת חריגות זמן טיפול:', error);
    }
}

module.exports = router;
module.exports.notifyUser = notifyUser;
module.exports.checkOverdueSLA = checkOverdueSLA;
