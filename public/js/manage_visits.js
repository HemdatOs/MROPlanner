// public/js/manage_visits.js

let allVisits = [];
let currentSessionUser = null; // המשתמש המחובר כרגע - קובע מי רשאי לחתום, לא נבחר מרשימה

document.addEventListener('DOMContentLoaded', () => {
    loadCurrentSessionUser();
    loadVisits();
    document.getElementById('visitEditForm')?.addEventListener('submit', handleVisitEditSubmit);
    document.getElementById('newVisitForm')?.addEventListener('submit', handleNewVisitSubmit);
});

function loadCurrentSessionUser() {
    const userRaw = sessionStorage.getItem('loggedInUser');
    if (!userRaw) return;
    try {
        currentSessionUser = JSON.parse(userRaw);
    } catch (err) {
        console.error('שגיאה בקריאת פרטי המשתמש המחובר:', err);
    }
}



// =========================================================================
// פתיחת ביקור חדש - טעינת רשימות עזר (מטוסים/לקוחות/עמדות)
// =========================================================================
async function loadNewVisitLookups() {
    try {
        const [aircraftRes, customersRes, hangarRes] = await Promise.all([
            fetch('/api/aircraft'),
            fetch('/api/customers'),
            fetch('/api/hangar')
        ]);

        if (checkAuthResponse(aircraftRes) || checkAuthResponse(customersRes) || checkAuthResponse(hangarRes)) return;

        const aircraftList = await aircraftRes.json();
        const customersList = await customersRes.json();
        const hangarList = await hangarRes.json();

        const aircraftSelect = document.getElementById('newVisitAircraft');
        aircraftSelect.innerHTML = '<option value="">-- בחר מטוס קיים --</option>' +
            aircraftList.map(a => `<option value="${a.SerialNumber}">${a.TailNumber} (${a.CustomerName || 'ללא לקוח'})</option>`).join('');

        const customerSelect = document.getElementById('newVisitCustomer');
        customerSelect.innerHTML = '<option value="">-- בחר לקוח קיים --</option>' +
            customersList.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

        const hangarSelect = document.getElementById('newVisitHangar');
        hangarSelect.innerHTML = '<option value="">-- בחר עמדה --</option>' +
            hangarList.map(h => `<option value="${h.HangarLocationID}">${h.HangarPosition || h.HangarLocationID}</option>`).join('');

    } catch (error) {
        console.error('שגיאה בטעינת רשימות עזר לפתיחת ביקור:', error);
    }
}

