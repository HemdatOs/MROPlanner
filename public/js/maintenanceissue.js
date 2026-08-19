// ==========================================
// משתנים גלובליים
// ==========================================
let cachedCategories = [];
let cachedDepartments = [];
let cachedActionStatuses = [];
let actionIndex = 0;
let stagedAttachments = []; // קבצים שנבחרו ע"י המשתמש וממתינים להעלאה לאחר שמירת התקלה
let actionAttachmentsMap = {}; // uid של כרטיס פעולה -> מערך קבצים שצורפו אליו

// ==========================================
// אתחול ראשי עם טעינת הדף
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. בדיקת התחברות ב-sessionStorage
    const userRaw = sessionStorage.getItem('loggedInUser');
    if (!userRaw) {
        window.location.href = 'login.html';
        return;
    }

    // 2. תפיסת אלמנטים מרכזיים
    const deptSelect = document.getElementById('DepartmentCode') || document.getElementById('departmentSelect'); 
    const assignedSelect = document.getElementById('assingTo'); // שדה טכנאי
    const createdBySelect = document.getElementById('createdBy'); // שדה דווח ע"י
    const activeVisitsSelect = document.getElementById('activeVisitsSelect');
    const actionBtn = document.getElementById('addActionBtn');
    const issueForm = document.getElementById('issueForm');
    const categorySelect = document.getElementById('FaultCategory');
    const visitCard = document.getElementById('visitCard');

    // 3. הגדרת מצב התחלתי לשדה הטכנאים
    if (assignedSelect) {
        assignedSelect.innerHTML = '<option value="">קודם בחר מחלקת אחזקה...</option>';
        assignedSelect.disabled = true;
    }

    // 4. טעינות ראשוניות מהשרת (חייב להסתיים לפני בדיקת ערכים קיימים)
    await fetchDropdownData(); 
    loadActiveVisitsDropdown(); 

    // 5. בדיקה האם כבר נבחרה מחלקה מראש (רק לאחר שהנתונים נטענו)
    if (deptSelect && deptSelect.value) {
        loadUsersForDepartment(deptSelect.value);
    }

    // 6. מאזיני אירועים כלליים
    if (actionBtn) actionBtn.addEventListener('click', addActionCard);
    if (issueForm) issueForm.addEventListener('submit', handleFormSubmit);
    if (categorySelect) categorySelect.addEventListener('change', handleCategoryChange);
    initAttachmentsUI();

    // 7. לוגיקת ביקורים פעילים
    if (activeVisitsSelect) {
        activeVisitsSelect.addEventListener('change', (event) => {
            const selectedVisitId = event.target.value;
            if (selectedVisitId) {
                fetchVisitDetails(selectedVisitId);
            } else if (visitCard) {
                visitCard.style.display = 'none';
            }
        });
    }

    // 8. לוגיקת מחלקות ועדכון טכנאים
    if (deptSelect && assignedSelect) {
        deptSelect.addEventListener('change', (event) => {
            const selectedDeptCode = event.target.value;
            loadUsersForDepartment(selectedDeptCode);
            handleDepartmentChange(event);
        });
    }
    // 2. האזנה לשינוי הקלדה בשדות מספר עובד (גם על כרטיסים שייווצרו בעתיד)
// האזנה גלובלית לכל שדות המבצע/חותם בדף (גם לכרטיסים חדשים)
document.addEventListener('input', (e) => {
    if (e.target.matches('.act-signed')) {
        updateEmployeeNameFromMemory(e.target);
    }
});
});


// ==========================================
// שליפת נתונים ראשוניים (Lookups)
// ==========================================
async function fetchDropdownData() {
    try {
        const response = await fetch('/api/lookups/lookup');

        // 🛡️ בדיקת התנתקות (פג תוקף 40 דק' / איפוס שרת)
        if (checkAuthResponse(response)) return;

        if (!response.ok) throw new Error(`שגיאת שרת: ${response.status}`);

        const data = await response.json(); 

        cachedDepartments = data.departments || [];
        cachedCategories = data.categories || [];
        cachedActionStatuses = data.actionStatuses || [];

        // 1. עיבוד המחלקות (ללא שינוי)
        const formattedDepartments = cachedDepartments.map(dept => {
            const id = dept.id ?? dept.DepartmentCode ?? dept.code;
            const name = dept.name ?? dept.DepartmentName ?? '';

            return {
                id: id,
                name: name
            };
        });

        // 🟢 עיבוד ה-Lookups מ-MySQL כדי ש-populateSelect יקבל id ו-name
        const formattedCategories = (data.categories || []).map(cat => ({
            id: cat.id ?? cat.CategoryId ?? cat.code,
            name: cat.name ?? cat.CategoryName ?? ''
        }));

        const formattedSeverities = (data.severities || []).map(sev => ({
            id: sev.id ?? sev.SeverityId ?? sev.code,
            name: sev.name ?? sev.SeverityName ?? ''
        }));

        const formattedPriorities = (data.priorities || []).map(pri => ({
            id: pri.id ?? pri.PriorityId ?? pri.code,
            name: pri.name ?? pri.PriorityName ?? ''
        }));

        const formattedStatuses = (data.statuses || []).map(st => ({
            id: st.id ?? st.StatusID ?? st.code,
            name: st.name ?? st.StatusName ?? ''
        }));

        // 2. אכלוס רשימות הבחירה הכלליות
        populateSelect('FaultCategory', formattedCategories);
        populateSelect('SeverityId', formattedSeverities);
        populateSelect('PriorityId', formattedPriorities);
        populateSelect('StatusID', formattedStatuses);
        populateSelect('DepartmentCode', formattedDepartments);

        // 3. אכלוס שדה המדווח (createdBy) - ללא שינוי!
        populateUserSelect('createdBy', data.users);

        // 4. בחירת המשתמש המחובר אוטומטית ל-createdBy - ללא שינוי!
        autoSelectLoggedInUser();

    } catch (error) {
        console.error("שגיאה בטעינת הרשימות:", error);
    }
}

