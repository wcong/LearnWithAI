// ============================================================
// LearnWithAI Mobile – 笔记页面逻辑
// ============================================================

// ——— State ———
let treeData = [];
let selectedAreaId = null;
let selectedAreaName = '';
let _expanded = {};
let quill = null;
let _isEditingNote = false;
let _activeOverlay = null;

// ============================================================
//  Overlay Controls
// ============================================================

function openAreaOverlay() {
    if (_activeOverlay === 'area') { closeAllOverlays(); return; }
    closeAllOverlays();
    _activeOverlay = 'area';
    document.getElementById('mOverlayMask').classList.add('visible');
    document.getElementById('mAreaOverlay').classList.add('open');
}

function closeAllOverlays() {
    _activeOverlay = null;
    const mask = document.getElementById('mOverlayMask');
    if (mask) mask.classList.remove('visible');
    const areaOv = document.getElementById('mAreaOverlay');
    if (areaOv) areaOv.classList.remove('open');
}

// ============================================================
//  Auth UI
// ============================================================

const authPage = document.getElementById('mAuthPage');
const appShell = document.getElementById('mAppShell');

function showAuth() {
    authPage.style.display = 'flex';
    appShell.style.display = 'none';
}

function showApp() {
    authPage.style.display = 'none';
    appShell.style.display = 'flex';
    const badge = document.getElementById('mUsernameBadge');
    if (badge && currentUser) {
        badge.textContent = currentUser.username;
        badge.style.display = 'inline-block';
    }
    bootNotes();
}

let isLoginMode = true;

function toggleMobileAuthRegisterFields(show) {
    const el = document.getElementById('mAuthRegisterFields');
    if (el) el.style.display = show ? '' : 'none';
}

function resetMNotesRegStep() {
    const s1 = document.getElementById('mAuthRegStep1');
    const s2 = document.getElementById('mAuthRegStep2');
    if (s1) s1.style.display = '';
    if (s2) s2.style.display = 'none';
    document.getElementById('mAuthPassword').style.display = '';
    document.getElementById('mAuthEmail').removeAttribute('readonly');
}

document.getElementById('mTabLogin').addEventListener('click', () => {
    isLoginMode = true;
    document.getElementById('mTabLogin').classList.add('active');
    document.getElementById('mTabRegister').classList.remove('active');
    document.getElementById('mAuthBtn').textContent = '登录';
    document.getElementById('mAuthBtn').style.display = '';
    document.getElementById('mAuthError').textContent = '';
    document.getElementById('mAuthError').style.color = '#ef4444';
    toggleMobileAuthRegisterFields(false);
    document.getElementById('mAuthPassword').style.display = '';
    document.getElementById('mAuthEmail').removeAttribute('readonly');
});

document.getElementById('mTabRegister').addEventListener('click', () => {
    isLoginMode = false;
    document.getElementById('mTabRegister').classList.add('active');
    document.getElementById('mTabLogin').classList.remove('active');
    document.getElementById('mAuthBtn').textContent = '注册';
    document.getElementById('mAuthBtn').style.display = 'none';
    document.getElementById('mAuthError').textContent = '';
    document.getElementById('mAuthError').style.color = '#ef4444';
    toggleMobileAuthRegisterFields(true);
    resetMNotesRegStep();
    document.getElementById('mAuthPassword').style.display = 'none';
});

