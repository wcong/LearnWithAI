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

document.getElementById('tabLogin').addEventListener('click', () => {
    isLoginMode = true;
    document.getElementById('tabLogin').classList.add('active');
    document.getElementById('tabRegister').classList.remove('active');
    document.getElementById('authBtn').textContent = '登录';
    document.getElementById('authError').textContent = '';
});

document.getElementById('tabRegister').addEventListener('click', () => {
    isLoginMode = false;
    document.getElementById('tabRegister').classList.add('active');
    document.getElementById('tabLogin').classList.remove('active');
    document.getElementById('authBtn').textContent = '注册';
    document.getElementById('authError').textContent = '';
});

document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value.trim();
    if (!username || !password) { document.getElementById('authError').textContent = '请填写用户名和密码'; return; }
    const btn = document.getElementById('authBtn');
    btn.disabled = true;
    btn.textContent = '处理中...';
    document.getElementById('authError').textContent = '';
    try {
        const endpoint = isLoginMode ? '/auth/login' : '/auth/register';
        const data = await api(endpoint, { method: 'POST', body: { username, password } });
        token = data.token;
        currentUser = { id: data.user_id, username: data.username };
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(currentUser));
        showApp();
    } catch (err) { document.getElementById('authError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = isLoginMode ? '登录' : '注册'; }
});

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