function openNewVisitPanel() {
    loadNewVisitLookups();
    const panel = document.getElementById('newVisitPanel');
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeNewVisitPanel() {
    document.getElementById('newVisitPanel').classList.add('hidden');
    document.getElementById('newVisitForm').reset();
    document.getElementById('newAircraftFields').classList.add('hidden');
    document.getElementById('newAircraftCustomerWrap').classList.add('hidden');
    document.getElementById('newCustomerFields').classList.add('hidden');
}

function toggleNewAircraftFields(checkbox) {
    document.getElementById('newAircraftFields').classList.toggle('hidden', !checkbox.checked);
    document.getElementById('newAircraftCustomerWrap').classList.toggle('hidden', !checkbox.checked);
    document.getElementById('newVisitAircraft').disabled = checkbox.checked;
    if (!checkbox.checked) {
        document.getElementById('newCustomerFields').classList.add('hidden');
        document.getElementById('newCustomerToggle').checked = false;
    }
}

function toggleNewCustomerFields(checkbox) {
    document.getElementById('newCustomerFields').classList.toggle('hidden', !checkbox.checked);
    document.getElementById('newVisitCustomer').disabled = checkbox.checked;
}

async function handleNewVisitSubmit(e) {
    e.preventDefault();

    try {
        let serialNumber = document.getElementById('newVisitAircraft').value;
        const isNewAircraft = document.getElementById('newAircraftToggle').checked;

        if (isNewAircraft) {
            let customerId = document.getElementById('newVisitCustomer').value;
            const isNewCustomer = document.getElementById('newCustomerToggle').checked;

            if (isNewCustomer) {
                const customerPayload = {
                    CustomerName: document.getElementById('newCustomerName').value,
                    RepresentativeName: document.getElementById('newCustomerRep').value,
                    RepresentativeEmail: document.getElementById('newCustomerEmail').value,
                    Address: document.getElementById('newCustomerAddress').value
                };
                if (!customerPayload.CustomerName) {
                    alert('שם הלקוח הוא שדה חובה');
                    return;
                }
                const custRes = await fetch('/api/customers', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(customerPayload)
                });
                if (checkAuthResponse(custRes)) return;
                if (!custRes.ok) { const e = await custRes.json().catch(() => ({})); throw new Error(e.error || 'שגיאה ביצירת לקוח'); }
                const custData = await custRes.json();
                customerId = custData.id;
            }

            if (!customerId) {
                alert('יש לבחור לקוח קיים או ליצור לקוח חדש');
                return;
            }

            serialNumber = document.getElementById('newAircraftSerial').value;
            const aircraftPayload = {
                SerialNumber: serialNumber,
                TailNumber: document.getElementById('newAircraftTail').value,
                Model: document.getElementById('newAircraftModel').value,
                CustomerId: customerId
            };
            if (!aircraftPayload.SerialNumber || !aircraftPayload.TailNumber) {
                alert('מספר סידורי ומספר זנב הם שדות חובה למטוס חדש');
                return;
            }
            const acRes = await fetch('/api/aircraft', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(aircraftPayload)
            });
            if (checkAuthResponse(acRes)) return;
            if (!acRes.ok) { const e = await acRes.json().catch(() => ({})); throw new Error(e.error || 'שגיאה ביצירת מטוס'); }
        }

        if (!serialNumber) {
            alert('יש לבחור מטוס קיים או להזין פרטי מטוס חדש');
            return;
        }

        const hangarLocationId = document.getElementById('newVisitHangar').value;
        if (!hangarLocationId) {
            alert('יש לבחור עמדת האנגר');
            return;
        }

        const targetDate = document.getElementById('newVisitTargetDate').value;

        const visitPayload = {
            SerialNumber: serialNumber,
            HangarLocationID: hangarLocationId,
            TargetLeaveDate: targetDate ? targetDate.replace('T', ' ') + ':00' : null
        };

        const visitRes = await fetch('/api/visits', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(visitPayload)
        });
        if (checkAuthResponse(visitRes)) return;
        if (!visitRes.ok) { const e = await visitRes.json().catch(() => ({})); throw new Error(e.error || 'שגיאה בפתיחת ביקור'); }

        const visitData = await visitRes.json();
        alert(`הביקור ${visitData.VisitID} נפתח בהצלחה!`);
        closeNewVisitPanel();
        await loadVisits();

    } catch (error) {
        console.error('שגיאה בפתיחת ביקור חדש:', error);
        alert('שגיאה: ' + error.message);
    }
}

