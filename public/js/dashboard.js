// public/js/dashboard.js

document.addEventListener('DOMContentLoaded', () => {
    if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
    }

    hideTechnicianRestrictedItems();
    loadKpis();
    loadVisitFiltersForCharts();
    loadTrendsChart();
    loadWorkloadChart();
    loadFleetChart();
    loadCategoriesChart();
    loadHoursChart();
    loadTimelineChart();
    setupDashboardTabs();
    activateTabFromUrl();

    document.getElementById('trendsVisitFilter')?.addEventListener('change', (e) => loadTrendsChart(e.target.value));
    document.getElementById('workloadVisitFilter')?.addEventListener('change', (e) => loadWorkloadChart(e.target.value));
    document.getElementById('employeesVisitFilter')?.addEventListener('change', (e) => loadEmployeesChart(e.target.value));
});

// טוענת את רשימת הביקורים הפעילים פעם אחת, ומאכלסת את שני בוררי הביקור בטאבים
async function loadVisitFiltersForCharts() {
    try {
        const response = await fetch('/api/visits/active');
        if (checkAuthResponse(response)) return;
        if (!response.ok) return;

        const visits = await response.json();
        const optionsHtml = visits.map(v =>
            `<option value="${v.VisitID}">${v.VisitID} - זנב ${v.TailNumber} (${v.CustomerName})</option>`
        ).join('');

        ['trendsVisitFilter', 'workloadVisitFilter', 'employeesVisitFilter'].forEach(id => {
            const select = document.getElementById(id);
            if (select) select.insertAdjacentHTML('beforeend', optionsHtml);
        });
    } catch (error) {
        console.error('שגיאה בטעינת רשימת ביקורים לסינון:', error);
    }
}

// הסתרת הקבוצה הכלל-מערכתית לעובד רגיל (Technician, קוד 6) - נוחות בממשק בלבד.
// ⚠️ לא הגנת אבטחה - ה-API-ים עדיין נגישים, רק הקטע מוסתר כאן
function hideTechnicianRestrictedItems() {
    const userRaw = sessionStorage.getItem('loggedInUser');
    if (!userRaw) return;
    const user = JSON.parse(userRaw);
    if (user.permissionCode === 6) {
        document.querySelectorAll('.technician-hidden').forEach(el => el.classList.add('hidden'));
    }
}

function setupDashboardTabs() {
    // כל סרגל טאבים (systemTabs, aircraftTabs) מנוהל בנפרד - טאב שנלחץ בקבוצה אחת
    // לא נוגע בתוכן שמוצג כרגע בקבוצה השנייה
    document.querySelectorAll('.dashboard-tabs').forEach(tabBar => {
        const tabs = tabBar.querySelectorAll('.dashboard-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // מסתירים רק את התוכן ששייך לטאבים של הסרגל הזה, לא של הסרגל השני
                tabs.forEach(t => document.getElementById(`tab-${t.dataset.tab}`)?.classList.add('hidden'));
                document.getElementById(`tab-${tab.dataset.tab}`)?.classList.remove('hidden');
            });
        });
    });
}

// אם הגענו עם ?tab=... (לדוגמה מ"לוחות זמנים" בדף הבית) - פותחים ישר את הטאב הזה,
// בכל קבוצה שהוא נמצא בה (מפעילים קליק אמיתי, כדי לא לשכפל את לוגיקת ההחלפה)
function activateTabFromUrl() {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (!requestedTab) return;

    const tabButton = document.querySelector(`.dashboard-tab[data-tab="${requestedTab}"]`);
    tabButton?.click();
    tabButton?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadKpis() {
    try {
        const response = await fetch('/api/dashboard/kpis');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת נתוני הדשבורד');

        const data = await response.json();

        setText('kpiOpenIssues', data.openIssuesTotal);
        setText('kpiCriticalIssues', data.openIssuesCritical);
        setText('kpiActiveVisits', data.activeVisits);
        setText('kpiOverdueVisits', data.visitsOverdue);
        setText('kpiOpenMissions', data.openMissions);
        setText('kpiMissingDocs', data.issuesMissingDocs);

    } catch (error) {
        console.error('שגיאה בטעינת KPI:', error);
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? 0;
}

// =========================================================================
// מגמות לאורך זמן (per-visit אפשרי)
// =========================================================================
let trendsChartInstance = null;

async function loadTrendsChart(visitId = '') {
    const canvas = document.getElementById('trendsChart');
    if (!canvas) return;

    try {
        const url = '/api/dashboard/trends' + (visitId ? `?visitId=${encodeURIComponent(visitId)}` : '');
        const response = await fetch(url);
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת נתוני המגמה');

        const data = await response.json();

        if (trendsChartInstance) { trendsChartInstance.destroy(); trendsChartInstance = null; }

        if (!data.labels || data.labels.length === 0) {
            canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        if (typeof Chart === 'undefined') return;

        trendsChartInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [
                    { label: 'תקלות שנפתחו', data: data.opened, borderColor: '#1758c9', backgroundColor: 'rgba(23,88,201,0.1)', tension: 0.3, fill: true },
                    { label: 'תקלות שנסגרו', data: data.closed, borderColor: '#15803d', backgroundColor: 'rgba(21,128,61,0.1)', tension: 0.3, fill: true }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { font: { family: 'Assistant' } } },
                    datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, align: 'top', font: { size: 10 } }
                },
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } } }
            }
        });

    } catch (error) {
        console.error('שגיאה בטעינת גרף המגמה:', error);
    }
}

