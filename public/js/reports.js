// public/js/reports.js

let currentReportType = 'open-issues';
let currentReportData = []; // המידע הגולמי שהתקבל מהשרת (מקונן או שטוח, תלוי בסוג הדוח)
let visibleColumns = [];    // רק העמודות שנבחרו להצגה/ייצוא (לדוחות שטוחים בלבד)

// דוחות מקוננים (תקלות + פעולות תחתן) - לא עוברים דרך בורר העמודות
const NESTED_REPORT_TYPES = ['open-issues', 'my-issues'];

// דוחות שלא רלוונטי להם סינון לפי ביקור בכלל
const REPORTS_WITHOUT_VISIT_FILTER = ['my-issues', 'fleet-history', 'quality-compliance', 'missions-sla', 'schedule-gap'];

const REPORT_TITLES = {
    'open-issues': 'תקלות פתוחות',
    'my-issues': 'התקלות שלי',
    'activity': 'פעילות',
    'aging': 'וותק תקלות',
    'workload': 'עומס עובדים',
    'fleet-history': 'היסטוריית מטוסים',
    'quality-compliance': 'תיעוד חסר',
    'missions-sla': 'קריאות פתוחות',
    'schedule-gap': 'פערי לוז'
};

document.addEventListener('DOMContentLoaded', () => {
    hideTechnicianRestrictedItems();
    loadVisitsForFilter();
    setupReportTypeCards();

    document.getElementById('runReportBtn')?.addEventListener('click', runReport);
    document.getElementById('exportExcelBtn')?.addEventListener('click', exportToExcel);
});

// הסתרת דוחות לא רלוונטיים לעובד רגיל (Technician, קוד 6) - נוחות בממשק בלבד.
// ⚠️ לא הגנת אבטחה - השרת לא חוסם את ה-API-ים האלה, רק הכפתורים מוסתרים כאן
function hideTechnicianRestrictedItems() {
    const userRaw = sessionStorage.getItem('loggedInUser');
    if (!userRaw) return;
    const user = JSON.parse(userRaw);
    if (user.permissionCode !== 6) return;

    document.querySelectorAll('.technician-hidden').forEach(el => el.classList.add('hidden'));

    // אם ברירת המחדל (הכרטיס הראשון הפעיל) הוסתרה - עוברים לראשון שכן נשאר גלוי
    const activeCard = document.querySelector('.report-type-card.active');
    if (activeCard && activeCard.classList.contains('hidden')) {
        activeCard.classList.remove('active');
        const firstVisible = document.querySelector('.report-type-card:not(.hidden)');
        if (firstVisible) {
            firstVisible.classList.add('active');
            currentReportType = firstVisible.dataset.report;
        }
    }
}