// ממירה datetime של MySQL (או ISO) לפורמט ש-input[type=datetime-local] מבין
function toDatetimeLocalValue(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadVisits() {
    try {
        const response = await fetch('/api/visits/all');
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת ביקורים');

        allVisits = await response.json();
        renderVisitsTable();

    } catch (error) {
        console.error('שגיאה בטעינת ביקורים:', error);
        const tbody = document.getElementById('visitsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="placeholder-text" style="text-align:center;">שגיאה בטעינת הביקורים</td></tr>';
    }
}

function renderVisitsTable() {
    const tbody = document.getElementById('visitsTableBody');
    if (!tbody) return;

    if (!Array.isArray(allVisits) || allVisits.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="placeholder-text" style="text-align:center;">אין ביקורים במערכת</td></tr>';
        return;
    }

    tbody.innerHTML = allVisits.map(visit => {
        let statusBadge;
        if (visit.LeaveDate) {
            statusBadge = '<span class="badge visit-closed">הסתיים</span>';
        } else if (visit.QAApprovedBy) {
            statusBadge = '<span class="badge visit-waiting">ממתין לחתימת מנהל</span>';
        } else {
            statusBadge = '<span class="badge visit-active">פעיל</span>';
        }

        return `
            <tr onclick="openVisitEditPanel('${visit.VisitID}')">
                <td>${visit.VisitID}</td>
                <td>${visit.TailNumber || '—'}</td>
                <td>${visit.CustomerName || '—'}</td>
                <td>${visit.HangarPosition || visit.HangarLocationID || '—'}</td>
                <td>${visit.EntryDate ? new Date(visit.EntryDate).toLocaleString('he-IL') : '—'}</td>
                <td>${visit.TargetLeaveDate ? new Date(visit.TargetLeaveDate).toLocaleString('he-IL') : '—'}</td>
                <td>${visit.LeaveDate ? new Date(visit.LeaveDate).toLocaleString('he-IL') : '—'}</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join('');
}

function openVisitEditPanel(visitId) {
    const visit = allVisits.find(v => v.VisitID === visitId);
    if (!visit) return;

    document.getElementById('editingVisitId').value = visit.VisitID;
    document.getElementById('visitEditTitle').textContent = `עריכת ביקור ${visit.VisitID} (${visit.TailNumber || ''})`;
    renderVisitInfoBlock(visit);
    document.getElementById('editTargetLeaveDate').value = toDatetimeLocalValue(visit.TargetLeaveDate);
    renderSignoffStatus(visit);

    // עריכת יעד יציאה אסורה לעובד רגיל (Technician) - נעילה בממשק, השרת אוכף את זה גם ככה
    const isTechnician = currentSessionUser?.permissionCode === 6;
    document.getElementById('editTargetLeaveDate').disabled = isTechnician;
    const saveTargetBtn = document.querySelector('#visitEditForm button[type="submit"]');
    if (saveTargetBtn) {
        saveTargetBtn.disabled = isTechnician;
        saveTargetBtn.title = isTechnician ? 'עובדים רגילים אינם רשאים לערוך יעד יציאה' : '';
    }

    const panel = document.getElementById('visitEditPanel');
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeVisitEditPanel() {
    document.getElementById('visitEditPanel').classList.add('hidden');
    document.getElementById('visitEditForm').reset();
    document.getElementById('editingVisitId').value = '';
    document.getElementById('actualLeaveDateWrap').classList.add('hidden');
}

// מציגה את כל פרטי הביקור לקריאה בלבד - זנב, לקוח, מגדל, כניסה, יציאה בפועל (אם נסגר)
function renderVisitInfoBlock(visit) {
    const block = document.getElementById('visitInfoBlock');
    if (!block) return;

    const rows = [
        ['זנב', visit.TailNumber],
        ['דגם', visit.Model],
        ['לקוח', visit.CustomerName],
        ['מיקום במגדל', visit.HangarPosition || visit.HangarLocationID],
        ['כניסה', visit.EntryDate ? new Date(visit.EntryDate).toLocaleString('he-IL') : null],
        ['יציאה בפועל', visit.LeaveDate ? new Date(visit.LeaveDate).toLocaleString('he-IL') : null]
    ];

    block.innerHTML = rows.map(([label, value]) => `
        <div>
            <div class="info-label">${label}</div>
            <div class="info-value">${value || '—'}</div>
        </div>
    `).join('');
}

// מציגה את מצב החתימות הנוכחי, ומחליטה אם כפתור החתימה פעיל/מוסתר/כתוב אחרת
function renderSignoffStatus(visit) {
    const statusEl = document.getElementById('visitSignoffStatus');
    const signBtn = document.getElementById('signVisitBtn');
    const rejectBtn = document.getElementById('rejectVisitBtn');

    const lines = [];

    if (visit.LeaveDate) {
        lines.push(`<span class="signoff-closed">🔒 הביקור נסגר סופית ב-${new Date(visit.LeaveDate).toLocaleString('he-IL')}</span>`);
        signBtn.style.display = 'none';
        rejectBtn.classList.add('hidden');
        document.getElementById('actualLeaveDateWrap').classList.add('hidden');
        statusEl.innerHTML = lines.join('');
        return;
    }

    if (visit.QAApprovedBy) {
        lines.push(`<span class="signoff-done">✅ נחתם ע"י מבקר איכות ב-${new Date(visit.QAApprovedAt).toLocaleString('he-IL')}</span>`);
        lines.push('<span class="signoff-waiting">⏳ ממתין לחתימת מנהל בכיר</span>');
    } else {
        lines.push('<span class="signoff-waiting">⏳ טרם נחתם - ממתין לחתימת מבקר איכות</span>');
    }

    statusEl.innerHTML = lines.join('');
    signBtn.style.display = 'inline-flex';
    // כפתור הדחייה רלוונטי רק בשלב "ממתין למנהל" - זו הפעולה השנייה שיש למנהל, מלבד חתימה סופית
    rejectBtn.classList.toggle('hidden', !visit.QAApprovedBy);

    // שדה תאריך היציאה בפועל מוצג רק בשלב חתימת המנהל (אחרי ש-QA כבר חתם) - ברירת מחדל "עכשיו", ניתן לערוך אחורה
    const leaveDateWrap = document.getElementById('actualLeaveDateWrap');
    const leaveDateInput = document.getElementById('actualLeaveDateInput');
    if (visit.QAApprovedBy) {
        leaveDateWrap.classList.remove('hidden');
        leaveDateInput.value = toDatetimeLocalValue(new Date());
    } else {
        leaveDateWrap.classList.add('hidden');
    }

    // הכיתוב על הכפתור עצמו נקבע לפי מה שהמשתמש המחובר יכול לחתום עליו (רק תצוגה - השרת מאמת בפועל)
    const myPermission = currentSessionUser?.permissionCode;
    if (myPermission === 5 && !visit.QAApprovedBy) {
        signBtn.textContent = '✍️ חתום כמבקר איכות';
    } else if (myPermission === 2 && visit.QAApprovedBy) {
        signBtn.textContent = '✍️ חתום כמנהל בכיר (סגירה סופית)';
    } else {
        signBtn.textContent = '✍️ חתום על סגירת הביקור';
    }
}

async function handleRejectVisit() {
    const visitId = document.getElementById('editingVisitId').value;
    if (!visitId) return;

    const confirmed = confirm('אזהרה: פעולה זו תמחק את חתימת מבקר האיכות ותחזיר את הביקור למצב פעיל (ממתין לבדיקה מחדש). להמשיך?');
    if (!confirmed) return;

    try {
        const response = await fetch(`/api/visits/${encodeURIComponent(visitId)}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (checkAuthResponse(response)) return;
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            alert(data.error || 'שגיאה בביטול החתימה');
            return;
        }

        alert(data.message || 'החתימה בוטלה');
        await loadVisits();

        const updatedVisit = allVisits.find(v => v.VisitID === visitId);
        if (updatedVisit) renderSignoffStatus(updatedVisit);

    } catch (error) {
        console.error('שגיאה בביטול חתימה:', error);
        alert('שגיאה: ' + error.message);
    }
}

async function handleSignVisit() {
    const visitId = document.getElementById('editingVisitId').value;
    if (!visitId) return;

    // בדיקה שקטה קודם - לפני שמראים בכלל את שאלת "בטוח שברצונך לחתום?"
    try {
        const checkResponse = await fetch(`/api/visits/${encodeURIComponent(visitId)}/close-checks`);
        if (checkAuthResponse(checkResponse)) return;
        const checkData = await checkResponse.json().catch(() => ({}));

        if (!checkResponse.ok || !checkData.eligible) {
            alert(checkData.reason || 'לא ניתן לחתום כרגע');
            return;
        }
    } catch (error) {
        console.error('שגיאה בבדיקת אפשרות חתימה:', error);
        alert('שגיאה בבדיקה מקדימה: ' + error.message);
        return;
    }

    const confirmed = confirm('האם את בטוחה שברצונך לחתום? האם בדקת שכל התקלות בביקור נסגרו לפני החתימה?');
    if (!confirmed) return;

    const leaveDateWrap = document.getElementById('actualLeaveDateWrap');
    const payload = {};
    if (!leaveDateWrap.classList.contains('hidden')) {
        const leaveDateVal = document.getElementById('actualLeaveDateInput').value;
        if (leaveDateVal) payload.LeaveDate = leaveDateVal.replace('T', ' ') + ':00';
    }

    try {
        const response = await fetch(`/api/visits/${encodeURIComponent(visitId)}/sign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (checkAuthResponse(response)) return;
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            alert(data.error || 'שגיאה בחתימה');
            return;
        }

        alert(data.message || 'נחתם בהצלחה');
        await loadVisits();

        const updatedVisit = allVisits.find(v => v.VisitID === visitId);
        if (updatedVisit) renderSignoffStatus(updatedVisit);

    } catch (error) {
        console.error('שגיאה בחתימה על ביקור:', error);
        alert('שגיאה בחתימה: ' + error.message);
    }
}

async function handleVisitEditSubmit(e) {
    e.preventDefault();
    const visitId = document.getElementById('editingVisitId').value;
    if (!visitId) return;

    const targetLeave = document.getElementById('editTargetLeaveDate').value;

    const payload = {
        TargetLeaveDate: targetLeave ? targetLeave.replace('T', ' ') + ':00' : null
    };

    try {
        const response = await fetch(`/api/visits/${encodeURIComponent(visitId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (checkAuthResponse(response)) return;
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'שגיאה בשמירת השינויים');
        }

        closeVisitEditPanel();
        await loadVisits();

    } catch (error) {
        console.error('שגיאה בעדכון ביקור:', error);
        alert('שגיאה בשמירה: ' + error.message);
    }
}
