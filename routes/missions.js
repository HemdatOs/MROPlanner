// routes/missions.js
// ⚠️ קובץ חדש - יש להוסיף לתיקיית routes/ ולחבר ב-server.js:
//   app.use('/api/missions', require('./routes/missions'));

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');
const { notifyUser } = require('./notifications');

// =========================================================================
// עזר: רישום שינוי ב-maintenancelog (אותה טבלה משמשת גם למשימות, IssueNumber=NULL לא אפשרי כי היא NOT NULL...)
// שימי לב: maintenancelog.IssueNumber הוא NOT NULL ו-FK ל-maintenanceissue, אז הוא לא מתאים לתעד שינויי משימות.
// לכן שינויים במשימה נרשמים כרגע רק ל-alertlog / קונסול, לא ל-maintenancelog.
// אם תרצי טבלת לוג ייעודית למשימות בעתיד - נדבר על זה בנפרד.
// =========================================================================

// =========================================================================
// GET /api/missions - רשימת כל המשימות, עם שמות קריאים (לא רק מזהים)
// תומך בסינון אופציונלי: ?statusId=&priorityId=&categoryId=&departmentId=
// =========================================================================
router.get('/', requireAuth, async (req, res) => {
    try {
        const { statusId, priorityId, categoryId, departmentId, createdByMe, assignedToMe } = req.query;

        let query = `
            SELECT
                m.MissionId,
                m.Description,
                m.MissionCategoryID,
                mc.CategoryName,
                m.StatusId,
                ms.Description AS StatusName,
                m.PriorityId,
                mp.Description AS PriorityName,
                m.DepartmentId,
                d.DepartmentName,
                m.CreatedBy,
                CONCAT(u_created.UserName, ' ', u_created.UserLastName) AS created_by_name,
                u_created.Email AS created_by_email,
                m.AssingTo,
                COALESCE(CONCAT(u_assigned.UserName, ' ', u_assigned.UserLastName), 'טרם שובץ') AS assigned_to_name,
                m.CreatedAt,
                m.CloseAt,
                m.AttachPath,
                m.HandlerComment
            FROM missiontable m
            LEFT JOIN missioncategory mc ON m.MissionCategoryID = mc.MissionCategoryID
            LEFT JOIN missionstatus ms ON m.StatusId = ms.StatusId
            LEFT JOIN missionpriority mp ON m.PriorityId = mp.PriorityId
            LEFT JOIN department d ON m.DepartmentId = d.DepartmentCode
            LEFT JOIN users u_created ON m.CreatedBy = u_created.UserId
            LEFT JOIN users u_assigned ON m.AssingTo = u_assigned.UserId
            WHERE 1 = 1
        `;
        const params = [];

        if (statusId)     { query += ' AND m.StatusId = ?'; params.push(statusId); }
        if (priorityId)   { query += ' AND m.PriorityId = ?'; params.push(priorityId); }
        if (categoryId)   { query += ' AND m.MissionCategoryID = ?'; params.push(categoryId); }
        if (departmentId) { query += ' AND m.DepartmentId = ?'; params.push(departmentId); }

        // 🛡️ "שלי" תמיד נפתר לפי מי שבאמת מחובר עכשיו (req.session.userId) - לא לפי מה שהלקוח שולח,
        // כדי שאי אפשר יהיה "להתחזות" ולבקש את המשימות של מישהו אחר
        if (createdByMe === 'true')  { query += ' AND m.CreatedBy = ?'; params.push(req.session.userId); }
        if (assignedToMe === 'true') { query += ' AND m.AssingTo = ?'; params.push(req.session.userId); }

        query += ' ORDER BY m.CreatedAt DESC';

        const [rows] = await db.query(query, params);
        res.json(rows);

    } catch (error) {
        console.error('שגיאה בשליפת משימות:', error);
        res.status(500).json({ error: 'שגיאה בטעינת המשימות' });
    }
});

// =========================================================================
// GET /api/missions/:id - משימה בודדת (לצורך חלון עריכה)
// =========================================================================
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const [[mission]] = await db.query(`SELECT * FROM missiontable WHERE MissionId = ?`, [req.params.id]);
        if (!mission) return res.status(404).json({ error: 'המשימה לא נמצאה' });
        res.json(mission);
    } catch (error) {
        console.error('שגיאה בשליפת משימה:', error);
        res.status(500).json({ error: 'שגיאה בטעינת המשימה' });
    }
});

