// ============================================================
// LearnWithAI – 技能管理页面逻辑
// ============================================================

let token = localStorage.getItem('token') || '';
let currentUser = null;
let _editingSkill = null;  // { id, type: 'global'|'personal' } or null for create
let _createType = null;    // 'global' | 'personal' | null (for creating new)
let _isAdmin = false;

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

function logout() {
    token = '';
    currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    document.getElementById('authPage').style.display = 'flex';
    document.getElementById('appPage').style.display = 'none';
}

// ============================================================
// Auth
// ============================================================

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
    document.getElementById('authError').style.color = '#ef4444';
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
    document.getElementById('authError').style.color = '#ef4444';
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
            authError.style.color = '#ef4444';
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
            authError.style.color = '#ef4444';
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

// 忘记密码 — 事件委托
authPage.addEventListener('click', (e) => {
    const target = e.target;
    if (target.id === 'authForgotLink') {
        document.getElementById('authForm').style.display = 'none';
        document.getElementById('authForgotPanel').style.display = '';
        document.getElementById('authForgotError').textContent = '';
        document.getElementById('authForgotResetError').textContent = '';
        document.getElementById('authForgotStep2').style.display = 'none';
        document.getElementById('authForgotStep1').style.display = '';
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
    btn.disabled = true;
    btn.textContent = '发送中...';
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
    const newPassword = document.getElementById('authForgotNewPassword')?.value?.trim();
    if (!code || !newPassword) { document.getElementById('authForgotResetError').textContent = '请填写验证码和新密码'; return; }
    const btn = document.getElementById('authForgotResetBtn');
    btn.disabled = true;
    btn.textContent = '重置中...';
    document.getElementById('authForgotResetError').textContent = '';
    try {
        await api('/auth/reset-password', { method: 'POST', body: { email, code, new_password: newPassword } });
        document.getElementById('authForgotResetError').style.color = '#67c23a';
        document.getElementById('authForgotResetError').textContent = '密码重置成功，请返回登录';
        setTimeout(() => { document.getElementById('authForgotBack')?.click(); }, 2000);
    } catch (err) { document.getElementById('authForgotResetError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = '重置密码'; }
}

document.getElementById('logoutBtn').addEventListener('click', logout);

function showApp() {
    authPage.style.display = 'none';
    appPage.style.display = 'flex';
    document.getElementById('userBadge').textContent = currentUser ? currentUser.username : '';
    // 检测是否为管理员
    checkAdmin().then(admin => {
        _isAdmin = admin;
        document.getElementById('btnCreateGlobal').style.display = admin ? 'inline-block' : 'none';
        loadAllSkills();
    });
}

async function checkAdmin() {
    try {
        await api('/skills/global/list');
        return true;
    } catch {
        return false;
    }
}

// ============================================================
//  Init
// ============================================================

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

async function loadAllSkills() {
    try {
        const skills = await api('/skills');
        const globalSkills = skills.filter(s => s.is_global);
        const personalSkills = skills.filter(s => !s.is_global);
        renderGlobalSkills(globalSkills);
        renderPersonalSkills(personalSkills);
    } catch (err) {
        document.getElementById('globalSkillsList').innerHTML =
            `<div class="empty-text">⚠️ 加载失败：${escHtml(err.message)}</div>`;
        document.getElementById('personalSkillsList').innerHTML = '';
    }
}

function renderGlobalSkills(skills) {
    const container = document.getElementById('globalSkillsList');
    if (skills.length === 0) {
        container.innerHTML = '<div class="empty-text">暂无全局技能</div>';
        return;
    }
    let html = '';
    skills.forEach(s => {
        const canDelete = _isAdmin && !s.is_default;
        html += `
            <div class="skill-card" data-id="${s.id}">
                <div class="skill-card-header">
                    <span class="skill-card-name">${escHtml(s.name)}${s.is_default ? ' <span class="skill-default-badge">默认</span>' : ''}</span>
                </div>
                <div class="skill-card-desc">${escHtml(s.description || '')}</div>
                <div class="skill-card-template"><code>${escHtml(s.prompt_template.substring(0, 150))}${s.prompt_template.length > 150 ? '...' : ''}</code></div>
                <div class="skill-card-actions">
                    ${_isAdmin ? `<button class="btn-edit" data-id="${s.id}" data-name="${escHtml(s.name)}" data-desc="${escHtml(s.description || '')}" data-template="${escHtml(s.prompt_template)}">✏️ 编辑</button>` : ''}
                    ${canDelete ? `<button class="btn-delete" data-id="${s.id}">🗑 删除</button>` : ''}
                </div>
            </div>`;
    });
    container.innerHTML = html;

    container.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            showEditModal('global', {
                id: parseInt(btn.dataset.id, 10),
                name: btn.dataset.name,
                description: btn.dataset.desc,
                prompt_template: btn.dataset.template,
            });
        });
    });
    container.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('确认删除此全局技能？')) return;
            try {
                await api(`/skills/global/${btn.dataset.id}`, { method: 'DELETE' });
                loadAllSkills();
            } catch (err) { alert('删除失败：' + err.message); }
        });
    });
}