// =========================================================================
// עומס לפי מחלקה (per-visit אפשרי)
// =========================================================================
let workloadChartInstance = null;

async function loadWorkloadChart(visitId = '') {
    const canvas = document.getElementById('workloadChart');
    if (!canvas) return;

    try {
        const url = '/api/dashboard/workload-by-department' + (visitId ? `?visitId=${encodeURIComponent(visitId)}` : '');
        const response = await fetch(url);
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת עומס מחלקה');

        const data = await response.json();
        if (workloadChartInstance) { workloadChartInstance.destroy(); workloadChartInstance = null; }

        if (!data.labels || data.labels.length === 0) {
            canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        if (typeof Chart === 'undefined') return;

        const palette = ['#1758c9', '#d97706', '#15803d', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#64748b'];

        workloadChartInstance = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: data.datasets.map((ds, i) => ({
                    label: ds.label,
                    data: ds.data,
                    backgroundColor: palette[i % palette.length]
                }))
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { font: { family: 'Assistant' }, boxWidth: 14 } },
                    datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, font: { weight: 'bold', size: 10 }, color: '#fff' }
                },
                scales: {
                    x: { stacked: true },
                    y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1, precision: 0 } }
                }
            }
        });
    } catch (error) {
        console.error('שגיאה בטעינת גרף עומס מחלקה:', error);
    }
}

// =========================================================================
// תקלות לפי מטוס (כלל-מערכתי בלבד - משווה בין מטוסים)
// =========================================================================
let fleetChartInstance = null;

async function loadFleetChart() {
    const canvas = document.getElementById('fleetChart');
    if (!canvas) return;

    try {
        const response = await fetch('/api/dashboard/top-aircraft');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת נתוני מטוסים');

        const data = await response.json();
        if (!data.labels || data.labels.length === 0) {
            canvas.parentElement.innerHTML = '<p class="placeholder-text">אין עדיין תקלות רשומות למטוסים</p>';
            return;
        }
        if (typeof Chart === 'undefined') return;

        const fleetPalette = ['#1758c9', '#d97706', '#15803d', '#dc2626', '#7c3aed'];

        fleetChartInstance = new Chart(canvas, {
            type: 'polarArea',
            data: {
                labels: data.labels,
                datasets: [{
                    label: 'סה"כ תקלות',
                    data: data.values,
                    backgroundColor: data.labels.map((_, i) => fleetPalette[i % fleetPalette.length] + 'cc')
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { font: { family: 'Assistant' } } },
                    datalabels: { color: '#fff', font: { weight: 'bold', size: 13 } }
                },
                scales: {
                    r: { ticks: { stepSize: 1, backdropColor: 'transparent' } }
                }
            }
        });
    } catch (error) {
        console.error('שגיאה בטעינת גרף מטוסים:', error);
    }
}

// =========================================================================
// פילוח תקלות לפי קטגוריה (כלל-מערכתי)
// =========================================================================
let categoriesChartInstance = null;

