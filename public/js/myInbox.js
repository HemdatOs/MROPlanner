// public/js/myInbox.js

document.addEventListener('DOMContentLoaded', () => {
    loadProfile();
    loadAssignedIssues();
    loadAssignedMissions();
    loadOpenedIssues();
    loadOpenedMissions();
    setupInboxTabs();
    loadMissionLookups();
    document.getElementById('missionModalForm')?.addEventListener('submit', handleMissionModalSubmit);
});

let missionStatusOptions = [];
let missionPriorityOptions = [];

async function loadMissionLookups() {
    try {
        const response = await fetch('/api/lookups/lookup');
        if (checkAuthResponse(response)) return;
        if (!response.ok) return;
        const data = await response.json();
        missionStatusOptions = data.missionStatuses || [];
        missionPriorityOptions = data.missionPriorities || [];

        document.getElementById('missionModalStatus').innerHTML =
            missionStatusOptions.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        document.getElementById('missionModalPriority').innerHTML =
            missionPriorityOptions.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    } catch (error) {
        console.error('שגיאה בטעינת רשימות עזר למשימות:', error);
    }
}

async function openMissionModal(missionId) {
    try {
        const response = await fetch(`/api/missions/${missionId}`);
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת הקריאה');

        const mission = await response.json();

        document.getElementById('missionModalTitle').textContent = `קריאה #${mission.MissionId}`;
        document.getElementById('missionModalDescription').value = mission.Description || '';
        document.getElementById('missionModalStatus').value = mission.StatusId || '';
        document.getElementById('missionModalPriority').value = mission.PriorityId || '';
        document.getElementById('missionModalComment').value = mission.HandlerComment || '';
        document.getElementById('missionModalForm').dataset.missionId = mission.MissionId;

        document.getElementById('missionModalOverlay').classList.remove('hidden');
    } catch (error) {
        console.error('שגיאה בפתיחת הקריאה:', error);
        alert('שגיאה בטעינת הקריאה');
    }
}

function closeMissionModal() {
    document.getElementById('missionModalOverlay').classList.add('hidden');
}

