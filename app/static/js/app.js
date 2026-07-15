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
//  SSE 流式读取 & Thinking 面板
// ============================================================

let _thinkingTokenBuffer = '';
let _thinkingRafId = null;

function parseSSEEvent(text) {
    const lines = text.split('\n');
    let type = 'message';
    let data = {};
    for (const line of lines) {
        if (line.startsWith('event: ')) {
            type = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
            try {
                data = JSON.parse(line.slice(6));
            } catch { /* ignore parse errors */ }
        }
    }
    return { type, data };
}

function showThinkingPanel() {
    const panel = document.getElementById('thinkingPanel');
    const icon = document.getElementById('thinkingIcon');
    const title = document.getElementById('thinkingTitle');
    const toggle = document.getElementById('thinkingToggle');
    const body = document.getElementById('thinkingBody');
    const content = document.getElementById('thinkingContent');

    panel.style.display = '';
    panel.classList.remove('collapsed');
    toggle.style.display = 'none';
    body.style.display = '';
    icon.textContent = '🤔';
    icon.classList.add('loading');
    title.textContent = 'AI 思考中...';
    content.innerHTML = '';
    _thinkingTokenBuffer = '';

    // 将 thinking 面板插入到 chat-messages 下方
    const chatMessages = document.getElementById('chatMessages');
    const inputArea = document.querySelector('.chat-input-area');
    if (panel.parentNode !== chatMessages.parentNode) {
        inputArea.parentNode.insertBefore(panel, inputArea);
    }
}

function updateThinkingContent(chunk) {
    _thinkingTokenBuffer += chunk;
    if (_thinkingRafId) return;
    _thinkingRafId = requestAnimationFrame(() => {
        _thinkingRafId = null;
        const el = document.getElementById('thinkingContent');
        if (el) el.innerHTML = escHtml(_thinkingTokenBuffer).replace(/\n/g, '<br>') + '<span class="thinking-cursor"></span>';
        // 自动滚动到底部
        const body = document.getElementById('thinkingBody');
        if (body) body.scrollTop = body.scrollHeight;
    });
}

function appendToolCall(chunk) {
    document.getElementById('thinkingContent').innerHTML +=
        `<span class="tool-call">${escHtml(chunk)}</span>`;
}

function completeThinking() {
    const icon = document.getElementById('thinkingIcon');
    const title = document.getElementById('thinkingTitle');
    const toggle = document.getElementById('thinkingToggle');

    icon.classList.remove('loading');
    icon.textContent = '✅';
    title.textContent = 'AI 思考完成';
    toggle.style.display = '';

    // 去掉光标
    const el = document.getElementById('thinkingContent');
    if (el) el.innerHTML = escHtml(_thinkingTokenBuffer).replace(/\n/g, '<br>');
}

function toggleThinkingPanel() {
    const panel = document.getElementById('thinkingPanel');
    const body = document.getElementById('thinkingBody');
    const toggle = document.getElementById('thinkingToggle');
    const isCollapsed = panel.classList.toggle('collapsed');
    toggle.textContent = isCollapsed ? '▲' : '▼';
}



function _initThinkingPanel() {
    const header = document.getElementById('thinkingHeader');
    const toggle = document.getElementById('thinkingToggle');
    if (header) {
        header.addEventListener('click', (e) => {
            if (e.target.closest('.thinking-toggle')) return;
            if (document.getElementById('thinkingToggle').style.display !== 'none') {
                toggleThinkingPanel();
            }
        });
    }
    if (toggle) {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleThinkingPanel();
        });
    }
}

