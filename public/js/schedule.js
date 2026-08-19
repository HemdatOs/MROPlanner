// public/js/schedule.js

document.addEventListener('DOMContentLoaded', loadGantt);

async function loadGantt() {
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

        // שליפת יחס שעות עבודה, בנפרד ובלי לחסום את הגאנט אם זה נכשל
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
            const tooltip = `${r.label}: ${new Date(entry).toLocaleDateString('he-IL')} → ${new Date(target).toLocaleDateString('he-IL')} (לחיצה מציגה תקלות פתוחות)`;

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
                        <div class="gantt-bar" data-visit-id="${r.visitId}" data-visit-label="${r.label}"
                             style="left:${leftPct}%; width:${widthPct}%; background:${color};" title="${tooltip}"></div>
                    </div>
                </div>
            `;
        }).join('');

        wrap.innerHTML = headerHtml + rowsHtml;

        // חיבור לחיצה לכל פס - מציג את התקלות הפתוחות של אותו ביקור
        wrap.querySelectorAll('.gantt-bar').forEach(bar => {
            bar.addEventListener('click', () => {
                wrap.querySelectorAll('.gantt-bar').forEach(b => b.classList.remove('active'));
                bar.classList.add('active');
                openDrilldown(bar.dataset.visitId, bar.dataset.visitLabel);
            });
        });

    } catch (error) {
        console.error('שגיאה בטעינת הגאנט:', error);
        wrap.innerHTML = '<p class="placeholder-text">שגיאה בטעינת לוח הזמנים</p>';
    }
}

async function openDrilldown(visitId, visitLabel) {
    const panel = document.getElementById('drilldownPanel');
    const title = document.getElementById('drilldownTitle');
    const content = document.getElementById('drilldownContent');

    title.textContent = `תקלות פתוחות - ${visitLabel}`;
    content.innerHTML = '<p class="placeholder-text">טוען...</p>';
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
        const response = await fetch(`/api/reports/open-issues?visitId=${encodeURIComponent(visitId)}`);
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת התקלות');

        const issues = await response.json();

        if (!Array.isArray(issues) || issues.length === 0) {
            content.innerHTML = '<p class="placeholder-text">אין תקלות פתוחות בביקור הזה 🎉</p>';
            return;
        }

        content.innerHTML = issues.map(issue => `
            <div class="nested-issue-card">
                <div class="nested-issue-header">
                    <span class="nested-issue-number">#${issue.IssueNumber}</span>
                    <span class="nested-issue-title">${issue.Title || ''}</span>
                    <span class="badge">${issue.StatusName || '—'}</span>
                </div>
                <div class="nested-issue-meta">
                    🏢 ${issue.DepartmentName || '—'} &nbsp;·&nbsp;
                    חומרה: ${issue.SeverityName || '—'} &nbsp;·&nbsp;
                    דחיפות: ${issue.PriorityName || '—'} &nbsp;·&nbsp;
                    הוקצתה ל-${issue.AssignedToName || 'טרם שובץ'}
                </div>
                ${issue.actions && issue.actions.length > 0 ? `
                    <div class="nested-actions-list">
                        ${issue.actions.map((act, idx) => `
                            <div class="nested-action-row">
                                <span class="nested-action-index">${idx + 1}.</span>
                                <span class="nested-action-desc">${act.ActionDescription || ''}</span>
                                <span class="nested-action-status badge">${act.ActionStatusName || '—'}</span>
                                <span class="nested-action-meta">${act.SignedByName ? 'חתם: ' + act.SignedByName : ''}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : '<p class="attachments-empty">אין עדיין פעולות טיפול לתקלה זו</p>'}
            </div>
        `).join('');

    } catch (error) {
        console.error('שגיאה בטעינת תקלות לקידוח:', error);
        content.innerHTML = '<p class="placeholder-text">שגיאה בטעינת התקלות</p>';
    }
}

function closeDrilldown() {
    document.getElementById('drilldownPanel').classList.add('hidden');
    document.querySelectorAll('.gantt-bar.active').forEach(b => b.classList.remove('active'));
}
