// routes/customers.js
// ⚠️ קובץ חדש - יש להוסיף לתיקיית routes/ ולחבר ב-server.js:
//   app.use('/api/customers', require('./routes/customers'));

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

// GET /api/customers - רשימת כל הלקוחות (לדרופדאון בחירה)
router.get('/', requireAuth, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT CustomerId AS id, CustomerName AS name FROM customer ORDER BY CustomerName');
        res.json(rows);
    } catch (error) {
        console.error('שגיאה בשליפת לקוחות:', error);
        res.status(500).json({ error: 'שגיאה בשליפת הלקוחות' });
    }
});

// POST /api/customers - יצירת לקוח חדש
router.post('/', requireAuth, async (req, res) => {
    const { CustomerName, RepresentativeName, RepresentativeEmail, Address } = req.body;

    if (!CustomerName) {
        return res.status(400).json({ error: 'שם הלקוח הוא שדה חובה' });
    }

    try {
        const [result] = await db.query(
            'INSERT INTO customer (CustomerName, RepresentativeName, RepresentativeEmail, Address) VALUES (?, ?, ?, ?)',
            [CustomerName, RepresentativeName || null, RepresentativeEmail || null, Address || null]
        );
        res.status(201).json({ success: true, id: result.insertId, name: CustomerName });
    } catch (error) {
        console.error('שגיאה ביצירת לקוח:', error);
        res.status(500).json({ error: 'שגיאה ביצירת הלקוח' });
    }
});

module.exports = router;