async function readSSEStream(response, callbacks) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop();

        for (const eventText of events) {
            if (!eventText.trim()) continue;
            const event = parseSSEEvent(eventText);
            const handler = callbacks[event.type];
            if (handler) {
                await handler(event.data);
            }
        }
    }
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
let selectedSkillId = null;
let _skills = [];

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
    // Admin tab switching
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            if (tab.dataset.tab === 'stats') loadAdminStats();
        });
    });

    // Skill selector
    document.getElementById('skillSelect').addEventListener('change', (e) => {
        selectedSkillId = e.target.value ? parseInt(e.target.value, 10) : null;
        const skill = _skills.find(s => s.id === selectedSkillId);
        const input = document.getElementById('chatInput');
        if (skill) {
            input.placeholder = `使用「${skill.name}」提问...`;
        } else if (selectedAreaName) {
            input.placeholder = `在「${selectedAreaName}」中提问...`;
        } else {
            input.placeholder = '选择左侧领域后开始提问...';
        }
    });

    // Examine modal
    document.getElementById('btnCloseExamine').addEventListener('click', closeExamineModal);
    document.getElementById('examineOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeExamineModal();
    });

    // Generate subareas modal
    document.getElementById('btnCloseGen').addEventListener('click', closeGenModal);
    document.getElementById('genOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeGenModal();
    });

    // Quill 编辑器初始化（放在事件绑定之后，即使失败也不影响 UI 交互）
    if (!quill) {
        try {
            quill = new Quill('#noteEditor', {
                theme: 'snow',
                placeholder: '在此处记录学习笔记…',
                modules: {
                    syntax: {
                        hljs: window.hljs,
                    },
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

    // Thinking 面板初始化
    _initThinkingPanel();

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
        html += `<button class="tree-delete" title="删除此领域">✕</button>`;
        if (hasChildren) {
            html += `<button class="tree-examine" title="审查子领域">🔍</button>`;
        }
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
            if (e.target.closest('.tree-examine')) return;
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
        row.querySelector('.tree-examine')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const node = findNodeById(treeData, id);
            if (node) examineArea(node.id, node.name);
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
//  审查子领域
// ============================================================

async function examineArea(areaId, areaName) {
    const btn = document.querySelector(`.tree-row[data-id="${areaId}"] .tree-examine`);
    if (btn) btn.disabled = true;

    document.getElementById('examineLabel').textContent = `🔍 审查子领域 · ${areaName}`;
    document.getElementById('examineOverlay').classList.add('active');
    document.getElementById('examineBody').innerHTML = `
        <div class="examine-loading" id="examineThinking">
            <span id="examineThinkingIcon">🤔</span>
            <span id="examineThinkingText">AI 正在分析子领域...</span>
        </div>
        <div class="examine-stream" id="examineStream"></div>`;

    try {
        const res = await fetch(`/api/areas/${areaId}/examine/stream`, {
            method: 'POST',
            headers: {
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            },
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `请求失败 (${res.status})`);
        }

        let resultData = null;
        const streamEl = document.getElementById('examineStream');
        let streamContent = '';

        await readSSEStream(res, {
            thinking: (data) => {
                if (data.chunk) {
                    streamContent += data.chunk;
                    streamEl.innerHTML = escHtml(streamContent).replace(/\n/g, '<br>');
                }
            },
            tool_call: (data) => {
                if (data.chunk) {
                    streamContent += '\n' + data.chunk;
                    streamEl.innerHTML = escHtml(streamContent).replace(/\n/g, '<br>');
                }
            },
            result: (data) => {
                resultData = data;
            },
            error: (data) => {
                throw new Error(data.detail || '审查出错');
            },
        });

        if (resultData && resultData.sub_area_summaries) {
            showExamineResult(resultData, areaName);
        } else if (resultData) {
            showExamineResult(resultData, areaName);
        } else {
            document.getElementById('examineBody').innerHTML =
                '<div class="examine-loading" style="color:#ef4444;">⚠️ 审查未返回有效结果</div>';
        }
    } catch (err) {
        document.getElementById('examineBody').innerHTML =
            `<div class="examine-loading" style="color:#ef4444;">⚠️ 分析失败：${escHtml(err.message)}</div>`;
    } finally {
        if (btn) btn.disabled = false;
    }
}

function showExamineResult(data, areaName) {
    const subs = data.sub_area_summaries || [];
    const missing = data.missing_suggestions || [];

    let html = '';

    // 总体摘要
    if (data.summary) {
        html += `<div class="examine-summary">${escHtml(data.summary)}</div>`;
    }

    // 子领域摘要
    html += `<div class="examine-section-title">📋 子领域摘要 (${subs.length})</div>`;
    if (subs.length === 0) {
        html += '<div class="examine-empty">暂无子领域摘要</div>';
    } else {
        subs.forEach((s, i) => {
            html += `
                <div class="examine-sub-card">
                    <div class="examine-sub-index">${i + 1}</div>
                    <div>
                        <div class="examine-sub-name">${escHtml(s.name)}</div>
                        <div class="examine-sub-desc">${escHtml(s.summary || '')}</div>
                    </div>
                </div>`;
        });
    }

    // 缺失建议
    html += `<div class="examine-section-title" style="margin-top:20px;">💡 建议补充的子领域 (${missing.length})</div>`;
    if (missing.length === 0) {
        html += '<div style="text-align:center;color:#67c23a;padding:16px 0;font-size:13px;">✅ 当前子领域覆盖完整，无需补充</div>';
    } else {
        missing.forEach((m, i) => {
            html += `
                <div class="examine-missing-card">
                    <div class="examine-missing-icon">${i + 1}</div>
                    <div>
                        <div class="examine-missing-name">${escHtml(m.name)}</div>
                        <div class="examine-missing-reason">📌 ${escHtml(m.reason || '')}</div>
                    </div>
                    <button class="examine-create-btn" data-name="${escHtml(m.name)}" data-reason="${escHtml(m.reason || '')}"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> 创建</button>
                </div>`;
        });
    }

    // 底部操作栏
    const time = data.created_at
        ? new Date(data.created_at).toLocaleString('zh-CN')
        : '';
    html += `
        <div class="examine-footer">
            <span class="examine-time">🕐 ${time || '刚刚'}</span>
            <button class="examine-reload-btn" id="btnExamineReload">🔄 重新分析</button>
        </div>`;

    document.getElementById('examineBody').innerHTML = html;

    // 绑定重新分析按钮
    document.getElementById('btnExamineReload')?.addEventListener('click', () => {
        const id = data.area_id;
        if (id) examineArea(id, areaName);
    });

    // 绑定缺失建议的创建按钮
    document.querySelectorAll('.examine-create-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const name = btn.dataset.name;
            const reason = btn.dataset.reason;
            const parentId = data.area_id;
            if (!name || !parentId) return;

            btn.disabled = true;
            btn.textContent = '创建中...';
            try {
                await api('/areas', {
                    method: 'POST',
                    body: { name, description: reason, parent_id: parentId },
                });
                btn.textContent = '✅ 已创建';
                btn.classList.add('created');
                // 展开父节点以便看到新建的子领域
                if (parentId) _expanded[parentId] = true;
                loadData();
            } catch (err) {
                btn.textContent = '❌ 失败';
                setTimeout(() => { btn.textContent = '➕ 创建'; btn.disabled = false; }, 2000);
            }
        });
    });
}

function closeExamineModal() {
    document.getElementById('examineOverlay').classList.remove('active');
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
    const skill = _skills.find(s => s.id === selectedSkillId);
    document.getElementById('chatInput').placeholder = skill
        ? `使用「${skill.name}」提问...`
        : `在「${nodeData.name}」中提问...`;
    document.getElementById('sendBtn').disabled = false;

    loadHistory(nodeData.id);
    loadNote(nodeData.id);
    loadSkills();
}

function clearArea() {
    document.getElementById('areaTitle').textContent = '请选择一个领域';
    document.getElementById('areaDesc').textContent = '';
    document.getElementById('chatMessages').innerHTML =
        `<div class="empty-chat"><div class="icon">🌱</div><p>选择一个学习领域，开启 AI 引导的深度学习之旅</p></div>`;
    document.getElementById('chatInput').disabled = true;
    document.getElementById('sendBtn').disabled = true;
    // 清空笔记
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
//  笔记
// ============================================================

async function loadNote(areaId) {
    try {
        const note = await api(`/notes/${areaId}`);
        document.getElementById('noteTitle').textContent = `📝 笔记 · ${selectedAreaName}`;
        // 填充编辑器内容
        quill.root.innerHTML = note.content || '';
        // 进入查看模式（Quill 只读）
        _isEditingNote = false;
        showNoteView();
    } catch { /* ignore */ }
}

function showNoteView() {
    const editor = document.getElementById('noteEditor');
    // Quill 置为只读，保持原有格式
    quill.enable(false);
    editor.classList.add('ql-readonly');
    editor.style.display = 'flex';
    document.getElementById('noteView').style.display = 'none';
    document.getElementById('btnEditNote').style.display = 'inline-block';
    document.getElementById('btnSaveNote').style.display = 'none';
    document.getElementById('noteStatus').textContent = '';
}

// ============================================================
//  Skill 选择
// ============================================================

async function loadSkills() {
    try {
        _skills = await api('/skills');
        const select = document.getElementById('skillSelect');
        const currentVal = select.value;
        select.innerHTML = '<option value="">无 Skill</option>';
        _skills.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name + (s.is_global ? ' 🌐' : '');
            select.appendChild(opt);
        });
        if (selectedSkillId && _skills.some(s => s.id === selectedSkillId)) {
            select.value = selectedSkillId;
        } else {
            select.value = '';
            selectedSkillId = null;
        }
    } catch { /* ignore */ }
}

function showEditNote() {
    const editor = document.getElementById('noteEditor');
    // Quill 启用编辑
    quill.enable(true);
    editor.classList.remove('ql-readonly');
    document.getElementById('noteView').style.display = 'none';
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
        // 保存后切换为只读查看模式，不重新渲染，保持格式完全一致
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
//  聊天
// ============================================================

async function loadHistory(areaId) {
    try {
        const messages = await api(`/chat/history/${areaId}`);
        if (messages.length === 0) return;
        const container = document.getElementById('chatMessages');
        container.innerHTML = '';

        // 分离父领域和当前领域的消息
        const parentMessages = messages.filter(m => m.area_id !== areaId);
        const currentMessages = messages.filter(m => m.area_id === areaId);

        // 先渲染父领域的问答
        parentMessages.forEach(m => appendMessage(m.role, m.content, m.id));

        // 如果两个领域都有消息，添加分割线
        if (parentMessages.length > 0 && currentMessages.length > 0) {
            const divider = document.createElement('div');
            divider.className = 'chat-divider';
            divider.innerHTML = '<span>📖 父领域问答</span>';
            container.appendChild(divider);
        }

        // 再渲染当前领域的问答
        currentMessages.forEach(m => appendMessage(m.role, m.content, m.id));

        container.scrollTop = container.scrollHeight;
    } catch { /* ignore */ }
}

function appendMessage(role, content, msgId) {
    const container = document.getElementById('chatMessages');
    const empty = container.querySelector('.empty-chat');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.dataset.msgId = msgId;
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
            + '<div class="msg-actions">'
            + '<button class="msg-sub-btn">➕ 添加子领域</button>'
            + '<button class="msg-gen-btn">✨ 生成子领域</button>'
            + '<button class="msg-del-btn">🗑 删除</button>'
            + '</div>';
        div.querySelector('.click-hint').addEventListener('click', (e) => {
            e.stopPropagation(); showResponseModal(content, msgId);
        });
        div.querySelector('.msg-sub-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (selectedAreaId) showCreateModal(selectedAreaId, selectedAreaName);
        });
        div.querySelector('.msg-gen-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (selectedAreaId) generateSubareas(selectedAreaId);
        });
        div.querySelector('.msg-del-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteMessage(msgId, div);
        });
    } else {
        div.innerHTML = '<span class="msg-user-text">' + escHtml(content) + '</span>'
            + '<div class="msg-actions"><button class="msg-del-btn">🗑 删除</button></div>';
        div.querySelector('.msg-del-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteMessage(msgId, div);
        });
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

