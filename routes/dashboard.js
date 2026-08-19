// routes/dashboard.js
// ⚠️ קובץ חדש - יש להוסיף לתיקיית routes/ ולחבר ב-server.js:
//   app.use('/api/dashboard', require('./routes/dashboard'));

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

// =========================================================================
// GET /api/dashboard/kpis
// שורת המספרים הגדולים למבט ראשון - הכל בקריאה אחת יעילה
// =========================================================================
router.get('/kpis', requireAuth, async (req, res) => {
    try {
        const [[issueCounts]] = await db.query(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN sev.SeverityName LIKE '%קריטי%' OR p.PriorityName LIKE '%קריטי%' THEN 1 ELSE 0 END) AS critical
            FROM maintenanceissue i
            LEFT JOIN issuestatus s ON i.StatusID = s.StatusID
            LEFT JOIN issueseverity sev ON i.SeverityId = sev.SeverityId
            LEFT JOIN issuepriority p ON i.PriorityId = p.PriorityId
            WHERE (s.StatusName IS NULL OR s.StatusName NOT LIKE '%סגר%')
        `);

        const [[visitCounts]] = await db.query(
            `SELECT COUNT(*) AS active FROM maintenancevisit WHERE LeaveDate IS NULL`
        );

        const [[scheduleGap]] = await db.query(`
            SELECT COUNT(*) AS overdue FROM maintenancevisit
            WHERE LeaveDate IS NULL AND TargetLeaveDate IS NOT NULL AND TargetLeaveDate < NOW()
        `);

        const [[missionCounts]] = await db.query(
            `SELECT COUNT(*) AS open FROM missiontable WHERE CloseAt IS NULL`
        );

        const [[complianceCounts]] = await db.query(`
            SELECT COUNT(DISTINCT i.IssueNumber) AS missingDocs
            FROM maintenanceissue i
            LEFT JOIN issuestatus s ON i.StatusID = s.StatusID
            LEFT JOIN attachments att ON att.IssueNumber = i.IssueNumber
            WHERE s.StatusName LIKE '%סגר%' AND att.AttachmentId IS NULL
        `);

        res.json({
            openIssuesTotal: issueCounts.total || 0,
            openIssuesCritical: issueCounts.critical || 0,
            activeVisits: visitCounts.active || 0,
            visitsOverdue: scheduleGap.overdue || 0,
            openMissions: missionCounts.open || 0,
            issuesMissingDocs: complianceCounts.missingDocs || 0
        });

    } catch (error) {
        console.error('שגיאה בהפקת נתוני KPI:', error);
        res.status(500).json({ error: 'שגיאה בהפקת נתוני הדשבורד' });
    }
});

// =========================================================================
// GET /api/dashboard/trends
// כמה תקלות נפתחו וכמה נסגרו בכל יום, ב-30 הימים האחרונים - לגרף מגמה
// =========================================================================
router.get('/trends', requireAuth, async (req, res) => {
    try {
        const { visitId } = req.query;
        const visitClause = visitId ? 'AND VisitId = ?' : '';
        const visitParams = visitId ? [visitId] : [];

        const [openedRows] = await db.query(`
            SELECT DATE(CreatedAt) AS day, COUNT(*) AS cnt
            FROM maintenanceissue
            WHERE CreatedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY) ${visitClause}
            GROUP BY DATE(CreatedAt)
        `, visitParams);
        const [closedRows] = await db.query(`
            SELECT DATE(ClosedAt) AS day, COUNT(*) AS cnt
            FROM maintenanceissue
            WHERE ClosedAt IS NOT NULL AND ClosedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY) ${visitClause}
            GROUP BY DATE(ClosedAt)
        `, visitParams);

        const dayMap = {};
        const toKey = (d) => new Date(d).toISOString().slice(0, 10);

        openedRows.forEach(r => {
            const key = toKey(r.day);
            if (!dayMap[key]) dayMap[key] = { opened: 0, closed: 0 };
            dayMap[key].opened = r.cnt;
        });
        closedRows.forEach(r => {
            const key = toKey(r.day);
            if (!dayMap[key]) dayMap[key] = { opened: 0, closed: 0 };
            dayMap[key].closed = r.cnt;
        });

        const sortedDays = Object.keys(dayMap).sort();
        res.json({
            labels: sortedDays,
            opened: sortedDays.map(d => dayMap[d].opened),
            closed: sortedDays.map(d => dayMap[d].closed)
        });

    } catch (error) {
        console.error('שגיאה בהפקת נתוני מגמה:', error);
        res.status(500).json({ error: 'שגיאה בהפקת נתוני המגמה' });
    }
});

// =========================================================================
// GET /api/dashboard/workload-by-department
// כמה תקלות פתוחות יש כרגע בכל מחלקה - לגרף בר
// =========================================================================
router.get('/workload-by-department', requireAuth, async (req, res) => {
    try {
        const { visitId } = req.query;
        const query = `
            SELECT
                d.DepartmentName AS dept,
                v.VisitID AS visitId,
                a.TailNumber AS tailNumber,
                COUNT(DISTINCT i.IssueNumber) AS cnt
            FROM department d
            JOIN maintenanceissue i ON i.DepartmentCode = d.DepartmentCode
            JOIN maintenancevisit v ON i.VisitId = v.VisitID
            LEFT JOIN aircraft a ON v.SerialNumber = a.SerialNumber
            LEFT JOIN issuestatus s ON i.StatusID = s.StatusID
            WHERE (s.StatusName IS NULL OR s.StatusName NOT LIKE '%סגר%')
                ${visitId ? 'AND v.VisitID = ?' : ''}
            GROUP BY d.DepartmentCode, d.DepartmentName, v.VisitID, a.TailNumber
            HAVING cnt > 0
            ORDER BY d.DepartmentName
        `;
        const [rows] = await db.query(query, visitId ? [visitId] : []);

        // ציר X = מחלקות; כל ביקור מקבל סדרה (dataset) משלו, כדי שהעמודה תתחלק פנימית לפי ביקור
        const departments = [...new Set(rows.map(r => r.dept))];
        const visitIds = [...new Set(rows.map(r => r.visitId))];
        const tailByVisit = Object.fromEntries(rows.map(r => [r.visitId, r.tailNumber]));

        const datasets = visitIds.map(vId => ({
            label: `${vId}${tailByVisit[vId] ? ' (' + tailByVisit[vId] + ')' : ''}`,
            data: departments.map(dept => {
                const match = rows.find(r => r.dept === dept && r.visitId === vId);
                return match ? match.cnt : 0;
            })
        }));

        res.json({ labels: departments, datasets });
    } catch (error) {
        console.error('שגיאה בהפקת עומס מחלקה:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הנתונים' });
    }
});

// =========================================================================
// GET /api/dashboard/top-aircraft
// 5 המטוסים עם הכי הרבה תקלות בסך הכל (כל הזמנים)
// =========================================================================
router.get('/top-aircraft', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT
                a.TailNumber AS name,
                COUNT(DISTINCT i.IssueNumber) AS cnt
            FROM aircraft a
            LEFT JOIN maintenancevisit v ON v.SerialNumber = a.SerialNumber
            LEFT JOIN maintenanceissue i ON i.VisitId = v.VisitID
            GROUP BY a.SerialNumber, a.TailNumber
            HAVING cnt > 0
            ORDER BY cnt DESC
            LIMIT 5
        `;
        const [rows] = await db.query(query);
        res.json({ labels: rows.map(r => r.name), values: rows.map(r => r.cnt) });
    } catch (error) {
        console.error('שגיאה בהפקת מטוסים בעייתיים:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הנתונים' });
    }
});

