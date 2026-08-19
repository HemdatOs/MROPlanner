document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const resetForm = document.getElementById('resetForm');
    const modal = document.getElementById('resetModal');
    const openResetModalBtn = document.getElementById('openResetModal');
    const closeResetModalBtn = document.getElementById('closeResetModal');

    // 1. התחברות למערכת
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const employeeId = document.getElementById('employeeId').value;
            const password = document.getElementById('password').value;
            const errDiv = document.getElementById('loginError');
            errDiv.textContent = '';

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ employeeId, password })
                });

                const data = await res.json();

                if (!res.ok) {
                    if (data.requirePasswordReset) {
                        alert(data.error);
                        modal.style.display = 'flex';
                        document.getElementById('resetEmpId').value = employeeId;
                    } else {
                        errDiv.textContent = data.error;
                    }
                    return;
                }

                // שמירת המשתמש ב-sessionStorage
                sessionStorage.setItem('loggedInUser', JSON.stringify(data.user));

                // 👈 המעבר המתוקן! מכיוון ששני הקבצים בתיקיית html, הקישור ישיר:
                window.location.href = 'homePage.html';

            } catch (err) {
                console.error('Login Error:', err);
                errDiv.textContent = 'שגיאה בהתחברות לשרת';
            }
        });
    }

    // 2. פתיחה וסגירה של חלון האיפוס
    if (openResetModalBtn) {
        openResetModalBtn.addEventListener('click', () => {
            modal.style.display = 'flex';
        });
    }

    if (closeResetModalBtn) {
        closeResetModalBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    // 3. איפוס סיסמה
    if (resetForm) {
        resetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const errDiv = document.getElementById('resetError');
            errDiv.textContent = '';

            const payload = {
                employeeId: document.getElementById('resetEmpId').value,
                idNumber: document.getElementById('resetIdNumber').value,
                oldPassword: document.getElementById('resetOldPass').value,
                newPassword: document.getElementById('resetNewPass').value,
                confirmPassword: document.getElementById('resetConfirmPass').value
            };

            try {
                const res = await fetch('/api/auth/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) {
                    errDiv.textContent = data.error;
                    return;
                }

                alert(data.message);
                modal.style.display = 'none';
                resetForm.reset();
            } catch (err) {
                console.error('Reset Error:', err);
                errDiv.textContent = 'שגיאה בעדכון הסיסמה';
            }
        });
    }
});