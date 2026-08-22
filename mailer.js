// mailer.js
// ⚠️ קובץ חדש - שים בתיקיית השורש של הפרויקט (ליד server.js, db.js)
// דורש: npm install nodemailer
//

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');  // 👈 חדש - חייב לרוץ לפני יצירת ה-transporter

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'mroplanner030.gmail.com',   // 👈 שונה מ-service:'gmail' לקונפיגורציה מפורשת
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    family: 4   // 👈 חדש - כפיית IPv4 ברמת החיבור עצמו
});

// שולחת מייל בודד. לא זורקת שגיאה החוצה - אם השליחה נכשלת (למשל אין אינטרנט, פרטי
// ההתחברות שגויים), רק רושמת ללוג ומחזירה false, כדי שכשל בשליחת מייל לא יפיל
// שום פעולה אחרת במערכת (כמו יצירת/עדכון תקלה) שמתבצעת יחד עם ההתראה.
async function sendEmail(to, subject, html) {
    if (!to) return false;

    try {
        await transporter.sendMail({
            from: `"MRO Planner" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html
        });
        return true;
    } catch (error) {
        console.error('שגיאה בשליחת מייל:', error.message);
        return false;
    }
}

module.exports = { sendEmail };