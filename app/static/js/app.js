// ============================================================
// LearnWithAI – 前端主逻辑
// ============================================================

// ——— Auth ———
let token = localStorage.getItem('token') || '';
let currentUser = null;

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

// ============================================================
//  Auth UI
// ============================================================

const authPage = document.getElementById('authPage');
const appContainer = document.getElementById('appContainer');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const authForm = document.getElementById('authForm');
const authUsername = document.getElementById('authUsername');
const authPassword = document.getElementById('authPassword');
const authBtn = document.getElementById('authBtn');
const authError = document.getElementById('authError');
const logoutBtn = document.getElementById('logoutBtn');

let isLoginMode = true;

tabLogin.addEventListener('click', () => {
    isLoginMode = true;
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    authBtn.textContent = '登录';
    authError.textContent = '';
});

tabRegister.addEventListener('click', () => {
    isLoginMode = false;
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    authBtn.textContent = '注册';
    authError.textContent = '';
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = authUsername.value.trim();
    const password = authPassword.value.trim();
    if (!username || !password) { authError.textContent = '请填写用户名和密码'; return; }
    authBtn.disabled = true;
    authBtn.textContent = '处理中...';
    authError.textContent = '';
    try {
        const endpoint = isLoginMode ? '/auth/login' : '/auth/register';
        const data = await api(endpoint, { method: 'POST', body: { username, password } });
        token = data.token;
        currentUser = { id: data.user_id, username: data.username };
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(currentUser));
        showApp();
    } catch (err) { authError.textContent = err.message; }
    finally { authBtn.disabled = false; authBtn.textContent = isLoginMode ? '登录' : '注册'; }
});

logoutBtn.addEventListener('click', logout);

function logout() {
    token = ''; currentUser = null;
    localStorage.removeItem('token'); localStorage.removeItem('user');
    showAuth();
}
function showAuth() { authPage.style.display = 'flex'; appContainer.style.display = 'none'; }
function showApp() {
    authPage.style.display = 'none'; appContainer.style.display = 'flex';
    const badge = document.getElementById('usernameBadge');
    if (badge && currentUser) badge.textContent = currentUser.username;
    bootApp();
}

// ============================================================
//  State
// ============================================================

let treeData = [];
let selectedAreaId = null;
let selectedAreaName = '';
let isSending = false;
let _expanded = {};
let quill = null;
let _isEditingNote = false;

// ============================================================
//  Boot
// ============================================================

function initAuth() {
    const saved = localStorage.getItem('user');
    if (token && saved) { currentUser = JSON.parse(saved); showApp(); }
    else { showAuth(); }
}

function bootApp() {
    // ⚡ 先注册所有事件监听器（避免因第三方库初始化失败而阻断 UI）
    document.getElementById('btnEditNote').addEventListener('click', enterEditNote);
    document.getElementById('btnSaveNote').addEventListener('click', saveNote);

    document.getElementById('btnNewRootArea').addEventListener('click', () => showCreateModal(null, ''));
    document.getElementById('btnRagSearch').addEventListener('click', showRagSearchModal);
    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    document.getElementById('chatInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.getElementById('btnCloseResponse').addEventListener('click', closeResponseModal);
    document.getElementById('responseOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeResponseModal();
    });
    document.getElementById('btnCloseRagSearch').addEventListener('click', closeRagSearchModal);
    document.getElementById('ragSearchOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeRagSearchModal();
    });
    document.getElementById('btnSubmitRagSearch').addEventListener('click', submitRagSearch);
    document.getElementById('ragSearchInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitRagSearch(); }
    });

    // Admin
    document.getElementById('btnAdmin').addEventListener('click', showAdminPanel);
    document.getElementById('btnCloseAdmin').addEventListener('click', closeAdminPanel);
    document.getElementById('adminOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeAdminPanel();
    });
    document.getElementById('btnAdminRefresh').addEventListener('click', loadAdminStats);

    // Quill 编辑器初始化（放在事件绑定之后，即使失败也不影响 UI 交互）
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
            console.warn('Quill 编辑器初始化失败，笔记功能暂不可用', e);
        }
    }

    loadData();
}

// ============================================================
//  左侧：领域树
// ============================================================

