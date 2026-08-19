// routes/aircraft.js
// ⚠️ קובץ חדש - יש להוסיף לתיקיית routes/ ולחבר ב-server.js:
//   app.use('/api/aircraft', require('./routes/aircraft'));

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

// GET /api/aircraft - רשימת כל המטוסים, עם שם הלקוח (לדרופדאון בחירה בפתיחת ביקור)
router.get('/', requireAuth, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT a.SerialNumber, a.TailNumber, a.Model, a.CustomerId, c.CustomerName
            FROM aircraft a
            LEFT JOIN customer c ON a.CustomerId = c.CustomerId
            ORDER BY a.TailNumber
        `);
        res.json(rows);
    } catch (error) {
        console.error('שגיאה בשליפת מטוסים:', error);
        res.status(500).json({ error: 'שגיאה בשליפת המטוסים' });
    }
});

// POST /api/aircraft - הוספת מטוס חדש
router.post('/', requireAuth, async (req, res) => {
    const { SerialNumber, TailNumber, Model, CustomerId } = req.body;

    if (!SerialNumber || !TailNumber || !CustomerId) {
        return res.status(400).json({ error: 'מספר סידורי, מספר זנב ולקוח הם שדות חובה' });
    }

    try {
        await db.query(
            'INSERT INTO aircraft (SerialNumber, TailNumber, CustomerId, Model) VALUES (?, ?, ?, ?)',
            [SerialNumber, TailNumber, CustomerId, Model || null]
        );
        res.status(201).json({ success: true, SerialNumber });
    } catch (error) {
        console.error('שגיאה ביצירת מטוס:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'מספר סידורי זה כבר קיים במערכת' });
        }
        res.status(500).json({ error: 'שגיאה ביצירת המטוס' });
    }
});

module.exports = router;