// =========================================================================
// GET /api/dashboard/categories
// התפלגות קטגוריות תקלה על פני כל המערכת (כל הזמנים, לא רק פתוחות)
// =========================================================================
router.get('/categories', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT
                fc.CategoryName AS name,
                COUNT(*) AS cnt
            FROM maintenanceissue i
            LEFT JOIN faultcategorytable fc ON i.FaultCategory = fc.FaultCategoryId
            GROUP BY fc.FaultCategoryId, fc.CategoryName
            HAVING cnt > 0
            ORDER BY cnt DESC
        `;
        const [rows] = await db.query(query);
        res.json({ labels: rows.map(r => r.name || 'לא מסווג'), values: rows.map(r => r.cnt) });
    } catch (error) {
        console.error('שגיאה בהפקת פילוח קטגוריות:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הנתונים' });
    }
});

// =========================================================================
// GET /api/dashboard/hours-by-aircraft
// זמן חלוף בין פתיחה לסגירה (CreatedAt->ClosedAt) בשעות, מסוכם לכל מטוס.
// ⚠️ זה "כמה זמן התקלה הייתה פתוחה", לא "כמה שעות עבודה הושקעו בפועל" - 
// אין תיעוד שעות עבודה אמיתי במערכת, זו הערכה לפי משך הטיפול הכולל.
// =========================================================================
router.get('/hours-by-aircraft', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT
                a.TailNumber AS name,
                SUM(ROUND(GREATEST(TIMESTAMPDIFF(HOUR, i.CreatedAt, i.ClosedAt), 0) / 24 * 9)) AS hours
            FROM maintenanceissue i
            LEFT JOIN maintenancevisit v ON i.VisitId = v.VisitID
            LEFT JOIN aircraft a ON v.SerialNumber = a.SerialNumber
            WHERE i.ClosedAt IS NOT NULL
            GROUP BY a.SerialNumber, a.TailNumber
            HAVING hours > 0
            ORDER BY hours DESC
        `;
        const [rows] = await db.query(query);
        res.json({ labels: rows.map(r => r.name), values: rows.map(r => r.hours) });
    } catch (error) {
        console.error('שגיאה בהפקת שעות טיפול:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הנתונים' });
    }
});