async function deleteMessage(msgId, element) {
    if (!msgId) return;
    if (!confirm('确定删除此消息？')) return;
    try {
        await api(`/chat/message/${msgId}`, { method: 'DELETE' });
        element.remove();
        const container = document.getElementById('chatMessages');
        if (container.children.length === 0) {
            container.innerHTML = '<div class="empty-chat"><div class="icon">💬</div><p>暂无聊天记录，开始学习吧！</p></div>';
        }
    } catch (err) {
        alert('删除失败：' + err.message);
    }
}

async function sendMessage() {
    const msg = document.getElementById('chatInput').value.trim();
    if (!msg || isSending || !selectedAreaId) return;
    appendMessage('user', msg);
    document.getElementById('chatInput').value = '';
    isSending = true;
    const btn = document.getElementById('sendBtn');
    btn.disabled = true; btn.textContent = '发送中...';

    // 显示 thinking 面板
    showThinkingPanel();

    try {
        const body = { area_id: selectedAreaId, message: msg };
        if (selectedSkillId) body.skill_id = selectedSkillId;

        const res = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            if (res.status === 401) { logout(); throw new Error('登录已过期'); }
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `请求失败 (${res.status})`);
        }

        let resultData = null;
        let fullThinking = '';

        await readSSEStream(res, {
            thinking: (data) => {
                if (data.chunk) updateThinkingContent(data.chunk);
            },
            tool_call: (data) => {
                if (data.chunk) appendToolCall(data.chunk);
            },
            result: (data) => {
                resultData = data;
                if (data.reply) {
                    appendMessage('assistant', data.reply, data.message_id);
                }
            },
            error: (data) => {
                throw new Error(data.detail || 'AI 处理出错');
            },
        });

        completeThinking();

        if (!resultData) {
            appendMessage('assistant', '⚠️ AI 未返回有效回复');
        }
    } catch (err) {
        appendMessage('assistant', '⚠️ 请求失败：' + err.message);
        // 出错时也标记 thinking 完成
        const icon = document.getElementById('thinkingIcon');
        const title = document.getElementById('thinkingTitle');
        if (icon) { icon.textContent = '⚠️'; icon.classList.remove('loading'); }
        if (title) title.textContent = '思考中断';
        const toggle = document.getElementById('thinkingToggle');
        if (toggle) toggle.style.display = '';
    } finally {
        isSending = false;
        btn.disabled = false;
        btn.textContent = '发送';
        document.getElementById('chatInput').focus();
    }
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
//  生成子领域
// ============================================================

