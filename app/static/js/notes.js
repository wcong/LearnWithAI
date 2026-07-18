// ============================================================
// LearnWithAI – 笔记页面逻辑（左树右笔记，无聊天）
// ============================================================

let token = localStorage.getItem('token') || '';
let currentUser = null;
let treeData = [];
let selectedAreaId = null;
let selectedAreaName = '';
let _expanded = {};
let quill = null;
let _isEditingNote = false;

// ============================================================
//  API Helper
// ============================================================

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

// ============================================================
//  Auth
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

function logout() {
    token = '';
    currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    authPage.style.display = 'flex';
    appPage.style.display = 'none';
}

function showApp() {
    authPage.style.display = 'none';
    appPage.style.display = 'flex';
    document.getElementById('userBadge').textContent = currentUser ? currentUser.username : '';
    bootNotes();
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
    if (!roots || roots.length === 0) {
        document.getElementById('areaTree').innerHTML =
            '<div class="loading-text">暂无领域，点击上方 + 创建</div>';
        return;
    }
    document.getElementById('areaTree').innerHTML = buildTreeHtml(roots);
    bindTreeEvents(document.getElementById('areaTree'));
}

function buildTreeHtml(nodes) {
    return nodes.map(n => {
        const hasChildren = n.children && n.children.length > 0;
        const isExpanded = _expanded[n.id] !== false;
        const isActive = n.id === selectedAreaId;
        let html = `<div class="tree-node"><div class="tree-row ${isActive ? 'active' : ''}" data-id="${n.id}">`;
        html += hasChildren
            ? `<span class="tree-toggle ${isExpanded ? 'expanded' : ''}">▶</span>`
            : `<span class="tree-toggle leaf">▶</span>`;
        html += `<span class="tree-icon">${hasChildren ? '📂' : '📄'}</span>`;
        html += `<span class="tree-name">${escHtml(n.name)}</span>`;
        html += `<button class="tree-delete" title="删除此领域">✕</button>`;
        html += `</div>`;
        if (hasChildren) {
            html += `<div class="tree-children" style="display:${isExpanded ? '' : 'none'}">${buildTreeHtml(n.children)}</div>`;
        }
        html += `</div>`;
        return html;
    }).join('');
}

function bindTreeEvents(container) {
    container.querySelectorAll('.tree-row').forEach(row => {
        const id = parseInt(row.dataset.id, 10);
        row.addEventListener('click', (e) => {
            if (e.target.closest('.tree-delete')) return;
            if (e.target.closest('.tree-toggle')) {
                const toggle = e.target.closest('.tree-toggle');
                if (toggle.classList.contains('leaf')) return;
                const exp = toggle.classList.toggle('expanded');
                _expanded[id] = exp;
                const ch = row.nextElementSibling;
                if (ch && ch.classList.contains('tree-children')) ch.style.display = exp ? '' : 'none';
                return;
            }
            const node = findNodeById(treeData, id);
            if (node) selectArea(node);
        });
        row.querySelector('.tree-delete')?.addEventListener('click', (e) => {
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

    // 树高亮
    document.querySelectorAll('#areaTree .tree-row').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.id, 10) === selectedAreaId);
    });

    // 更新标题
    document.getElementById('noteTitle').textContent = `📝 学习笔记`;
    document.getElementById('noteAreaName').textContent = `当前领域：${nodeData.name}`;

    // 加载笔记
    loadNote(nodeData.id);
}

function clearArea() {
    selectedAreaId = null;
    selectedAreaName = '';
    document.getElementById('noteTitle').textContent = '📝 学习笔记';
    document.getElementById('noteAreaName').textContent = '请选择一个领域开始记录笔记';
    if (quill) {
        quill.setText('');
        quill.enable(false);
    }
    document.getElementById('noteEditor').classList.add('ql-readonly');
    document.getElementById('noteView').style.display = 'none';
    document.getElementById('noteEditor').style.display = 'flex';
    document.getElementById('btnEditNote').style.display = 'none';
    document.getElementById('btnSaveNote').style.display = 'none';
    document.getElementById('noteStatus').textContent = '';
}

// ============================================================
//  笔记 CRUD
// ============================================================

async function loadNote(areaId) {
    try {
        const note = await api(`/notes/${areaId}`);
        document.getElementById('noteTitle').textContent = `📝 笔记 · ${selectedAreaName}`;
        quill.root.innerHTML = note.content || '';
        _isEditingNote = false;
        showNoteView();
    } catch { /* ignore */ }
}

function showNoteView() {
    quill.enable(false);
    document.getElementById('noteEditor').classList.add('ql-readonly');
    document.getElementById('noteEditor').style.display = 'flex';
    document.getElementById('noteView').style.display = 'none';
    document.getElementById('btnEditNote').style.display = 'inline-block';
    document.getElementById('btnSaveNote').style.display = 'none';
    document.getElementById('noteStatus').textContent = '';
}

function enterEditNote() {
    _isEditingNote = true;
    showEditNote();
}

function showEditNote() {
    quill.enable(true);
    document.getElementById('noteEditor').classList.remove('ql-readonly');
    document.getElementById('noteView').style.display = 'none';
    document.getElementById('noteEditor').style.display = 'flex';
    document.getElementById('btnEditNote').style.display = 'none';
    document.getElementById('btnSaveNote').style.display = 'inline-block';
    document.getElementById('noteStatus').textContent = '编辑中…';
    quill.focus();
}

