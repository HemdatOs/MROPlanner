// public/js/missions.js

let lookupsData = {};
let allMissions = [];
let currentUser = null; // המשתמש המחובר כרגע (מתוך sessionStorage, בדיוק כמו homePage.js)

document.addEventListener('DOMContentLoaded', () => {
    loadCurrentUser();
    loadLookupsData();
    loadMissions();

    document.getElementById('missionForm')?.addEventListener('submit', handleMissionFormSubmit);

    document.getElementById('missionDepartment')?.addEventListener('change', (e) =>
        loadDepartmentEmployees(e.target.value, 'missionAssignTo'));

    ['filterMissionStatus', 'filterMissionPriority', 'filterMissionCategory'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', renderMissionsTable);
    });
});

// --- משתמש מחובר: "נפתח ע"י" נגזר מכאן, לא מדרופדאון ---
function loadCurrentUser() {
    const userRaw = sessionStorage.getItem('loggedInUser');
    if (!userRaw) return;
    try {
        currentUser = JSON.parse(userRaw);
        const display = document.getElementById('missionCreatorDisplay');
        if (display) display.textContent = currentUser.fullName || currentUser.employeeId || '—';
    } catch (err) {
        console.error('שגיאה בקריאת פרטי המשתמש המחובר:', err);
    }
}

function populateSelect(selectId, list, placeholder) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = `<option value="">${placeholder}</option>` +
        (list || []).map(item => `<option value="${item.id}">${item.name}</option>`).join('');
}

function populateFilterSelect(selectId, list) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '<option value="">הכל</option>' +
        (list || []).map(item => `<option value="${item.id}">${item.name}</option>`).join('');
}

async function loadLookupsData() {
    try {
        const response = await fetch('/api/lookups/lookup');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת נתוני עזר');

        lookupsData = await response.json();

        populateSelect('missionCategory', lookupsData.missionCategories, '-- בחר סוג --');
        populateSelect('missionPriority', lookupsData.missionPriorities, '-- בחר דחיפות --');
        populateSelect('missionStatus', lookupsData.missionStatuses, '-- בחר סטטוס --');
        populateSelect('missionDepartment', lookupsData.departments, '-- בחר מחלקה --');

        populateFilterSelect('filterMissionStatus', lookupsData.missionStatuses);
        populateFilterSelect('filterMissionPriority', lookupsData.missionPriorities);
        populateFilterSelect('filterMissionCategory', lookupsData.missionCategories);

    } catch (error) {
        console.error('שגיאה בטעינת lookups:', error);
    }
}

async function loadDepartmentEmployees(deptCode, targetSelectId, preselectUserId = null) {
    const select = document.getElementById(targetSelectId);
    if (!select) return;

    if (!deptCode) {
        select.innerHTML = '<option value="">בחר מחלקה קודם...</option>';
        return;
    }

    select.innerHTML = '<option value="">טוען עובדי מחלקה...</option>';

    try {
        const response = await fetch(`/api/maintanace_calls/departments/${encodeURIComponent(deptCode)}/users`);
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת עובדי המחלקה');

        const data = await response.json();
        const usersList = Array.isArray(data) ? data : (data.users || []);

        select.innerHTML = '<option value="">בחר עובד...</option>';
        usersList.forEach(user => {
            const option = document.createElement('option');
            const userId = user.UserId ?? user.userId ?? user.id;
            const fullName = user.displayName || user.fullName ||
                [user.UserName ?? user.userName, user.UserLastName ?? user.userLastName].filter(Boolean).join(' ');
            option.value = userId;
            option.textContent = fullName || userId;
            select.appendChild(option);
        });

        if (preselectUserId) select.value = preselectUserId;

    } catch (error) {
        console.error('שגיאה בטעינת עובדי מחלקה:', error);
        select.innerHTML = '<option value="">שגיאה בטעינה</option>';
    }
}