// ==========================================
// טעינת עובדי מחלקה ובחירת מנהל/עובד ברירת מחדל
// ==========================================
async function loadUsersForDepartment(deptCode) {
    const assignedSelect = document.getElementById('assingTo');
    if (!assignedSelect) return;

    if (!deptCode) {
        assignedSelect.innerHTML = '<option value="">קודם בחר מחלקת אחזקה...</option>';
        assignedSelect.disabled = true;
        return;
    }

    try {
        assignedSelect.disabled = false;
        assignedSelect.innerHTML = '<option value="">טוען עובדי מחלקה...</option>';

        const response = await fetch(`/api/maintanace_calls/departments/${encodeURIComponent(deptCode)}/users`);
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('שגיאה בטעינת עובדי המחלקה מהשרת');
        const data = await response.json(); 
        console.log("נתוני עובדי מחלקה שהתקבלו:", data); // לבדיקה בקונסול (F12)

        let usersList = [];
        let managerId = null;

        if (Array.isArray(data)) {
            usersList = data;
        } else if (data && typeof data === 'object') {
            usersList = data.users || data.data || [];
            // תמיכה בכל צורות הרישום של המנהל (אותיות גדולות/קטנות מה-DB)
            managerId = data.managerEmployeeId ?? data.ManagerEmployeeId ?? data.managerId ?? data.ManagerId ?? null;
        }

        // אכלוס הרשימה והוספת התגית (מנהל מחלקה)
        populateUserSelect('assingTo', usersList, managerId);

        // 1. ניסיון בחירה במנהל המחלקה
        let selectedValue = null;
        if (managerId !== null && managerId !== undefined && String(managerId).trim() !== '') {
            selectedValue = String(managerId).trim();
        } 
        // 2. גיבוי: אם אין מנהל מוגדר, נבחר את העובד הראשון ברשימה
        else if (usersList.length > 0) {
            const firstUser = usersList[0];
            selectedValue = String(firstUser.EmployeeId ?? firstUser.employeeId ?? firstUser.userId ?? firstUser.id ?? '').trim();
        }

        if (selectedValue) {
            assignedSelect.value = selectedValue;
        }

    } catch (error) {
        console.error('Error fetching department users:', error);
        assignedSelect.innerHTML = '<option value="">שגיאה בטעינת עובדים</option>';
        assignedSelect.disabled = true;
    }
}


function populateUserSelect(elementId, users, managerId = null) {
    const select = document.getElementById(elementId);
    if (!select) return;

    select.innerHTML = '<option value="">בחר...</option>';

    if (!Array.isArray(users) || users.length === 0) return;

    users.forEach(user => {
        const option = document.createElement('option');
        
        const userId = user.UserId ?? user.userId ?? user.id;
        const empId = user.EmployeeId ?? user.employeeId ?? '';
        
        const firstName = user.UserName ?? user.userName ?? user.FirstName ?? user.firstName ?? '';
        const lastName = user.UserLastName ?? user.userLastName ?? user.LastName ?? user.lastName ?? '';
        const fullName = user.displayName || user.fullName || [firstName, lastName].filter(Boolean).join(' ') || '';

        const valStr = userId !== undefined && userId !== null ? String(userId).trim() : '';
        const empStr = empId !== undefined && empId !== null ? String(empId).trim() : '';
        const managerStr = managerId !== undefined && managerId !== null ? String(managerId).trim() : '';
        
        const isManager = managerStr !== '' && (valStr === managerStr || empStr === managerStr);
        const roleTag = isManager ? ' (מנהל מחלקה)' : '';

        option.value = valStr; // שומר UUID עבור ה-DB
        if (empStr) option.dataset.employeeId = empStr; // שומר EmployeeId כגיבוי

        // 🧠 מנגנון למניעת כפילות במספר העובד:
        let displayLabel = fullName;
        if (empStr && !fullName.includes(empStr)) {
            // מוסיף את מספר העובד רק אם הוא לא מופיע כבר בשם המלא
            displayLabel = `${empStr} - ${fullName}`;
        } else if (!fullName) {
            displayLabel = empStr;
        }

        option.textContent = `${displayLabel}${roleTag}`.trim();
        
        select.appendChild(option);
    });
}

