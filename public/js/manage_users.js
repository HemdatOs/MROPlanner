// public/js/manage_users.js

document.addEventListener('DOMContentLoaded', () => {
    loadUsers();
    loadDepartmentsForForm();
    document.getElementById('newUserForm')?.addEventListener('submit', handleNewUserSubmit);
});

async function loadDepartmentsForForm() {
    try {
        const response = await fetch('/api/lookups/lookup');
        if (checkAuthResponse(response)) return;
        if (!response.ok) return;
        const data = await response.json();

        const select = document.getElementById('newUserDepartment');
        select.innerHTML = '<option value="">-- בחר מחלקה --</option>' +
            (data.departments || []).map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    } catch (error) {
        console.error('שגיאה בטעינת מחלקות:', error);
    }
}

async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    try {
        const response = await fetch('/api/users');
        if (checkAuthResponse(response)) return;

        if (response.status === 403) {
            tbody.innerHTML = '<tr><td colspan="6" class="placeholder-text" style="text-align:center;">אין לך הרשאה לצפות בדף זה</td></tr>';
            return;
        }
        if (!response.ok) throw new Error('שגיאה בטעינת המשתמשים');

        const users = await response.json();
        if (!Array.isArray(users) || users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="placeholder-text" style="text-align:center;">אין משתמשים</td></tr>';
            return;
        }

        tbody.innerHTML = users.map(u => `
            <tr>
                <td>${u.EmployeeId}</td>
                <td>${u.UserName} ${u.UserLastName}</td>
                <td>${u.Email || '—'}</td>
                <td>${u.DepartmentName || '—'}</td>
                <td>${u.PermissionName || u.PermissionCode}</td>
                <td>${u.MustChangePassword ? '<span class="badge pass-temp">סיסמה זמנית</span>' : '<span class="badge pass-ok">הוגדרה</span>'}</td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('שגיאה בטעינת משתמשים:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="placeholder-text" style="text-align:center;">שגיאה בטעינה</td></tr>';
    }
}

function openNewUserPanel() {
    document.getElementById('newUserPanel').classList.remove('hidden');
    document.getElementById('newUserPanel').scrollIntoView({ behavior: 'smooth' });
}
function closeNewUserPanel() {
    document.getElementById('newUserPanel').classList.add('hidden');
    document.getElementById('newUserForm').reset();
}
function closeTempPasswordPanel() {
    document.getElementById('tempPasswordPanel').classList.add('hidden');
}

async function handleNewUserSubmit(e) {
    e.preventDefault();

    const payload = {
        EmployeeId: document.getElementById('newUserEmployeeId').value.trim(),
        IdNumber: document.getElementById('newUserIdNumber').value.trim(),
        UserName: document.getElementById('newUserFirstName').value.trim(),
        UserLastName: document.getElementById('newUserLastName').value.trim(),
        Email: document.getElementById('newUserEmail').value.trim(),
        DepartmentCode: document.getElementById('newUserDepartment').value,
        PermissionCode: document.getElementById('newUserPermission').value
    };

    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (checkAuthResponse(response)) return;
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            alert(data.error || 'שגיאה ביצירת המשתמש');
            return;
        }

        closeNewUserPanel();
        await loadUsers();

        document.getElementById('tempPassEmployeeId').textContent = data.employeeId;
        document.getElementById('tempPassValue').textContent = data.tempPassword;
        document.getElementById('tempPasswordPanel').classList.remove('hidden');
        document.getElementById('tempPasswordPanel').scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        console.error('שגיאה ביצירת משתמש:', error);
        alert('שגיאה: ' + error.message);
    }
}
