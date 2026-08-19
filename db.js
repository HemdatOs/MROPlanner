const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    // כל שורה: קודם מנסה את משתנה הסביבה של Railway (קיים רק כשרץ בענן),
    // ואם הוא לא קיים - נופלת אוטומטית חזרה למשתנה המקומי שלך מ-.env (בדיוק כמו היום)
    host: process.env.MYSQLHOST || process.env.DB_HOST,
    user: process.env.MYSQLUSER || process.env.DB_USER,
    password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD,
    database: process.env.MYSQLDATABASE || process.env.DB_NAME,
    port: process.env.MYSQLPORT || process.env.DB_PORT
});

pool.getConnection((err, connection) => {
    if (err) {
        console.error('Database connection failed:', err);
        return;
    }

    console.log('Connected to MySQL successfully!');
    connection.release();
});

module.exports = pool.promise();
