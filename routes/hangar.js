// routes/hangar.js
// ⚠️ קובץ חדש - יש להוסיף לתיקיית routes/ ולחבר ב-server.js:
//   app.use('/api/hangar', require('./routes/hangar'));

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

// =========================================================================
// GET /api/hangar/dashboard
// מחזיר את כל עמדות ההאנגר, ולכל עמדה - הביקור הפעיל בה (אם יש) יחד עם
// פילוג התקלות שלו לפי סטטוס. עמדה בלי ביקור פעיל מוחזרת עם visit: null.
// =========================================================================
router.get('/dashboard', requireAuth, async (req, res) => {
    try {
        const [bays] = await db.query('SELECT * FROM hangarlayout');

        const [activeVisits] = await db.query(`
            SELECT v.VisitID, v.HangarLocationID, v.EntryDate, v.TargetLeaveDate,
                   a.TailNumber, a.Model, c.CustomerName
            FROM maintenancevisit v
            JOIN aircraft a ON v.SerialNumber = a.SerialNumber
            JOIN customer c ON a.CustomerId = c.CustomerId
            WHERE v.LeaveDate IS NULL
        `);

        let statusRows = [];
        if (activeVisits.length > 0) {
            const visitIds = activeVisits.map(v => v.VisitID);
            const placeholders = visitIds.map(() => '?').join(',');
            [statusRows] = await db.query(`
                SELECT i.VisitId, i.StatusID, s.StatusName, COUNT(*) AS count
                FROM maintenanceissue i
                LEFT JOIN issuestatus s ON i.StatusID = s.StatusID
                WHERE i.VisitId IN (${placeholders})
                GROUP BY i.VisitId, i.StatusID, s.StatusName
            `, visitIds);
        }

        // בניית מפה: HangarLocationID -> אובייקט ביקור מלא + פילוג הסטטוסים שלו
        const visitByBay = {};
        activeVisits.forEach(v => {
            const statusCounts = statusRows
                .filter(r => r.VisitId === v.VisitID)
                .map(r => ({ StatusID: r.StatusID, StatusName: r.StatusName || 'לא ידוע', count: r.count }));

            visitByBay[v.HangarLocationID] = { ...v, statusCounts };
        });

        const result = bays.map(bay => ({
            HangarLocationID: bay.HangarLocationID,
            HangarPosition: bay.HangarPosition,
            Description: bay.Description,
            visit: visitByBay[bay.HangarLocationID] || null
        }));

        res.json(result);

    } catch (error) {
        console.error('שגיאה בטעינת דשבורד ההאנגר:', error);
        res.status(500).json({ error: 'שגיאה בטעינת נתוני ההאנגר' });
    }
});

// =========================================================================
// GET /api/hangar - רשימת כל עמדות ההאנגר (לדרופדאון בחירה בפתיחת ביקור חדש)
// =========================================================================
router.get('/', requireAuth, async (req, res) => {
    try {
        const [bays] = await db.query('SELECT * FROM hangarlayout ORDER BY HangarLocationID');
        res.json(bays);
    } catch (error) {
        console.error('שגיאה בשליפת עמדות ההאנגר:', error);
        res.status(500).json({ error: 'שגיאה בשליפת העמדות' });
    }
});

module.exports = router;