async function handleMissionModalSubmit(e) {
    e.preventDefault();
    const missionId = e.target.dataset.missionId;
    if (!missionId) return;

    const payload = {
        Description: document.getElementById('missionModalDescription').value,
        StatusId: document.getElementById('missionModalStatus').value,
        PriorityId: document.getElementById('missionModalPriority').value,
        HandlerComment: document.getElementById('missionModalComment').value
    };

    try {
        const response = await fetch(`/api/missions/${missionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בשמירת הקריאה');

        closeMissionModal();
        await loadAssignedMissions();
        await loadOpenedMissions();

    } catch (error) {
        console.error('שגיאה בשמירת קריאה:', error);
        alert('שגיאה בשמירה: ' + error.message);
    }
}

function setupInboxTabs() {
    const tabs = document.querySelectorAll('.dashboard-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.dashboard-tab-content').forEach(c => c.classList.add('hidden'));
            document.getElementById(`tab-${tab.dataset.tab}`)?.classList.remove('hidden');
        });
    });
}

async function loadProfile() {
    const card = document.getElementById('profileCard');
    try {
        const response = await fetch('/api/auth/profile');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת הפרופיל');

        const p = await response.json();
        card.innerHTML = `
            <div class="profile-field"><div class="profile-label">שם</div><div class="profile-value">${p.UserName || '—'}</div></div>
            <div class="profile-field"><div class="profile-label">שם משפחה</div><div class="profile-value">${p.UserLastName || '—'}</div></div>
            <div class="profile-field"><div class="profile-label">מחלקה</div><div class="profile-value">${p.DepartmentName || '—'}</div></div>
            <div class="profile-field"><div class="profile-label">מייל</div><div class="profile-value">${p.Email || '—'}</div></div>
            <div class="profile-field"><div class="profile-label">מספר עובד</div><div class="profile-value">${p.EmployeeId || '—'}</div></div>
        `;
    } catch (error) {
        console.error('שגיאה בטעינת הפרופיל:', error);
        card.innerHTML = '<p class="placeholder-text">שגיאה בטעינת הפרופיל</p>';
    }
}

// =========================================================================
// תקלות - מוקצות אלי / שפתחתי (תצוגה מקוננת עם פעולות, זהה לדוחות)
// =========================================================================
function renderNestedIssues(containerId, issues) {
    const container = document.getElementById(containerId);
    if (!Array.isArray(issues) || issues.length === 0) {
        container.innerHTML = '<p class="placeholder-text">אין כרגע</p>';
        return;
    }

    container.innerHTML = issues.map(issue => `
        <div class="nested-issue-card">
            <div class="nested-issue-header">
                <span class="nested-issue-number">#${issue.IssueNumber}</span>
                <span class="nested-issue-title">${issue.Title || ''}</span>
                <span class="badge">${issue.StatusName || '—'}</span>
                ${issue.VisitId ? `<a class="btn-edit-issue" href="manage_issues.html?visitId=${encodeURIComponent(issue.VisitId)}&issueNumber=${encodeURIComponent(issue.IssueNumber)}">✏️ ערוך</a>` : ''}
            </div>
            <div class="nested-issue-meta">
                ✈️ ${issue.TailNumber || '—'} &nbsp;·&nbsp;
                🏢 ${issue.DepartmentName || '—'} &nbsp;·&nbsp;
                חומרה: ${issue.SeverityName || '—'} &nbsp;·&nbsp;
                דחיפות: ${issue.PriorityName || '—'} &nbsp;·&nbsp;
                ${issue.CreatedAt ? new Date(issue.CreatedAt).toLocaleDateString('he-IL') : ''}
            </div>
            ${issue.actions && issue.actions.length > 0 ? `
                <div class="nested-actions-list">
                    ${issue.actions.map((act, idx) => `
                        <div class="nested-action-row">
                            <span class="nested-action-index">${idx + 1}.</span>
                            <span class="nested-action-desc">${act.ActionDescription || ''}</span>
                            <span class="nested-action-status badge">${act.ActionStatusName || '—'}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `).join('');
}

async function loadAssignedIssues() {
    try {
        const response = await fetch('/api/reports/my-issues');
        if (checkAuthResponse(response)) return;
        const issues = response.ok ? await response.json() : [];
        renderNestedIssues('assignedIssues', issues);
    } catch (error) {
        console.error('שגיאה בטעינת תקלות מוקצות:', error);
        document.getElementById('assignedIssues').innerHTML = '<p class="placeholder-text">שגיאה בטעינה</p>';
    }
}

async function loadOpenedIssues() {
    try {
        const response = await fetch('/api/reports/my-opened-issues');
        if (checkAuthResponse(response)) return;
        const issues = response.ok ? await response.json() : [];
        renderNestedIssues('openedIssues', issues);
    } catch (error) {
        console.error('שגיאה בטעינת תקלות שנפתחו:', error);
        document.getElementById('openedIssues').innerHTML = '<p class="placeholder-text">שגיאה בטעינה</p>';
    }
}

// =========================================================================
// קריאות כלליות (משימות) - מוקצות אלי / שפתחתי
// =========================================================================
function renderMissions(containerId, missions) {
    const container = document.getElementById(containerId);
    if (!Array.isArray(missions) || missions.length === 0) {
        container.innerHTML = '<p class="placeholder-text">אין כרגע</p>';
        return;
    }

    container.innerHTML = missions.map(m => `
        <div class="mission-row" onclick="openMissionModal(${m.MissionId})">
            <span class="mission-id">#${m.MissionId}</span>
            <span class="mission-desc">${m.Description || ''}</span>
            <span class="badge">${m.StatusName || '—'}</span>
            <span class="mission-meta">
                ${m.DepartmentName || '—'} · ${m.CreatedAt ? new Date(m.CreatedAt).toLocaleDateString('he-IL') : ''}<br>
                נפתח ע"י: ${m.created_by_name || '—'}${m.created_by_email ? ' (' + m.created_by_email + ')' : ''}<br>
                מוקצה ל: ${m.assigned_to_name || 'טרם שובץ'}
            </span>
        </div>
    `).join('');
}

async function loadAssignedMissions() {
    try {
        const response = await fetch('/api/missions?assignedToMe=true');
        if (checkAuthResponse(response)) return;
        const missions = response.ok ? await response.json() : [];
        renderMissions('assignedMissions', missions);
    } catch (error) {
        console.error('שגיאה בטעינת קריאות מוקצות:', error);
        document.getElementById('assignedMissions').innerHTML = '<p class="placeholder-text">שגיאה בטעינה</p>';
    }
}

async function loadOpenedMissions() {
    try {
        const response = await fetch('/api/missions?createdByMe=true');
        if (checkAuthResponse(response)) return;
        const missions = response.ok ? await response.json() : [];
        renderMissions('openedMissions', missions);
    } catch (error) {
        console.error('שגיאה בטעינת קריאות שנפתחו:', error);
        document.getElementById('openedMissions').innerHTML = '<p class="placeholder-text">שגיאה בטעינה</p>';
    }
}