// =========================================================================
// GET /api/dashboard/employees-by-department?visitId=חובה
// כמה עובדים שונים מכל מחלקה מעורבים בביקור הזה (חתמו על פעולה, או הוקצו לתקלה)
// =========================================================================
router.get('/employees-by-department', requireAuth, async (req, res) => {
    try {
        const { visitId } = req.query;
        if (!visitId) return res.json({ labels: [], values: [] });

        const query = `
            SELECT d.DepartmentName AS name, COUNT(DISTINCT u.UserId) AS cnt
            FROM users u
            JOIN department d ON u.DepartmentCode = d.DepartmentCode
            WHERE u.UserId IN (
                SELECT ma.SingedByEmployeeId
                FROM maintenanceaction ma
                JOIN maintenanceissue i ON ma.IssueNumber = i.IssueNumber
                WHERE i.VisitId = ? AND ma.SingedByEmployeeId IS NOT NULL
                UNION
                SELECT i2.assingTo
                FROM maintenanceissue i2
                WHERE i2.VisitId = ? AND i2.assingTo IS NOT NULL
            )
            GROUP BY d.DepartmentCode, d.DepartmentName
            HAVING cnt > 0
            ORDER BY cnt DESC
        `;
        const [rows] = await db.query(query, [visitId, visitId]);
        res.json({ labels: rows.map(r => r.name), values: rows.map(r => r.cnt) });
    } catch (error) {
        console.error('שגיאה בהפקת עובדים לפי ביקור:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הנתונים' });
    }
});

// =========================================================================
// GET /api/dashboard/departure-timeline
// כל הביקורים הפעילים - כניסה ליעד יציאה, לגרף ציר-זמן (כלל-מערכתי)
// =========================================================================
router.get('/departure-timeline', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT
                v.VisitID, a.TailNumber, v.EntryDate, v.TargetLeaveDate
            FROM maintenancevisit v
            LEFT JOIN aircraft a ON v.SerialNumber = a.SerialNumber
            WHERE v.LeaveDate IS NULL AND v.TargetLeaveDate IS NOT NULL AND v.EntryDate IS NOT NULL
                AND v.EntryDate > '2000-01-01'
            ORDER BY v.TargetLeaveDate ASC
        `;
        const [rows] = await db.query(query);
        res.json(rows.map(r => ({
            visitId: r.VisitID,
            label: `${r.TailNumber || ''} (${r.VisitID})`,
            entry: r.EntryDate,
            target: r.TargetLeaveDate
        })));
    } catch (error) {
        console.error('שגיאה בהפקת ציר זמן יציאות:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הנתונים' });
    }
});

// =========================================================================
// GET /api/dashboard/visit-hours-ratio
// לכל ביקור פעיל: כמה שעות עבודה בפועל תועדו (מתקלות סגורות בלבד),
// מתוך סך השעות שחלפו מאז הכניסה - ליחס עבור הטבעת בגאנט.
// =========================================================================
router.get('/visit-hours-ratio', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT
                v.VisitID,
                CONCAT(a.TailNumber, ' (', v.VisitID, ')') AS label,
                COALESCE(SUM(ROUND(GREATEST(TIMESTAMPDIFF(HOUR, i.CreatedAt, i.ClosedAt), 0) / 24 * 9)), 0) AS workedHours,
                GREATEST(ROUND(GREATEST(TIMESTAMPDIFF(HOUR, v.EntryDate, NOW()), 1) / 24 * 9), 1) AS totalHours
            FROM maintenancevisit v
            LEFT JOIN aircraft a ON v.SerialNumber = a.SerialNumber
            LEFT JOIN maintenanceissue i ON i.VisitId = v.VisitID AND i.ClosedAt IS NOT NULL
            WHERE v.LeaveDate IS NULL AND v.EntryDate IS NOT NULL
            GROUP BY v.VisitID, a.TailNumber, v.EntryDate
        `;
        const [rows] = await db.query(query);
        res.json(rows.map(r => ({
            visitId: r.VisitID,
            label: r.label,
            workedHours: r.workedHours,
            totalHours: r.totalHours,
            percent: Math.min(100, Math.round((r.workedHours / r.totalHours) * 100))
        })));
    } catch (error) {
        console.error('שגיאה בהפקת יחס שעות עבודה:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הנתונים' });
    }
});

module.exports = router;
