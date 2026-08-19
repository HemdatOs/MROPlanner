let allIssues = [];
let lookupsData = {};
let currentIssueNumberInModal = null;
let attachmentsByActionId = {}; // 'issue' -> [..], <ActionId> -> [..]

document.addEventListener('DOMContentLoaded', async () => {
    // 🛡️ סדר קריטי: lookupsData חייב להיות מוכן *לפני* שביקור נטען אוטומטית מ-URL,
    // אחרת הדונאט/הטבלה מנסים לתרגם סטטוסים למראה מ-lookupsData שעדיין ריק (= "לא ידוע" לכולם)
    await loadLookupsData();
    await loadActiveVisits();
    setupEventListeners();
});

// 1. הגדרת מאזינים לאירועים בדף
function setupEventListeners() {
    const visitSelect = document.getElementById('visitSelect');
    if (visitSelect) {
        visitSelect.addEventListener('change', (e) => {
            const selectedVisitId = e.target.value;
            if (selectedVisitId) {
                loadIssuesForVisit(selectedVisitId);
            } else {
                allIssues = [];
                renderIssuesTable([]);
                toggleFilters(false);
            }
        });
    }

    // מאזינים לפילטרים בכותרות הטבלה
    ['filterStatus', 'filterSeverity', 'filterPriority'].forEach(id => {
        const elem = document.getElementById(id);
        if (elem) elem.addEventListener('change', filterIssues);
    });

    // מאזין לשליחת טופס העריכה ב-Modal
    const editForm = document.getElementById('editForm');
    if (editForm) {
        editForm.addEventListener('submit', handleFormSubmit);
    }

    // מאזין לשינוי מחלקה במודל העריכה - מרענן את רשימת הטכנאים לשיבוץ
    const editDept = document.getElementById('editDepartmentCode');
    if (editDept) {
        editDept.addEventListener('change', () => loadDepartmentEmployeesForEdit(editDept.value));
    }
}

// 2. טעינת ביקורים פעילים
async function loadActiveVisits() {
    const visitSelect = document.getElementById('visitSelect');
    if (!visitSelect) return;

    try {
        const response = await fetch('/api/visits/active');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת הביקורים');

        const rawData = await response.json();
        const visits = Array.isArray(rawData) ? rawData : (rawData.data || []);

        visitSelect.innerHTML = '<option value="">-- בחר ביקור / מספר זנב --</option>';

        visits.forEach(visit => {
            const option = document.createElement('option');
            option.value = visit.VisitID;
            option.textContent = `${visit.VisitID} - זנב ${visit.TailNumber} (${visit.CustomerName})`;
            visitSelect.appendChild(option);
        });

        // 🟢 חדש: אם הגענו עם ?visitId=... (לדוגמה מדשבורד ההאנגר בדף הבית) - בוחרים אותו אוטומטית
        const urlParams = new URLSearchParams(window.location.search);
        const preselectedVisitId = urlParams.get('visitId');
        if (preselectedVisitId && visitSelect.querySelector(`option[value="${CSS.escape(preselectedVisitId)}"]`)) {
            visitSelect.value = preselectedVisitId;
            await loadIssuesForVisit(preselectedVisitId);

            // 🟢 חדש: אם יש גם ?issueNumber=... - פותחים ישר את המודל של אותה תקלה (עריכה, או צפייה אם סגורה)
            const preselectedIssueNumber = urlParams.get('issueNumber');
            if (preselectedIssueNumber) {
                openEditModal(preselectedIssueNumber);
            }
        }

    } catch (error) {
        console.error('שגיאה בטעינת ביקורים:', error);
        visitSelect.innerHTML = '<option value="">שגיאה בטעינת הביקורים</option>';
    }
}

// 3. טעינת ה-Lookups (פילטרים + Modal)
async function loadLookupsData() {
    try {
        const response = await fetch('/api/lookups/lookup'); 
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת Lookups');

        lookupsData = await response.json();

        // אכלוס פילטרים בכותרות הטבלה
        populateSelect('filterStatus', lookupsData.statuses, 'הכל');
        populateSelect('filterSeverity', lookupsData.severities, 'הכל');
        populateSelect('filterPriority', lookupsData.priorities, 'הכל');

        // אכלוס השדות בתוך Modal העריכה
        populateSelect('editStatusID', lookupsData.statuses, '-- בחר סטטוס --');
        populateSelect('editFaultCategory', lookupsData.categories, '-- בחר קטגוריה --');
        populateSelect('editSeverityId', lookupsData.severities, '-- בחר חומרה --');
        populateSelect('editPriorityId', lookupsData.priorities, '-- בחר דחיפות --');
        populateSelect('editDepartmentCode', lookupsData.departments, '-- בחר מחלקה --');

    } catch (error) {
        console.error('שגיאה בטעינת Lookups:', error);
    }
}