document.getElementById('mAuthForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const authEmail = document.getElementById('mAuthEmail');
    const authError = document.getElementById('mAuthError');
    const authBtn = document.getElementById('mAuthBtn');
    const email = authEmail.value.trim();

    if (isLoginMode) {
        const password = document.getElementById('mAuthPassword').value.trim();
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
        const step2 = document.getElementById('mAuthRegStep2');
        if (!step2 || step2.style.display === 'none') {
            if (!email || email.indexOf('@') === -1) { authError.textContent = '请输入有效的邮箱'; return; }
            const sendBtn = document.getElementById('mAuthRegSendBtn');
            if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '发送中...'; }
            authError.textContent = '';
            authError.style.color = '#ef4444';
            try {
                await api('/auth/register-send-code', { method: 'POST', body: { email } });
                document.getElementById('mAuthRegStep1').style.display = 'none';
                document.getElementById('mAuthRegStep2').style.display = '';
                authBtn.style.display = '';
                document.getElementById('mAuthPassword').style.display = 'none';
                authEmail.setAttribute('readonly', 'readonly');
                authError.textContent = '验证码已发送，请查收邮件';
                authError.style.color = '#67c23a';
            } catch (err) {
                if (err.message.includes('已注册')) {
                    document.getElementById('mTabLogin').click();
                    authError.textContent = '该邮箱已注册，请直接登录';
                } else {
                    authError.textContent = err.message;
                }
            }
            finally { if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '发送验证码'; } }
        } else {
            const code = document.getElementById('mAuthRegCode')?.value?.trim();
            const password = document.getElementById('mAuthRegPassword')?.value?.trim();
            const confirmPw = document.getElementById('mAuthConfirmPassword')?.value || '';
            const nickname = document.getElementById('mAuthNickname')?.value?.trim() || '';
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
    if (target.id === 'mAuthForgotLink') {
        document.getElementById('mAuthForm').style.display = 'none';
        document.getElementById('mAuthForgotPanel').style.display = '';
        document.getElementById('mAuthForgotError').textContent = '';
        document.getElementById('mAuthForgotResetError').textContent = '';
        document.getElementById('mAuthForgotStep2').style.display = 'none';
        document.getElementById('mAuthForgotStep1').style.display = '';
    } else if (target.id === 'mAuthForgotBack') {
        document.getElementById('mAuthForgotPanel').style.display = 'none';
        document.getElementById('mAuthForm').style.display = '';
    } else if (target.id === 'mAuthForgotSendBtn') {
        handleMNotesForgotSend();
    } else if (target.id === 'mAuthForgotResetBtn') {
        handleMNotesForgotReset();
    }
});