function renderPersonalSkills(skills) {
    const container = document.getElementById('personalSkillsList');
    if (skills.length === 0) {
        container.innerHTML = '<div class="empty-text">暂无个人技能，点击右上角"新建"创建</div>';
        return;
    }
    let html = '';
    skills.forEach(s => {
        html += `
            <div class="skill-card" data-id="${s.id}">
                <div class="skill-card-header">
                    <span class="skill-card-name">${escHtml(s.name)}</span>
                </div>
                <div class="skill-card-desc">${escHtml(s.description || '')}</div>
                <div class="skill-card-template"><code>${escHtml(s.prompt_template.substring(0, 150))}${s.prompt_template.length > 150 ? '...' : ''}</code></div>
                <div class="skill-card-actions">
                    <button class="btn-edit" data-id="${s.id}" data-name="${escHtml(s.name)}" data-desc="${escHtml(s.description || '')}" data-template="${escHtml(s.prompt_template)}">✏️ 编辑</button>
                    <button class="btn-delete" data-id="${s.id}">🗑 删除</button>
                </div>
            </div>`;
    });
    container.innerHTML = html;

    container.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            showEditModal('personal', {
                id: parseInt(btn.dataset.id, 10),
                name: btn.dataset.name,
                description: btn.dataset.desc,
                prompt_template: btn.dataset.template,
            });
        });
    });
    container.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('确认删除此技能？')) return;
            try {
                await api(`/skills/${btn.dataset.id}`, { method: 'DELETE' });
                loadAllSkills();
            } catch (err) { alert('删除失败：' + err.message); }
        });
    });
}

// ============================================================
//  Edit Modal
// ============================================================

function showEditModal(type, skill) {
    _editingSkill = skill ? { id: skill.id, type } : null;
    _createType = skill ? null : type;
    document.getElementById('editTitle').textContent = skill
        ? (type === 'global' ? '编辑全局技能' : '编辑个人技能')
        : (type === 'global' ? '新建全局技能' : '新建个人技能');
    document.getElementById('editName').value = skill ? skill.name : '';
    document.getElementById('editDesc').value = skill ? (skill.description || '') : '';
    document.getElementById('editTemplate').value = skill ? skill.prompt_template : '';
    document.getElementById('editOverlay').classList.add('active');
    setTimeout(() => document.getElementById('editName')?.focus(), 100);
}

function closeEditModal() {
    document.getElementById('editOverlay').classList.remove('active');
    _editingSkill = null;
    _createType = null;
}

document.getElementById('btnCloseEdit').addEventListener('click', closeEditModal);
document.getElementById('editOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditModal();
});
document.getElementById('btnEditCancel').addEventListener('click', closeEditModal);
document.getElementById('btnEditSave').addEventListener('click', saveSkill);
document.getElementById('btnCreateGlobal').addEventListener('click', () => showEditModal('global', null));
document.getElementById('btnCreatePersonal').addEventListener('click', () => showEditModal('personal', null));

async function saveSkill() {
    const name = document.getElementById('editName').value.trim();
    const description = document.getElementById('editDesc').value.trim();
    const prompt_template = document.getElementById('editTemplate').value.trim();

    if (!name) { alert('请输入技能名称'); return; }
    if (!prompt_template) { alert('请输入提示词模板'); return; }

    const body = { name, description, prompt_template };
    try {
        if (_editingSkill) {
            if (_editingSkill.type === 'global') {
                await api(`/skills/global/${_editingSkill.id}`, { method: 'PATCH', body });
            } else {
                await api(`/skills/${_editingSkill.id}`, { method: 'PATCH', body });
            }
        } else if (_createType === 'global') {
            await api('/skills/global', { method: 'POST', body });
        } else {
            await api('/skills', { method: 'POST', body });
        }
        closeEditModal();
        loadAllSkills();
    } catch (err) { alert('保存失败：' + err.message); }
}

// ============================================================
//  Boot
// ============================================================

function boot() {
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => boot()); return; }
    init();
}
boot();