function populateSelect(elementId, items, defaultText) {
    const select = document.getElementById(elementId);
    if (!select || !items) return;

    select.innerHTML = `<option value="">${defaultText}</option>`;

    items.forEach(item => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        select.appendChild(option);
    });
}

function toggleFilters(enable) {
    ['filterStatus', 'filterSeverity', 'filterPriority'].forEach(id => {
        const elem = document.getElementById(id);
        if (elem) elem.disabled = !enable;
    });
}

// 4. טעינת התקלות מהשרת לביקור שנבחר
async function loadIssuesForVisit(visitId) {
    const tbody = document.getElementById('issuesTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">טוען תקלות...</td></tr>';

    try {
        const response = await fetch(`/api/maintanace_calls/visit/${visitId}`);
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת תקלות');

        const rawData = await response.json();

        if (Array.isArray(rawData)) {
            allIssues = rawData;
        } else if (rawData && Array.isArray(rawData.issues)) {
            allIssues = rawData.issues;
        } else if (rawData && Array.isArray(rawData.data)) {
            allIssues = rawData.data;
        } else {
            allIssues = [];
        }

        resetFilters();
        toggleFilters(true);

        renderIssuesTable(allIssues);

    } catch (error) {
        console.error('Error loading issues:', error);
        if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:red;">שגיאה בטעינת הנתונים מהשרת</td></tr>';
    }
}

// פונקציית עזר לשליפת שם מתוך רשימת Lookups לפי ID
function getLookupName(list, id, fallbackValue) {
    if (!id) return fallbackValue || '-';
    if (!list || !Array.isArray(list)) return fallbackValue || id;
    
    const item = list.find(i => String(i.id) === String(id) || String(i.code) === String(id));
    return item ? item.name : (fallbackValue || id);
}

// 5. רינדור טבלת התקלות (בדיוק 10 עמודות מיושרות)
function renderIssuesTable(issues) {
    const tbody = document.getElementById('issuesTableBody');
    if (!tbody) return;

    calcAndRenderStats(issues); // 🟢 עדכון שורת הסטטיסטיקה בכל רינדור (כולל אחרי סינון)
    renderVisitStatusDonut(issues); // 🟢 דונאט כללי - סטטוסים על פני כל הביקור
    renderDeptStatusDonuts(issues); // 🟢 דונאט נפרד לכל מחלקה - פילוג סטטוסים בתוכה

    if (!Array.isArray(issues) || issues.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;">אין תקלות להצגה או התואמות את הסינון</td></tr>`;
        return;
    }

    tbody.innerHTML = issues.map(issue => {
        const issueNumber = issue.issue_number || issue.IssueNumber;
        const title = issue.title || issue.Title || '-';
        
        // --- השינוי מתחיל כאן ---
        
        // 1. מי פתח את התקלה (כולל ניסיון לשלוף שם מ-Lookups וקיצור ה-UUID)
        const openedByText = issue.opened_by || 
                             issue.OpenedByName || 
                             getLookupName(lookupsData.users, issue.createdBy, null) || 
                             (issue.createdBy ? `עובד #${String(issue.createdBy).substring(0, 8)}...` : '-');

        // 2. מי צריך לטפל (תופס גם את assingTo מה-DB וגם מנסה למצוא שם)
        const rawAssignedId = issue.assigned_to || issue.AssignedTo || issue.assingTo;
        const assignedToText = (rawAssignedId && rawAssignedId !== 'טרם שובץ')
            ? (issue.assigned_to || getLookupName(lookupsData.users, rawAssignedId, `עובד #${String(rawAssignedId).substring(0, 8)}...`))
            : 'טרם שובץ';
            
        // --- השינוי נגמר כאן ---

        const deptText = issue.department_name || issue.DepartmentName || getLookupName(lookupsData.departments, issue.DepartmentCode, '-');
        const statusText = issue.status_name || issue.StatusName || getLookupName(lookupsData.statuses, issue.StatusID, 'פתוחה');
        const severityText = issue.severity_name || issue.SeverityName || getLookupName(lookupsData.severities, issue.SeverityId, 'רגילה');
        const priorityText = issue.priority_name || issue.PriorityName || getLookupName(lookupsData.priorities, issue.PriorityId, 'רגילה');
        const actionsCount = (issue.actions_count !== undefined) ? issue.actions_count : (issue.ActionsCount || 0);

        const statusId = issue.StatusID || issue.status_id || '';
        const severityId = issue.SeverityId || issue.severity_id || '';
        const priorityId = issue.PriorityId || issue.priority_id || '';

        return `
            <tr data-issue-id="${issueNumber}">
                <!-- 1. מז"ה תקלה -->
                <td><b>#${issueNumber}</b></td>
                
                <!-- 2. כותרת -->
                <td class="col-title">${title}</td>
                
                <!-- 3. נפתח ע"י -->
                <td>${openedByText}</td>
                
                <!-- 4. מחלקה -->
                <td>${deptText}</td>
                
                <!-- 5. סטטוס -->
                <td><span class="badge status-${statusId}">${statusText}</span></td>
                
                <!-- 6. חומרה -->
                <td><span class="badge severity-${severityId}">${severityText}</span></td>
                
                <!-- 7. דחיפות -->
                <td><span class="badge priority-${priorityId}">${priorityText}</span></td>

                <!-- 8. מי צריך לטפל -->
                <td>${assignedToText}</td>
                
                <!-- 9. מס' פעולות -->
                <td style="text-align: center;"><b>${actionsCount}</b></td>
                
                <!-- 10. פעולות (כפתור עריכה) -->
                <td style="text-align: center;">
                    <button class="btn-edit" type="button" onclick="openEditModal('${issueNumber}')">ערוך / צפה</button>
                </td>
            </tr>
        `;
    }).join('');
}

// 🟢 חדש: חישוב סטטיסטיקה קצרה על סמך התקלות המוצגות כרגע (אחרי סינון, אם יש)
function calcAndRenderStats(issues) {
    const list = Array.isArray(issues) ? issues : [];

    const total = list.length;

    const critical = list.filter(issue => {
        const sev = issue.SeverityId || issue.severity_id;
        const pri = issue.PriorityId || issue.priority_id;
        return String(sev) === '3' || String(pri) === '3';
    }).length;

    const unassigned = list.filter(issue => {
        const rawAssignedId = issue.assigned_to || issue.AssignedTo || issue.assingTo;
        return !rawAssignedId || rawAssignedId === 'טרם שובץ';
    }).length;

    const totalActions = list.reduce((sum, issue) => {
        const count = (issue.actions_count !== undefined) ? issue.actions_count : (issue.ActionsCount || 0);
        return sum + Number(count || 0);
    }, 0);

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setText('statTotal', total);
    setText('statCritical', critical);
    setText('statUnassigned', unassigned);
    setText('statActions', totalActions);
}

// 🟢 חדש: מעבר לדף פתיחת תקלה חדשה, עם הביקור הנבחר כרגע כאן - כדי לא לבחור אותו פעמיים
function goToNewIssueForVisit() {
    const visitId = document.getElementById('visitSelect')?.value;
    if (!visitId) {
        alert('נא לבחור ביקור מהרשימה קודם');
        return;
    }
    window.location.href = `maintenanceissue.html?visitId=${encodeURIComponent(visitId)}`;
}

let visitStatusChartInstance = null;
let deptDonutInstances = {}; // שם מחלקה -> Chart instance

// צבע קבוע ומשמעותי לכל סטטוס, לפי מה שהוא אומר (לא לפי סדר הופעה) - אחיד בכל האתר, כולל דשבורד ההאנגר
function getStatusColor(statusName) {
    const name = String(statusName || '').trim();
    if (name.includes('סגר')) return '#15803d';       // ירוק - סגורה/נסגרה
    if (name.includes('בוטל')) return '#dc2626';       // אדום - בוטלה
    if (name.includes('טיפול')) return '#d97706';      // כתום/ענבר - בטיפול
    if (name.includes('המתנה') || name.includes('ממתינ')) return '#7c3aed'; // סגול - ממתינה (להנדסה וכו')
    if (name.includes('פתוח')) return '#1758c9';       // כחול - פתוחה
    return '#64748b';                                   // אפור - כל מקרה אחר/לא ידוע
}

// 🟢 דונאט 1: התפלגות סטטוסים על פני כלל התקלות בביקור (מימד אחד - סטטוס)
function renderVisitStatusDonut(issues) {
    const canvas = document.getElementById('visitStatusDonut');
    if (!canvas || typeof Chart === 'undefined') return;

    const list = Array.isArray(issues) ? issues : [];
    const counts = {};
    list.forEach(issue => {
        const statusId = issue.StatusID ?? issue.status_id;
        const statusName = issue.status_name || issue.StatusName || getLookupName(lookupsData.statuses, statusId, 'לא ידוע');
        counts[statusName] = (counts[statusName] || 0) + 1;
    });

    const labels = Object.keys(counts);
    const data = labels.map(l => counts[l]);
    const colors = labels.map(getStatusColor);

    if (visitStatusChartInstance) {
        visitStatusChartInstance.data.labels = labels;
        visitStatusChartInstance.data.datasets[0].data = data;
        visitStatusChartInstance.data.datasets[0].backgroundColor = colors;
        visitStatusChartInstance.update();
        return;
    }

    visitStatusChartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors }] },
        options: {
            responsive: true,
            plugins: { legend: { position: 'bottom', labels: { font: { family: 'Assistant' } } } }
        }
    });
}

