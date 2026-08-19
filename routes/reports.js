// routes/reports.js
// ⚠️ מחליף את הקובץ הקיים ב-routes/reports.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

// =========================================================================
// עזר משותף: תקלות + הפעולות שתחתן, מקוננות (לא שורה שטוחה לכל פעולה)
// משמש גם את /open-issues וגם את /my-issues
// =========================================================================
async function fetchIssuesWithActions(whereClause, params) {
    const query = `
        SELECT
            i.IssueNumber, i.Title, i.CreatedAt, i.VisitId,
            a.TailNumber, c.CustomerName, d.DepartmentName,
            s.StatusName, sev.SeverityName, p.PriorityName,
            CONCAT(u_created.UserName, ' ', u_created.UserLastName) AS CreatedByName,
            COALESCE(CONCAT(u_assigned.UserName, ' ', u_assigned.UserLastName), 'טרם שובץ') AS AssignedToName,
            ma.ActionId, ma.ActionDescription, ma.ActionDate, ma.ActionLiteratureRef,
            astat.StatusName AS ActionStatusName,
            CONCAT(u_signed.UserName, ' ', u_signed.UserLastName) AS SignedByName
        FROM maintenanceissue i
        LEFT JOIN maintenancevisit v ON i.VisitId = v.VisitID
        LEFT JOIN aircraft a ON v.SerialNumber = a.SerialNumber
        LEFT JOIN customer c ON a.CustomerId = c.CustomerId
        LEFT JOIN department d ON i.DepartmentCode = d.DepartmentCode
        LEFT JOIN issuestatus s ON i.StatusID = s.StatusID
        LEFT JOIN issueseverity sev ON i.SeverityId = sev.SeverityId
        LEFT JOIN issuepriority p ON i.PriorityId = p.PriorityId
        LEFT JOIN users u_created ON i.createdBy = u_created.UserId
        LEFT JOIN users u_assigned ON i.assingTo = u_assigned.UserId
        LEFT JOIN maintenanceaction ma ON ma.IssueNumber = i.IssueNumber
        LEFT JOIN actionstatus astat ON ma.ActionStatusId = astat.ActionStatusId
        LEFT JOIN users u_signed ON ma.SingedByEmployeeId = u_signed.UserId
        WHERE ${whereClause}
        ORDER BY i.CreatedAt DESC, ma.ActionDate ASC
    `;
    const [rows] = await db.query(query, params);

    const issuesMap = new Map();
    rows.forEach(row => {
        if (!issuesMap.has(row.IssueNumber)) {
            issuesMap.set(row.IssueNumber, {
                IssueNumber: row.IssueNumber,
                Title: row.Title,
                VisitId: row.VisitId,
                TailNumber: row.TailNumber,
                CustomerName: row.CustomerName,
                DepartmentName: row.DepartmentName,
                StatusName: row.StatusName,
                SeverityName: row.SeverityName,
                PriorityName: row.PriorityName,
                CreatedByName: row.CreatedByName,
                AssignedToName: row.AssignedToName,
                CreatedAt: row.CreatedAt,
                actions: []
            });
        }
        if (row.ActionId) {
            issuesMap.get(row.IssueNumber).actions.push({
                ActionDescription: row.ActionDescription,
                ActionDate: row.ActionDate,
                ActionStatusName: row.ActionStatusName,
                ActionLiteratureRef: row.ActionLiteratureRef,
                SignedByName: row.SignedByName
            });
        }
    });
    return Array.from(issuesMap.values());
}

// =========================================================================
// GET /api/reports/open-issues?visitId=optional
// תקלות פתוחות, עם כל פעולות הטיפול מקוננות תחת כל תקלה
// =========================================================================
router.get('/open-issues', requireAuth, async (req, res) => {
    try {
        const { visitId } = req.query;
        let where = `(s.StatusName IS NULL OR s.StatusName NOT LIKE '%סגר%')`;
        const params = [];
        if (visitId) { where += ' AND i.VisitId = ?'; params.push(visitId); }

        const issues = await fetchIssuesWithActions(where, params);
        res.json(issues);
    } catch (error) {
        console.error('שגיאה בהפקת דוח תקלות פתוחות:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הדוח' });
    }
});

