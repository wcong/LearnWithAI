// ============================================================
// LearnWithAI – 学习计划页面逻辑（Apple Reminders 风格）
// ============================================================

let token = localStorage.getItem('token') || '';
let currentUser = null;
let _editingId = null;
let _editingParentId = null;
let _deletingId = null;
let _allPlans = [];
let _allAreas = [];

// ── API 辅助 ─────────────────────────────────────────────
async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch('/api' + path, { ...opts, headers });
    if (res.status === 401) { logout(); throw new Error('登录已过期'); }
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `请求失败 (${res.status})`);
    }
    return res.json();
}

function escHtml(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ── Auth ──────────────────────────────────────────────────
function logout() {
    token = '';
    currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    document.getElementById('authPage').style.display = 'flex';
    document.getElementById('appPage').style.display = 'none';
}

const authPage = document.getElementById('authPage');
const appPage = document.getElementById('appPage');
let isLoginMode = true;

function toggleAuthRegisterFields(show) {
    const el = document.getElementById('authRegisterFields');
    if (el) el.style.display = show ? '' : 'none';
}

function resetRegisterStep() {
    const s1 = document.getElementById('authRegStep1');
    const s2 = document.getElementById('authRegStep2');
    if (s1) s1.style.display = '';
    if (s2) s2.style.display = 'none';
    document.getElementById('authPassword').style.display = '';
    document.getElementById('authEmail').removeAttribute('readonly');
}

document.getElementById('tabLogin').addEventListener('click', () => {
    isLoginMode = true;
    document.getElementById('tabLogin').classList.add('active');
    document.getElementById('tabRegister').classList.remove('active');
    document.getElementById('authBtn').textContent = '登录';
    document.getElementById('authBtn').style.display = '';
    document.getElementById('authError').textContent = '';
    toggleAuthRegisterFields(false);
    document.getElementById('authPassword').style.display = '';
    document.getElementById('authEmail').removeAttribute('readonly');
});

document.getElementById('tabRegister').addEventListener('click', () => {
    isLoginMode = false;
    document.getElementById('tabRegister').classList.add('active');
    document.getElementById('tabLogin').classList.remove('active');
    document.getElementById('authBtn').textContent = '注册';
    document.getElementById('authBtn').style.display = 'none';
    document.getElementById('authError').textContent = '';
    toggleAuthRegisterFields(true);
    resetRegisterStep();
    document.getElementById('authPassword').style.display = 'none';
});

document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const authEmail = document.getElementById('authEmail');
    const authError = document.getElementById('authError');
    const authBtn = document.getElementById('authBtn');
    const email = authEmail.value.trim();

    if (isLoginMode) {
        const password = document.getElementById('authPassword').value.trim();
        if (!email || !password) { authError.textContent = '请填写邮箱和密码'; return; }
        authBtn.disabled = true;
        authBtn.textContent = '处理中...';
        authError.textContent = '';
        try {
            const data = await api('/auth/login', { method: 'POST', body: { email, password } });
            token = data.token;
            currentUser = { id: data.user_id, username: data.username };
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(currentUser));
            showApp();
        } catch (err) { authError.textContent = err.message; }
        finally { authBtn.disabled = false; authBtn.textContent = '登录'; }
    } else {
        const step2 = document.getElementById('authRegStep2');
        if (!step2 || step2.style.display === 'none') {
            if (!email || email.indexOf('@') === -1) { authError.textContent = '请输入有效的邮箱'; return; }
            const sendBtn = document.getElementById('authRegSendBtn');
            if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '发送中...'; }
            authError.textContent = '';
            try {
                await api('/auth/register-send-code', { method: 'POST', body: { email } });
                document.getElementById('authRegStep1').style.display = 'none';
                document.getElementById('authRegStep2').style.display = '';
                authBtn.style.display = '';
                document.getElementById('authPassword').style.display = 'none';
                authEmail.setAttribute('readonly', 'readonly');
                authError.textContent = '验证码已发送，请查收邮件';
                authError.style.color = '#67c23a';
            } catch (err) {
                if (err.message.includes('已注册')) {
                    document.getElementById('tabLogin').click();
                    authError.textContent = '该邮箱已注册，请直接登录';
                } else {
                    authError.textContent = err.message;
                }
            }
            finally { if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '发送验证码'; } }
        } else {
            const code = document.getElementById('authRegCode')?.value?.trim();
            const password = document.getElementById('authRegPassword')?.value?.trim();
            const confirmPw = document.getElementById('authConfirmPassword')?.value || '';
            const nickname = document.getElementById('authNickname')?.value?.trim() || '';
            if (!code || !password) { authError.textContent = '请填写验证码和密码'; return; }
            if (password !== confirmPw) { authError.textContent = '两次输入的密码不一致'; return; }
            if (password.length < 4) { authError.textContent = '密码至少 4 个字符'; return; }
            authBtn.disabled = true;
            authBtn.textContent = '注册中...';
            authError.textContent = '';
            try {
                const data = await api('/auth/register', { method: 'POST', body: { email, password, code, nickname } });
                token = data.token;
                currentUser = { id: data.user_id, username: data.username };
                localStorage.setItem('token', token);
                localStorage.setItem('user', JSON.stringify(currentUser));
                showApp();
            } catch (err) { authError.textContent = err.message; }
            finally { authBtn.disabled = false; authBtn.textContent = '注册'; }
        }
    }
});