// 🟢 דונאט לכל מחלקה: פילוג הסטטוסים בתוך אותה מחלקה בלבד (שני מימדים - מחלקה, ובתוכה סטטוס)
function renderDeptStatusDonuts(issues) {
    const container = document.getElementById('deptDonutsContainer');
    if (!container || typeof Chart === 'undefined') return;

    const list = Array.isArray(issues) ? issues : [];

    const deptStatusCounts = {};
    list.forEach(issue => {
        const deptId = issue.DepartmentCode ?? issue.department_code;
        const statusId = issue.StatusID ?? issue.status_id;
        const deptName = issue.department_name || issue.DepartmentName || getLookupName(lookupsData.departments, deptId, `מחלקה ${deptId}`);
        const statusName = issue.status_name || issue.StatusName || getLookupName(lookupsData.statuses, statusId, 'לא ידוע');

        if (!deptStatusCounts[deptName]) deptStatusCounts[deptName] = {};
        deptStatusCounts[deptName][statusName] = (deptStatusCounts[deptName][statusName] || 0) + 1;
    });

    // הריסת instances ישנים ובנייה מחדש - הכי פשוט ובטוח כשמספר המחלקות משתנה בין סינון לסינון
    Object.values(deptDonutInstances).forEach(chart => chart.destroy());
    deptDonutInstances = {};
    container.innerHTML = '';

    Object.entries(deptStatusCounts).forEach(([deptName, statusCounts]) => {
        const card = document.createElement('div');
        card.className = 'dept-donut-card';
        card.innerHTML = `<h3>${deptName}</h3><canvas></canvas>`;
        container.appendChild(card);

        const labels = Object.keys(statusCounts);
        const data = labels.map(l => statusCounts[l]);
        const colors = labels.map(getStatusColor);

        deptDonutInstances[deptName] = new Chart(card.querySelector('canvas'), {
            type: 'doughnut',
            data: { labels, datasets: [{ data, backgroundColor: colors }] },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom', labels: { font: { size: 10, family: 'Assistant' } } } }
            }
        });
    });

    if (Object.keys(deptStatusCounts).length === 0) {
        container.innerHTML = '<p class="placeholder-text">אין תקלות להצגה</p>';
    }
}

