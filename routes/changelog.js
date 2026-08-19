// routes/changelog.js
// ⚠️ קובץ חדש - יש להוסיף לתיקיית routes/ ולחבר ב-server.js:
//   app.use('/api/changelog', require('./routes/changelog'));

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

// 🛡️ מגן אמיתי בשרת - לא רק הסתרת כפתור. אילו הרשאות מותרות לצפות בלוג:
// Admin(1), SeniorManager/הנהלה(2), TeamLead/ראש צוות(3), Engineer/IT(4), QAInspector/ביקורת איכות(5)
const ALLOWED_PERMISSIONS = [1, 2, 3, 4, 5];

const requireLogAccess = (req, res, next) => {
    if (!ALLOWED_PERMISSIONS.includes(req.session?.user?.permissionCode)) {
        return res.status(403).json({ error: 'צפייה בלוג שינויים מותרת רק להנהלה, ראש צוות, IT או ביקורת איכות.' });
    }
    next();
};

// =========================================================================
// GET /api/changelog?visitId=... - כל שורות הלוג של כל התקלות בביקור נתון
// =========================================================================
router.get('/', requireAuth, requireLogAccess, async (req, res) => {
    try {
        const { visitId } = req.query;
        if (!visitId) {
            return res.status(400).json({ error: 'יש לבחור ביקור' });
        }

        const [rows] = await db.query(`
            SELECT
                l.LogId, l.IssueNumber, l.LogDateTime, l.OldValue, l.NewValue, l.Comment,
                CONCAT(u.UserName, ' ', u.UserLastName) AS PerformedByName,
                i.Title AS IssueTitle
            FROM maintenancelog l
            JOIN maintenanceissue i ON l.IssueNumber = i.IssueNumber
            LEFT JOIN users u ON l.PreformedBy = u.UserId
            WHERE i.VisitId = ?
            ORDER BY l.LogDateTime DESC
        `, [visitId]);

        res.json(rows);
    } catch (error) {
        console.error('שגיאה בשליפת לוג שינויים:', error);
        res.status(500).json({ error: 'שגיאה בטעינת הלוג' });
    }
});

module.exports = router;