async function loadData() {
    try { treeData = await api('/areas/tree'); } catch { treeData = []; }
    renderTree(treeData);
    if (treeData.length > 0) {
        const still = selectedAreaId && findNodeById(treeData, selectedAreaId);
        selectArea(still || treeData[0]);
    } else { clearArea(); }
}

function renderTree(roots) {
    if (!roots || roots.length === 0) {
        document.getElementById('areaTree').innerHTML =
            '<div class="empty-chat" style="margin-top:30px;font-size:12px;"><p style="color:#c0c4cc;">暂无领域，点击上方创建</p></div>';
        return;
    }
    document.getElementById('areaTree').innerHTML = buildTreeHtml(roots, 0);
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
        html += `<button class="tree-delete" title="删除此领域">✕</button></div>`;
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

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function deleteArea(id, name) {
    if (!confirm(`确认删除「${name}」及其所有子领域？`)) return;
    try {
        await api(`/areas/${id}`, { method: 'DELETE' });
        if (selectedAreaId === id) { selectedAreaId = null; selectedAreaName = ''; clearArea(); }
        await loadData();
    } catch (err) { alert('删除失败：' + err.message); }
}

// ============================================================
//  选择领域 → 更新聊天 + 笔记
// ============================================================

function selectArea(nodeData) {
    selectedAreaId = nodeData.id;
    selectedAreaName = nodeData.name;

    // 树高亮
    document.querySelectorAll('#areaTree .tree-row').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.id, 10) === selectedAreaId);
    });

    // 聊天
    document.getElementById('areaTitle').textContent = nodeData.name;
    document.getElementById('areaDesc').textContent = nodeData.description || '暂无简介';
    document.getElementById('chatMessages').innerHTML =
        `<div class="empty-chat"><div class="icon">💬</div><p>已进入 <strong>${nodeData.name}</strong>，开始学习吧！</p></div>`;
    document.getElementById('chatInput').disabled = false;
    document.getElementById('chatInput').placeholder = `在「${nodeData.name}」中提问...`;
    document.getElementById('sendBtn').disabled = false;

    loadHistory(nodeData.id);
    loadNote(nodeData.id);
}

function clearArea() {
    document.getElementById('areaTitle').textContent = '请选择一个领域';
    document.getElementById('areaDesc').textContent = '';
    document.getElementById('chatMessages').innerHTML =
        `<div class="empty-chat"><div class="icon">🌱</div><p>选择一个学习领域，开启 AI 引导的深度学习之旅</p></div>`;
    document.getElementById('chatInput').disabled = true;
    document.getElementById('sendBtn').disabled = true;
    // 清空笔记
    if (quill) quill.setText('');
    document.getElementById('noteView').innerHTML = '<div class="empty-note">选择一个领域查看笔记</div>';
    document.getElementById('noteView').style.display = 'block';
    document.getElementById('noteEditor').style.display = 'none';
    document.getElementById('btnEditNote').style.display = 'none';
    document.getElementById('btnSaveNote').style.display = 'none';
    document.getElementById('noteStatus').textContent = '';
}

// ============================================================
//  笔记
// ============================================================

async function loadNote(areaId) {
    try {
        const note = await api(`/notes/${areaId}`);
        document.getElementById('noteTitle').textContent = `📝 笔记 · ${selectedAreaName}`;
        // 填充编辑器内容
        quill.root.innerHTML = note.content || '';
        // 进入查看模式
        _isEditingNote = false;
        showNoteView();
    } catch { /* ignore */ }
}

function showNoteView() {
    const view = document.getElementById('noteView');
    const editor = document.getElementById('noteEditor');
    const content = quill ? quill.root.innerHTML : '';

    if (content && content !== '<p><br></p>') {
        view.innerHTML = content;
    } else {
        view.innerHTML = '<div class="empty-note">暂无笔记，点击「✏️ 编辑」添加</div>';
    }

    view.style.display = 'block';
    editor.style.display = 'none';
    document.getElementById('btnEditNote').style.display = 'inline-block';
    document.getElementById('btnSaveNote').style.display = 'none';
    document.getElementById('noteStatus').textContent = '';
}