function autoSelectLoggedInUser() {
  const select = document.getElementById('createdBy');
    if (!select) return;

    // 1. קריאה ישירה מה-sessionStorage
    const savedUser = sessionStorage.getItem('loggedInUser');
    if (!savedUser) return;

    try {
        const user = JSON.parse(savedUser);
        
        // 2. יצירת האופציה ישירות מהנתונים הקיימים
        const empId = user.employeeId;   // 1001
        const name = user.fullName;      // Hemdat Os

        if (empId && name) {
            // שתילת האופציה בתוך ה-Select ובחירתה מראש
            select.innerHTML = `<option value="${empId}" selected>${empId} - ${name}</option>`;
        }
    } catch (err) {
        console.error('שגיאה בשליפת המשתמש מהסשן:', err);
    }
}
// ==========================================
// פונקציית בחירה חכמה - מזהה גם לפי UUID וגם לפי EmployeeId
// ==========================================
function setSelectedUserInSelect(elementId, targetId) {
    const select = document.getElementById(elementId);
    if (!select || !targetId) return;

    const targetStr = String(targetId).trim();

    // 1. ניסיון בחירה ישיר לפי ה-value (UserId / UUID)
    select.value = targetStr;

    // 2. גיבוי: אם לא נמצאה התאמה, סריקה לפי data-employee-id (מספר עובד קצר)
    if (select.value !== targetStr) {
        for (let option of select.options) {
            if (option.value === targetStr || option.dataset.employeeId === targetStr) {
                option.selected = true;
                break;
            }
        }
    }
}

// מילוי כללי ל-select רגילים
function populateSelect(elementId, items) {
    const select = document.getElementById(elementId);
    if (!select) return;

    select.innerHTML = '<option value="">בחר...</option>';

    if (!Array.isArray(items)) return;

    items.forEach(item => {
        const option = document.createElement('option');
        
        const val = item.id ?? item.Code ?? item.code ?? item.value ?? item.CategoryId ?? item.SeverityId ?? item.PriorityId ?? item.StatusID ?? item.DepartmentCode;
        const text = item.name ?? item.Name ?? item.description ?? item.Description ?? item.label ?? item.text ?? item.CategoryName ?? item.SeverityName ?? item.PriorityName ?? item.StatusName ?? item.DepartmentName;

        option.value = val !== undefined ? String(val) : '';
        option.textContent = text !== undefined ? String(text) : String(val);

        select.appendChild(option);
    });
}



// ==========================================
// טיפול בשינויים בשדות (Change Handlers)
// ==========================================
function handleDepartmentChange(event) {
    const selectedDeptId = event.target.value;
    const descBox = document.getElementById('deptDescBox');
    const descText = document.getElementById('deptDescText');

    if (!descBox || !descText) return;

    if (!selectedDeptId) {
        descBox.classList.add('hidden');
        descText.textContent = '';
        return;
    }

    const selectedDept = cachedDepartments.find(
        dept => (dept.DepartmentCode ?? dept.id) == selectedDeptId
    );

    if (selectedDept && (selectedDept.Description || selectedDept.description)) {
        descText.textContent = selectedDept.Description || selectedDept.description;
        descBox.classList.remove('hidden');
    } else {
        descBox.classList.add('hidden');
        descText.textContent = '';
    }
}

function handleCategoryChange(event) {
    const selectedCategoryId = event.target.value;
    const descBox = document.getElementById('categoryDescBox');
    const descText = document.getElementById('categoryDescText');

    if (!descBox || !descText) return;

    if (!selectedCategoryId) {
        descBox.classList.add('hidden');
        descText.textContent = '';
        return;
    }

    const selectedCategory = cachedCategories.find(
        cat => (cat.FaultCategoryId ?? cat.id) == selectedCategoryId
    );

    if (selectedCategory && (selectedCategory.Description || selectedCategory.description)) {
        descText.textContent = selectedCategory.Description || selectedCategory.description;
        descBox.classList.remove('hidden');
    } else {
        descBox.classList.add('hidden');
        descText.textContent = '';
    }
}