// =========================================================================
// GET /api/reports/my-issues
// כל התקלות שהוקצו למשתמש המחובר כרגע (לא בחירה מרשימה - תמיד לפי ה-session)
// =========================================================================
router.get('/my-issues', requireAuth, async (req, res) => {
    try {
        const currentUserId = req.session?.userId;
        if (!currentUserId) return res.status(401).json({ error: 'לא מחובר' });

        const issues = await fetchIssuesWithActions('i.assingTo = ?', [currentUserId]);
        res.json(issues);
    } catch (error) {
        console.error('שגיאה בהפקת דוח התקלות שלי:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הדוח' });
    }
});

// =========================================================================
// GET /api/reports/activity?groupBy=employee|department&visitId=optional
// דוח פעילות - כמות תקלות/פעולות (לא שעות - אין תיעוד שעות במערכת)
// =========================================================================
router.get('/activity', requireAuth, async (req, res) => {
    try {
        const { groupBy, visitId } = req.query;

        if (groupBy === 'employee') {
            const visitFilterClause = visitId ? 'WHERE ev.VisitID = ?' : '';
            const query = `
                SELECT
                    ev.VisitID                                     AS \`מספר ביקור\`,
                    u.EmployeeId                                   AS \`מספר עובד\`,
                    CONCAT(u.UserName, ' ', u.UserLastName)        AS \`שם עובד\`,
                    d.DepartmentName                                AS \`מחלקה\`,
                    COUNT(DISTINCT CASE WHEN i_action.VisitId = ev.VisitID THEN ma.ActionId END) AS \`פעולות טיפול שבוצעו\`,
                    COUNT(DISTINCT CASE WHEN i_assigned.VisitId = ev.VisitID THEN i_assigned.IssueNumber END) AS \`תקלות שהוקצו אליו\`
                FROM (
                    -- כל צירוף (עובד, ביקור) שבו העובד באמת מעורב - דרך פעולה שביצע או תקלה שהוקצתה לו
                    SELECT DISTINCT ma2.SingedByEmployeeId AS UserId, i2.VisitId AS VisitID
                    FROM maintenanceaction ma2
                    JOIN maintenanceissue i2 ON ma2.IssueNumber = i2.IssueNumber
                    WHERE ma2.SingedByEmployeeId IS NOT NULL AND i2.VisitId IS NOT NULL
                    UNION
                    SELECT DISTINCT i3.assingTo AS UserId, i3.VisitId AS VisitID
                    FROM maintenanceissue i3
                    WHERE i3.assingTo IS NOT NULL AND i3.VisitId IS NOT NULL
                ) ev
                JOIN users u ON u.UserId = ev.UserId
                LEFT JOIN department d ON u.DepartmentCode = d.DepartmentCode
                LEFT JOIN maintenanceaction ma ON ma.SingedByEmployeeId = u.UserId
                LEFT JOIN maintenanceissue i_action ON ma.IssueNumber = i_action.IssueNumber
                LEFT JOIN maintenanceissue i_assigned ON i_assigned.assingTo = u.UserId
                ${visitFilterClause}
                GROUP BY ev.VisitID, u.UserId, u.EmployeeId, u.UserName, u.UserLastName, d.DepartmentName
                ORDER BY ev.VisitID, \`פעולות טיפול שבוצעו\` DESC
            `;
            const params = visitId ? [visitId] : [];
            const [rows] = await db.query(query, params);
            return res.json(rows);
        }

        const query = `
            SELECT
                d.DepartmentName                                                       AS \`מחלקה\`,
                COUNT(DISTINCT i.IssueNumber)                                          AS \`סה"כ תקלות\`,
                COUNT(DISTINCT CASE WHEN s.StatusName LIKE '%סגר%' THEN i.IssueNumber END) AS \`תקלות סגורות\`,
                COUNT(DISTINCT CASE WHEN s.StatusName NOT LIKE '%סגר%' OR s.StatusName IS NULL THEN i.IssueNumber END) AS \`תקלות פתוחות\`,
                COUNT(DISTINCT ma.ActionId)                                            AS \`סה"כ פעולות טיפול\`
            FROM department d
            LEFT JOIN maintenanceissue i ON i.DepartmentCode = d.DepartmentCode
                ${visitId ? 'AND i.VisitId = ?' : ''}
            LEFT JOIN issuestatus s ON i.StatusID = s.StatusID
            LEFT JOIN maintenanceaction ma ON ma.IssueNumber = i.IssueNumber
            GROUP BY d.DepartmentCode, d.DepartmentName
            HAVING \`סה"כ תקלות\` > 0
            ORDER BY \`סה"כ תקלות\` DESC
        `;
        const params = visitId ? [visitId] : [];
        const [rows] = await db.query(query, params);
        res.json(rows);

    } catch (error) {
        console.error('שגיאה בהפקת דוח פעילות:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הדוח' });
    }
});

