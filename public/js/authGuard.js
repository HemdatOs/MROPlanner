// public/js/authGuard.js
// 🛡️ קובץ משותף - יש לכלול אותו (script src) בכל דף שדורש התחברות,
// לפני קובץ ה-JS הספציפי של אותו דף (homePage.js, maintenanceissue.js וכו').

/**
 * בודקת אם תגובת fetch מסמנת פקיעת התחברות (401),
 * ואם כן - מציגה הודעה ומפנה אוטומטית לדף הכניסה מיד לאחר אישור המשתמש.
 * מחזירה true אם הייתה פקיעת התחברות (כדי לעצור את שאר הלוגיקה בקריאה),
 * ו-false אחרת.
 */
function checkAuthResponse(response) {
    if (response && response.status === 401) {
        alert('פג תוקף החיבור או שהשרת אופס. נא להתחבר מחדש.');
        // ה-alert חוסם את הריצה עד לחיצת אישור - ההפניה קורית מיד אחרי זה
        window.location.href = 'login.html';
        return true;
    }
    return false;
}