// 忘记密码
authPage.addEventListener('click', (e) => {
    const target = e.target;
    if (target.id === 'authForgotLink') {
        document.getElementById('authForm').style.display = 'none';
        document.getElementById('authForgotPanel').style.display = '';
    } else if (target.id === 'authForgotBack') {
        document.getElementById('authForgotPanel').style.display = 'none';
        document.getElementById('authForm').style.display = '';
    } else if (target.id === 'authForgotSendBtn') {
        handleForgotSend();
    } else if (target.id === 'authForgotResetBtn') {
        handleForgotReset();
    }
});

async function handleForgotSend() {
    const email = document.getElementById('authForgotEmail')?.value?.trim();
    if (!email) { document.getElementById('authForgotError').textContent = '请输入邮箱'; return; }
    const btn = document.getElementById('authForgotSendBtn');
    btn.disabled = true; btn.textContent = '发送中...';
    document.getElementById('authForgotError').textContent = '';
    try {
        await api('/auth/forgot-password', { method: 'POST', body: { email } });
        document.getElementById('authForgotStep1').style.display = 'none';
        document.getElementById('authForgotStep2').style.display = '';
    } catch (err) { document.getElementById('authForgotError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = '发送验证码'; }
}

async function handleForgotReset() {
    const email = document.getElementById('authForgotEmail')?.value?.trim();
    const code = document.getElementById('authForgotCode')?.value?.trim();
    const newPw = document.getElementById('authForgotNewPassword')?.value?.trim();
    if (!code || !newPw) { document.getElementById('authForgotResetError').textContent = '请填写验证码和新密码'; return; }
    const btn = document.getElementById('authForgotResetBtn');
    btn.disabled = true; btn.textContent = '重置中...';
    document.getElementById('authForgotResetError').textContent = '';
    try {
        await api('/auth/reset-password', { method: 'POST', body: { email, code, new_password: newPw } });
        document.getElementById('authForgotResetError').style.color = '#67c23a';
        document.getElementById('authForgotResetError').textContent = '密码重置成功，请返回登录';
        setTimeout(() => { document.getElementById('authForgotBack')?.click(); }, 2000);
    } catch (err) { document.getElementById('authForgotResetError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = '重置密码'; }
}

document.getElementById('logoutBtn').addEventListener('click', logout);

// ============================================================
//  App Init
// ============================================================

function showApp() {
    authPage.style.display = 'none';
    appPage.style.display = 'flex';
    document.getElementById('userBadge').textContent = currentUser ? currentUser.username : '';
    loadAll();
}

function init() {
    const saved = localStorage.getItem('user');
    if (token && saved) {
        currentUser = JSON.parse(saved);
        showApp();
    } else {
        authPage.style.display = 'flex';
    }
}

// ============================================================
//  Load & Render
// ============================================================

async function loadAll() {
    await Promise.all([loadPlans(), loadStats(), loadAreas()]);
}

async function loadPlans() {
    try {
        _allPlans = await api('/plans');
        renderPlans(_allPlans);
    } catch (err) {
        document.getElementById('plansList').innerHTML =
            `<div class="loading-text">⚠️ 加载失败：${escHtml(err.message)}</div>`;
    }
}

async function loadStats() {
    try {
        const stats = await api('/plans/stats');
        document.getElementById('statTodayNum').textContent = stats.today;
        document.getElementById('statOverdueNum').textContent = stats.overdue;
        document.getElementById('statTotalNum').textContent = stats.total;
    } catch (err) {
        console.error('加载统计失败', err);
    }
}

async function loadAreas() {
    try {
        _allAreas = await api('/areas/tree');
        populateAreaSelect();
    } catch (err) {
        console.error('加载领域失败', err);
    }
}

// ── 渲染计划列表 ─────────────────────────────────────────

function renderPlans(plans) {
    const container = document.getElementById('plansList');
    const empty = document.getElementById('plansEmpty');

    if (plans.length === 0) {
        container.innerHTML = '';
        empty.style.display = '';
        return;
    }
    empty.style.display = 'none';

    const now = new Date();
    let html = '';
    plans.forEach(p => {
        html += renderPlanCard(p, now);
    });
    container.innerHTML = html;

    // 绑定事件
    container.querySelectorAll('.plan-checkbox').forEach(el => {
        el.addEventListener('click', () => toggleComplete(parseInt(el.dataset.id, 10), false));
    });
    container.querySelectorAll('.sub-plan-checkbox').forEach(el => {
        el.addEventListener('click', () => toggleComplete(parseInt(el.dataset.id, 10), true));
    });
    container.querySelectorAll('.plan-action-btn.edit').forEach(el => {
        el.addEventListener('click', () => openEditModal(parseInt(el.dataset.id, 10)));
    });
    container.querySelectorAll('.plan-action-btn.delete').forEach(el => {
        el.addEventListener('click', () => openDeleteConfirm(parseInt(el.dataset.id, 10)));
    });
    container.querySelectorAll('.plan-action-btn.add-sub').forEach(el => {
        el.addEventListener('click', () => openCreateSubModal(parseInt(el.dataset.id, 10)));
    });
}

function renderPlanCard(plan, now) {
    const plannedDate = plan.planned_at ? new Date(plan.planned_at) : null;
    const isOverdue = plannedDate && plannedDate < now && !plan.is_completed;

    const timeStr = plannedDate ? formatDate(plannedDate) : '';
    const areaHtml = plan.area_name
        ? `<a class="plan-area-tag" href="/domain?select=${plan.area_id}" target="_blank">📌 ${escHtml(plan.area_name)}</a>`
        : '';

    const childrenHtml = plan.children && plan.children.length > 0
        ? `<div class="plan-children">${plan.children.map(c => renderSubPlan(c, now)).join('')}</div>`
        : '';

    return `
        <div class="plan-card" data-id="${plan.id}">
            <div class="plan-main-row">
                <div class="plan-checkbox ${plan.is_completed ? 'checked' : ''} ${isOverdue ? 'overdue' : ''}"
                     data-id="${plan.id}" title="${plan.is_completed ? '标记未完成' : '标记完成'}"></div>
                <div class="plan-content">
                    <div class="plan-title ${isOverdue ? 'overdue' : ''} ${plan.is_completed ? 'completed' : ''}">
                        ${escHtml(plan.title)}
                    </div>
                    ${plan.description ? `<div class="plan-desc">${escHtml(plan.description)}</div>` : ''}
                    <div class="plan-meta">
                        ${timeStr ? `<span class="plan-time ${isOverdue ? 'overdue' : ''}">${isOverdue ? '🔴' : '🕐'} ${timeStr}</span>` : ''}
                        ${areaHtml}
                    </div>
                </div>
                <div class="plan-actions">
                    <button class="plan-action-btn add-sub" data-id="${plan.id}" title="添加子计划">➕</button>
                    <button class="plan-action-btn edit" data-id="${plan.id}" title="编辑">✏️</button>
                    <button class="plan-action-btn delete" data-id="${plan.id}" title="删除">🗑️</button>
                </div>
            </div>
            ${childrenHtml}
        </div>`;
}

function renderSubPlan(plan, now) {
    const plannedDate = plan.planned_at ? new Date(plan.planned_at) : null;
    const isOverdue = plannedDate && plannedDate < now && !plan.is_completed;

    return `
        <div class="sub-plan-card" data-id="${plan.id}">
            <div class="sub-plan-row">
                <div class="sub-plan-checkbox ${plan.is_completed ? 'checked' : ''}"
                     data-id="${plan.id}" title="${plan.is_completed ? '标记未完成' : '标记完成'}"></div>
                <span class="sub-plan-title ${isOverdue ? 'overdue' : ''} ${plan.is_completed ? 'completed' : ''}">
                    ${escHtml(plan.title)}
                </span>
                <div class="sub-plan-actions">
                    <button class="plan-action-btn edit" data-id="${plan.id}" title="编辑">✏️</button>
                    <button class="plan-action-btn delete" data-id="${plan.id}" title="删除">🗑️</button>
                </div>
            </div>
        </div>`;
}

function formatDate(d) {
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hours}:${mins}`;
}

// ── 领域选择填充 ─────────────────────────────────────────

function flattenAreas(areas, depth = 0) {
    let result = [];
    areas.forEach(a => {
        result.push({ ...a, depth });
        if (a.children && a.children.length > 0) {
            result = result.concat(flattenAreas(a.children, depth + 1));
        }
    });
    return result;
}

function populateAreaSelect(selectedId) {
    const select = document.getElementById('editAreaSelect');
    select.innerHTML = '<option value="">— 不关联 —</option>';
    const flat = flattenAreas(_allAreas);
    flat.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = '　'.repeat(a.depth) + a.name;
        if (selectedId && String(a.id) === String(selectedId)) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
}

// ============================================================
//  标记完成
// ============================================================

async function toggleComplete(planId, isSub) {
    const plan = findPlanById(planId);
    if (!plan) return;
    try {
        await api(`/plans/${planId}`, {
            method: 'PATCH',
            body: { is_completed: !plan.is_completed },
        });
        await loadAll();
    } catch (err) {
        alert('操作失败：' + err.message);
    }
}

function findPlanById(id, list) {
    list = list || _allPlans;
    for (const p of list) {
        if (p.id === id) return p;
        if (p.children) {
            const found = p.children.find(c => c.id === id);
            if (found) return found;
        }
    }
    return null;
}

// ============================================================
//  创建/编辑模态框
// ============================================================

function openCreateModal() {
    _editingId = null;
    _editingParentId = null;
    document.getElementById('editTitle').textContent = '新建学习计划';
    document.getElementById('editPlanId').value = '';
    document.getElementById('editParentId').value = '';
    document.getElementById('editTitleInput').value = '';
    document.getElementById('editDescInput').value = '';
    document.getElementById('editDateInput').value = '';
    document.getElementById('editAreaSelect').value = '';
    document.getElementById('editParentField').style.display = 'none';
    document.getElementById('editOverlay').classList.add('active');
    setTimeout(() => document.getElementById('editTitleInput')?.focus(), 100);
}

function openEditModal(planId) {
    const plan = findPlanById(planId);
    if (!plan) return;
    _editingId = plan.id;
    _editingParentId = plan.parent_id;
    document.getElementById('editTitle').textContent = '编辑计划';
    document.getElementById('editPlanId').value = plan.id;
    document.getElementById('editParentId').value = plan.parent_id || '';
    document.getElementById('editTitleInput').value = plan.title;
    document.getElementById('editDescInput').value = plan.description || '';
    document.getElementById('editAreaSelect').value = plan.area_id || '';
    document.getElementById('editParentField').style.display = 'none';

    // 设置日期时间
    if (plan.planned_at) {
        const d = new Date(plan.planned_at);
        document.getElementById('editDateInput').value = toLocalDatetimeStr(d);
    } else {
        document.getElementById('editDateInput').value = '';
    }
    populateAreaSelect(plan.area_id);
    document.getElementById('editOverlay').classList.add('active');
}

function openCreateSubModal(parentId) {
    _editingId = null;
    _editingParentId = parentId;
    document.getElementById('editTitle').textContent = '添加子计划';
    document.getElementById('editPlanId').value = '';
    document.getElementById('editParentId').value = parentId;
    document.getElementById('editTitleInput').value = '';
    document.getElementById('editDescInput').value = '';
    document.getElementById('editDateInput').value = '';
    document.getElementById('editAreaSelect').value = '';
    document.getElementById('editParentField').style.display = 'none';
    document.getElementById('editOverlay').classList.add('active');
    setTimeout(() => document.getElementById('editTitleInput')?.focus(), 100);
}

function closeEditModal() {
    document.getElementById('editOverlay').classList.remove('active');
    _editingId = null;
    _editingParentId = null;
}

function toLocalDatetimeStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
}

// ── 模态框按钮事件绑定 ──────────────────────────────────

document.getElementById('btnCreatePlan').addEventListener('click', openCreateModal);
document.getElementById('btnCloseEdit').addEventListener('click', closeEditModal);
document.getElementById('editOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditModal();
});
document.getElementById('btnEditCancel').addEventListener('click', closeEditModal);
document.getElementById('btnEditSave').addEventListener('click', savePlan);

async function savePlan() {
    const title = document.getElementById('editTitleInput').value.trim();
    const description = document.getElementById('editDescInput').value.trim();
    const dateVal = document.getElementById('editDateInput').value;
    const areaId = document.getElementById('editAreaSelect').value;
    const editId = document.getElementById('editPlanId').value;
    const parentId = document.getElementById('editParentId').value;

    if (!title) { alert('请输入计划标题'); return; }
    if (!dateVal) { alert('请选择计划时间'); return; }

    // 将本地时间转为 ISO
    const localDate = new Date(dateVal);
    const plannedAt = localDate.toISOString();

    const body = { title, description, planned_at: plannedAt };
    if (areaId) body.area_id = parseInt(areaId, 10);
    if (parentId && !editId) body.parent_id = parseInt(parentId, 10);

    try {
        if (editId) {
            await api(`/plans/${editId}`, { method: 'PATCH', body });
        } else {
            await api('/plans', { method: 'POST', body });
        }
        closeEditModal();
        await loadAll();
    } catch (err) {
        alert('保存失败：' + err.message);
    }
}

// ============================================================
//  删除确认
// ============================================================

function openDeleteConfirm(planId) {
    _deletingId = planId;
    const plan = findPlanById(planId);
    const text = plan ? `确认删除「${plan.title}」？${plan.children && plan.children.length > 0 ? '子计划也会被删除。' : ''}` : '确认删除此计划？';
    document.getElementById('deleteConfirmText').textContent = text;
    document.getElementById('deleteOverlay').classList.add('active');
}

function closeDeleteConfirm() {
    document.getElementById('deleteOverlay').classList.remove('active');
    _deletingId = null;
}

document.getElementById('btnCloseDelete').addEventListener('click', closeDeleteConfirm);
document.getElementById('deleteOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDeleteConfirm();
});
document.getElementById('btnDeleteCancel').addEventListener('click', closeDeleteConfirm);

document.getElementById('btnDeleteConfirm').addEventListener('click', async () => {
    if (!_deletingId) return;
    try {
        await api(`/plans/${_deletingId}`, { method: 'DELETE' });
        closeDeleteConfirm();
        await loadAll();
    } catch (err) {
        alert('删除失败：' + err.message);
    }
});

// ============================================================
//  已完成计划弹窗
// ============================================================

document.getElementById('btnCompleted').addEventListener('click', openCompletedModal);
document.getElementById('btnCloseCompleted').addEventListener('click', closeCompletedModal);
document.getElementById('completedOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCompletedModal();
});

function closeCompletedModal() {
    document.getElementById('completedOverlay').classList.remove('active');
}

async function openCompletedModal() {
    document.getElementById('completedOverlay').classList.add('active');
    document.getElementById('completedBody').innerHTML = '<div class="loading-text">加载中...</div>';
    try {
        const groups = await api('/plans/completed');
        renderCompleted(groups);
    } catch (err) {
        document.getElementById('completedBody').innerHTML =
            `<div class="loading-text">⚠️ 加载失败：${escHtml(err.message)}</div>`;
    }
}

function renderCompleted(groups) {
    const container = document.getElementById('completedBody');
    if (!groups || groups.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#8E8E93;">暂无已完成的计划</div>';
        return;
    }

    let html = '';
    groups.forEach(g => {
        const dateLabel = formatDayLabel(g.date);
        html += `<div class="completed-day-group">
            <div class="completed-day-header">${dateLabel}（${g.plans.length} 项）</div>`;
        g.plans.forEach(p => {
            const areaTag = p.area_name
                ? `<span class="completed-day-area">📌 ${escHtml(p.area_name)}</span>`
                : '';
            html += `<div class="completed-day-item">
                <div class="completed-day-check"></div>
                <span class="completed-day-title">${p.parent_id ? '↳ ' : ''}${escHtml(p.title)}</span>
                ${areaTag}
            </div>`;
        });
        html += '</div>';
    });
    container.innerHTML = html;
}

function formatDayLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return '今天';
    if (d.toDateString() === yesterday.toDateString()) return '昨天';

    const month = d.getMonth() + 1;
    const day = d.getDate();
    return `${month}月${day}日`;
}

// ============================================================
//  Boot
// ============================================================

function boot() {
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => boot()); return; }
    init();
}
boot();