// פונקציית עזר להצגה/הסתרה של שדות המספר הסידורי
function toggleSerialFields(checkbox) {
    const card = checkbox.closest('.action-card');
    const serialFields = card ? card.querySelector('.serial-fields') : null;
    if (serialFields) {
        serialFields.style.display = checkbox.checked ? 'grid' : 'none';
        if (!checkbox.checked) {
            // איפוס הערכים אם ה-Checkbox שוב סומן כלא רלוונטי
            card.querySelector('.act-old-sn').value = '';
            card.querySelector('.act-new-sn').value = '';
        }
    }
}

function addActionCard() {
    const container = document.getElementById('actionsContainer');
    if (!container) return;

    const actionIndex = container.children.length + 1;

    // שליפת העובד המחובר מ-sessionStorage ברירת מחדל
    const loggedInUserRaw = sessionStorage.getItem('loggedInUser');
    let defaultEmpId = '';
    // אם קיים עובד מחובר דיפולטיבי, נבצע עבורו בדיקת שם מידית
    if (defaultEmpId) {
        const lastCard = container.lastElementChild;
        const signedInput = lastCard.querySelector('.act-signed');
        // 👇 התיקון כאן: שימוש בפונקציה מהזיכרון
        if (signedInput) updateEmployeeNameFromMemory(signedInput); 
    }


    // פורמט תאריך וזמן נוכחי בשביל input datetime-local
    const now = new Date();
    const localIsoDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);

    // מזהה ייחודי לכרטיס - משמש לשיוך קבצים מצורפים אחרי השמירה
    const uid = 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    actionAttachmentsMap[uid] = [];

    const cardHTML = `
        <div class="action-card" data-uid="${uid}">

            <!-- כותרת וכפתור הסרה -->
            <div class="action-stub-header">
                <h3 class="stub-index">✂ פעולה #${actionIndex}</h3>
                <button type="button" class="btn btn-danger btn-sm" onclick="this.closest('.action-card').remove()">הסר</button>
            </div>

            <!-- שורה 1: תיאור ותאריך -->
            <div class="grid-2">
                <div class="form-group">
                    <label>תיאור הפעולה (ActionDescription) <span class="required">*</span></label>
                    <input type="text" class="act-desc" required placeholder="למשל: לקיחת דגימת שמן">
                </div>
                <div class="form-group">
                    <label>תאריך וזמן (ActionDate)</label>
                    <input type="datetime-local" class="act-date" value="${localIsoDate}">
                </div>
            </div>

            <!-- שורה 2: סטטוס, מבצע, ספרות טכנית -->
            <div class="grid-3">
                <div class="form-group">
                    <label>סטטוס פעולה (ActionStatus)</label>
                    <select class="act-status">
                        ${cachedActionStatuses.map(s => {
                            const isCompleted = String(s.name || '').includes('שלמ'); // ברירת מחדל הגיונית: "הושלמה"
                            return `<option value="${s.id}" ${isCompleted ? 'selected' : ''}>${s.name}</option>`;
                        }).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>מבצע/חותם (מספר עובד):</label>
                    <input type="text" class="act-signed" placeholder="הקלד מספר עובד..." value="${defaultEmpId}">
                    <span class="act-employee-name employee-tag"></span>
                    <span class="act-employee-name employee-tag"></span>
                </div>
                <div class="form-group">
                    <label>ספרות טכנית (ActionLiteratureRef)</label>
                    <input type="text" class="act-lit" placeholder="AMM-30-10-11">
                </div>
            </div>

            <!-- שורה 3: רכיב טורי (Checkbox) -->
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" class="act-serialized-cb" onchange="toggleSerialFields(this)">
                    <span>האם הוחלף רכיב מנוהל סיראלי (Serialized Part)</span>
                </label>
            </div>

            <!-- שורה 4: מספרי סדרה (מוסתר כברירת מחדל) -->
            <div class="serial-fields grid-2" style="display: none;">
                <div class="form-group">
                    <label>מספר סידורי ישן (Old S/N)</label>
                    <input type="text" class="act-old-sn" placeholder="הזן מספר ישן">
                </div>
                <div class="form-group">
                    <label>מספר סידורי חדש (New S/N)</label>
                    <input type="text" class="act-new-sn" placeholder="הזן מספר חדש">
                </div>
            </div>

            <!-- שורה 5: צירוף מסמכים לפעולה הספציפית הזו -->
            <div class="form-group">
                <label class="btn btn-outline" style="cursor:pointer; font-size:0.82rem; padding:0.45rem 0.9rem;">
                    📎 צרף מסמך לפעולה זו
                    <input type="file" class="hidden" multiple onchange="handleActionFileSelect(this, '${uid}')">
                </label>
                <div class="attachments-list" id="attach-list-${uid}">
                    <p class="attachments-empty">לא צורפו קבצים לפעולה זו</p>
                </div>
            </div>

        </div>
    `;

    container.insertAdjacentHTML('beforeend', cardHTML);

    // אם קיים עובד מחובר דיפולטיבי, נבצע עבורו בדיקת שם מידית
    if (defaultEmpId) {
        const lastCard = container.lastElementChild;
        const signedInput = lastCard.querySelector('.act-signed');
        if (signedInput) fetchAndDisplayEmployeeName(signedInput);
    }
}