function showEditNote() {
    const view = document.getElementById('noteView');
    const editor = document.getElementById('noteEditor');

    view.style.display = 'none';
    editor.style.display = 'flex';
    document.getElementById('btnEditNote').style.display = 'none';
    document.getElementById('btnSaveNote').style.display = 'inline-block';
    document.getElementById('noteStatus').textContent = '编辑中…';
    quill.focus();
}

function enterEditNote() {
    _isEditingNote = true;
    showEditNote();
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
        showNoteView();
        setTimeout(() => {
            if (document.getElementById('noteStatus').textContent === '已保存')
                document.getElementById('noteStatus').textContent = '';
        }, 2000);
    } catch { document.getElementById('noteStatus').textContent = '保存失败'; }
}

// ============================================================
//  聊天
// ============================================================

async function loadHistory(areaId) {
    try {
        const messages = await api(`/chat/history/${areaId}`);
        if (messages.length === 0) return;
        document.getElementById('chatMessages').innerHTML = '';
        messages.forEach(m => appendMessage(m.role, m.content, m.id));
        document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
    } catch { /* ignore */ }
}

function appendMessage(role, content, msgId) {
    const container = document.getElementById('chatMessages');
    const empty = container.querySelector('.empty-chat');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = `message ${role}`;
    if (role === 'assistant') {
        // Markdown -> HTML 解析（带容错）
        let html;
        try {
            html = (typeof marked !== 'undefined')
                ? marked.parse(content, { breaks: true, gfm: true })
                : content;
        } catch (e) {
            console.warn('marked.parse 失败，使用纯文本降级', e);
            html = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        div.innerHTML = html
            + '<span class="click-hint">👆 点击展开详情</span>'
            + '<button class="msg-sub-btn">➕ 添加子领域</button>';
        div.querySelector('.click-hint').addEventListener('click', (e) => {
            e.stopPropagation(); showResponseModal(content, msgId);
        });
        div.querySelector('.msg-sub-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (selectedAreaId) showCreateModal(selectedAreaId, selectedAreaName);
        });
    } else {
        div.textContent = content;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
    const msg = document.getElementById('chatInput').value.trim();
    if (!msg || isSending || !selectedAreaId) return;
    appendMessage('user', msg);
    document.getElementById('chatInput').value = '';
    isSending = true;
    const btn = document.getElementById('sendBtn');
    btn.disabled = true; btn.textContent = '发送中...';
    try {
        const data = await api('/chat', { method: 'POST', body: { area_id: selectedAreaId, message: msg } });
        appendMessage('assistant', data.reply, data.message_id);
        await loadData();
    } catch (err) { appendMessage('assistant', '⚠️ 请求失败：' + err.message); }
    finally { isSending = false; btn.disabled = false; btn.textContent = '发送'; document.getElementById('chatInput').focus(); }
}

function buildUsageHtml(usage) {
    if (!usage) return `<div style="margin-top:20px;padding-top:14px;border-top:1px solid #e4e7ed;"><div style="font-size:12px;font-weight:600;color:#909399;">⚙️ 用量数据</div><p style="font-size:11px;color:#c0c4cc;margin-top:5px;">暂无用量记录</p></div>`;
    return `<div style="margin-top:20px;padding-top:14px;border-top:1px solid #e4e7ed;"><div style="font-size:12px;font-weight:600;color:#606266;margin-bottom:8px;">⚙️ Token 用量</div><table style="width:auto;font-size:12px;"><tr><td style="padding:3px 14px 3px 0;color:#909399;">模型</td><td style="padding:3px 0;">${escHtml(usage.model||'-')}</td></tr><tr><td style="padding:3px 14px 3px 0;color:#909399;">提供商</td><td style="padding:3px 0;">${escHtml(usage.provider||'-')}</td></tr><tr><td style="padding:3px 14px 3px 0;color:#909399;">输入 Token</td><td style="padding:3px 0;">${usage.prompt_tokens?.toLocaleString()||0}</td></tr><tr><td style="padding:3px 14px 3px 0;color:#909399;">输出 Token</td><td style="padding:3px 0;">${usage.completion_tokens?.toLocaleString()||0}</td></tr><tr><td style="padding:3px 14px 3px 0;color:#909399;">合计 Token</td><td style="padding:3px 0;font-weight:600;">${usage.total_tokens?.toLocaleString()||0}</td></tr><tr><td style="padding:3px 14px 3px 0;color:#909399;">耗时</td><td style="padding:3px 0;">${usage.duration_ms?(usage.duration_ms/1000).toFixed(1)+'s':'-'}</td></tr></table></div>`;
}

async function showResponseModal(content, msgId) {
    document.getElementById('responseLabel').textContent = `AI 回复详情 · ${selectedAreaName}`;
    let html;
    try {
        html = (typeof marked !== 'undefined')
            ? marked.parse(content, { breaks: true, gfm: true })
            : content;
    } catch (e) {
        console.warn('marked.parse 失败', e);
        html = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    if (msgId) { try { html += buildUsageHtml(await api(`/chat/usage/${msgId}`)); } catch {} }
    document.getElementById('responseBody').innerHTML = html;
    document.getElementById('responseOverlay').classList.add('active');
}
function closeResponseModal() { document.getElementById('responseOverlay').classList.remove('active'); }

// ============================================================
//  创建领域
// ============================================================

function showCreateModal(parentId, parentName) {
    document.getElementById('modalTitle').textContent = parentId
        ? `在「${parentName}」下创建子领域` : '创建顶级学习领域';
    document.getElementById('modalForm').innerHTML = `
        <label>领域名称 *</label>
        <input type="text" id="modalName" placeholder="例如：机器学习" required>
        <label>简介（选填）</label>
        <textarea id="modalDesc" rows="3" placeholder="描述该领域的核心内容..."></textarea>
        <input type="hidden" id="modalParentId" value="${parentId || ''}">
        <div class="modal-actions">
            <button type="button" id="btnModalCancel">取消</button>
            <button type="button" class="btn-primary" id="btnModalSubmit">创建</button>
        </div>`;
    document.getElementById('modalOverlay').classList.add('active');
    setTimeout(() => document.getElementById('modalName')?.focus(), 100);
    document.getElementById('btnModalCancel').addEventListener('click', closeModal);
    document.getElementById('btnModalSubmit').addEventListener('click', submitCreate);
    document.getElementById('modalName').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCreate(); });
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('active'); }

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
        await loadData();
    } catch (err) { alert('创建失败：' + err.message); }
}