// =========================================================================
// GET /api/reports/aging?visitId=optional
// תקלות פתוחות ממוינות לפי כמה זמן הן פתוחות (הכי ותיקות למעלה)
// =========================================================================
router.get('/aging', requireAuth, async (req, res) => {
    try {
        const { visitId } = req.query;
        let query = `
            SELECT
                i.IssueNumber      AS \`מספר תקלה\`,
                i.Title             AS \`כותרת\`,
                a.TailNumber        AS \`זנב\`,
                d.DepartmentName    AS \`מחלקה\`,
                s.StatusName        AS \`סטטוס\`,
                sev.SeverityName    AS \`חומרה\`,
                i.CreatedAt         AS \`נפתחה בתאריך\`,
                DATEDIFF(NOW(), i.CreatedAt) AS \`ימים פתוחה\`
            FROM maintenanceissue i
            LEFT JOIN maintenancevisit v ON i.VisitId = v.VisitID
            LEFT JOIN aircraft a ON v.SerialNumber = a.SerialNumber
            LEFT JOIN department d ON i.DepartmentCode = d.DepartmentCode
            LEFT JOIN issuestatus s ON i.StatusID = s.StatusID
            LEFT JOIN issueseverity sev ON i.SeverityId = sev.SeverityId
            WHERE (s.StatusName IS NULL OR s.StatusName NOT LIKE '%סגר%')
        `;
        const params = [];
        if (visitId) { query += ' AND i.VisitId = ?'; params.push(visitId); }
        query += ' ORDER BY `ימים פתוחה` DESC';

        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (error) {
        console.error('שגיאה בהפקת דוח וותק תקלות:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הדוח' });
    }
});

// =========================================================================
// GET /api/reports/workload?visitId=optional
// כמה תקלות פתוחות מוקצות לכל עובד, לפי מחלקה - עוזר לזהות עומס/פנאי
// =========================================================================
router.get('/workload', requireAuth, async (req, res) => {
    try {
        const { visitId } = req.query;
        let query = `
            SELECT
                v.VisitID            AS \`מספר ביקור\`,
                d.DepartmentName    AS \`מחלקה\`,
                u.EmployeeId         AS \`מספר עובד\`,
                CONCAT(u.UserName, ' ', u.UserLastName) AS \`שם עובד\`,
                COUNT(DISTINCT i.IssueNumber) AS \`תקלות פתוחות מוקצות\`
            FROM maintenanceissue i
            JOIN users u ON i.assingTo = u.UserId
            JOIN department d ON u.DepartmentCode = d.DepartmentCode
            JOIN maintenancevisit v ON i.VisitId = v.VisitID
            LEFT JOIN issuestatus s ON i.StatusID = s.StatusID
            WHERE (s.StatusName IS NULL OR s.StatusName NOT LIKE '%סגר%')
                ${visitId ? 'AND i.VisitId = ?' : ''}
        `;
        const params = visitId ? [visitId] : [];
        query += `
            GROUP BY v.VisitID, d.DepartmentName, u.EmployeeId, u.UserName, u.UserLastName
            HAVING \`תקלות פתוחות מוקצות\` > 0
            ORDER BY v.VisitID, \`תקלות פתוחות מוקצות\` DESC
        `;

        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (error) {
        console.error('שגיאה בהפקת דוח עומס עובדים:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הדוח' });
    }
});

// =========================================================================
// GET /api/reports/fleet-history
// היסטוריית ביקורים ותקלות לכל מטוס - מזהה מטוסים "בעייתיים"
// =========================================================================
router.get('/fleet-history', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT
                a.TailNumber        AS \`זנב\`,
                a.Model              AS \`דגם\`,
                c.CustomerName       AS \`לקוח\`,
                v.VisitID            AS \`מספר ביקור\`,
                v.EntryDate          AS \`תאריך כניסה\`,
                v.TargetLeaveDate    AS \`יעד יציאה\`,
                v.LeaveDate          AS \`תאריך יציאה בפועל\`,
                COUNT(DISTINCT i.IssueNumber) AS \`תקלות בביקור\`
            FROM aircraft a
            LEFT JOIN customer c ON a.CustomerId = c.CustomerId
            LEFT JOIN maintenancevisit v ON v.SerialNumber = a.SerialNumber
            LEFT JOIN maintenanceissue i ON i.VisitId = v.VisitID
            WHERE v.VisitID IS NOT NULL
            GROUP BY a.SerialNumber, a.TailNumber, a.Model, c.CustomerName, v.VisitID, v.EntryDate, v.TargetLeaveDate, v.LeaveDate
            ORDER BY v.EntryDate DESC
        `;
        const [rows] = await db.query(query);
        res.json(rows);
    } catch (error) {
        console.error('שגיאה בהפקת דוח היסטוריית מטוסים:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הדוח' });
    }
});