// פונקציה לאכלוס ה-Datalist עבור ה-Autocomplete בפעולות
function populateEmployeeDatalist(users) {
    const datalist = document.getElementById('employeesDatalist');
    if (!datalist || !Array.isArray(users)) return;

    datalist.innerHTML = ''; // איפוס

    users.forEach(user => {
        const option = document.createElement('option');
        
        // שליפת מזהים ושמות
        const userId = user.UserId ?? user.userId ?? '';
        const empId = user.EmployeeId ?? user.employeeId ?? '';
        const firstName = user.UserName ?? user.userName ?? user.FirstName ?? '';
        const lastName = user.UserLastName ?? user.userLastName ?? user.LastName ?? '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ');

        // ה-value שיוצג בבחירה (מספר עובד - שם עובד)
        option.value = empId || userId;
        option.label = fullName ? `${fullName}` : '';
        
        // שמירת ה-UUID כמאפיין נסתר במידה וה-DB מצפה ל-UUID
        if (userId) option.dataset.userId = userId;

        datalist.appendChild(option);
    });
}
function removeCard(cardId) {
    const card = document.getElementById(cardId);
    if (card) card.remove();
}

// ==========================================
// ניהול מסמכים מצורפים לתקלה (Attachments)
// ==========================================
function initAttachmentsUI() {
    const input = document.getElementById('issueAttachmentsInput');
    if (!input) return; // הדף עדיין לא כולל את אזור הצירופים

    input.addEventListener('change', () => {
        Array.from(input.files).forEach(file => stagedAttachments.push(file));
        input.value = ''; // מאפשר לבחור שוב אותו קובץ אם הוסר בטעות
        renderAttachmentsList();
    });

    renderAttachmentsList();
}

function renderAttachmentsList() {
    const list = document.getElementById('attachmentsList');
    if (!list) return;

    if (stagedAttachments.length === 0) {
        list.innerHTML = '<p class="attachments-empty">לא צורפו קבצים עדיין</p>';
        return;
    }

    list.innerHTML = stagedAttachments.map((file, idx) => `
        <span class="attachment-chip">
            📎 ${file.name}
            <button type="button" class="remove-chip" onclick="removeStagedAttachment(${idx})" title="הסר קובץ">✕</button>
        </span>
    `).join('');
}

function removeStagedAttachment(index) {
    stagedAttachments.splice(index, 1);
    renderAttachmentsList();
}

// --- צירופים ברמת פעולת טיפול בודדת ---
function handleActionFileSelect(inputEl, uid) {
    if (!actionAttachmentsMap[uid]) actionAttachmentsMap[uid] = [];
    Array.from(inputEl.files).forEach(file => actionAttachmentsMap[uid].push(file));
    inputEl.value = '';
    renderActionAttachments(uid);
}

function renderActionAttachments(uid) {
    const list = document.getElementById(`attach-list-${uid}`);
    if (!list) return;
    const files = actionAttachmentsMap[uid] || [];

    if (files.length === 0) {
        list.innerHTML = '<p class="attachments-empty">לא צורפו קבצים לפעולה זו</p>';
        return;
    }

    list.innerHTML = files.map((file, idx) => `
        <span class="attachment-chip">
            📎 ${file.name}
            <button type="button" class="remove-chip" onclick="removeActionAttachment('${uid}', ${idx})" title="הסר קובץ">✕</button>
        </span>
    `).join('');
}

function removeActionAttachment(uid, index) {
    if (!actionAttachmentsMap[uid]) return;
    actionAttachmentsMap[uid].splice(index, 1);
    renderActionAttachments(uid);
}

// העלאת קבצי צירוף ששייכים לפעולת טיפול ספציפית (לאחר שנודע ה-ActionId האמיתי מהשרת)
async function uploadActionAttachments(issueNumber, actionId, files) {
    const formData = new FormData();
    formData.append('IssueNumber', issueNumber);
    formData.append('ActionId', actionId);
    files.forEach(file => formData.append('files', file));

    try {
        const response = await fetch('/api/attachments', { method: 'POST', body: formData });
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `שגיאת שרת: ${response.status}`);
        }
    } catch (error) {
        console.error(`שגיאה בהעלאת צירופים לפעולה ${actionId}:`, error);
        alert(`חלק מהצירופים לפעולה מספר ${actionId} לא הועלו בהצלחה: ${error.message}`);
    }
}