// ============================================================
//  RAG 搜索
// ============================================================

let _ragSearching = false;

function showRagSearchModal() {
    document.getElementById('ragSearchOverlay').classList.add('active');
    document.getElementById('ragSearchInput').value = '';
    document.getElementById('ragSearchResults').innerHTML =
        '<div class="rag-search-empty">输入查询内容后点击"搜索"</div>';
    setTimeout(() => document.getElementById('ragSearchInput')?.focus(), 100);
}

function closeRagSearchModal() {
    document.getElementById('ragSearchOverlay').classList.remove('active');
}

async function submitRagSearch() {
    const query = document.getElementById('ragSearchInput').value.trim();
    if (!query || _ragSearching) return;

    _ragSearching = true;
    const btn = document.getElementById('btnSubmitRagSearch');
    btn.disabled = true;
    btn.textContent = '搜索中...';
    document.getElementById('ragSearchResults').innerHTML =
        '<div class="rag-search-empty" style="color:#909399;">🔍 正在搜索...</div>';

    try {
        const data = await api('/rag/search', {
            method: 'POST',
            body: { query, top_k: 10 },
        });
        renderRagResults(data.results || [], query);
    } catch (err) {
        document.getElementById('ragSearchResults').innerHTML =
            `<div class="rag-search-empty" style="color:#ef4444;">⚠️ 搜索失败：${escHtml(err.message)}</div>`;
    } finally {
        _ragSearching = false;
        btn.disabled = false;
        btn.textContent = '搜索';
    }
}