// =========================================================================
// POST /api/missions - פתיחת משימה חדשה
// =========================================================================
router.post('/', requireAuth, async (req, res) => {
    const { Description, MissionCategoryID, StatusId, PriorityId, DepartmentId, CreatedBy, AssingTo } = req.body;

    if (!Description || !MissionCategoryID || !StatusId || !PriorityId || !DepartmentId || !CreatedBy || !AssingTo) {
        return res.status(400).json({ error: 'חסרים שדות חובה לפתיחת המשימה' });
    }

    try {
        const [result] = await db.query(`
            INSERT INTO missiontable (Description, MissionCategoryID, StatusId, PriorityId, DepartmentId, CreatedBy, AssingTo)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [Description, MissionCategoryID, StatusId, PriorityId, DepartmentId, CreatedBy, AssingTo]);

        res.status(201).json({ success: true, missionId: result.insertId });

        // 🟢 חדש: התראה לעובד שהוקצתה אליו הקריאה, אחרי שהתגובה כבר יצאה
        notifyUser(
            AssingTo,
            `הוקצתה אליך קריאה כללית חדשה: #${result.insertId} - ${Description}`,
            `myInbox.html`
        );

    } catch (error) {
        console.error('שגיאה בפתיחת משימה:', error);
        res.status(500).json({ error: 'שגיאה בפתיחת המשימה' });
    }
});

// =========================================================================
// PUT /api/missions/:id - עדכון משימה (סטטוס, עדיפות, שיוך, תיאור)
// CloseAt מתעדכן אוטומטית כשמעבירים לסטטוס שנראה כמו "הושלמה"/"בוטלה" (לפי שם, לא מספר מנוחש)
// =========================================================================
router.put('/:id', requireAuth, async (req, res) => {
    const missionId = req.params.id;
    const { Description, MissionCategoryID, StatusId, PriorityId, DepartmentId, AssingTo, HandlerComment } = req.body;

    try {
        const [[oldMission]] = await db.query(`SELECT * FROM missiontable WHERE MissionId = ?`, [missionId]);
        if (!oldMission) return res.status(404).json({ error: 'המשימה לא נמצאה' });

        // בדיקה אם הסטטוס החדש נראה כמו "סגירה" (הושלמה/בוטלה), כדי לעדכן CloseAt אוטומטית
        let closeAtClause = '';
        let closeAtParam = [];
        if (StatusId && String(StatusId) !== String(oldMission.StatusId)) {
            const [[statusRow]] = await db.query('SELECT Description FROM missionstatus WHERE StatusId = ?', [StatusId]);
            const statusName = String(statusRow?.Description || '').trim();
            const looksClosed = statusName.includes('שלמ') || statusName.includes('בוטל');
            if (looksClosed) {
                closeAtClause = ', CloseAt = NOW()';
            } else {
                closeAtClause = ', CloseAt = NULL'; // נפתחה מחדש
            }
        }

        await db.query(`
            UPDATE missiontable
            SET Description = ?, MissionCategoryID = ?, StatusId = ?, PriorityId = ?, DepartmentId = ?, AssingTo = ?, HandlerComment = ?
                ${closeAtClause}
            WHERE MissionId = ?
        `, [
            Description || oldMission.Description,
            MissionCategoryID || oldMission.MissionCategoryID,
            StatusId || oldMission.StatusId,
            PriorityId || oldMission.PriorityId,
            DepartmentId || oldMission.DepartmentId,
            AssingTo || oldMission.AssingTo,
            HandlerComment ?? oldMission.HandlerComment,
            missionId
        ]);

        res.json({ success: true });

        // 🟢 חדש: אם שיוך העובד השתנה - מתריעים לעובד החדש
        if (AssingTo && String(AssingTo) !== String(oldMission.AssingTo)) {
            notifyUser(
                AssingTo,
                `הוקצתה אליך קריאה: #${missionId} - ${Description || oldMission.Description}`,
                `myInbox.html`
            );
        }

    } catch (error) {
        console.error('שגיאה בעדכון משימה:', error);
        res.status(500).json({ error: 'שגיאה בעדכון המשימה' });
    }
});

module.exports = router;