// העלאת כל הקבצים שנבחרו לשרת, מקושרים ל-IssueNumber שנוצר עכשיו
async function uploadStagedAttachments(issueNumber) {
    const formData = new FormData();
    formData.append('IssueNumber', issueNumber);
    stagedAttachments.forEach(file => formData.append('files', file));

    try {
        const response = await fetch('/api/attachments', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `שגיאת שרת: ${response.status}`);
        }

        stagedAttachments = [];
    } catch (error) {
        console.error('שגיאה בהעלאת הצירופים:', error);
        alert('התקלה נשמרה בהצלחה, אך הייתה שגיאה בהעלאת הקבצים המצורפים: ' + error.message);
    }
}




// ==========================================
// ניהול ביקורים פעילים (Active Visits)
// ==========================================
async function loadActiveVisitsDropdown() {
    const selectElem = document.getElementById('activeVisitsSelect');
    if (!selectElem) return;

    try {
        const response = await fetch('/api/visits/active');
        if (checkAuthResponse(response)) return;
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `שגיאת שרת: ${response.status}`);
        }
        
        const data = await response.json(); 
        selectElem.innerHTML = '<option value="">-- בחר ביקור מהרשימה --</option>';

        if (Array.isArray(data) && data.length > 0) {
            data.forEach(visit => {
                const option = document.createElement('option');
                option.value = visit.VisitID;
                option.textContent = `${visit.TailNumber} (${visit.Model}) - ${visit.CustomerName}`;
                selectElem.appendChild(option);
            });
        } else {
            selectElem.innerHTML = '<option value="">אין ביקורים פעילים כרגע</option>';
        }

        // 🟢 חדש: אם הגענו לדף עם ?visitId=... (מכפתור "פתח תקלה חדשה לביקור זה"), נבחר אותו אוטומטית
        const urlParams = new URLSearchParams(window.location.search);
        const preselectedVisitId = urlParams.get('visitId');
        if (preselectedVisitId && selectElem.querySelector(`option[value="${CSS.escape(preselectedVisitId)}"]`)) {
            selectElem.value = preselectedVisitId;
            fetchVisitDetails(preselectedVisitId);
        }

    } catch (error) {
        console.error('Fetch error:', error);
        selectElem.innerHTML = '<option value="">שגיאה בטעינת הביקורים</option>';
    }
}

async function fetchVisitDetails(visitId) {
    const cardElem = document.getElementById('visitCard');
    if (!cardElem) return;

    try {
        const response = await fetch(`/api/visits/${visitId}`);
        if (checkAuthResponse(response)) return;
        if (!response.ok) throw new Error('לא ניתן למשוך את פרטי הביקור');

        const visit = await response.json();

        document.getElementById('valVisitId').textContent = visit.VisitID;
        document.getElementById('valAircraft').textContent = `${visit.TailNumber} (${visit.Model})`;
        document.getElementById('valCustomer').textContent = visit.CustomerName;
        document.getElementById('valContact').textContent = `${visit.RepresentativeName} (${visit.RepresentativeEmail})`;
        document.getElementById('valHangar').textContent = `${visit.HangarLocationID} - ${visit.HangarPosition}`;
        
        document.getElementById('valEntryDate').textContent = new Date(visit.EntryDate).toLocaleString('he-IL');
        document.getElementById('valTargetDate').textContent = new Date(visit.TargetLeaveDate).toLocaleString('he-IL');

        const statusElem = document.getElementById('valStatus');
        const isOverdue = new Date() > new Date(visit.TargetLeaveDate);
        
        if (isOverdue) {
            statusElem.textContent = 'באיחור (Overdue)';
            statusElem.style.color = 'red';
        } else {
            statusElem.textContent = 'בזמן (On Time)';
            statusElem.style.color = 'green';
        }

        cardElem.style.display = 'block';

    } catch (error) {
        console.error('Fetch Details Error:', error);
        alert('שגיאה בטעינת פרטי הביקור שנבחר');
    }
}


