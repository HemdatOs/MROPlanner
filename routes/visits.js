const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

// 1. קריאה לאכלוס רשימת הבחירה (Dropdown)
// מסלול מלא: GET /api/visits/active (בהנחה שב-app.js הוגדר app.use('/api/visits', visitsRouter))
router.get('/active', requireAuth, async (req, res) => {
  try {
    const query = `
      SELECT v.VisitID, a.TailNumber, a.Model, c.CustomerName
      FROM maintenancevisit v
      JOIN aircraft a ON v.SerialNumber = a.SerialNumber
      JOIN customer c ON a.CustomerId = c.CustomerId
      WHERE v.LeaveDate IS NULL
      ORDER BY v.EntryDate DESC
    `;
    const [rows] = await db.execute(query);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching active visits:', err);
    res.status(500).json({ error: 'שגיאה בשליפת הביקורים הפעילים' });
  }
});

// 1.5. קריאה לרשימת כל הביקורים (גם סגורים) - למסך עריכת ביקורים
// ⚠️ חייב לבוא לפני /:visitId, אחרת "/all" ייתפס בטעות כ-visitId
// מסלול מלא: GET /api/visits/all
router.get('/all', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT
                v.VisitID, a.TailNumber, a.Model, c.CustomerName,
                h.HangarPosition, h.HangarLocationID,
                v.EntryDate, v.TargetLeaveDate, v.LeaveDate,
                v.QAApprovedBy, v.QAApprovedAt, v.ManagerApprovedBy, v.ManagerApprovedAt
            FROM maintenancevisit v
            JOIN aircraft a ON v.SerialNumber = a.SerialNumber
            JOIN customer c ON a.CustomerId = c.CustomerId
            LEFT JOIN hangarlayout h ON v.HangarLocationID = h.HangarLocationID
            ORDER BY v.EntryDate DESC
        `;
        const [rows] = await db.execute(query);
        res.json(rows);
    } catch (err) {
        console.error('שגיאה בשליפת כל הביקורים:', err);
        res.status(500).json({ error: 'שגיאה בשליפת הביקורים' });
    }
});

// 2. קריאה לשליפת פרטי ביקור בודד לפי VisitID
// מסלול מלא: GET /api/visits/:visitId
router.get('/:visitId', requireAuth, async (req, res) => {
    try {
        const { visitId } = req.params;

        const query = `
            SELECT
                v.VisitID,
                a.TailNumber,
                a.Model,
                c.CustomerName,
                c.RepresentativeName,
                c.RepresentativeEmail,
                h.HangarLocationID,
                h.HangarPosition,
                v.EntryDate,
                v.TargetLeaveDate,
                v.LeaveDate
            FROM maintenancevisit v
            JOIN aircraft a ON v.SerialNumber = a.SerialNumber
            JOIN customer c ON a.CustomerId = c.CustomerId
            LEFT JOIN hangarlayout h ON v.HangarLocationID = h.HangarLocationID
            WHERE v.VisitID = ?
        `;

        const [rows] = await db.execute(query, [visitId]);

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'הביקור לא נמצא' });
        }

        res.json(rows[0]);

    } catch (err) {
        console.error('שגיאה בשליפת פרטי ביקור:', err);
        res.status(500).json({ error: 'שגיאה בטעינת פרטי הביקור' });
    }
});
// =========================================================================
// 3. עדכון תאריך יעד יציאה משוער בלבד (לא סוגר את הביקור - זה תפקיד /sign)
// מסלול מלא: PUT /api/visits/:visitId
// =========================================================================
router.put('/:visitId', requireAuth, async (req, res) => {
    try {
        const { visitId } = req.params;
        const { TargetLeaveDate } = req.body;

        // 🛡️ עריכת יעד יציאה מותרת לכל תפקיד חוץ מעובד רגיל (Technician, קוד 6)
        if (req.session?.user?.permissionCode === 6) {
            return res.status(403).json({ error: 'עובדים רגילים אינם רשאים לערוך יעד יציאה משוער.' });
        }

        const [[existing]] = await db.execute('SELECT * FROM maintenancevisit WHERE VisitID = ?', [visitId]);
        if (!existing) {
            return res.status(404).json({ error: 'הביקור לא נמצא' });
        }
        if (existing.LeaveDate) {
            return res.status(409).json({ error: 'לא ניתן לערוך ביקור שכבר נסגר.' });
        }

        await db.execute(
            'UPDATE maintenancevisit SET TargetLeaveDate = ? WHERE VisitID = ?',
            [TargetLeaveDate || existing.TargetLeaveDate, visitId]
        );

        res.json({ success: true });

    } catch (err) {
        console.error('שגיאה בעדכון תאריך יעד:', err);
        res.status(500).json({ error: 'שגיאה בעדכון הביקור' });
    }
});

// =========================================================================
// 4. חתימה על סגירת ביקור - מזוהה תמיד לפי המשתמש המחובר בפועל (ה-session),
// לעולם לא לפי בחירה מרשימה. תהליך דו-שלבי: קודם מבקר איכות, אחר כך מנהל בכיר.
// LeaveDate (סגירה בפועל) נקבע אוטומטית כ-NOW() רק כשגם המנהל חתם.
// מסלול מלא: POST /api/visits/:visitId/sign
// =========================================================================
// =========================================================================
// 4.5. בדיקה שקטה (לא מבצעת שום שינוי) - האם מותר בכלל לנסות לחתום עכשיו?
// רצה בצד הלקוח *לפני* הצגת פופ-אפ האישור, כדי שלא נציג "בטוח שברצונך לחתום?"
// כשידוע מראש שיש תקלות פתוחות/אין יעד יציאה.
// מסלול מלא: GET /api/visits/:visitId/close-checks
// =========================================================================
router.get('/:visitId/close-checks', requireAuth, async (req, res) => {
    try {
        const { visitId } = req.params;
        const [[visit]] = await db.execute('SELECT * FROM maintenancevisit WHERE VisitID = ?', [visitId]);
        if (!visit) return res.status(404).json({ eligible: false, reason: 'הביקור לא נמצא' });
        if (visit.LeaveDate) return res.json({ eligible: false, reason: 'הביקור כבר סגור.' });

        if (!visit.QAApprovedBy) {
            if (!visit.TargetLeaveDate) {
                return res.json({ eligible: false, reason: 'יש להזין יעד יציאה משוער לביקור לפני חתימה.' });
            }
            const [openIssues] = await db.execute(`
                SELECT i.IssueNumber FROM maintenanceissue i
                LEFT JOIN issuestatus s ON i.StatusID = s.StatusID
                WHERE i.VisitId = ? AND (s.StatusName IS NULL OR (s.StatusName NOT LIKE '%סגר%' AND s.StatusName NOT LIKE '%בוטל%'))
            `, [visitId]);
            if (openIssues.length > 0) {
                return res.json({ eligible: false, reason: `יש ${openIssues.length} תקלות פתוחות בביקור - לא ניתן לחתום עדיין.` });
            }
            return res.json({ eligible: true });
        }

        if (visit.ManagerApprovedBy) {
            return res.json({ eligible: false, reason: 'מנהל בכיר כבר חתם על ביקור זה.' });
        }
        return res.json({ eligible: true }); // אין בדיקות נוספות בשלב המנהל - רק ההרשאה, שנבדקת בפועל בזמן החתימה

    } catch (err) {
        console.error('שגיאה בבדיקת אפשרות חתימה:', err);
        res.status(500).json({ eligible: false, reason: 'שגיאה בבדיקת האפשרות לחתום' });
    }
});

router.post('/:visitId/sign', requireAuth, async (req, res) => {
    try {
        const { visitId } = req.params;
        const currentUserId = req.session?.userId;
        const currentPermission = req.session?.user?.permissionCode;

        const [[visit]] = await db.execute('SELECT * FROM maintenancevisit WHERE VisitID = ?', [visitId]);
        if (!visit) return res.status(404).json({ error: 'הביקור לא נמצא' });
        if (visit.LeaveDate) return res.status(409).json({ error: 'הביקור כבר סגור.' });

        if (!visit.QAApprovedBy) {
            // שלב 1 - חתימת מבקר איכות. ההיררכיה חלה על כל מי שמנסה לחתום, בסדר הזה בדיוק,
            // לפני שבודקים בכלל אם יש לו הרשאה - כדי שהבדיקות האלה לא "יידלגו" סתם כי מישהו לא מורשה ניסה.

            // 1. חייב להיות יעד יציאה משוער לפני שאפשר בכלל לנסות לסגור
            if (!visit.TargetLeaveDate) {
                return res.status(400).json({ error: 'יש להזין יעד יציאה משוער לביקור לפני חתימה.' });
            }

            // 2. אין תקלות פתוחות
            const [openIssues] = await db.execute(`
                SELECT i.IssueNumber FROM maintenanceissue i
                LEFT JOIN issuestatus s ON i.StatusID = s.StatusID
                WHERE i.VisitId = ? AND (s.StatusName IS NULL OR (s.StatusName NOT LIKE '%סגר%' AND s.StatusName NOT LIKE '%בוטל%'))
            `, [visitId]);
            if (openIssues.length > 0) {
                return res.status(409).json({ error: `יש ${openIssues.length} תקלות פתוחות בביקור - לא ניתן לחתום עדיין.` });
            }

            // 3. רק עכשיו, אחרי ששתי הבדיקות הקודמות עברו - בודקים שהמשתמש המחובר הוא אכן מבקר איכות
            if (currentPermission !== 5) {
                return res.status(403).json({ error: 'רק מבקר איכות מורשה לחתום בשלב זה.' });
            }

            await db.execute(
                'UPDATE maintenancevisit SET QAApprovedBy = ?, QAApprovedAt = NOW() WHERE VisitID = ?',
                [currentUserId, visitId]
            );
            return res.json({ success: true, stage: 'qa_signed', message: 'נחתם בהצלחה כמבקר איכות. ממתין לחתימת מנהל בכיר.' });
        }

        // שלב 2 - חתימת מנהל בכיר. הבדיקות (תאריך יעד, תקלות פתוחות) כבר בוצעו בשלב ה-QA.
        // כאן נדרש רק שהמשתמש המחובר הוא אכן מנהל בכיר.
        if (visit.ManagerApprovedBy) {
            return res.status(409).json({ error: 'מנהל בכיר כבר חתם על ביקור זה.' });
        }
        if (currentPermission !== 2) {
            return res.status(403).json({ error: 'רק מנהל בכיר מורשה לחתום בשלב זה.' });
        }

        // תאריך היציאה בפועל - ברירת מחדל "עכשיו", אבל המנהל הבכיר יכול לערוך אחורה (למשל אם המטוס יצא בפועל קודם)
        const { LeaveDate } = req.body;
        const leaveDateToSave = LeaveDate ? new Date(LeaveDate) : new Date();

        if (isNaN(leaveDateToSave.getTime())) {
            return res.status(400).json({ error: 'תאריך היציאה בפועל שהוזן אינו תקין.' });
        }
        if (visit.EntryDate && leaveDateToSave < new Date(visit.EntryDate)) {
            return res.status(400).json({ error: 'תאריך היציאה בפועל לא יכול להיות לפני תאריך הכניסה.' });
        }

        await db.execute(
            'UPDATE maintenancevisit SET ManagerApprovedBy = ?, ManagerApprovedAt = NOW(), LeaveDate = ? WHERE VisitID = ?',
            [currentUserId, leaveDateToSave, visitId]
        );
        return res.json({ success: true, stage: 'closed', message: 'הביקור נסגר סופית!' });

    } catch (err) {
        console.error('שגיאה בחתימה על ביקור:', err);
        res.status(500).json({ error: 'שגיאה בתהליך החתימה' });
    }
});

// =========================================================================
// 5. דחיית חתימת מבקר האיכות ע"י מנהל בכיר - "ראיתי בעיה, מחזיר לפעיל"
// מוחקת את חתימת ה-QA (לא נוגעת בשום דבר אחר). זמינה רק בשלב "ממתין למנהל".
// מסלול מלא: POST /api/visits/:visitId/reject
// =========================================================================
router.post('/:visitId/reject', requireAuth, async (req, res) => {
    try {
        const { visitId } = req.params;
        const currentPermission = req.session?.user?.permissionCode;

        if (currentPermission !== 2) {
            return res.status(403).json({ error: 'רק מנהל בכיר יכול לדחות חתימת מבקר איכות.' });
        }

        const [[visit]] = await db.execute('SELECT * FROM maintenancevisit WHERE VisitID = ?', [visitId]);
        if (!visit) return res.status(404).json({ error: 'הביקור לא נמצא' });
        if (visit.LeaveDate) return res.status(409).json({ error: 'הביקור כבר נסגר סופית - אי אפשר לבטל.' });
        if (!visit.QAApprovedBy) return res.status(409).json({ error: 'אין חתימת מבקר איכות לבטל.' });

        await db.execute(
            'UPDATE maintenancevisit SET QAApprovedBy = NULL, QAApprovedAt = NULL WHERE VisitID = ?',
            [visitId]
        );

        res.json({ success: true, message: 'חתימת מבקר האיכות בוטלה. הביקור חזר להמתין לבדיקת מבקר איכות.' });

    } catch (err) {
        console.error('שגיאה בדחיית חתימה:', err);
        res.status(500).json({ error: 'שגיאה בביטול החתימה' });
    }
});

// =========================================================================
// POST /api/visits - פתיחת ביקור חדש
// מייצרת VisitID אוטומטי בהמשך לקונבנציה הקיימת (VIS-{שנה}-{מספר סידורי})
// =========================================================================
router.post('/', requireAuth, async (req, res) => {
    try {
        const { SerialNumber, HangarLocationID, EntryDate, TargetLeaveDate } = req.body;

        if (!SerialNumber || !HangarLocationID) {
            return res.status(400).json({ error: 'מטוס ועמדת האנגר הם שדות חובה' });
        }

        // 🛡️ מניעת הבאג שכבר גילינו - שני ביקורים פעילים על אותה עמדה בו-זמנית
        const [[occupied]] = await db.execute(
            `SELECT VisitID FROM maintenancevisit WHERE HangarLocationID = ? AND LeaveDate IS NULL`,
            [HangarLocationID]
        );
        if (occupied) {
            return res.status(409).json({ error: `העמדה הזו כבר תפוסה על ידי ביקור פעיל אחר (${occupied.VisitID}). יש לסגור אותו קודם.` });
        }

        const year = new Date().getFullYear();
        const [[{ maxNum }]] = await db.execute(
            `SELECT MAX(CAST(SUBSTRING_INDEX(VisitID, '-', -1) AS UNSIGNED)) AS maxNum
             FROM maintenancevisit WHERE VisitID LIKE ?`,
            [`VIS-${year}-%`]
        );
        const nextNum = String((maxNum || 0) + 1).padStart(3, '0');
        const newVisitId = `VIS-${year}-${nextNum}`;

        await db.execute(`
            INSERT INTO maintenancevisit (VisitID, SerialNumber, HangarLocationID, EntryDate, TargetLeaveDate)
            VALUES (?, ?, ?, ?, ?)
        `, [
            newVisitId,
            SerialNumber,
            HangarLocationID,
            EntryDate || new Date(),
            TargetLeaveDate || null
        ]);

        res.status(201).json({ success: true, VisitID: newVisitId });

    } catch (err) {
        console.error('שגיאה בפתיחת ביקור חדש:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'קיים כבר ביקור פעיל אחר על עמדה זו' });
        }
        res.status(500).json({ error: 'שגיאה בפתיחת הביקור' });
    }
});

module.exports = router;