async function saveNote() {
    if (!selectedAreaId || !quill) return;
    const content = quill.root.innerHTML;
    document.getElementById('noteStatus').textContent = '保存中…';

    try {
        await api(`/notes/${selectedAreaId}`, {
            method: 'PUT',
            body: { content },
        });
        document.getElementById('noteStatus').textContent = '已保存';
        _isEditingNote = false;
        quill.enable(false);
        document.getElementById('noteEditor').classList.add('ql-readonly');
        document.getElementById('btnEditNote').style.display = 'inline-block';
        document.getElementById('btnSaveNote').style.display = 'none';
        setTimeout(() => {
            if (document.getElementById('noteStatus').textContent === '已保存')
                document.getElementById('noteStatus').textContent = '';
        }, 2000);
    } catch { document.getElementById('noteStatus').textContent = '保存失败'; }
}

// ============================================================
//  模态框 – 创建/编辑领域
// ============================================================

document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
});

function showCreateModal(parentId, parentName) {
    showAreaModal({ mode: 'create', parentId, parentName });
}

function showAreaModal(opts) {
    const isEdit = opts.mode === 'edit';
    document.getElementById('modalTitle').textContent = isEdit
        ? '编辑学习领域'
        : (opts.parentId ? `在「${opts.parentName}」下创建子领域` : '创建顶级学习领域');
    document.getElementById('modalForm').innerHTML = `
        <label>领域名称 *</label>
        <input type="text" id="modalName" placeholder="例如：机器学习" required value="${isEdit ? escHtml(opts.editName || '') : ''}">
        <label>简介（选填）</label>
        <textarea id="modalDesc" rows="3" placeholder="描述该领域的核心内容...">${isEdit ? escHtml(opts.editDesc || '') : ''}</textarea>
        <input type="hidden" id="modalParentId" value="${opts.parentId || ''}">
        <input type="hidden" id="modalEditId" value="${opts.editId || ''}">
        <div class="modal-actions">
            <button type="button" id="btnModalCancel">取消</button>
            <button type="button" class="btn-primary" id="btnModalSubmit">${isEdit ? '保存' : '创建'}</button>
        </div>`;
    document.getElementById('modalOverlay').classList.add('active');
    setTimeout(() => document.getElementById('modalName')?.focus(), 100);
    document.getElementById('btnModalCancel').addEventListener('click', closeModal);
    document.getElementById('btnModalSubmit').addEventListener('click', isEdit ? submitEditArea : submitCreate);
    document.getElementById('modalName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') (isEdit ? submitEditArea : submitCreate)();
    });
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
}

async function submitCreate() {
    const name = document.getElementById('modalName').value.trim();
    const description = document.getElementById('modalDesc').value.trim();
    const parentId = document.getElementById('modalParentId').value;
    if (!name) { alert('请输入领域名称'); return; }
    const body = { name, description };
    if (parentId) body.parent_id = parseInt(parentId, 10);
    try {
        await api('/areas', { method: 'POST', body });
        closeModal();
        if (parentId) _expanded[parseInt(parentId, 10)] = true;
        await loadAreaTree();
    } catch (err) { alert('创建失败：' + err.message); }
}

async function submitEditArea() {
    const name = document.getElementById('modalName').value.trim();
    const description = document.getElementById('modalDesc').value.trim();
    const editId = document.getElementById('modalEditId').value;
    if (!name) { alert('请输入领域名称'); return; }
    if (!editId) return;
    try {
        await api(`/areas/${editId}`, { method: 'PATCH', body: { name, description } });
        closeModal();
        if (selectedAreaId === parseInt(editId, 10)) {
            document.getElementById('noteTitle').textContent = `📝 笔记 · ${name}`;
            document.getElementById('noteAreaName').textContent = `当前领域：${name}`;
            selectedAreaName = name;
        }
        await loadAreaTree();
    } catch (err) { alert('保存失败：' + err.message); }
}

// ============================================================
//  树右键菜单 – 右键点击创建子领域
// ============================================================

document.getElementById('areaTree').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.tree-row');
    if (row) {
        e.preventDefault();
        const id = parseInt(row.dataset.id, 10);
        const node = findNodeById(treeData, id);
        if (node) showCreateModal(node.id, node.name);
    }
});

// ============================================================
//  Boot
// ============================================================

function bootNotes() {
    document.getElementById('btnEditNote').addEventListener('click', enterEditNote);
    document.getElementById('btnSaveNote').addEventListener('click', saveNote);
    document.getElementById('btnNewRootArea').addEventListener('click', () => showCreateModal(null, ''));

    // Quill 编辑器初始化
    if (!quill) {
        try {
            quill = new Quill('#noteEditor', {
                theme: 'snow',
                placeholder: '在此处记录学习笔记…',
                modules: {
                    toolbar: [
                        [{ header: [1,2,3,false] }],
                        ['bold','italic','underline','strike'],
                        [{ list: 'ordered' }, { list: 'bullet' }],
                        [{ indent: '-1' }, { indent: '+1' }],
                        [{ color: [] }, { background: [] }],
                        ['blockquote','code-block'],
                        [{ align: [] }],
                        ['link'],
                        ['clean'],
                    ],
                },
            });
        } catch (e) {
            console.warn('Quill 编辑器初始化失败', e);
        }
    }

    loadAreaTree();
}

// ============================================================
//  入口
// ============================================================

(function boot() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init());
    } else {
        init();
    }
})();