async function loadVisitsForFilter() {
    const select = document.getElementById('reportVisitSelect');
    if (!select) return;

    try {
        const response = await fetch('/api/visits/active');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת ביקורים');

        const visits = await response.json();
        visits.forEach(visit => {
            const option = document.createElement('option');
            option.value = visit.VisitID;
            option.textContent = `${visit.VisitID} - זנב ${visit.TailNumber} (${visit.CustomerName})`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('שגיאה בטעינת ביקורים לסינון:', error);
    }
}

function setupReportTypeCards() {
    const cards = document.querySelectorAll('.report-type-card');
    const groupByWrap = document.getElementById('groupByWrap');
    const visitFilterWrap = document.getElementById('visitFilterWrap');

    cards.forEach(card => {
        card.addEventListener('click', () => {
            cards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            currentReportType = card.dataset.report;

            groupByWrap.classList.toggle('hidden', currentReportType !== 'activity');
            visitFilterWrap.classList.toggle('hidden', REPORTS_WITHOUT_VISIT_FILTER.includes(currentReportType));

            // מעבר דוח = מתחילים תצוגה נקייה, עד שילחצו שוב על "הפק דוח"
            resetReportOutput();
        });
    });
}

function resetReportOutput() {
    currentReportData = [];
    visibleColumns = [];
    document.getElementById('columnPickerSection').style.display = 'none';
    document.getElementById('previewSection').style.display = 'none';
    document.getElementById('reportEmptyState').classList.add('hidden');
}

function isNestedReport() {
    return NESTED_REPORT_TYPES.includes(currentReportType);
}

async function runReport() {
    const visitId = document.getElementById('reportVisitSelect').value;
    const groupBy = document.getElementById('reportGroupBy').value;

    let url;
    if (currentReportType === 'activity') {
        const params = new URLSearchParams();
        params.set('groupBy', groupBy);
        if (visitId) params.set('visitId', visitId);
        url = `/api/reports/activity?${params.toString()}`;
    } else {
        const supportsVisitFilter = !REPORTS_WITHOUT_VISIT_FILTER.includes(currentReportType);
        url = `/api/reports/${currentReportType}` + (supportsVisitFilter && visitId ? `?visitId=${encodeURIComponent(visitId)}` : '');
    }

    try {
        const response = await fetch(url);
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בהפקת הדוח');

        currentReportData = await response.json();

        if (!Array.isArray(currentReportData) || currentReportData.length === 0) {
            resetReportOutput();
            document.getElementById('reportEmptyState').classList.remove('hidden');
            return;
        }

        document.getElementById('reportEmptyState').classList.add('hidden');
        document.getElementById('previewSection').style.display = 'block';

        if (isNestedReport()) {
            document.getElementById('columnPickerSection').style.display = 'none';
            document.getElementById('flatTableWrap').classList.add('hidden');
            document.getElementById('nestedIssuesPreview').classList.remove('hidden');
            renderNestedIssuesPreview();
        } else {
            document.getElementById('nestedIssuesPreview').classList.add('hidden');
            document.getElementById('flatTableWrap').classList.remove('hidden');
            document.getElementById('columnPickerSection').style.display = 'block';
            visibleColumns = Object.keys(currentReportData[0]);
            renderColumnPicker();
            renderPreviewTable();
        }

    } catch (error) {
        console.error('שגיאה בהפקת הדוח:', error);
        alert('שגיאה בהפקת הדוח: ' + error.message);
    }
}

// =========================================================================
// תצוגה מקוננת - תקלות פתוחות / התקלות שלי
// =========================================================================
function renderNestedIssuesPreview() {
    const container = document.getElementById('nestedIssuesPreview');
    if (!container) return;

    container.innerHTML = currentReportData.map(issue => `
        <div class="nested-issue-card">
            <div class="nested-issue-header">
                <span class="nested-issue-number">#${issue.IssueNumber}</span>
                <span class="nested-issue-title">${issue.Title || ''}</span>
                <span class="badge">${issue.StatusName || '—'}</span>
            </div>
            <div class="nested-issue-meta">
                ✈️ ${issue.TailNumber || '—'} &nbsp;·&nbsp;
                🏢 ${issue.DepartmentName || '—'} &nbsp;·&nbsp;
                חומרה: ${issue.SeverityName || '—'} &nbsp;·&nbsp;
                דחיפות: ${issue.PriorityName || '—'} &nbsp;·&nbsp;
                נפתחה ע"י ${issue.CreatedByName || '—'} &nbsp;·&nbsp;
                הוקצתה ל-${issue.AssignedToName || 'טרם שובץ'} &nbsp;·&nbsp;
                ${issue.CreatedAt ? new Date(issue.CreatedAt).toLocaleDateString('he-IL') : ''}
            </div>

            ${issue.actions && issue.actions.length > 0 ? `
                <div class="nested-actions-list">
                    ${issue.actions.map((act, idx) => `
                        <div class="nested-action-row">
                            <span class="nested-action-index">${idx + 1}.</span>
                            <span class="nested-action-desc">${act.ActionDescription || ''}</span>
                            <span class="nested-action-status badge">${act.ActionStatusName || '—'}</span>
                            <span class="nested-action-meta">${act.SignedByName ? 'חתם: ' + act.SignedByName : ''} ${act.ActionDate ? new Date(act.ActionDate).toLocaleDateString('he-IL') : ''}</span>
                        </div>
                    `).join('')}
                </div>
            ` : '<p class="attachments-empty">אין עדיין פעולות טיפול לתקלה זו</p>'}
        </div>
    `).join('');
}

// =========================================================================
// טבלה שטוחה + בורר עמודות - לכל שאר הדוחות
// =========================================================================
function renderColumnPicker() {
    const container = document.getElementById('columnPicker');
    if (!container || currentReportData.length === 0) return;

    const allColumns = Object.keys(currentReportData[0]);

    container.innerHTML = allColumns.map(col => `
        <label>
            <input type="checkbox" value="${col}" ${visibleColumns.includes(col) ? 'checked' : ''} onchange="handleColumnToggle(this)">
            ${col}
        </label>
    `).join('');
}

function handleColumnToggle(checkbox) {
    const col = checkbox.value;
    if (checkbox.checked) {
        if (!visibleColumns.includes(col)) visibleColumns.push(col);
    } else {
        visibleColumns = visibleColumns.filter(c => c !== col);
    }
    renderPreviewTable();
}

function renderPreviewTable() {
    const table = document.getElementById('reportPreviewTable');
    if (!table || currentReportData.length === 0) return;

    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    const allColumns = Object.keys(currentReportData[0]);
    const orderedVisible = allColumns.filter(col => visibleColumns.includes(col));

    thead.innerHTML = '<tr>' + orderedVisible.map(col => `<th>${col}</th>`).join('') + '</tr>';

    tbody.innerHTML = currentReportData.map(row => {
        const cells = orderedVisible.map(col => {
            let val = row[col];
            if (val === null || val === undefined) val = '—';
            return `<td>${val}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');
}

// =========================================================================
// ייצוא לאקסל - מטפל גם בדוחות מקוננים (משטח לשורה אחת לכל פעולה) וגם שטוחים
// =========================================================================
function exportToExcel() {
    if (currentReportData.length === 0) {
        alert('אין נתונים לייצוא - יש להפיק דוח קודם');
        return;
    }
    if (typeof XLSX === 'undefined') {
        alert('ספריית הייצוא לא נטענה - בדקי חיבור לאינטרנט ורעננית את הדף');
        return;
    }

    let exportRows;

    if (isNestedReport()) {
        exportRows = [];
        currentReportData.forEach(issue => {
            const baseRow = {
                'מספר תקלה': issue.IssueNumber,
                'כותרת': issue.Title,
                'זנב': issue.TailNumber,
                'מחלקה': issue.DepartmentName,
                'סטטוס': issue.StatusName,
                'חומרה': issue.SeverityName,
                'דחיפות': issue.PriorityName,
                'נפתחה ע"י': issue.CreatedByName,
                'הוקצתה ל': issue.AssignedToName,
                'תאריך פתיחה': issue.CreatedAt
            };
            if (issue.actions && issue.actions.length > 0) {
                issue.actions.forEach(act => {
                    exportRows.push({
                        ...baseRow,
                        'תיאור פעולה': act.ActionDescription,
                        'סטטוס פעולה': act.ActionStatusName,
                        'חתם': act.SignedByName,
                        'תאריך פעולה': act.ActionDate
                    });
                });
            } else {
                exportRows.push({ ...baseRow, 'תיאור פעולה': '', 'סטטוס פעולה': '', 'חתם': '', 'תאריך פעולה': '' });
            }
        });
    } else {
        const allColumns = Object.keys(currentReportData[0]);
        const orderedVisible = allColumns.filter(col => visibleColumns.includes(col));
        exportRows = currentReportData.map(row => {
            const filteredRow = {};
            orderedVisible.forEach(col => { filteredRow[col] = row[col]; });
            return filteredRow;
        });
    }

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    const sheetName = REPORT_TITLES[currentReportType] || 'דוח';
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `דוח_${sheetName}_${dateStr}.xlsx`);
}