// ==========================================
// איסוף הנתונים ושליחה לבסיס הנתונים (POST)
// ==========================================
async function handleFormSubmit(event) {
    event.preventDefault();

    if (!event.target.checkValidity()) {
        event.target.reportValidity();
        return;
    }

    // 1. שליפת מזהה התקלה (אם מדובר בעריכת תקלה קיימת, אחרת נשלח null/undefined)
    const issueIdElem = document.getElementById('issueId') || document.getElementById('IssueNumber');
    const currentIssueNumber = issueIdElem ? issueIdElem.value.trim() : null;

    // 2. שליפת ה-userId (UUID) של המשתמש המחובר מתוך ה-sessionStorage
    let loggedInUserId = null;
    try {
        const savedUser = sessionStorage.getItem('loggedInUser');
        if (savedUser) {
            const parsedUser = JSON.parse(savedUser);
            loggedInUserId = parsedUser.userId || parsedUser.UserId || null;
        }
    } catch (e) {
        console.error('שגיאה בפענוח המשתמש מ-sessionStorage:', e);
    }

    // איסוף נתוני התקלה הראשית מתוך שדות הטופס (issueData)
    const titleVal = document.getElementById('Title')?.value?.trim() || '';
    const descriptionVal = document.getElementById('Description')?.value?.trim() || '';

    const issueData = {
        IssueNumber: currentIssueNumber,
        
        // שליפת הכותרת מה-input בשם Title
        Title: titleVal || descriptionVal.slice(0, 50) || 'תקלת אחזקה חדשה',
        
        // שליפת התיאור מה-textarea בשם Description
        Description: descriptionVal,

        // שאר השדות מהטופס
        DepartmentCode: document.getElementById('DepartmentCode')?.value || document.getElementById('departmentSelect')?.value || null,
        FaultCategory: document.getElementById('FaultCategory')?.value || null,
        SeverityId: document.getElementById('SeverityId')?.value || null,
        PriorityId: document.getElementById('PriorityId')?.value || null,
        StatusID: document.getElementById('StatusID')?.value || null,
        
        // 📌 השינוי היחידי: לקחת את ה-UUID מהסשן (עם גיבוי ל-Select אם חסר)
        CreatedByUserId: loggedInUserId || document.getElementById('createdBy')?.value || null,
        
        AssignedToUserId: document.getElementById('assingTo')?.value || null,
        
        // שליפת מזהה הביקור מה-select בשם activeVisitsSelect
        VisitID: document.getElementById('activeVisitsSelect')?.value || null
    };

    // 3. איסוף נתוני הפעולות הדינמיות (Actions)
    const actionsData = [];
    const actionUids = []; // 🟢 חדש: uid מקביל לכל אקשן, לשיוך צירופים אחרי השמירה

    document.querySelectorAll('.action-card').forEach(card => {
        actionUids.push(card.dataset.uid || null);
        const isSerialized = card.querySelector('.act-serialized-cb')?.checked || false;
        
        // המרת תאריך לפורמט תקין עבור MySQL (YYYY-MM-DD HH:MM:SS)
        const rawDate = card.querySelector('.act-date')?.value;
        const formattedDate = rawDate 
            ? new Date(rawDate).toISOString().slice(0, 19).replace('T', ' ') 
            : null;

        // שליפת ה-UserId שנשמר ב-dataset בעת הקלדת מספר העובד
        const signedInput = card.querySelector('.act-signed');
        const signedByUserId = signedInput ? (signedInput.dataset.userId || null) : null;

        actionsData.push({
            IssueNumber: currentIssueNumber,
            ActionDescription: card.querySelector('.act-desc')?.value.trim() || '',
            ActionDate: formattedDate,
            ActionStatusId: card.querySelector('.act-status')?.value || null,
            SingedByEmployeeId: signedByUserId, // שולח את ה-UserId (UUID)
            ActionLiteratureRef: card.querySelector('.act-lit')?.value.trim() || null,
            SerializedPart: isSerialized ? 1 : 0,
            OldSerialNumber: isSerialized ? (card.querySelector('.act-old-sn')?.value.trim() || null) : null,
            NewSerialNumber: isSerialized ? (card.querySelector('.act-new-sn')?.value.trim() || null) : null
        });
    });

    // 4. הרכבת האובייקט לשליחה לשרת
    const payload = { issue: issueData, actions: actionsData };

    try {
        console.log('שולח נתונים לשרת:', payload);

        const response = await fetch('/api/maintanace_calls', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (checkAuthResponse(response)) return;

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `שגיאת שרת: ${response.status}`);
        }

        const result = await response.json();

        // 5. העלאת קבצים מצורפים ברמת התקלה (אם נבחרו)
        if (stagedAttachments.length > 0 && result.issueNumber) {
            await uploadStagedAttachments(result.issueNumber);
        }

        // 6. העלאת קבצים מצורפים ברמת כל פעולה, לפי ה-ActionId שהוחזר מהשרת (אותו סדר שנשלח)
        if (Array.isArray(result.actionIds) && result.issueNumber) {
            for (let i = 0; i < result.actionIds.length; i++) {
                const uid = actionUids[i];
                const files = uid ? (actionAttachmentsMap[uid] || []) : [];
                if (files.length > 0) {
                    await uploadActionAttachments(result.issueNumber, result.actionIds[i], files);
                }
            }
        }

        alert('התקלה והפעולות נשמרו בהצלחה במסד הנתונים!');
        
        // רענון העמוד מחדש לאחר שמירה מוצלחת
        window.location.reload();

    } catch (error) {
        console.error('Error saving maintenance issue:', error);
        alert(`שגיאה בשמירת הנתונים: ${error.message}`);
    }
}
async function fetchAndDisplayEmployeeName(inputElement) {
    const employeeId = inputElement.value.trim();
    const card = inputElement.closest('.action-card');
    const nameDisplay = card ? card.querySelector('.act-employee-name') : null;

    if (!nameDisplay) return;

    if (!employeeId) {
        nameDisplay.textContent = '';
        return;
    }

    // 1. חיפוש במערך העובדים שכבר נטען בזיכרון (מונע פניות מיותרות לשרת ושגיאות 404)
    const localEmployees = window.departmentEmployees || window.employeesData || window.employeesList || [];
    const foundLocal = localEmployees.find(emp => 
        String(emp.EmployeeId || emp.employeeId || emp.id) === String(employeeId)
    );

    if (foundLocal) {
        const fullName = foundLocal.EmployeeName || `${foundLocal.FirstName || ''} ${foundLocal.LastName || ''}`.trim() || foundLocal.name;
        nameDisplay.textContent = `(${fullName})`;
        nameDisplay.style.color = '#2e7d32'; // ירוק
        return;
    }

    // 2. אם לא נמצא בזיכרון המקומי – ניסיון קריאה לשרת
    nameDisplay.textContent = 'טוען...';
    nameDisplay.style.color = '#666';

    try {
        const response = await fetch(`/api/employees/${encodeURIComponent(employeeId)}`);
        
        if (response.ok) {
            const employee = await response.json();
            const fullName = employee.EmployeeName || `${employee.FirstName || ''} ${employee.LastName || ''}`.trim();
            nameDisplay.textContent = `(${fullName})`;
            nameDisplay.style.color = '#2e7d32';
        } else {
            nameDisplay.textContent = '(עובד לא נמצא)';
            nameDisplay.style.color = '#d32f2f'; // אדום
        }
    } catch (err) {
        console.error('שגיאה בטעינת שם עובד:', err);
        nameDisplay.textContent = '(שגיאה באימות)';
        nameDisplay.style.color = '#d32f2f';
    }
}



