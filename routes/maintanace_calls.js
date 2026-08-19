const express = require('express');
const router = express.Router();
const db = require('../db'); // ייבוא נכון של ה-db מתיקיית השורש של הפרויקט
const { requireAuth } = require('./auth');
const { notifyUser } = require('./notifications');

// =========================================================================
// 1. שליפת נתונים ל-Dropdowns (חומרה, סטטוס, עדיפות, קטגוריות, מחלקות, עובדים)
// נתיב: GET /api/maintanace_calls/lookups
// =========================================================================
router.get('/lookups', requireAuth, async (req, res) => {
    try {
        // שליפת הנתונים במקביל מכל הטבלאות ב-MySQL
        const [severities] = await db.query('SELECT SeverityId AS id, SeverityName AS name FROM IssueSeverity');
        const [statuses] = await db.query('SELECT StatusID AS id, StatusName AS name FROM IssueStatus');
        const [priorities] = await db.query('SELECT PriorityId AS id, PriorityName AS name FROM IssuePriority');
        
        // שליפת קטגוריות כולל עמודת התיאור עבור ה-UX במסך
        const [categories] = await db.query('SELECT FaultCategoryId AS id, CategoryName AS name FROM faultcategorytable');
        
        // שליפת מחלקות
        const [departments] = await db.query('SELECT DepartmentCode AS id, DepartmentName AS name,Description FROM Department');

        // שליפת סטטוסי פעולה (טבלת lookup חדשה - actionstatus)
        const [actionStatuses] = await db.query('SELECT ActionStatusId AS id, StatusName AS name FROM actionstatus');

        // שליפת משתמשים (טכנאים ומדווחים)
// בתוך routes/maintanace_calls.js תחת router.get('/lookups', ...)

const [users] = await db.query(`
    SELECT 
        UserId AS userId,
        EmployeeId AS employeeId,
        CONCAT(EmployeeId, ' - ', UserName, ' ', UserLastName) AS displayName
    FROM Users
`);
        // החזרת המידע המלא כאובייקט JSON ל-Frontend
        res.json({
            severities,
            statuses,
            priorities,
            categories,
            departments,
            actionStatuses,
            users: users.length ? users : [{ id: 'usr-1', name: 'טכנאי ברירת מחדל' }]
        });

    } catch (error) {
        console.error('Error fetching lookups from MySQL:', error);
        res.status(500).json({ error: 'שגיאה בשליפת רשימות הנתונים ממסד הנתונים' });
    }
});

