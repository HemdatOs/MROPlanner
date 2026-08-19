// public/js/changelog.js

document.addEventListener('DOMContentLoaded', () => {
    loadVisits();
    document.getElementById('visitSelect')?.addEventListener('change', (e) => {
        if (e.target.value) loadChangeLog(e.target.value);
        else resetTable();
    });
});

async function loadVisits() {
    const select = document.getElementById('visitSelect');
    try {
        const response = await fetch('/api/visits/all');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת ביקורים');

        const visits = await response.json();
        select.innerHTML = '<option value="">-- בחר ביקור --</option>' +
            visits.map(v => `<option value="${v.VisitID}">${v.VisitID} - זנב ${v.TailNumber} (${v.CustomerName})</option>`).join('');
    } catch (error) {
        console.error('שגיאה בטעינת ביקורים:', error);
        select.innerHTML = '<option value="">שגיאה בטעינת הביקורים</option>';
    }
}

function resetTable() {
    document.getElementById('logTableBody').innerHTML =
        '<tr><td colspan="7" class="placeholder-text" style="text-align:center;">בחרי ביקור כדי לראות את הלוג</td></tr>';
}

async function loadChangeLog(visitId) {
    const tbody = document.getElementById('logTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="placeholder-text" style="text-align:center;">טוען...</td></tr>';

    try {
        const response = await fetch(`/api/changelog?visitId=${encodeURIComponent(visitId)}`);
        if (checkAuthResponse(response)) return;

        if (response.status === 403) {
            const data = await response.json().catch(() => ({}));
            tbody.innerHTML = `<tr><td colspan="7" class="placeholder-text" style="text-align:center;">${data.error || 'אין לך הרשאה לצפות בלוג זה'}</td></tr>`;
            return;
        }
        if (!response.ok) throw new Error('שגיאה בטעינת הלוג');

        const rows = await response.json();
        if (!Array.isArray(rows) || rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="placeholder-text" style="text-align:center;">אין רשומות לוג לביקור הזה</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${new Date(r.LogDateTime).toLocaleString('he-IL')}</td>
                <td>#${r.IssueNumber}</td>
                <td>${r.IssueTitle || '—'}</td>
                <td>${r.PerformedByName || '—'}</td>
                <td>${r.Comment || '—'}</td>
                <td class="log-old">${r.OldValue || '—'}</td>
                <td class="log-new">${r.NewValue || '—'}</td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('שגיאה בטעינת לוג שינויים:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="placeholder-text" style="text-align:center;">שגיאה בטעינת הלוג</td></tr>';
    }
}