async function loadMissions() {
    try {
        const response = await fetch('/api/missions');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת קריאות');

        allMissions = await response.json();
        renderMissionsTable();

    } catch (error) {
        console.error('שגיאה בטעינת משימות:', error);
        const tbody = document.getElementById('missionsTableBody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="placeholder-text" style="text-align:center;">שגיאה בטעינת הקריאות</td></tr>`;
    }
}

function calcAndRenderMissionStats(list) {
    const total = list.length;
    const open = list.filter(m => !m.CloseAt).length;
    const critical = list.filter(m => String(m.PriorityName || '').includes('קריטי')).length;

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setText('statMissionsTotal', total);
    setText('statMissionsOpen', open);
    setText('statMissionsCritical', critical);
}

function renderMissionsTable() {
    const tbody = document.getElementById('missionsTableBody');
    if (!tbody) return;

    const statusFilter = document.getElementById('filterMissionStatus')?.value;
    const priorityFilter = document.getElementById('filterMissionPriority')?.value;
    const categoryFilter = document.getElementById('filterMissionCategory')?.value;

    let filtered = allMissions;
    if (statusFilter) filtered = filtered.filter(m => String(m.StatusId) === statusFilter);
    if (priorityFilter) filtered = filtered.filter(m => String(m.PriorityId) === priorityFilter);
    if (categoryFilter) filtered = filtered.filter(m => String(m.MissionCategoryID) === categoryFilter);

    calcAndRenderMissionStats(filtered);

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="placeholder-text" style="text-align:center;">אין קריאות להצגה</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(m => `
        <tr onclick="loadMissionIntoForm(${m.MissionId})">
            <td>#${m.MissionId}</td>
            <td class="col-desc">${m.Description || ''}</td>
            <td><span class="badge">${m.CategoryName || '—'}</span></td>
            <td>${m.DepartmentName || '—'}</td>
            <td><span class="badge">${m.PriorityName || '—'}</span></td>
            <td><span class="badge">${m.StatusName || '—'}</span></td>
            <td>${m.assigned_to_name || 'טרם שובץ'}</td>
            <td>${m.CreatedAt ? new Date(m.CreatedAt).toLocaleDateString('he-IL') : '—'}</td>
        </tr>
    `).join('');
}

// =========================================================================
// פאנל אחד, שני מצבים: יצירה חדשה / עריכת קריאה קיימת
// =========================================================================
function openMissionPanelForCreate() {
    document.getElementById('missionForm').reset();
    document.getElementById('editingMissionId').value = '';
    document.getElementById('missionAssignTo').innerHTML = '<option value="">בחר מחלקה קודם...</option>';
    document.getElementById('missionPanelTitle').textContent = '🎧 פתיחת קריאה חדשה';
    document.getElementById('missionSubmitBtn').textContent = 'פתח קריאה';
    document.getElementById('missionFormPanel').classList.remove('hidden');
    document.getElementById('missionFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadMissionIntoForm(missionId) {
    try {
        const response = await fetch(`/api/missions/${missionId}`);
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בשליפת הקריאה');

        const mission = await response.json();

        document.getElementById('editingMissionId').value = mission.MissionId;
        document.getElementById('missionDescription').value = mission.Description || '';
        document.getElementById('missionCategory').value = mission.MissionCategoryID || '';
        document.getElementById('missionPriority').value = mission.PriorityId || '';
        document.getElementById('missionStatus').value = mission.StatusId || '';
        document.getElementById('missionDepartment').value = mission.DepartmentId || '';
        document.getElementById('missionHandlerComment').value = mission.HandlerComment || '';

        await loadDepartmentEmployees(mission.DepartmentId, 'missionAssignTo', mission.AssingTo);

        document.getElementById('missionPanelTitle').textContent = `🎧 עריכת קריאה #${mission.MissionId}`;
        document.getElementById('missionSubmitBtn').textContent = 'שמור שינויים';
        document.getElementById('missionFormPanel').classList.remove('hidden');
        document.getElementById('missionFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
        console.error('שגיאה בטעינת הקריאה לעריכה:', error);
    }
}

function closeMissionPanel() {
    document.getElementById('missionFormPanel').classList.add('hidden');
    document.getElementById('missionForm').reset();
    document.getElementById('editingMissionId').value = '';
}

async function handleMissionFormSubmit(e) {
    e.preventDefault();
    const editingId = document.getElementById('editingMissionId').value;

    const payload = {
        Description: document.getElementById('missionDescription').value,
        MissionCategoryID: document.getElementById('missionCategory').value,
        StatusId: document.getElementById('missionStatus').value,
        PriorityId: document.getElementById('missionPriority').value,
        DepartmentId: document.getElementById('missionDepartment').value,
        AssingTo: document.getElementById('missionAssignTo').value,
        HandlerComment: document.getElementById('missionHandlerComment').value
    };

    const isEdit = !!editingId;
    if (!isEdit) {
        payload.CreatedBy = currentUser?.userId || currentUser?.UserId;
        if (!payload.CreatedBy) {
            alert('לא זוהה משתמש מחובר - נא להתחבר מחדש');
            return;
        }
    }

    try {
        const response = await fetch(isEdit ? `/api/missions/${editingId}` : '/api/missions', {
            method: isEdit ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (checkAuthResponse(response)) return;
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `שגיאת שרת: ${response.status}`);
        }

        alert(isEdit ? 'השינויים נשמרו בהצלחה!' : 'הקריאה נפתחה בהצלחה!');
        closeMissionPanel();
        loadMissions();

    } catch (error) {
        console.error('שגיאה בשמירת קריאה:', error);
        alert('שגיאה בשמירה: ' + error.message);
    }
}