// 3. הרצה ראשונית על כרטיסים קיימים שנטענו מראש עם מספר עובד
function initEmployeeNames() {
    console.log("מאתחל שמות עובדים בכרטיסים קיימים...");
    document.querySelectorAll('.act-signed').forEach(input => {
        if (input.value) {
            updateEmployeeNameFromMemory(input);
        }
    });
}

// פונקציה קטנה לטעינת כל העובדים לזיכרון
async function loadAllEmployees() {
    try {
        console.log('מתחיל משיכת כל העובדים לזיכרון מול השרת...');
        const response = await fetch('/api/maintanace_calls/employees'); 
        if (response.ok) {
            window.allEmployees = await response.json();
            console.log('✅ כל העובדים נטענו לזיכרון:', window.allEmployees);
            
            // 👇 התיקון החשוב: מריצים את עדכון השמות *רק אחרי* שהעובדים נטענו!
            initEmployeeNames();
        } else {
            console.error('❌ שגיאה בקבלת העובדים מהשרת. סטטוס:', response.status);
        }
    } catch (err) {
        console.error('❌ שגיאה בטעינת עובדים לזיכרון:', err);
    }
}

// הפעלה אוטומטית כשהדף עולה
document.addEventListener('DOMContentLoaded', loadAllEmployees);

// הפונקציה המרכזית שמעדכנת מהזיכרון
function updateEmployeeNameFromMemory(inputElement) {
    const employeeId = inputElement.value.trim();
    const card = inputElement.closest('.action-card');
    const nameDisplay = card ? card.querySelector('.act-employee-name') : null;

    if (!nameDisplay) return;

    if (!employeeId) {
        nameDisplay.textContent = '';
        delete inputElement.dataset.userId;
        return;
    }

    const employeesList = window.allEmployees || [];

    // חיפוש העובד לפי EmployeeId
    const emp = employeesList.find(e => 
        String(e.EmployeeId || e.employeeId || '').trim() === String(employeeId)
    );

    if (emp) {
        // שמירת ה-UserId ב-dataset בשביל השמירה ל-DB
        inputElement.dataset.userId = emp.UserId || emp.userId || emp.id;

        // הרכבת השם המלא
        const firstName = emp.UserName || emp.userName || emp.FirstName || '';
        const lastName = emp.UserLastName || emp.userLastName || emp.LastName || '';
        const fullName = emp.displayName || emp.fullName || [firstName, lastName].filter(Boolean).join(' ') || 'עובד';
        const empCode = emp.EmployeeId || emp.employeeId || employeeId;

        // 👈 התצוגה המעודכנת בדיוק כמו ב-Created By: (שם מלא - מספר עובד)
        nameDisplay.textContent = `(${fullName} - ${empCode})`;
        nameDisplay.style.color = '#2e7d32'; // ירוק לחיווי תקין
    } else {
        delete inputElement.dataset.userId;
        nameDisplay.textContent = '(עובד לא נמצא)';
        nameDisplay.style.color = '#d32f2f'; // אדום
    }
}