function resetFilters() {
    ['filterStatus', 'filterSeverity', 'filterPriority'].forEach(id => {
        const elem = document.getElementById(id);
        if (elem) elem.value = '';
    });
}

// 6. סינון דינמי ב-Client
function filterIssues() {
    const status = document.getElementById('filterStatus')?.value;
    const severity = document.getElementById('filterSeverity')?.value;
    const priority = document.getElementById('filterPriority')?.value;

    const filtered = allIssues.filter(issue => {
        const issueStatus = issue.StatusID || issue.status_id;
        const issueSeverity = issue.SeverityId || issue.severity_id;
        const issuePriority = issue.PriorityId || issue.priority_id;

        const matchStatus = !status || String(issueStatus) === String(status);
        const matchSeverity = !severity || String(issueSeverity) === String(severity);
        const matchPriority = !priority || String(issuePriority) === String(priority);
        return matchStatus && matchSeverity && matchPriority;
    });

    renderIssuesTable(filtered);
}

// טעינת עובדי המחלקה הנבחרת עבור שדה "הקצה לטכנאי", עם בחירה מוקדמת אופציונלית
async function loadDepartmentEmployeesForEdit(deptCode, preselectUserId = null) {
    const select = document.getElementById('editAssignTo');
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

        select.innerHTML = '<option value="">בחר טכנאי...</option>';
        usersList.forEach(user => {
            const option = document.createElement('option');
            const userId = user.UserId ?? user.userId ?? user.id;
            const firstName = user.UserName ?? user.userName ?? '';
            const lastName = user.UserLastName ?? user.userLastName ?? '';
            const fullName = user.displayName || user.fullName || [firstName, lastName].filter(Boolean).join(' ');
            option.value = userId;
            option.textContent = fullName || userId;
            select.appendChild(option);
        });

        if (preselectUserId) select.value = preselectUserId;

    } catch (error) {
        console.error('שגיאה בטעינת עובדי מחלקה:', error);
        select.innerHTML = '<option value="">שגיאה בטעינת עובדים</option>';
    }
}

