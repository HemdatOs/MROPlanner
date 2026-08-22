// mailer.js
// שולח מיילים דרך Resend API (HTTPS, פורט 443) במקום SMTP -
// כי Railway חוסם תעבורה יוצאת בפורטים של SMTP (465/587/25).
// דורש: npm install resend
// דורש משתנה סביבה RESEND_API_KEY ב-Railway (Variables)

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// שולחת מייל בודד. לא זורקת שגיאה החוצה - אם השליחה נכשלת, רק רושמת ללוג
// ומחזירה false, כדי שכשל בשליחת מייל לא יפיל שום פעולה אחרת במערכת
// (כמו יצירת/עדכון תקלה) שמתבצעת יחד עם ההתראה.
async function sendEmail(to, subject, html) {
    if (!to) return false;

    try {
        const { data, error } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'MRO Planner <mroplanner030@gmail.com>',
            to,
            subject,
            html
        });

        if (error) {
            console.error('שגיאה בשליחת מייל:', error.message || error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('שגיאה בשליחת מייל:', error.message);
        return false;
    }
}

module.exports = { sendEmail };