document.addEventListener('DOMContentLoaded', () => {
    // 1. בדיקה שקיים משתמש מחובר ב-sessionStorage
    const userRaw = sessionStorage.getItem('loggedInUser');
    if (!userRaw) {
        // אם המשתמש לא מחובר, החזרה למסך הכניסה
        window.location.href = 'login.html';
        return;
    }

    const user = JSON.parse(userRaw);

    // 2. הצגת שם המשתמש בברכה
    const greetingElem = document.getElementById('userGreeting');
    if (greetingElem) {
        greetingElem.textContent = `שלום, ${user.fullName} (עובד: ${user.employeeId})`;
    }

    // 3. חשיפת כרטיס מנהל במידה ויש הרשאה מתאימה (PermissionCode === 1)
    const adminCard = document.getElementById('adminCard');
    if (adminCard && user.permissionCode === 1) {
        adminCard.classList.remove('hidden');
    }

    // 3.5 הסתרת מסכים שלא רלוונטיים לעובד רגיל (Technician, קוד 6) - נוחות בממשק בלבד.
    // ⚠️ זו לא הגנת אבטחה - חייבת בדיקה מקבילה בשרת בכל נתיב רגיש, בדיוק כמו requireAdmin ב-users.js
    if (user.permissionCode === 6) {
        document.querySelectorAll('.technician-hidden').forEach(el => el.classList.add('hidden'));
    }

    // 4. טיפול בלחיצה על התנתקות
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            sessionStorage.removeItem('loggedInUser');
            window.location.href = 'login.html';
        });
    }

    // 5. טעינת דשבורד מפת ההאנגר
    loadHangarDashboard();

    // 6. טעינת ספירת ההתראות (לא נקראות)
    loadUnreadNotifCount();
    setInterval(loadUnreadNotifCount, 60000); // בדיקה מחודשת כל דקה
});

// --- פעמון התראות ---

async function loadUnreadNotifCount() {
    try {
        const response = await fetch('/api/notifications/unread-count');
        if (checkAuthResponse(response)) return;
        if (!response.ok) return;
        const data = await response.json();

        const badge = document.getElementById('notifBadge');
        if (data.count > 0) {
            badge.textContent = data.count > 9 ? '9+' : data.count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    } catch (error) {
        console.error('שגיאה בטעינת ספירת התראות:', error);
    }
}

async function toggleNotifDropdown() {
    const dropdown = document.getElementById('notifDropdown');
    const isOpening = dropdown.classList.contains('hidden');
    dropdown.classList.toggle('hidden');
    if (isOpening) await loadNotifList();
}

async function loadNotifList() {
    const list = document.getElementById('notifList');
    try {
        const response = await fetch('/api/notifications');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת ההתראות');

        const notifications = await response.json();
        if (!Array.isArray(notifications) || notifications.length === 0) {
            list.innerHTML = '<p class="notif-empty">אין התראות</p>';
            return;
        }

        list.innerHTML = notifications.map(n => `
            <a class="notif-item ${n.IsRead ? '' : 'unread'}" onclick="handleNotifClick(${n.NotificationId}, '${n.Link || ''}')">
                ${n.Message}
                <span class="notif-time">${new Date(n.CreatedAt).toLocaleString('he-IL')}</span>
            </a>
        `).join('');
    } catch (error) {
        console.error('שגיאה בטעינת רשימת התראות:', error);
        list.innerHTML = '<p class="notif-empty">שגיאה בטעינה</p>';
    }
}

async function handleNotifClick(notificationId, link) {
    try {
        await fetch(`/api/notifications/${notificationId}/read`, { method: 'POST' });
    } catch (error) {
        console.error('שגיאה בסימון התראה כנקראה:', error);
    }
    if (link) window.location.href = link;
    else await loadUnreadNotifCount();
}

async function markAllNotificationsRead() {
    try {
        await fetch('/api/notifications/read-all', { method: 'POST' });
        await loadNotifList();
        await loadUnreadNotifCount();
    } catch (error) {
        console.error('שגיאה בסימון כל ההתראות:', error);
    }
}

// סגירת הדרופדאון בלחיצה מחוץ לו
document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.notif-bell-wrap');
    if (wrap && !wrap.contains(e.target)) {
        document.getElementById('notifDropdown')?.classList.add('hidden');
    }
});

// --- דשבורד מפת ההאנגר ---