// =========================================================================
// 2. שמירת תקלה חדשה ופעולות תומכות (Transaction)
// נתיב: POST /api/maintanace_calls
// =========================================================================
router.post('/', requireAuth, async (req, res) => {
    // פתיחת חיבור לטובת Transaction
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const { issue, actions } = req.body;

        // 1. הכנסת התקלה לטבלת maintenanceissue
        const [issueResult] = await connection.query(`
            INSERT INTO maintenanceissue (
                Title,
                Description, 
                FaultCategory, 
                SeverityId, 
                StatusID, 
                PriorityId, 
                VisitId, 
                DepartmentCode, 
                assingTo, 
                createdBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
    // בדיקת כותרת: Title / title / כריכה מתיאור / דיפולט
    issue.Title || issue.title || (issue.Description || issue.description)?.slice(0, 50) || 'תקלת אחזקה חדשה',

    // בדיקת תיאור: Description / description / details
    issue.Description || issue.description || issue.details || '',

    issue.FaultCategory || issue.faultCategory || null,
    issue.SeverityId || issue.severityId || null,
    issue.StatusID || issue.statusId || issue.statusID || null,
    issue.PriorityId || issue.priorityId || null,
    issue.VisitId || issue.VisitID || issue.visitId || null,
    issue.DepartmentCode || issue.departmentCode || null,
    issue.assingTo || issue.AssignedToUserId || issue.assignedTo || null,
    issue.createdBy || issue.CreatedByUserId || issue.createdByUserId || null
]);

        // שליפת ה-IssueNumber החדש שהופק אוטומטית (auto_increment)
        const newIssueNumber = issueResult.insertId;
        console.log(`✅ תקלה מספר ${newIssueNumber} נוצרה בהצלחה ב-maintenanceissue`);

        // 2. הכנסת הפעולות לטבלת maintenanceaction
        const insertedActionIds = []; // 🟢 חדש: שמירת סדר ה-ActionId שנוצרו, לשיוך צירופים
        if (Array.isArray(actions) && actions.length > 0) {
            for (const action of actions) {
                const [actionResult] = await connection.query(`
                    INSERT INTO maintenanceaction (
                        IssueNumber, 
                        ActionDescription, 
                        SingedByEmployeeId, 
                        SerializedPart, 
                        NewSerialNumber, 
                        OldSerialNumber, 
                        ActionDate, 
                        ActionStatusId, 
                        ActionLiteratureRef
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    newIssueNumber, // הקישור לתקלה החדשה!
                    action.ActionDescription || '',
                    action.SingedByEmployeeId || null, // ה-UserId (UUID) של החותם
                    action.SerializedPart ? 1 : 0,
                    action.NewSerialNumber || null,
                    action.OldSerialNumber || null,
                    action.ActionDate || new Date(),
                    action.ActionStatusId || null,
                    action.ActionLiteratureRef || null
                ]);
                insertedActionIds.push(actionResult.insertId); // 🟢 חדש
            }
        }

        // שמירת כל השינויים
        await connection.commit();

        res.status(201).json({ 
            success: true, 
            message: 'התקלה והפעולות נשמרו בהצלחה!', 
            issueNumber: newIssueNumber,
            actionIds: insertedActionIds // 🟢 חדש: מערך מקביל למערך ה-actions שנשלח, לפי סדר
        });

        // 🟢 חדש: התראה לעובד שהתקלה הוקצתה אליו כבר בעת הפתיחה (אם הוקצתה) - אחרי שהתגובה כבר יצאה,
        // כדי שכשל בשליחת ההתראה/מייל לא יעכב את התגובה למשתמש שפתח את התקלה
        const assignedUserId = issue.assingTo || issue.AssignedToUserId || issue.assignedTo || null;
        if (assignedUserId) {
            notifyUser(
                assignedUserId,
                `הוקצתה אליך תקלה חדשה: #${newIssueNumber} - ${issue.Title || issue.title || ''}`,
                `manage_issues.html?visitId=${issue.VisitId || issue.VisitID || issue.visitId || ''}&issueNumber=${newIssueNumber}`
            );
        }

    } catch (error) {
        // במידה ויש שגיאה - ביטול כל הפעולות
        await connection.rollback();
        console.error('❌ שגיאה בשמירת תקלה ופעולות:', error);
        res.status(500).json({ error: 'שגיאה במסד הנתונים: ' + error.message });
    } finally {
        connection.release();
    }
});




router.get('/departments/:deptCode/users', requireAuth, async (req, res) => {
  try {
    const { deptCode } = req.params;

    // 1. שליפת מנהל המחלקה
    const [deptRows] = await db.execute(
      `SELECT u.UserId AS managerUserId, u.EmployeeId AS managerEmployeeId 
       FROM department d
       LEFT JOIN USERS u ON d.ManagerId = u.UserId 
       WHERE d.DepartmentCode = ?`,
      [deptCode]
    );
    
    // מעבירים את ה-UserId של המנהל
    const managerEmployeeId = deptRows[0]?.managerUserId || deptRows[0]?.managerEmployeeId || null;

    // 2. שליפת כל העובדים - כולל UserId המבוקש ב-DB!
    const [users] = await db.execute(
      `SELECT UserId, EmployeeId, UserName, UserLastName 
       FROM USERS 
       WHERE DepartmentCode = ? 
       ORDER BY UserName ASC`,
      [deptCode]
    );

    res.json({
      managerEmployeeId,
      users
    });

  } catch (err) {
    console.error('Error fetching department users:', err);
    res.status(500).json({ error: 'שגיאה בשליפת עובדי המחלקה' });
  }
});

// GET /api/employees - מחזיר את כל העובדים במערכת
router.get('/employees', requireAuth, async (req, res) => {
try {
        const [employees] = await db.query(`
            SELECT 
                UserId,
                EmployeeId, 
                UserName,
                UserLastName,
                CONCAT(UserName, ' ', UserLastName) AS EmployeeName
            FROM USERS
            WHERE EmployeeId IS NOT NULL 
        `);

        res.json(employees);
    } catch (error) {
        console.error('שגיאה בשליפת עובדים:', error);
        res.status(500).json({ error: 'שגיאת שרת בטעינת עובדים' });
    }
});