let _genSubareasData = null;  // 缓存当前生成的数据

function closeGenModal() {
    document.getElementById('genOverlay').classList.remove('active');
    _genSubareasData = null;
}

function showGenLoading() {
    document.getElementById('genBody').innerHTML = `
        <div class="gen-thinking-container">
            <div class="gen-thinking-content" id="genThinkingContent"><span class="gen-thinking-cursor"></span></div>
        </div>
        <div class="gen-loading" style="padding:20px 0;">⏳ AI 正在思考...</div>`;
}

function updateGenThinking(chunk) {
    const el = document.getElementById('genThinkingContent');
    if (!el) return;
    const text = el.textContent || el.innerText || '';
    el.innerHTML = escHtml(text + chunk).replace(/\n/g, '<br>') + '<span class="gen-thinking-cursor"></span>';
    const container = document.querySelector('.gen-thinking-container');
    if (container) container.scrollTop = container.scrollHeight;
}

function appendGenToolCall(chunk) {
    const el = document.getElementById('genThinkingContent');
    if (el) el.innerHTML += `<span style="color:#6366f1;font-weight:500;">🔧 ${escHtml(chunk)}</span><br>`;
}

async function generateSubareas(areaId) {
    const overlay = document.getElementById('genOverlay');
    overlay.classList.add('active');
    showGenLoading();

    try {
        const res = await fetch(`/api/areas/${areaId}/generate-subareas/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            },
        });

        if (!res.ok) {
            if (res.status === 401) { logout(); throw new Error('登录已过期'); }
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `请求失败 (${res.status})`);
        }

        let resultData = null;

        await readSSEStream(res, {
            thinking: (data) => { if (data.chunk) updateGenThinking(data.chunk); },
            tool_call: (data) => { if (data.chunk) appendGenToolCall(data.chunk); },
            result: (data) => { resultData = data; },
            error: (data) => { throw new Error(data.detail || 'AI 处理出错'); },
        });

        if (resultData) {
            _genSubareasData = resultData;
            showGenerateSubareaResult(resultData);
        } else {
            document.getElementById('genBody').innerHTML = '<div style="text-align:center;color:#f56c6c;padding:40px 0;">⚠️ 生成失败，请重试</div>';
        }
    } catch (err) {
        document.getElementById('genBody').innerHTML = `<div style="text-align:center;color:#f56c6c;padding:40px 0;">⚠️ 请求失败：${escHtml(err.message)}</div>`;
    }
}

function showGenerateSubareaResult(data) {
    const generated = data.generated_sub_areas || [];
    const existing = data.existing_sub_areas || [];

    let html = '';

    // AI 思考过程（已完成）
    html += `<div class="gen-section-title">✅ AI 思考完成</div>`;

    // 已有子领域
    if (existing.length > 0) {
        html += `<div class="gen-section-title">📋 已有子领域</div>`;
        html += `<div class="gen-existing-badge">已有 ${existing.length} 个子领域，不可编辑</div>`;
        existing.forEach((item, i) => {
            html += `
                <div class="gen-item existing" data-index="${i}" data-type="existing" data-id="${item.id}">
                    <span class="gen-item-index">${i + 1}</span>
                    <input class="gen-item-input" value="${escHtml(item.name)}" disabled>
                    <textarea class="gen-item-desc" rows="2" disabled>${escHtml(item.description || '')}</textarea>
                    <span style="font-size:11px;color:#c0c4cc;white-space:nowrap;flex-shrink:0;">已存在</span>
                </div>`;
        });
    }

    // AI 生成的子领域（可编辑）
    html += `<div class="gen-section-title">💡 AI 建议的子领域 (${generated.length})</div>`;
    html += `<div id="genGeneratedList">`;
    generated.forEach((item, i) => {
        html += renderGenItem(i, item.title, item.description);
    });
    html += `</div>`;

    // 添加按钮
    html += `<button class="gen-add-btn" id="genAddBtn">➕ 添加条目</button>`;

    // 底部操作栏
    html += `
        <div class="gen-footer">
            <button class="gen-polish-btn" id="genPolishBtn">📝 检查并润色描述</button>
        </div>`;

    document.getElementById('genBody').innerHTML = html;

    // 绑定事件
    document.getElementById('genAddBtn').addEventListener('click', addGenItem);
    document.getElementById('genPolishBtn').addEventListener('click', polishGenItems);

    // 绑定各条目的删除和编辑事件
    bindGenItemEvents();

    // 自动调整描述文本框高度
    document.querySelectorAll('#genGeneratedList .gen-item-desc, .gen-item.existing .gen-item-desc').forEach(autoResizeTextarea);
}

function renderGenItem(index, title, description) {
    return `
        <div class="gen-item" data-index="${index}" data-type="generated">
            <span class="gen-item-index">${index + 1}</span>
            <input class="gen-item-input gen-title-input" value="${escHtml(title || '')}" placeholder="标题">
            <textarea class="gen-item-desc gen-desc-input" rows="2" placeholder="描述">${escHtml(description || '')}</textarea>
            <button class="gen-item-add-btn">➕ 添加子领域</button>
            <button class="gen-item-delete">🗑 删除</button>
        </div>`;
}

function bindGenItemEvents() {
    document.querySelectorAll('.gen-item:not(.existing) .gen-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const item = e.currentTarget.closest('.gen-item');
            if (item) item.remove();
            refreshGenIndices();
            updatePolishBtnState();
        });
    });

    // 添加子领域按钮
    document.querySelectorAll('.gen-item:not(.existing) .gen-item-add-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const item = e.currentTarget.closest('.gen-item');
            if (!item) return;
            const title = item.querySelector('.gen-title-input')?.value?.trim();
            const desc = item.querySelector('.gen-desc-input')?.value?.trim();
            if (!title) { alert('请先填写标题'); return; }

            btn.disabled = true;
            btn.textContent = '⏳ 添加中...';
            try {
                await api('/areas', {
                    method: 'POST',
                    body: { name: title, description: desc, parent_id: selectedAreaId },
                });
                btn.textContent = '✅ 已添加';
                btn.classList.add('added');
                // 展开父节点以便看到新建的子领域
                if (selectedAreaId) _expanded[selectedAreaId] = true;
                loadData();
            } catch (err) {
                btn.textContent = '❌ 失败';
                setTimeout(() => {
                    btn.textContent = '➕ 添加子领域';
                    btn.disabled = false;
                }, 2000);
            }
        });
    });

    // 输入变化时更新状态，并自动调整描述文本框高度
    document.querySelectorAll('.gen-title-input, .gen-desc-input').forEach(input => {
        input.addEventListener('input', function() {
            updatePolishBtnState();
            if (this.classList.contains('gen-desc-input')) {
                autoResizeTextarea(this);
            }
        });
    });
}

function addGenItem() {
    const list = document.getElementById('genGeneratedList');
    if (!list) return;
    const count = list.querySelectorAll('.gen-item').length;
    const div = document.createElement('div');
    div.innerHTML = renderGenItem(count, '', '');
    list.appendChild(div.firstElementChild);
    bindGenItemEvents();
    // 新条目的描述文本框自动调整高度
    const desc = list.lastElementChild?.querySelector('.gen-desc-input');
    if (desc) autoResizeTextarea(desc);
    updatePolishBtnState();
}

function refreshGenIndices() {
    const items = document.querySelectorAll('#genGeneratedList .gen-item');
    items.forEach((item, i) => {
        item.dataset.index = i;
        const idxEl = item.querySelector('.gen-item-index');
        if (idxEl) idxEl.textContent = i + 1;
    });
}

function autoResizeTextarea(el) {
    el.style.height = 'auto';
    // 至少保留 2 行高度
    const minHeight = el.dataset.minHeight || (el.dataset.minHeight = el.scrollHeight + 'px');
    el.style.height = Math.max(parseInt(minHeight), el.scrollHeight) + 'px';
}

function updatePolishBtnState() {
    // 只需确保按钮状态，如无生成项则禁用
    const items = document.querySelectorAll('#genGeneratedList .gen-item');
    const btn = document.getElementById('genPolishBtn');
    if (btn) {
        btn.disabled = items.length === 0;
    }
}

function collectGenItems() {
    const items = [];
    // 收集 AI 生成的条目（可编辑区域）
    document.querySelectorAll('#genGeneratedList .gen-item').forEach(item => {
        const title = item.querySelector('.gen-title-input')?.value?.trim() || '';
        const desc = item.querySelector('.gen-desc-input')?.value?.trim() || '';
        if (title) {
            items.push({ title, description: desc });
        }
    });
    return items;
}

async function polishGenItems() {
    const items = collectGenItems();
    if (items.length === 0) {
        alert('请至少保留一个子领域');
        return;
    }

    // 确认用户是否已完成编辑
    const confirmMsg = `将发送 ${items.length} 个子领域给 AI 检查和润色描述。\n注意：标题和数量不会改变。\n确定继续吗？`;
    if (!confirm(confirmMsg)) return;

    const btn = document.getElementById('genPolishBtn');
    btn.disabled = true;
    btn.textContent = '⏳ AI 润色中...';

    try {
        const result = await api(`/areas/${selectedAreaId}/polish-subareas`, {
            method: 'POST',
            body: { sub_areas: items },
        });

        if (result && result.sub_areas) {
            const list = document.getElementById('genGeneratedList');
            if (!list) return;
            list.innerHTML = '';
            result.sub_areas.forEach((item, i) => {
                const div = document.createElement('div');
                div.innerHTML = renderGenItem(i, item.title, item.description);
                list.appendChild(div.firstElementChild);
            });
            bindGenItemEvents();
            // 润色后自动调整高度
            list.querySelectorAll('.gen-desc-input').forEach(autoResizeTextarea);
            btn.textContent = '✅ 润色完成';
            btn.disabled = false;
            setTimeout(() => {
                btn.textContent = '📝 检查并润色描述';
            }, 2000);
        } else {
            throw new Error('未收到有效响应');
        }
    } catch (err) {
        alert('润色失败：' + err.message);
        btn.textContent = '📝 检查并润色描述';
        btn.disabled = false;
    }
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