function renderRagResults(results, query) {
    const container = document.getElementById('ragSearchResults');
    if (results.length === 0) {
        container.innerHTML = '<div class="rag-search-empty">未找到匹配结果，试试其他关键词</div>';
        return;
    }

    let html = `<div class="rag-result-count">共找到 ${results.length} 条相关结果</div>`;
    results.forEach((r, i) => {
        const highlighted = highlightText(escHtml(r.snippet), escHtml(query));
        html += `
            <div class="rag-result-item">
                <div class="rag-result-index">${i + 1}</div>
                <div class="rag-result-content">
                    <a class="rag-result-link" data-area-id="${r.area_id}">${escHtml(r.area_name)}</a>
                    <div class="rag-result-snippet">${highlighted}</div>
                    <div class="rag-result-score">相关度：${(r.score * 100).toFixed(0)}%</div>
                </div>
            </div>`;
    });
    container.innerHTML = html;

    // 绑定点击跳转
    container.querySelectorAll('.rag-result-link').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const areaId = parseInt(el.dataset.areaId, 10);
            const node = findNodeById(treeData, areaId);
            if (node) {
                closeRagSearchModal();
                selectArea(node);
            } else {
                alert('该领域可能已被删除');
            }
        });
    });
}

function highlightText(text, query) {
    // 简单关键词高亮
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return text;
    let result = text;
    for (const term of terms) {
        try {
            const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            result = result.replace(re, '<mark class="rag-highlight">$1</mark>');
        } catch { /* ignore invalid regex */ }
    }
    return result;
}


// ============================================================
//  Admin 统计面板
// ============================================================

function showAdminPanel() {
    document.getElementById('adminOverlay').classList.add('active');
    document.getElementById('adminBody').innerHTML = '<div class="admin-loading">加载中...</div>';
    loadAdminStats();
}

function closeAdminPanel() {
    document.getElementById('adminOverlay').classList.remove('active');
}

async function loadAdminStats() {
    const body = document.getElementById('adminBody');
    body.innerHTML = '<div class="admin-loading">加载中...</div>';
    try {
        const data = await api('/admin/stats');
        renderAdminStats(data, body);
    } catch (err) {
        body.innerHTML = `<div class="admin-loading" style="color:#ef4444;">⚠️ 加载失败：${escHtml(err.message)}</div>`;
    }
}

function renderAdminStats(data, body) {
    const s = data.summary;
    const users = data.users;

    // 全局汇总卡片
    let html = `
        <div class="admin-summary">
            <div class="admin-card"><div class="admin-card-value">${s.total_users}</div><div class="admin-card-label">用户</div></div>
            <div class="admin-card"><div class="admin-card-value">${s.total_areas}</div><div class="admin-card-label">领域</div></div>
            <div class="admin-card"><div class="admin-card-value">${s.total_messages.toLocaleString()}</div><div class="admin-card-label">消息</div></div>
            <div class="admin-card"><div class="admin-card-value">${s.total_prompt_tokens.toLocaleString()}</div><div class="admin-card-label">输入 Token</div></div>
            <div class="admin-card"><div class="admin-card-value">${s.total_completion_tokens.toLocaleString()}</div><div class="admin-card-label">输出 Token</div></div>
            <div class="admin-card admin-card-primary"><div class="admin-card-value">${s.total_tokens.toLocaleString()}</div><div class="admin-card-label">总计 Token</div></div>
        </div>
    `;

    if (users.length === 0) {
        html += '<div class="admin-empty">暂无用户数据</div>';
    } else {
        // 每个用户的表格
        html += '<table class="admin-table"><thead><tr>' +
            '<th>用户</th><th>领域数</th><th>消息数</th><th>输入 Token</th><th>输出 Token</th><th>总计 Token</th>' +
            '</tr></thead><tbody>';
        users.forEach(u => {
            html += `<tr>
                <td><strong>${escHtml(u.username)}</strong></td>
                <td>${u.area_count}</td>
                <td>${u.message_count.toLocaleString()}</td>
                <td>${u.prompt_tokens.toLocaleString()}</td>
                <td>${u.completion_tokens.toLocaleString()}</td>
                <td><strong>${u.total_tokens.toLocaleString()}</strong></td>
            </tr>`;
        });
        html += '</tbody></table>';
    }

    body.innerHTML = html;
}


// ============================================================
//  Boot
// ============================================================

function boot() {
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => boot()); return; }
    if (typeof marked === 'undefined' || typeof Quill === 'undefined') { setTimeout(boot, 100); return; }
    initAuth();
}
boot();
