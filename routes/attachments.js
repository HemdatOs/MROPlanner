// routes/attachments.js
// ⚠️ קובץ חדש - לא היה קיים בפרויקט. יש להוסיף אותו לתיקיית routes/
// ולחבר אותו ב-server.js (ראה הוראות בהודעה).
//
// דורש התקנה: npm install multer

const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// תיקיית האחסון של הקבצים המצורפים
const uploadDir = path.join(__dirname, '..', 'uploads', 'attachments');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        // שם קובץ ייחודי: timestamp + השם המקורי (מנוקה מרווחים)
        const safeName = file.originalname.replace(/\s+/g, '_');
        cb(null, `${Date.now()}-${safeName}`);
    }
});

const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } }); // מגבלת 15MB לקובץ

// =========================================================================
// POST /api/attachments — העלאת קובץ/ים ושיוכם לתקלה קיימת
// מצפה ל-multipart/form-data עם שדה IssueNumber ושדה files (יכול להיות כמה קבצים)
// =========================================================================
router.post('/', upload.array('files'), async (req, res) => {
    const { IssueNumber, ActionId } = req.body;

    if (!IssueNumber) {
        return res.status(400).json({ error: 'חסר מספר תקלה (IssueNumber) לשיוך הצירופים' });
    }
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'לא התקבלו קבצים' });
    }

    try {
        const inserted = [];
        for (const file of req.files) {
            const relativePath = `/uploads/attachments/${file.filename}`;
            const [result] = await db.query(
                `INSERT INTO attachments (IssueNumber, ActionId, AttachPath, AttachType) VALUES (?, ?, ?, ?)`,
                [IssueNumber, ActionId || null, relativePath, file.mimetype]
            );
            inserted.push({ AttachmentId: result.insertId, AttachPath: relativePath, ActionId: ActionId || null });
        }

        res.status(201).json({ success: true, attachments: inserted });
    } catch (error) {
        console.error('שגיאה בשמירת צירוף:', error);
        res.status(500).json({ error: 'שגיאה בשמירת הצירוף במסד הנתונים' });
    }
});

// =========================================================================
// GET /api/attachments/:issueNumber — שליפת כל הצירופים של תקלה מסוימת
// =========================================================================
router.get('/:issueNumber', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT * FROM attachments WHERE IssueNumber = ?`,
            [req.params.issueNumber]
        );
        res.json(rows);
    } catch (error) {
        console.error('שגיאה בשליפת צירופים:', error);
        res.status(500).json({ error: 'שגיאה בשליפת הצירופים' });
    }
});

module.exports = router;