async function loadCategoriesChart() {
    const canvas = document.getElementById('categoriesChart');
    if (!canvas) return;

    try {
        const response = await fetch('/api/dashboard/categories');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת פילוח קטגוריות');

        const data = await response.json();
        if (!data.labels || data.labels.length === 0) {
            canvas.parentElement.remove();
            return;
        }
        if (typeof Chart === 'undefined') return;

        const palette = ['#1758c9', '#d97706', '#15803d', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#64748b'];

        categoriesChartInstance = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: data.labels,
                datasets: [{ data: data.values, backgroundColor: data.labels.map((_, i) => palette[i % palette.length]) }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { font: { family: 'Assistant' } } },
                    datalabels: {
                        color: '#fff',
                        font: { weight: 'bold' },
                        formatter: (value, ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            return total ? Math.round((value / total) * 100) + '%' : '';
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('שגיאה בטעינת גרף קטגוריות:', error);
    }
}

// =========================================================================
// זמן טיפול לפי מטוס (שעות פתוחה->סגורה, לא שעות עבודה בפועל) - כלל-מערכתי
// =========================================================================
let hoursChartInstance = null;

async function loadHoursChart() {
    const canvas = document.getElementById('hoursChart');
    if (!canvas) return;

    try {
        const response = await fetch('/api/dashboard/hours-by-aircraft');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת נתוני שעות טיפול');

        const data = await response.json();
        if (!data.labels || data.labels.length === 0) {
            canvas.parentElement.innerHTML = '<p class="placeholder-text">אין עדיין תקלות סגורות למדוד לפיהן</p>';
            return;
        }
        if (typeof Chart === 'undefined') return;

        hoursChartInstance = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [{
                    label: 'שעות עבודה (9 שעות ליום)',
                    data: data.values,
                    backgroundColor: '#7dd3d8',
                    hoverBackgroundColor: '#5ec4cb',
                    borderRadius: 999,
                    barPercentage: 0.45,
                    categoryPercentage: 0.7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    datalabels: { anchor: 'end', align: 'top', font: { weight: '600', size: 12 }, color: '#0e7490' }
                },
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: 'שעות עבודה' }, grid: { color: '#f1f5f9' } },
                    x: { grid: { display: false } }
                }
            }
        });
    } catch (error) {
        console.error('שגיאה בטעינת גרף שעות טיפול:', error);
    }
}

// =========================================================================
// עובדים לפי ביקור ומחלקה - חובה לבחור ביקור, אין ברירת מחדל
// =========================================================================
let employeesChartInstance = null;

async function loadEmployeesChart(visitId = '') {
    const canvas = document.getElementById('employeesChart');
    if (!canvas) return;

    if (employeesChartInstance) { employeesChartInstance.destroy(); employeesChartInstance = null; }
    canvas.parentElement.querySelectorAll('p.placeholder-text').forEach(p => p.remove());

    if (!visitId) {
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    try {
        const response = await fetch(`/api/dashboard/employees-by-department?visitId=${encodeURIComponent(visitId)}`);
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת נתוני עובדים');

        const data = await response.json();
        if (!data.labels || data.labels.length === 0) {
            canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            const note = document.createElement('p');
            note.className = 'placeholder-text';
            note.textContent = 'אין עדיין עובדים מעורבים בביקור הזה (אין תקלות/פעולות רשומות)';
            canvas.parentElement.appendChild(note);
            return;
        }
        if (typeof Chart === 'undefined') return;

        employeesChartInstance = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [{ label: 'עובדים מעורבים', data: data.values, backgroundColor: '#7c3aed' }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    datalabels: { anchor: 'end', align: 'top', font: { weight: 'bold' }, color: '#5b21b6' }
                },
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } } }
            }
        });
    } catch (error) {
        console.error('שגיאה בטעינת גרף עובדים:', error);
    }
}