// שליפת כל הצירופים של תקלה, מקובצים לפי ActionId ('issue' = צירוף כללי לתקלה)
async function fetchAttachmentsGrouped(issueNumber) {
    const grouped = { issue: [] };
    try {
        const response = await fetch(`/api/attachments/${issueNumber}`);
        if (checkAuthResponse(response)) return grouped;
        if (!response.ok) return grouped;

        const rows = await response.json();
        (Array.isArray(rows) ? rows : []).forEach(row => {
            const key = row.ActionId ? String(row.ActionId) : 'issue';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(row);
        });
    } catch (error) {
        console.error('שגיאה בטעינת צירופים:', error);
    }
    return grouped;
}

function renderAttachmentChips(containerEl, attachments) {
    if (!containerEl) return;
    if (!attachments || attachments.length === 0) {
        containerEl.innerHTML = '<p class="attachments-empty">לא צורפו קבצים</p>';
        return;
    }
    containerEl.innerHTML = attachments.map(att => `
        <a class="attachment-chip" href="${att.AttachPath}" target="_blank" rel="noopener" style="text-decoration:none;">
            📎 ${att.AttachPath.split('/').pop()}
        </a>
    `).join('');
}

// העלאה מיידית של צירוף לתקלה עצמה (ה-IssueNumber כבר ידוע בעריכה)
async function handleIssueLevelFileUpload(inputEl) {
    if (!inputEl.files.length || !currentIssueNumberInModal) return;
    await uploadAttachmentsNow(currentIssueNumberInModal, null, Array.from(inputEl.files));
    inputEl.value = '';
    const grouped = await fetchAttachmentsGrouped(currentIssueNumberInModal);
    attachmentsByActionId = grouped;
    renderAttachmentChips(document.getElementById('issueAttachmentsList'), grouped.issue);
}

// העלאה מיידית של צירוף לפעולה קיימת (יש לה כבר ActionId אמיתי)
async function handleActionLevelFileUpload(inputEl, actionId) {
    if (!inputEl.files.length || !currentIssueNumberInModal) return;
    await uploadAttachmentsNow(currentIssueNumberInModal, actionId, Array.from(inputEl.files));
    inputEl.value = '';
    const grouped = await fetchAttachmentsGrouped(currentIssueNumberInModal);
    attachmentsByActionId = grouped;
    renderAttachmentChips(document.getElementById(`attach-list-action-${actionId}`), grouped[String(actionId)] || []);
}

async function uploadAttachmentsNow(issueNumber, actionId, files) {
    const formData = new FormData();
    formData.append('IssueNumber', issueNumber);
    if (actionId) formData.append('ActionId', actionId);
    files.forEach(file => formData.append('files', file));

    try {
        const response = await fetch('/api/attachments', { method: 'POST', body: formData });
        if (checkAuthResponse(response)) return;
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `שגיאת שרת: ${response.status}`);
        }
    } catch (error) {
        console.error('שגיאה בהעלאת צירוף:', error);
        alert('שגיאה בהעלאת הקובץ: ' + error.message);
    }
}

