// mailer.js
// שולח מיילים דרך Brevo API (HTTPS, פורט 443) במקום SMTP -
// כי Railway חוסם תעבורה יוצאת בפורטים של SMTP (465/587/25).
// דורש: npm install axios (אם עוד אין בפרויקט)
// דורש משתני סביבה ב-Railway (Variables):
//   BREVO_API_KEY   - המפתח מ-Brevo (SMTP & API -> API Keys)
//   EMAIL_USER      - כתובת ה-Gmail שאימתת כ-Sender ב-Brevo

const axios = require('axios');

// שולחת מייל בודד. לא זורקת שגיאה החוצה - אם השליחה נכשלת, רק רושמת ללוג
// ומחזירה false, כדי שכשל בשליחת מייל לא יפיל שום פעולה אחרת במערכת
// (כמו יצירת/עדכון תקלה) שמתבצעת יחד עם ההתראה.
async function sendEmail(to, subject, html) {
    if (!to) return false;

    try {
        await axios.post(
            'https://api.brevo.com/v3/smtp/email',
            {
                sender: {
                    name: 'MRO Planner',
                    email: process.env.EMAIL_USER
                },
                to: [{ email: to }],
                subject,
                htmlContent: html
            },
            {
                headers: {
                    'api-key': process.env.BREVO_API_KEY,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );
        return true;
    } catch (error) {
        const details = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('שגיאה בשליחת מייל:', details);
        return false;
    }
}

module.exports = { sendEmail };