// צבע קבוע ומשמעותי לכל סטטוס, לפי מה שהוא אומר (לא לפי סדר הופעה) - אחיד בכל האתר
function getHangarStatusColor(statusName) {
    const name = String(statusName || '').trim();
    if (name.includes('סגר')) return '#15803d';
    if (name.includes('בוטל')) return '#dc2626';
    if (name.includes('טיפול')) return '#d97706';
    if (name.includes('המתנה') || name.includes('ממתינ')) return '#7c3aed';
    if (name.includes('פתוח')) return '#1758c9';
    return '#64748b';
}

// מפרקת מזהה כמו "HANGAR-A-01" לעמודה (A) ולמספר עמדה (1)
function parseHangarLocationId(id) {
    const match = /^HANGAR-([A-Za-z]+)-(\d+)$/.exec(id || '');
    if (!match) return { section: 'כללי', slot: id || '?' };
    return { section: match[1], slot: parseInt(match[2], 10) };
}

async function loadHangarDashboard() {
    const container = document.getElementById('hangarGrid');
    if (!container) return;

    try {
        const response = await fetch('/api/hangar/dashboard');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת נתוני ההאנגר');

        const bays = await response.json();
        renderHangarDashboard(bays);

    } catch (error) {
        console.error('שגיאה בטעינת דשבורד ההאנגר:', error);
        container.innerHTML = '<p class="hangar-loading">שגיאה בטעינת מפת ההאנגר</p>';
    }
}

function renderHangarDashboard(bays) {
    const container = document.getElementById('hangarGrid');
    if (!container) return;

    if (!Array.isArray(bays) || bays.length === 0) {
        container.innerHTML = '<p class="hangar-loading">לא הוגדרו עדיין עמדות באנגר במערכת</p>';
        return;
    }

    const sections = {};
    bays.forEach(bay => {
        const { section, slot } = parseHangarLocationId(bay.HangarLocationID);
        if (!sections[section]) sections[section] = [];
        sections[section].push({ ...bay, slot });
    });
    Object.values(sections).forEach(list => list.sort((a, b) => a.slot - b.slot));

    container.innerHTML = '';

    Object.keys(sections).sort().forEach(sectionName => {
        const column = document.createElement('div');
        column.className = 'hangar-section-column';
        column.innerHTML = `<div class="section-label">עמדה ${sectionName}</div>`;

        sections[sectionName].forEach(bay => {
            const rowEl = document.createElement('div');
            rowEl.className = 'hangar-bay-row';
            rowEl.innerHTML = `<span class="bay-row-number">${bay.slot}</span>`;

            const bayEl = document.createElement('div');

            if (!bay.visit) {
                bayEl.className = 'hangar-bay empty';
                bayEl.innerHTML = `
                    <div class="bay-position-label">${bay.HangarPosition || bay.HangarLocationID}</div>
                    <div>פנוי</div>
                `;
                rowEl.appendChild(bayEl);
                column.appendChild(rowEl);
                return;
            }

            bayEl.className = 'hangar-bay occupied';
            const statusCounts = bay.visit.statusCounts || [];
            const hasIssues = statusCounts.length > 0;

            bayEl.innerHTML = `
                ${hasIssues
                    ? '<div class="bay-donut-wrap"><canvas class="bay-donut"></canvas></div>'
                    : '<div class="bay-no-issues" title="אין תקלות חדשות עדיין">✓<span>אין תקלות</span></div>'}
                <div class="bay-info">
                    <div class="bay-tail">✈️ ${bay.visit.TailNumber || '—'} (${bay.visit.Model || ''})</div>
                    <div class="bay-meta">
                        ${bay.visit.CustomerName || ''}<br>
                        ${bay.HangarPosition || bay.HangarLocationID}<br>
                        כניסה: ${bay.visit.EntryDate ? new Date(bay.visit.EntryDate).toLocaleDateString('he-IL') : '—'}
                    </div>
                </div>
            `;
            bayEl.addEventListener('click', () => {
                window.location.href = `manage_issues.html?visitId=${encodeURIComponent(bay.visit.VisitID)}`;
            });

            rowEl.appendChild(bayEl);
            column.appendChild(rowEl);

            if (hasIssues && typeof Chart !== 'undefined') {
                const canvas = bayEl.querySelector('.bay-donut');
                const labels = statusCounts.map(s => s.StatusName);
                const data = statusCounts.map(s => s.count);
                const colors = labels.map(getHangarStatusColor);

                new Chart(canvas, {
                    type: 'doughnut',
                    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 1 }] },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false }, tooltip: { enabled: true } }
                    }
                });
            }
        });

        container.appendChild(column);
    });
}