// 7. Modal עריכה ושמירה
async function openEditModal(issueNumber) {
    try {
        const response = await fetch(`/api/maintanace_calls/${issueNumber}`);
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בשליפת פרטי תקלה');

        const data = await response.json();
        const issue = data.issue || data;
        const actions = data.actions || [];

        currentIssueNumberInModal = issue.IssueNumber || issue.issue_number;

        document.getElementById('modalIssueNumber').innerText = '#' + currentIssueNumberInModal;
        document.getElementById('editIssueId').value = currentIssueNumberInModal;
        document.getElementById('editTitle').value = issue.Title || issue.title || '';
        document.getElementById('editDescription').value = issue.Description || issue.description || '';
        document.getElementById('editStatusID').value = issue.StatusID || issue.status_id || '';
        document.getElementById('editFaultCategory').value = issue.FaultCategory || issue.fault_category || '';
        document.getElementById('editSeverityId').value = issue.SeverityId || issue.severity_id || '';
        document.getElementById('editPriorityId').value = issue.PriorityId || issue.priority_id || '';
        document.getElementById('editDepartmentCode').value = issue.DepartmentCode || issue.department_code || '';

        // שיבוץ טכנאי - טוען את עובדי המחלקה הנוכחית ובוחר מראש את מי שכבר משובץ
        await loadDepartmentEmployeesForEdit(issue.DepartmentCode || issue.department_code, issue.assingTo || issue.AssignedToUserId);

        // צירופים - נטענים פעם אחת ומחולקים בין התקלה לפעולות
        attachmentsByActionId = await fetchAttachmentsGrouped(currentIssueNumberInModal);
        renderAttachmentChips(document.getElementById('issueAttachmentsList'), attachmentsByActionId.issue);

        const actionsContainer = document.getElementById('actionsContainer');
        actionsContainer.innerHTML = '';
        if (Array.isArray(actions) && actions.length > 0) {
            actions.forEach(act => addActionCard(act));
        }

        // 🟢 חדש: אם התקלה כבר סגורה - צפייה בלבד, חוץ מ-Admin/TeamLead/QAInspector שכן יכולים לערוך
        // (זו רק נוחות בממשק - השרת אוכף את זה בפועל, גם אם מישהו יעקוף את זה כאן)
        const statusId = issue.StatusID || issue.status_id;
        const statusName = getLookupName(lookupsData.statuses, statusId, '');
        const isClosed = String(statusName).includes('סגר');

        const sessionUserRaw = sessionStorage.getItem('loggedInUser');
        const sessionUser = sessionUserRaw ? JSON.parse(sessionUserRaw) : null;
        const allowedToEditClosed = [1, 3, 5].includes(sessionUser?.permissionCode);

        setIssueModalReadOnly(isClosed && !allowedToEditClosed);

        document.getElementById('editModal').style.display = 'flex';

    } catch (err) {
        console.error('שגיאה בפתיחת המודל:', err);
    }
}

// נועלת/פותחת את כל טופס עריכת התקלה - לתקלה סגורה מציגים "צפייה" בלבד, בלי אפשרות לשמור
function setIssueModalReadOnly(readOnly) {
    const modalTitleH2 = document.querySelector('#editModal .modal-header h2');
    if (modalTitleH2 && modalTitleH2.firstChild) {
        modalTitleH2.firstChild.textContent = readOnly ? 'צפייה בתקלה (סגורה) ' : 'עריכת תקלה ';
    }

    const form = document.getElementById('editForm');
    if (form) {
        form.querySelectorAll('input, select, textarea, button').forEach(el => {
            if (el.getAttribute('onclick')?.includes('closeModal')) return; // כפתור "ביטול" תמיד פעיל
            el.disabled = readOnly;
        });
    }

    const saveBtn = document.querySelector('#editModal .btn-save');
    if (saveBtn) saveBtn.style.display = readOnly ? 'none' : '';
}