async function handleMNotesForgotSend() {
    const email = document.getElementById('mAuthForgotEmail')?.value?.trim();
    if (!email) { document.getElementById('mAuthForgotError').textContent = '请输入邮箱'; return; }
    const btn = document.getElementById('mAuthForgotSendBtn');
    btn.disabled = true;
    btn.textContent = '发送中...';
    document.getElementById('mAuthForgotError').textContent = '';
    try {
        await api('/auth/forgot-password', { method: 'POST', body: { email } });
        document.getElementById('mAuthForgotStep1').style.display = 'none';
        document.getElementById('mAuthForgotStep2').style.display = '';
    } catch (err) { document.getElementById('mAuthForgotError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = '发送验证码'; }
}

async function handleMNotesForgotReset() {
    const email = document.getElementById('mAuthForgotEmail')?.value?.trim();
    const code = document.getElementById('mAuthForgotCode')?.value?.trim();
    const newPassword = document.getElementById('mAuthForgotNewPassword')?.value?.trim();
    if (!code || !newPassword) { document.getElementById('mAuthForgotResetError').textContent = '请填写验证码和新密码'; return; }
    const btn = document.getElementById('mAuthForgotResetBtn');
    btn.disabled = true;
    btn.textContent = '重置中...';
    document.getElementById('mAuthForgotResetError').textContent = '';
    try {
        await api('/auth/reset-password', { method: 'POST', body: { email, code, new_password: newPassword } });
        document.getElementById('mAuthForgotResetError').style.color = '#67c23a';
        document.getElementById('mAuthForgotResetError').textContent = '密码重置成功，请返回登录';
        setTimeout(() => { document.getElementById('mAuthForgotBack')?.click(); }, 2000);
    } catch (err) { document.getElementById('mAuthForgotResetError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = '重置密码'; }
}

document.getElementById('mBtnLogout').addEventListener('click', () => {
    logout();
    showAuth();
});

// ============================================================
//  Init
// ============================================================

function init() {
    const saved = localStorage.getItem('user');
    if (token && saved) {
        try { currentUser = JSON.parse(saved); } catch { currentUser = null; }
    }
    if (token && currentUser) {
        showApp();
    } else {
        showAuth();
    }
}

// ============================================================
//  领域树
// ============================================================

async function loadAreaTree() {
    try {
        treeData = await api('/areas/tree');
    } catch {
        treeData = [];
    }
    renderTree(treeData);
    if (treeData.length > 0) {
        const still = selectedAreaId && findNodeById(treeData, selectedAreaId);
        selectArea(still || treeData[0]);
    } else {
        clearArea();
    }
}

function renderTree(roots) {
    const treeEl = document.getElementById('mAreaTree');
    if (!roots || roots.length === 0) {
        treeEl.innerHTML = '<div class="m-empty-state">暂无领域，点击下方 ➕ 创建</div>';
        return;
    }
    treeEl.innerHTML = buildTreeHtml(roots);
    bindTreeEvents(treeEl);
}

function buildTreeHtml(nodes) {
    return nodes.map(n => {
        const hasChildren = n.children && n.children.length > 0;
        const isExpanded = _expanded[n.id] !== false;
        const isActive = n.id === selectedAreaId;
        let html = `<div class="m-tree-node"><div class="m-tree-row ${isActive ? 'active' : ''}" data-id="${n.id}">`;
        html += hasChildren
            ? `<span class="m-tree-toggle ${isExpanded ? 'expanded' : ''}">▶</span>`
            : `<span class="m-tree-toggle leaf">▶</span>`;
        html += `<span class="m-tree-icon">${hasChildren ? '📂' : '📄'}</span>`;
        html += `<span class="m-tree-name">${escHtml(n.name)}</span>`;
        html += `<button class="m-tree-delete" title="删除">✕</button>`;
        html += `</div>`;
        if (hasChildren) {
            html += `<div class="m-tree-children" style="display:${isExpanded ? '' : 'none'}">${buildTreeHtml(n.children)}</div>`;
        }
        html += `</div>`;
        return html;
    }).join('');
}

function bindTreeEvents(container) {
    container.querySelectorAll('.m-tree-row').forEach(row => {
        const id = parseInt(row.dataset.id, 10);
        row.addEventListener('click', (e) => {
            if (e.target.closest('.m-tree-delete')) return;
            if (e.target.closest('.m-tree-toggle')) {
                const toggle = e.target.closest('.m-tree-toggle');
                if (toggle.classList.contains('leaf')) return;
                const exp = toggle.classList.toggle('expanded');
                _expanded[id] = exp;
                const ch = row.nextElementSibling;
                if (ch && ch.classList.contains('m-tree-children')) ch.style.display = exp ? '' : 'none';
                return;
            }
            const node = findNodeById(treeData, id);
            if (node) {
                selectArea(node);
                closeAllOverlays();
            }
        });
        row.querySelector('.m-tree-delete')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const node = findNodeById(treeData, id);
            if (node) deleteArea(node.id, node.name);
        });
    });
}

function findNodeById(roots, id) {
    for (const r of roots) {
        if (r.id === id) return r;
        if (r.children) { const f = findNodeById(r.children, id); if (f) return f; }
    }
    return null;
}

async function deleteArea(id, name) {
    if (!confirm(`确认删除「${name}」及其所有子领域？`)) return;
    try {
        await api(`/areas/${id}`, { method: 'DELETE' });
        if (selectedAreaId === id) { selectedAreaId = null; selectedAreaName = ''; clearArea(); }
        await loadAreaTree();
    } catch (err) { alert('删除失败：' + err.message); }
}

// ============================================================
//  选择领域 → 加载笔记
// ============================================================

function selectArea(nodeData) {
    selectedAreaId = nodeData.id;
    selectedAreaName = nodeData.name;

    document.querySelectorAll('#mAreaTree .m-tree-row').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.id, 10) === selectedAreaId);
    });

    document.getElementById('mNoteTitle').textContent = '📝 学习笔记';
    document.getElementById('mNoteAreaName').textContent = `当前领域：${nodeData.name}`;

    loadNote(nodeData.id);
}

function clearArea() {
    selectedAreaId = null;
    selectedAreaName = '';
    document.getElementById('mNoteTitle').textContent = '📝 学习笔记';
    document.getElementById('mNoteAreaName').textContent = '请选择领域开始记录';
    if (quill) {
        quill.setText('');
        quill.enable(false);
    }
    document.getElementById('mNoteEditor').classList.add('ql-readonly');
    document.getElementById('mNoteView').style.display = 'none';
    document.getElementById('mNoteEditor').style.display = 'flex';
    document.getElementById('mBtnEditNote').style.display = 'none';
    document.getElementById('mBtnSaveNote').style.display = 'none';
    document.getElementById('mNoteStatus').textContent = '';
}

// ============================================================
//  笔记 CRUD
// ============================================================

async function loadNote(areaId) {
    try {
        const note = await api(`/notes/${areaId}`);
        document.getElementById('mNoteTitle').textContent = `📝 ${selectedAreaName}`;
        if (quill) quill.root.innerHTML = note.content || '';
        _isEditingNote = false;
        showNoteView();
    } catch { /* ignore */ }
}