// =========================================================================
// GET /api/reports/quality-compliance
// תקלות שנסגרו אבל אין להן אף מסמך מצורף - דגל לפני ביקורת
// =========================================================================
router.get('/quality-compliance', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT
                i.IssueNumber AS \`מספר תקלה\`,
                i.Title        AS \`כותרת\`,
                a.TailNumber   AS \`זנב\`,
                s.StatusName   AS \`סטטוס\`,
                i.ClosedAt     AS \`נסגרה בתאריך\`
            FROM maintenanceissue i
            LEFT JOIN maintenancevisit v ON i.VisitId = v.VisitID
            LEFT JOIN aircraft a ON v.SerialNumber = a.SerialNumber
            LEFT JOIN issuestatus s ON i.StatusID = s.StatusID
            LEFT JOIN attachments att ON att.IssueNumber = i.IssueNumber
            WHERE s.StatusName LIKE '%סגר%' AND att.AttachmentId IS NULL
            ORDER BY i.ClosedAt DESC
        `;
        const [rows] = await db.query(query);
        res.json(rows);
    } catch (error) {
        console.error('שגיאה בהפקת דוח תיעוד חסר:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הדוח' });
    }
});

// =========================================================================
// GET /api/reports/missions-sla
// קריאות אחזקה כלליות שעדיין פתוחות, ממוינות לפי כמה זמן הן פתוחות
// =========================================================================
router.get('/missions-sla', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT
                m.MissionId    AS \`מספר קריאה\`,
                m.Description   AS \`תיאור\`,
                mc.CategoryName AS \`סוג\`,
                ms.Description  AS \`סטטוס\`,
                d.DepartmentName AS \`מחלקה\`,
                m.CreatedAt     AS \`נפתחה בתאריך\`,
                DATEDIFF(NOW(), m.CreatedAt) AS \`ימים פתוחה\`
            FROM missiontable m
            LEFT JOIN missioncategory mc ON m.MissionCategoryID = mc.MissionCategoryID
            LEFT JOIN missionstatus ms ON m.StatusId = ms.StatusId
            LEFT JOIN department d ON m.DepartmentId = d.DepartmentCode
            WHERE m.CloseAt IS NULL
            ORDER BY \`ימים פתוחה\` DESC
        `;
        const [rows] = await db.query(query);
        res.json(rows);
    } catch (error) {
        console.error('שגיאה בהפקת דוח קריאות פתוחות:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הדוח' });
    }
});

// =========================================================================
// GET /api/reports/schedule-gap
// ביקורים שעברו את יעד היציאה המשוער ועדיין לא נסגרו - "אזעקת לו"ז"
// =========================================================================
router.get('/schedule-gap', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT
                v.VisitID       AS \`מספר ביקור\`,
                a.TailNumber     AS \`זנב\`,
                c.CustomerName   AS \`לקוח\`,
                v.EntryDate      AS \`תאריך כניסה\`,
                v.TargetLeaveDate AS \`יעד יציאה\`,
                DATEDIFF(NOW(), v.TargetLeaveDate) AS \`ימי איחור\`,
                (
                    SELECT COUNT(*) FROM maintenanceissue i2
                    LEFT JOIN issuestatus s2 ON i2.StatusID = s2.StatusID
                    WHERE i2.VisitId = v.VisitID AND (s2.StatusName IS NULL OR s2.StatusName NOT LIKE '%סגר%')
                ) AS \`תקלות פתוחות שנותרו\`
            FROM maintenancevisit v
            LEFT JOIN aircraft a ON v.SerialNumber = a.SerialNumber
            LEFT JOIN customer c ON a.CustomerId = c.CustomerId
            WHERE v.LeaveDate IS NULL
              AND v.TargetLeaveDate IS NOT NULL
              AND v.TargetLeaveDate < NOW()
            ORDER BY \`ימי איחור\` DESC
        `;
        const [rows] = await db.query(query);
        res.json(rows);
    } catch (error) {
        console.error('שגיאה בהפקת דוח פערי לוח זמנים:', error);
        res.status(500).json({ error: 'שגיאה בהפקת הדוח' });
    }
});

module.exports = router;