function addActionCard(act = {}) {
    const container = document.getElementById('actionsContainer');
    if (!container) return;

    const completedStatusId = findCompletedActionStatusId();
    const isLocked = completedStatusId && String(act.ActionStatusId) === completedStatusId && !!act.ActionId;
    const actionAttachments = act.ActionId ? (attachmentsByActionId[String(act.ActionId)] || []) : null;

    const usersOptions = (lookupsData.users || []).map(u =>
        `<option value="${u.id}" ${String(u.id) === String(act.SingedByEmployeeId) ? 'selected' : ''}>${u.name}</option>`
    ).join('');

    const div = document.createElement('div');
    div.className = 'action-card-item';
    div.innerHTML = `
        <input type="hidden" class="act-id" value="${act.ActionId || ''}">

        ${isLocked ? `
        <div class="category-desc-box" style="margin-bottom:0.9rem;">
            <span class="info-icon">🔒</span>
            <span>פעולה שהושלמה - נעולה לעריכה.</span>
            <button type="button" class="btn btn-outline" style="margin-right:auto; padding:0.3rem 0.7rem; font-size:0.78rem;" onclick="unlockActionCard(this)">🔓 פתח לעריכה מחדש</button>
        </div>` : ''}

        <div class="grid-2">
            <div class="form-group">
                <label>תיאור פעולה <span class="required">*</span></label>
                <input type="text" class="act-desc" value="${act.ActionDescription || ''}" required ${isLocked ? 'disabled' : ''}>
            </div>
            <div class="form-group">
                <label>ספרות טכנית (ActionLiteratureRef)</label>
                <input type="text" class="act-lit" value="${act.ActionLiteratureRef || ''}" placeholder="AMM-30-10-11" ${isLocked ? 'disabled' : ''}>
            </div>
        </div>

        <div class="grid-2">
            <div class="form-group">
                <label>סטטוס פעולה</label>
                <select class="act-status" ${isLocked ? 'disabled' : ''}>
                    ${(lookupsData.actionStatuses || []).map(s =>
                        `<option value="${s.id}" ${String(s.id) === String(act.ActionStatusId) ? 'selected' : ''}>${s.name}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>מי חתם (Signed By)</label>
                <select class="act-signed" ${isLocked ? 'disabled' : ''}>
                    <option value="">בחר עובד...</option>
                    ${usersOptions}
                </select>
            </div>
        </div>

        <div class="form-group">
            <label class="checkbox-label">
                <input type="checkbox" class="act-serialized-cb" ${act.SerializedPart ? 'checked' : ''} ${isLocked ? 'disabled' : ''} onchange="toggleSerialFieldsEdit(this)">
                <span>הוחלף רכיב מנוהל סיראלי (Serialized Part)</span>
            </label>
        </div>
        <div class="serial-fields grid-2" style="display:${act.SerializedPart ? 'grid' : 'none'};">
            <div class="form-group">
                <label>מספר סידורי ישן (Old S/N)</label>
                <input type="text" class="act-old-sn" value="${act.OldSerialNumber || ''}" ${isLocked ? 'disabled' : ''}>
            </div>
            <div class="form-group">
                <label>מספר סידורי חדש (New S/N)</label>
                <input type="text" class="act-new-sn" value="${act.NewSerialNumber || ''}" ${isLocked ? 'disabled' : ''}>
            </div>
        </div>

        ${act.ActionId ? `
        <div class="form-group" style="margin-top:0.9rem;">
            <label class="btn btn-outline" style="cursor:pointer; font-size:0.82rem; padding:0.45rem 0.9rem;">
                📎 צרף מסמך לפעולה
                <input type="file" class="hidden" multiple onchange="handleActionLevelFileUpload(this, '${act.ActionId}')">
            </label>
            <div class="attachments-list" id="attach-list-action-${act.ActionId}"></div>
        </div>` : `
        <p class="attachments-empty" style="margin-top:0.6rem;">ניתן לצרף מסמכים לפעולה זו אחרי השמירה הראשונה</p>`}
    `;
    container.appendChild(div);

    if (act.ActionId) {
        renderAttachmentChips(div.querySelector(`#attach-list-action-${act.ActionId}`), actionAttachments);
    }
}

function toggleSerialFieldsEdit(checkbox) {
    const card = checkbox.closest('.action-card-item');
    const serialFields = card ? card.querySelector('.serial-fields') : null;
    if (serialFields) serialFields.style.display = checkbox.checked ? 'grid' : 'none';
}

function unlockActionCard(button) {
    const card = button.closest('.action-card-item');
    if (!card) return;
    card.querySelectorAll('input, select').forEach(el => el.disabled = false);
    const lockNotice = card.querySelector('.category-desc-box');
    if (lockNotice) lockNotice.remove();
}