// פונקציית עזר לרישום לוג בטבלת maintenancelog
async function logChange(connection, issueNumber, performedBy, oldValue, newValue, comment) {
    const oldStr = oldValue !== null && oldValue !== undefined ? String(oldValue) : '';
    const newStr = newValue !== null && newValue !== undefined ? String(newValue) : '';

    if (oldStr !== newStr) {
        await connection.query(`
            INSERT INTO maintenancelog (IssueNumber, PreformedBy, OldValue, NewValue, Comment)
            VALUES (?, ?, ?, ?, ?)
        `, [issueNumber, performedBy, oldStr, newStr, comment]);
    }
}

// 1. שליפת כל התקלות השייכות לביקור מסוים
router.get('/visit/:visitId', requireAuth, async (req, res) => {
    try {
        const { visitId } = req.params;
        const [issues] = await db.query(`
            SELECT 
                i.*,
                COUNT(a.ActionId) AS ActionsCount
            FROM maintenanceissue i
            LEFT JOIN maintenanceaction a ON i.IssueNumber = a.IssueNumber
            WHERE i.VisitId = ?
            GROUP BY i.IssueNumber
            ORDER BY i.IssueNumber DESC
        `, [visitId]);

        res.json({ success: true, data: issues });
    } catch (error) {
        console.error('שגיאה בשליפת תקלות לביקור:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. שליפת תקלה יחידה עם כל הפעולות שלה (לצורך טעינה במודל עריכה)
router.get('/:issueNumber', requireAuth, async (req, res) => {
    try {
        const { issueNumber } = req.params;

        const [[issue]] = await db.query(`SELECT * FROM maintenanceissue WHERE IssueNumber = ?`, [issueNumber]);
        if (!issue) {
            return res.status(404).json({ success: false, message: 'התקלה לא נמצאה' });
        }

        const [actions] = await db.query(`SELECT * FROM maintenanceaction WHERE IssueNumber = ?`, [issueNumber]);

        res.json({ success: true, issue, actions });
    } catch (error) {
        console.error('שגיאה בשליפת פרטי תקלה:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 3. עדכון תקלה ופעולות + הצרחה ל-maintenancelog
router.put('/:issueNumber', requireAuth, async (req, res) => {
    const { issueNumber } = req.params;
    const { issue, actions } = req.body;
    const performedBy = req.session?.userId || 'SYSTEM'; // מזהה המשתמש מה-Session

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. שליפת המצב הקיים לפני העדכון
        const [[oldIssue]] = await connection.query(`SELECT * FROM maintenanceissue WHERE IssueNumber = ?`, [issueNumber]);
        if (!oldIssue) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'התקלה לא נמצאה' });
        }

        // 1.5. שליפת מיפויי שמות, כדי שהלוג ירשום "פתוחה -> סגורה" ולא "2 -> 4"
        const [statusRows] = await connection.query('SELECT StatusID AS id, StatusName AS name FROM issuestatus');
        const [severityRows] = await connection.query('SELECT SeverityId AS id, SeverityName AS name FROM issueseverity');
        const [priorityRows] = await connection.query('SELECT PriorityId AS id, PriorityName AS name FROM issuepriority');
        const [categoryRows] = await connection.query('SELECT FaultCategoryId AS id, CategoryName AS name FROM faultcategorytable');
        const [departmentRows] = await connection.query('SELECT DepartmentCode AS id, DepartmentName AS name FROM department');
        const [userRows] = await connection.query("SELECT UserId AS id, CONCAT(UserName, ' ', UserLastName) AS name FROM users");
        const [actionStatusRows] = await connection.query('SELECT ActionStatusId AS id, StatusName AS name FROM actionstatus');

        const toMap = rows => Object.fromEntries(rows.map(r => [String(r.id), r.name]));
        const statusMap = toMap(statusRows);
        const severityMap = toMap(severityRows);
        const priorityMap = toMap(priorityRows);
        const categoryMap = toMap(categoryRows);
        const departmentMap = toMap(departmentRows);
        const userMap = toMap(userRows);
        const actionStatusMap = toMap(actionStatusRows);

        // מחזירה את השם הקריא אם קיים במיפוי, אחרת חוזרת ל-ID הגולמי (כדי שלא ניפול אם חסר משהו)
        const resolveName = (map, id) => (id === null || id === undefined || id === '') ? '' : (map[String(id)] || id);

        // 🛡️ הגנה אמיתית (לא רק UI): אם התקלה כבר סגורה, רק Admin (1) / TeamLead (3) / QAInspector (5)
        // רשאים לגעת בה בכלל - כל שינוי, לא רק סטטוס. כל השאר (כולל Technician) נחסמים כאן, בשרת.
        const oldStatusName = String(resolveName(statusMap, oldIssue.StatusID) || '');
        const wasClosed = oldStatusName.includes('סגר');
        const allowedToEditClosed = [1, 3, 5];
        const currentPermission = req.session?.user?.permissionCode;

        if (wasClosed && !allowedToEditClosed.includes(currentPermission)) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: 'תקלה זו סגורה - רק ראש צוות, מבקר איכות, או מנהל מערכת רשאים לערוך אותה.'
            });
        }

        // תיעוד מפורש בלוג שזו חריגה (עריכת תקלה סגורה), בנוסף לשאר שורות הלוג הרגילות שיירשמו למטה
        if (wasClosed) {
            await logChange(connection, issueNumber, performedBy, 'תקלה הייתה סגורה', `נערכה מחדש (אישור חריג - הרשאה ${currentPermission})`, 'עריכת תקלה סגורה - חריגה מורשית');
        }

        // 🟢 חדש: עדכון ClosedAt אוטומטי - אותה שיטה בדיוק כמו ב-missiontable
        const newStatusId = issue.StatusID || oldIssue.StatusID;
        let closedAtClause = '';
        if (String(newStatusId) !== String(oldIssue.StatusID)) {
            const newStatusName = String(resolveName(statusMap, newStatusId) || '').trim();
            const looksClosed = newStatusName.includes('סגר'); // מכסה סגור/סגורה/נסגר/נסגרה
            closedAtClause = looksClosed ? ', ClosedAt = NOW()' : ', ClosedAt = NULL'; // נפתחה מחדש -> מתאפס
        }

        // 2. הצרחת שינויים בטופס התקלה ל-maintenancelog (עם שמות קריאים, לא מזהים גולמיים)
        await logChange(connection, issueNumber, performedBy, oldIssue.Title, issue.Title, 'שינוי כותרת תקלה');
        await logChange(connection, issueNumber, performedBy, oldIssue.Description, issue.Description, 'שינוי תיאור תקלה');
        await logChange(connection, issueNumber, performedBy, resolveName(statusMap, oldIssue.StatusID), resolveName(statusMap, issue.StatusID), 'שינוי סטטוס תקלה');
        await logChange(connection, issueNumber, performedBy, resolveName(severityMap, oldIssue.SeverityId), resolveName(severityMap, issue.SeverityId), 'שינוי רמת חומרה');
        await logChange(connection, issueNumber, performedBy, resolveName(priorityMap, oldIssue.PriorityId), resolveName(priorityMap, issue.PriorityId), 'שינוי רמת דחיפות');
        await logChange(connection, issueNumber, performedBy, resolveName(categoryMap, oldIssue.FaultCategory), resolveName(categoryMap, issue.FaultCategory), 'שינוי קטגוריית תקלה');
        await logChange(connection, issueNumber, performedBy, resolveName(departmentMap, oldIssue.DepartmentCode), resolveName(departmentMap, issue.DepartmentCode), 'שינוי מחלקה אחראית');
        await logChange(connection, issueNumber, performedBy, resolveName(userMap, oldIssue.assingTo), resolveName(userMap, issue.assingTo), 'שינוי שיוך עובד מטפל');

        // 3. עדכון טבלת maintenanceissue
        // 🛡️ שימוש בערך הקיים כברירת מחדל אם הטופס לא שלח ערך (מונע איפוס שדות NOT NULL ל-NULL בטעות)
        await connection.query(`
            UPDATE maintenanceissue 
            SET Title = ?, Description = ?, StatusID = ?, SeverityId = ?, PriorityId = ?, 
                FaultCategory = ?, DepartmentCode = ?, assingTo = ?
                ${closedAtClause}
            WHERE IssueNumber = ?
        `, [
            issue.Title,
            issue.Description || '',
            issue.StatusID || oldIssue.StatusID,
            issue.SeverityId || oldIssue.SeverityId,
            issue.PriorityId || oldIssue.PriorityId,
            issue.FaultCategory || oldIssue.FaultCategory,
            issue.DepartmentCode || oldIssue.DepartmentCode,
            issue.assingTo || null,
            issueNumber
        ]);

        // 4. טיפול בפעולות (Maintenance Actions)
        const actionAssignNotifications = []; // 🟢 חדש: מי לחתום אליו התראה אחרי הקומיט
        if (Array.isArray(actions)) {
            for (const act of actions) {
                if (act.ActionId) {
                    // עדכון פעולה קיימת
                    const [[oldAct]] = await connection.query(`SELECT * FROM maintenanceaction WHERE ActionId = ?`, [act.ActionId]);
                    if (oldAct) {
                        await logChange(connection, issueNumber, performedBy, oldAct.ActionDescription, act.ActionDescription, `שינוי תיאור בפעולה #${act.ActionId}`);
                        await logChange(connection, issueNumber, performedBy, resolveName(actionStatusMap, oldAct.ActionStatusId), resolveName(actionStatusMap, act.ActionStatusId), `שינוי סטטוס בפעולה #${act.ActionId}`);
                        await logChange(connection, issueNumber, performedBy, resolveName(userMap, oldAct.SingedByEmployeeId), resolveName(userMap, act.SingedByEmployeeId), `שינוי חותם בפעולה #${act.ActionId}`);

                        // 🟢 חדש: אם החותם/מטפל בפעולה השתנה - נתריע לו
                        if (act.SingedByEmployeeId && String(act.SingedByEmployeeId) !== String(oldAct.SingedByEmployeeId)) {
                            actionAssignNotifications.push({ userId: act.SingedByEmployeeId, actionId: act.ActionId, description: act.ActionDescription });
                        }

                        await connection.query(`
                            UPDATE maintenanceaction 
                            SET ActionDescription = ?, ActionStatusId = ?, SingedByEmployeeId = ?, 
                                SerializedPart = ?, NewSerialNumber = ?, OldSerialNumber = ?, ActionLiteratureRef = ?
                            WHERE ActionId = ?
                        `, [
                            act.ActionDescription, act.ActionStatusId || oldAct.ActionStatusId, act.SingedByEmployeeId || null,
                            act.SerializedPart ? 1 : 0, act.NewSerialNumber || null, act.OldSerialNumber || null,
                            act.ActionLiteratureRef || null, act.ActionId
                        ]);
                    }
                } else {
                    // הכנסת פעולה חדשה
                    const [actRes] = await connection.query(`
                        INSERT INTO maintenanceaction 
                        (IssueNumber, ActionDescription, ActionStatusId, SingedByEmployeeId, SerializedPart, NewSerialNumber, OldSerialNumber, ActionLiteratureRef)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        issueNumber, act.ActionDescription, act.ActionStatusId || null, act.SingedByEmployeeId || null,
                        act.SerializedPart ? 1 : 0, act.NewSerialNumber || null, act.OldSerialNumber || null, act.ActionLiteratureRef || null
                    ]);

                    await logChange(connection, issueNumber, performedBy, '', `פעולה חדשה #${actRes.insertId}`, 'הוספת פעולה חדשה לתקלה');

                    // 🟢 חדש: אם הפעולה החדשה כבר נוצרה עם חותם/מטפל משויך - נתריע לו
                    if (act.SingedByEmployeeId) {
                        actionAssignNotifications.push({ userId: act.SingedByEmployeeId, actionId: actRes.insertId, description: act.ActionDescription });
                    }
                }
            }
        }

        await connection.commit();
        res.json({ success: true, message: 'התקלה והלוגים עודכנו בהצלחה!' });

        // 🟢 חדש: התראה לכל טכנאי שהוקצה/הוחלף כחותם על פעולה כלשהי בעדכון הזה
        actionAssignNotifications.forEach(({ userId, actionId, description }) => {
            notifyUser(
                userId,
                `הוקצתה אליך פעולת טיפול בתקלה #${issueNumber}: ${description || ''}`,
                `manage_issues.html?visitId=${oldIssue.VisitId || ''}&issueNumber=${issueNumber}`
            );
        });

        // 🟢 אם שיוך העובד המטפל השתנה - מתריעים לעובד החדש (אחרי שהתגובה כבר יצאה)
        const newAssignedTo = issue.assingTo;
        if (newAssignedTo && String(newAssignedTo) !== String(oldIssue.assingTo)) {
            notifyUser(
                newAssignedTo,
                `הוקצתה אליך תקלה: #${issueNumber} - ${issue.Title || oldIssue.Title || ''}`,
                `manage_issues.html?visitId=${oldIssue.VisitId || ''}&issueNumber=${issueNumber}`
            );
        }

    } catch (error) {
        await connection.rollback();
        console.error('שגיאה בעדכון תקלה:', error);
        res.status(500).json({ success: false, message: 'שגיאה במסד הנתונים: ' + error.message });
    } finally {
        connection.release();
    }
});

module.exports = router;