// =========================================================================
// ציר זמן יציאות - גאנט מותאם אישית (HTML/CSS, לא Chart.js). זו גרסה פשוטה
// בלי קידוח לתקלות - לקידוח פנימה יש דף עצמאי: schedule.html
// =========================================================================
async function loadTimelineChart() {
    const wrap = document.getElementById('ganttWrap');
    if (!wrap) return;

    try {
        const response = await fetch('/api/dashboard/departure-timeline');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת ציר הזמן');

        const rows = await response.json();

        const year2000 = new Date('2000-01-01').getTime();
        const validRows = rows.filter(r => {
            const entry = new Date(r.entry).getTime();
            const target = new Date(r.target).getTime();
            return !isNaN(entry) && !isNaN(target) && entry > year2000 && target > year2000;
        });

        if (validRows.length === 0) {
            wrap.innerHTML = '<p class="placeholder-text">אין ביקורים פעילים עם תאריכים תקינים להצגה</p>';
            return;
        }

        let hoursRatioByVisit = {};
        try {
            const hoursResponse = await fetch('/api/dashboard/visit-hours-ratio');
            if (hoursResponse.ok) {
                const hoursData = await hoursResponse.json();
                hoursData.forEach(h => { hoursRatioByVisit[h.visitId] = h; });
            }
        } catch (e) {
            console.error('שגיאה בטעינת יחס שעות (לא חוסם את הגאנט עצמו):', e);
        }

        const palette = ['#1758c9', '#d97706', '#15803d', '#dc2626', '#7c3aed', '#0891b2'];

        const entries = validRows.map(r => new Date(r.entry).getTime());
        const targets = validRows.map(r => new Date(r.target).getTime());
        let minDate = Math.min(...entries);
        let maxDate = Math.max(...targets);
        const span = maxDate - minDate;
        const pad = span > 0 ? span * 0.06 : 3 * 24 * 60 * 60 * 1000;
        minDate -= pad;
        maxDate += pad;
        const totalSpan = maxDate - minDate;

        const tickCount = 7;
        let ticksHtml = '';
        for (let i = 0; i <= tickCount; i++) {
            const t = minDate + (totalSpan * i / tickCount);
            const pct = (i / tickCount) * 100;
            ticksHtml += `<span class="gantt-tick-label" style="left:${pct}%">${new Date(t).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}</span>`;
        }
        const headerHtml = `
            <div class="gantt-header">
                <div class="gantt-label-col"></div>
                <div class="gantt-timeline-col">${ticksHtml}</div>
            </div>
        `;

        const rowsHtml = validRows.map((r, i) => {
            const entry = new Date(r.entry).getTime();
            const target = new Date(r.target).getTime();
            const leftPct = ((entry - minDate) / totalSpan) * 100;
            const widthPct = Math.max(((target - entry) / totalSpan) * 100, 1.5);
            const color = palette[i % palette.length];
            const tooltip = `${r.label}: ${new Date(entry).toLocaleDateString('he-IL')} → ${new Date(target).toLocaleDateString('he-IL')}`;

            const hoursInfo = hoursRatioByVisit[r.visitId];
            const pct = hoursInfo ? hoursInfo.percent : 0;
            const ringTitle = hoursInfo
                ? `${hoursInfo.workedHours} שעות עבודה מתועדות מתוך ${hoursInfo.totalHours} שעות שחלפו מאז הכניסה`
                : 'אין עדיין נתוני שעות עבודה';

            return `
                <div class="gantt-row">
                    <div class="gantt-label-col">
                        <span class="mini-ring" style="--pct:${pct}" title="${ringTitle}"><span>${pct}%</span></span>
                        <span>${r.label}</span>
                    </div>
                    <div class="gantt-timeline-col">
                        <div class="gantt-bar" style="left:${leftPct}%; width:${widthPct}%; background:${color};" title="${tooltip}"></div>
                    </div>
                </div>
            `;
        }).join('');

        wrap.innerHTML = headerHtml + rowsHtml;

    } catch (error) {
        console.error('שגיאה בטעינת ציר הזמן:', error);
    }
}

// =========================================================================
// מצב תצוגה מוגדל - למסך מוקרן/ישיבה: מסך מלא + הגדלת גופנים וגרפים
// =========================================================================
function togglePresentationMode() {
    const isEntering = !document.body.classList.contains('presentation-mode');

    if (isEntering) {
        document.body.classList.add('presentation-mode');
        document.documentElement.requestFullscreen?.().catch(() => {}); // אם המשתמש חוסם מסך מלא, ממשיכים בלעדיו
        document.getElementById('presentationModeBtn').textContent = '↩️ צאי ממצב תצוגה';
    } else {
        exitPresentationMode();
    }

    // רענון כל הגרפים אחרי שינוי הגודל, כדי ש-Chart.js יתאים את עצמו לממדים החדשים
    setTimeout(() => {
        [trendsChartInstance, workloadChartInstance, fleetChartInstance, categoriesChartInstance, hoursChartInstance, employeesChartInstance]
            .forEach(chart => chart?.resize());
    }, 150);
}

function exitPresentationMode() {
    document.body.classList.remove('presentation-mode');
    document.getElementById('presentationModeBtn').textContent = '🖥️ מצב תצוגה';
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

// אם המשתמש יוצא ממסך מלא בדרך אחרת (Esc וכו') - יוצאים גם ממצב התצוגה
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('presentation-mode')) {
        exitPresentationMode();
    }
});