function addEmptyActionCard() {
    addActionCard();
}

function closeModal() {
    document.getElementById('editModal').style.display = 'none';
}

// פונקציית עזר גנרית: מוצאת מזהה סטטוס מתוך רשימת lookup לפי שורש מילה (לא לפי מספר מנוחש)
function findStatusIdByRoot(list, roots) {
    const match = (list || []).find(s => {
        const name = String(s.name || '').trim().toLowerCase();
        return roots.some(root => name.includes(root));
    });
    return match ? String(match.id) : null;
}

// מוצאת את מזהה הסטטוס שמייצג "סגור" מתוך רשימת הסטטוסים שנטענה מהשרת (לפי שם, לא לפי מספר מנוחש)
function findClosedStatusId() {
    // "סגר" (בלי ו'/ה' בסוף) מכסה את כל הצורות: סגור, סגורה, נסגר, נסגרה
    return findStatusIdByRoot(lookupsData.statuses, ['סגר', 'closed', 'close']);
}

// מוצאת את מזהה סטטוס הפעולה שמייצג "הושלמה" מתוך טבלת actionstatus
function findCompletedActionStatusId() {
    // "שלמ" מכסה את הצורות: הושלם, הושלמה, שלמה...
    return findStatusIdByRoot(lookupsData.actionStatuses, ['שלמ', 'complete', 'done']);
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const issueNumber = document.getElementById('editIssueId').value;
    const selectedStatusId = document.getElementById('editStatusID').value;

    const actions = [];
    document.querySelectorAll('.action-card-item').forEach(card => {
        actions.push({
            ActionId: card.querySelector('.act-id')?.value || null,
            ActionDescription: card.querySelector('.act-desc')?.value || '',
            ActionStatusId: card.querySelector('.act-status')?.value || null,
            SingedByEmployeeId: card.querySelector('.act-signed')?.value || null,
            ActionLiteratureRef: card.querySelector('.act-lit')?.value || null,
            SerializedPart: card.querySelector('.act-serialized-cb')?.checked || false,
            OldSerialNumber: card.querySelector('.act-old-sn')?.value || null,
            NewSerialNumber: card.querySelector('.act-new-sn')?.value || null
        });
    });

    // 🛡️ אי אפשר לסגור תקלה אם יש פעולה שלא הושלמה, או פעולה בלי מי שחתם עליה
    const closedStatusId = findClosedStatusId();
    if (closedStatusId && String(selectedStatusId) === closedStatusId) {
        const completedActionStatusId = findCompletedActionStatusId();
        const notDone = actions.filter(a => String(a.ActionStatusId) !== completedActionStatusId);
        const notSigned = actions.filter(a => !a.SingedByEmployeeId);

        if (notDone.length > 0 || notSigned.length > 0) {
            const parts = [];
            if (notDone.length > 0) parts.push(`${notDone.length} פעולות שעדיין לא הושלמו`);
            if (notSigned.length > 0) parts.push(`${notSigned.length} פעולות ללא חותם`);
            alert(`לא ניתן לסגור את התקלה - יש ${parts.join(' וגם ')}. יש להשלים ולתעד מי חתם על כל פעולה לפני סגירת התקלה.`);
            return;
        }
    }

    const payload = {
        issue: {
            Title: document.getElementById('editTitle').value,
            Description: document.getElementById('editDescription').value,
            StatusID: selectedStatusId,
            FaultCategory: document.getElementById('editFaultCategory').value,
            SeverityId: document.getElementById('editSeverityId').value,
            PriorityId: document.getElementById('editPriorityId').value,
            DepartmentCode: document.getElementById('editDepartmentCode').value,
            assingTo: document.getElementById('editAssignTo')?.value || null
        },
        actions
    };

    try {
        const response = await fetch(`/api/maintanace_calls/${issueNumber}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בשמירה');

        const result = await response.json();
        alert(result.message || 'התקלה עודכנה בהצלחה!');
        closeModal();

        const currentVisitId = document.getElementById('visitSelect').value;
        if (currentVisitId) {
            loadIssuesForVisit(currentVisitId);
        }
    } catch (err) {
        console.error('שגיאה בשמירת התקלה:', err);
        alert('אירעה שגיאה בעת שמירת התקלה');
    }
}