function showNoteView() {
    if (quill) quill.enable(false);
    document.getElementById('mNoteEditor').classList.add('ql-readonly');
    document.getElementById('mNoteEditor').style.display = 'flex';
    document.getElementById('mNoteView').style.display = 'none';
    document.getElementById('mBtnEditNote').style.display = 'flex';
    document.getElementById('mBtnSaveNote').style.display = 'none';
    document.getElementById('mNoteStatus').textContent = '';
}

function enterEditNote() {
    _isEditingNote = true;
    showEditNote();
}

function showEditNote() {
    if (quill) quill.enable(true);
    document.getElementById('mNoteEditor').classList.remove('ql-readonly');
    document.getElementById('mNoteView').style.display = 'none';
    document.getElementById('mNoteEditor').style.display = 'flex';
    document.getElementById('mBtnEditNote').style.display = 'none';
    document.getElementById('mBtnSaveNote').style.display = 'flex';
    document.getElementById('mNoteStatus').textContent = '编辑中…';
    if (quill) quill.focus();
}

async function saveNote() {
    if (!selectedAreaId || !quill) return;
    const content = quill.root.innerHTML;
    document.getElementById('mNoteStatus').textContent = '保存中…';

    try {
        await api(`/notes/${selectedAreaId}`, { method: 'PUT', body: { content } });
        document.getElementById('mNoteStatus').textContent = '已保存';
        _isEditingNote = false;
        quill.enable(false);
        document.getElementById('mNoteEditor').classList.add('ql-readonly');
        document.getElementById('mBtnEditNote').style.display = 'flex';
        document.getElementById('mBtnSaveNote').style.display = 'none';
        setTimeout(() => {
            if (document.getElementById('mNoteStatus').textContent === '已保存')
                document.getElementById('mNoteStatus').textContent = '';
        }, 2000);
    } catch { document.getElementById('mNoteStatus').textContent = '保存失败'; }
}

// ============================================================
//  模态框 – 创建领域
// ============================================================

function showCreateModal() {
    document.getElementById('mModalCreateTitle').textContent = '创建学习领域';
    document.getElementById('mCreateName').value = '';
    document.getElementById('mCreateDesc').value = '';
    document.getElementById('mCreateParentId').value = '';
    document.getElementById('mEditId').value = '';
    document.getElementById('mCreateSubmit').textContent = '创建';
    document.getElementById('mModalCreate').classList.add('active');
    setTimeout(() => document.getElementById('mCreateName')?.focus(), 100);
}

function closeCreateModal() {
    document.getElementById('mModalCreate').classList.remove('active');
}

document.getElementById('mModalCreateClose').addEventListener('click', closeCreateModal);
document.getElementById('mCreateCancel').addEventListener('click', closeCreateModal);

document.getElementById('mCreateSubmit').addEventListener('click', async () => {
    const name = document.getElementById('mCreateName').value.trim();
    const description = document.getElementById('mCreateDesc').value.trim();
    if (!name) { alert('请输入领域名称'); return; }
    try {
        await api('/areas', { method: 'POST', body: { name, description } });
        closeCreateModal();
        await loadAreaTree();
    } catch (err) { alert('创建失败：' + err.message); }
});

// ============================================================
//  UI 绑定
// ============================================================

function bindUIEvents() {
    document.getElementById('mBtnToggleAreas').addEventListener('click', openAreaOverlay);
    document.getElementById('mCloseAreaOverlay').addEventListener('click', closeAllOverlays);
    document.getElementById('mOverlayMask').addEventListener('click', closeAllOverlays);
    document.getElementById('mBtnNewRoot').addEventListener('click', showCreateModal);
    document.getElementById('mBtnEditNote').addEventListener('click', enterEditNote);
    document.getElementById('mBtnSaveNote').addEventListener('click', saveNote);
}

// ============================================================
//  Boot
// ============================================================

function bootNotes() {
    bindUIEvents();

    if (!quill) {
        try {
            quill = new Quill('#mNoteEditor', {
                theme: 'snow',
                placeholder: '在此处记录学习笔记…',
                modules: {
                    toolbar: [
                        [{ header: [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ list: 'ordered' }, { list: 'bullet' }],
                        [{ color: [] }, { background: [] }],
                        ['blockquote', 'code-block'],
                        ['link'],
                        ['clean'],
                    ],
                },
            });
        } catch (e) {
            console.warn('Quill 初始化失败', e);
        }
    }

    loadAreaTree();
}

// ============================================================
//  入口
// ============================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
