const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth'); // הגנת אבטחה (401 במקרה של איפוס/40 דקות)

router.get('/lookup', requireAuth, async (req, res) => {
    const data = {
        severities: [],
        statuses: [],
        priorities: [],
        categories: [],
        departments: [],
        users: [],
        actionStatuses: [],
        missionStatuses: [],
        missionPriorities: [],
        missionCategories: []
    };

    try {
        // 1. חומרה
        try {
            const [rows] = await db.query('SELECT SeverityId AS id, SeverityName AS name FROM issueseverity');
            data.severities = rows;
        } catch (err) {
            console.error('❌ שגיאה בטעינת טבלת IssueSeverity:', err.message);
        }

        // 2. סטטוסים
        try {
            const [rows] = await db.query('SELECT StatusID AS id, StatusName AS name FROM issuestatus');
            data.statuses = rows;
        } catch (err) {
            console.error('❌ שגיאה בטעינת טבלת IssueStatus:', err.message);
        }

        // 3. דחיפות
        try {
            const [rows] = await db.query('SELECT PriorityId AS id, PriorityName AS name FROM issuepriority');
            data.priorities = rows;
        } catch (err) {
            console.error('❌ שגיאה בטעינת טבלת IssuePriority:', err.message);
        }

        // 4. קטגוריות (מתוקן לפי העמודות הקיימות: FaultCategoryId ו-CategoryName בלבד!)
        try {
            const [rows] = await db.query('SELECT FaultCategoryId AS id, CategoryName AS name FROM faultcategorytable');
            data.categories = rows;
        } catch (err) {
            console.error('❌ שגיאה בטעינת טבלת faultcategorytable:', err.message);
        }

        // 5. מחלקות
        try {
           const [rows] = await db.query('SELECT DepartmentCode AS id, DepartmentName AS name, Description AS description FROM department');
            data.departments = rows;
        } catch (err) {
            console.error('❌ שגיאה בטעינת טבלת Department:', err.message);
        }

        // 5.5. סטטוסי פעולה (טבלת lookup חדשה - actionstatus)
        try {
            const [rows] = await db.query('SELECT ActionStatusId AS id, StatusName AS name FROM actionstatus');
            data.actionStatuses = rows;
        } catch (err) {
            console.error('❌ שגיאה בטעינת טבלת actionstatus:', err.message);
        }

        // 5.6-5.8. lookups של מסך המשימות הכלליות (missiontable)
        try {
            const [rows] = await db.query('SELECT StatusId AS id, Description AS name FROM missionstatus');
            data.missionStatuses = rows;
        } catch (err) {
            console.error('❌ שגיאה בטעינת טבלת missionstatus:', err.message);
        }
        try {
            const [rows] = await db.query('SELECT PriorityId AS id, Description AS name FROM missionpriority');
            data.missionPriorities = rows;
        } catch (err) {
            console.error('❌ שגיאה בטעינת טבלת missionpriority:', err.message);
        }
        try {
            const [rows] = await db.query('SELECT MissionCategoryID AS id, CategoryName AS name FROM missioncategory');
            data.missionCategories = rows;
        } catch (err) {
            console.error('❌ שגיאה בטעינת טבלת missioncategory:', err.message);
        }

        // 6. משתמשים (מתוקן לפי UserName ו-UserLastName!)
        try {
            const [rows] = await db.query('SELECT UserId AS id, CONCAT(UserName, " ", UserLastName) AS name, PermissionCode FROM users');
            data.users = rows;
        } catch (err) {
            console.error('❌ שגיאה בטעינת טבלת Users:', err.message);
        }

        res.json(data);

    } catch (globalError) {
        console.error('❌ שגיאה כללית חמורה בשרת:', globalError);
        res.status(500).json({ error: 'שגיאה כללית בשרת' });
    }
});

// GET /api/maintanace_calls/visit/:visitId
router.get('/visit/:visitId', async (req, res) => {
    try {
        const { visitId } = req.params;

        const query = `
            SELECT 
                i.IssueNumber,
                i.Title,
                i.Description,
                i.VisitId,
                i.DepartmentCode,
                s.StatusName,
                s.StatusID,
                sev.SeverityName,
                sev.SeverityId,
                p.PriorityName,
                p.PriorityId,
                (SELECT COUNT(*) FROM maintenanceaction a WHERE a.IssueNumber = i.IssueNumber) AS ActionsCount
            FROM maintenanceissue i
           LEFT JOIN issuestatus s ON i.StatusID = s.StatusID
            LEFT JOIN issueseverity sev ON i.SeverityId = sev.SeverityId
            LEFT JOIN issuepriority p ON i.PriorityId = p.PriorityId
            WHERE i.VisitId = ?
            ORDER BY i.IssueNumber DESC
        `;

        const [issues] = await db.execute(query, [visitId]);
        res.json(issues);

    } catch (err) {
        console.error('שגיאה בשליפת תקלות לביקור:', err);
        res.status(500).json({ error: 'שגיאה בטעינת התקלות לביקור זה' });
    }
});
module.exports = router;