// ============================================================
// LearnWithAI Mobile – 主页面逻辑
// ============================================================

// ——— State ———
let treeData = [];
let selectedAreaId = null;
let selectedAreaName = '';
let isSending = false;
let _expanded = {};
let quill = null;
let _isEditingNote = false;
let _ragSearching = false;
let _genSubareasData = null;

// Thinking panel state
let _thinkingTokenBuffer = '';
let _thinkingRafId = null;
let _genThinkingBuffer = '';
let _genThinkingRafId = null;

// ============================================================
//  Overlay Controls
// ============================================================

let _activeOverlay = null; // 'area' | 'note' | null

function openAreaOverlay() {
    if (_activeOverlay === 'area') { closeAllOverlays(); return; }
    closeAllOverlays();
    _activeOverlay = 'area';
    document.getElementById('mOverlayMask').classList.add('visible');
    document.getElementById('mAreaOverlay').classList.add('open');
}

function openNoteOverlay() {
    if (_activeOverlay === 'note') { closeAllOverlays(); return; }
    closeAllOverlays();
    _activeOverlay = 'note';
    document.getElementById('mOverlayMask').classList.add('visible');
    document.getElementById('mNoteOverlay').classList.add('open');
    if (quill && selectedAreaId) {
        setTimeout(() => quill.update(), 100);
    }
}

function closeAllOverlays() {
    _activeOverlay = null;
    const mask = document.getElementById('mOverlayMask');
    if (mask) mask.classList.remove('visible');
    const areaOv = document.getElementById('mAreaOverlay');
    if (areaOv) areaOv.classList.remove('open');
    const noteOv = document.getElementById('mNoteOverlay');
    if (noteOv) noteOv.classList.remove('open');
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
        badge.style.display = 'inline';
    }
    bootApp();
}

let isLoginMode = true;

document.getElementById('mTabLogin').addEventListener('click', () => {
    isLoginMode = true;
    document.getElementById('mTabLogin').classList.add('active');
    document.getElementById('mTabRegister').classList.remove('active');
    document.getElementById('mAuthBtn').textContent = '登录';
    document.getElementById('mAuthError').textContent = '';
});

document.getElementById('mTabRegister').addEventListener('click', () => {
    isLoginMode = false;
    document.getElementById('mTabRegister').classList.add('active');
    document.getElementById('mTabLogin').classList.remove('active');
    document.getElementById('mAuthBtn').textContent = '注册';
    document.getElementById('mAuthError').textContent = '';
});

document.getElementById('mAuthForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('mAuthUsername').value.trim();
    const password = document.getElementById('mAuthPassword').value.trim();
    if (!username || !password) { document.getElementById('mAuthError').textContent = '请填写用户名和密码'; return; }
    const btn = document.getElementById('mAuthBtn');
    btn.disabled = true;
    btn.textContent = '处理中...';
    document.getElementById('mAuthError').textContent = '';
    try {
        const endpoint = isLoginMode ? '/auth/login' : '/auth/register';
        const data = await api(endpoint, { method: 'POST', body: { username, password } });
        token = data.token;
        currentUser = { id: data.user_id, username: data.username };
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(currentUser));
        showApp();
    } catch (err) { document.getElementById('mAuthError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = isLoginMode ? '登录' : '注册'; }
});

document.getElementById('mBtnLogout').addEventListener('click', () => {
    logout();
    showAuth();
});

// ============================================================
//  Boot
// ============================================================

function initAuth() {
    const saved = localStorage.getItem('user');
    if (token && saved) { currentUser = JSON.parse(saved); showApp(); }
    else { showAuth(); }
}

function bootApp() {
    // Register events
    document.getElementById('mBtnEditNote').addEventListener('click', enterEditNote);
    document.getElementById('mBtnSaveNote').addEventListener('click', saveNote);
    document.getElementById('mBtnNewRoot').addEventListener('click', () => showCreateModal(null, ''));
    document.getElementById('mBtnRagSearch').addEventListener('click', showRagSearchModal);
    document.getElementById('mSendBtn').addEventListener('click', sendMessage);
    document.getElementById('mChatInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.getElementById('mChatInput').addEventListener('input', function() { autoResizeTextarea(this); });

    // Modal close buttons
    document.getElementById('mModalCreateClose').addEventListener('click', closeCreateModal);
    document.getElementById('mCreateCancel').addEventListener('click', closeCreateModal);
    document.getElementById('mCreateSubmit').addEventListener('click', submitCreate);
    document.getElementById('mModalResponseClose').addEventListener('click', closeResponseModal);
    document.getElementById('mModalRagClose').addEventListener('click', closeRagSearchModal);
    document.getElementById('mRagSearchBtn').addEventListener('click', submitRagSearch);
    document.getElementById('mRagInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitRagSearch(); }
    });
    document.getElementById('mModalAdminClose').addEventListener('click', closeAdminModal);
    document.getElementById('mBtnAdminRefresh').addEventListener('click', loadAdminStats);
    document.getElementById('mBtnAdmin').addEventListener('click', showAdminModal);
    document.getElementById('mModalExamineClose').addEventListener('click', closeExamineModal);
    document.getElementById('mModalGenClose').addEventListener('click', closeGenModal);

    // Overlay toggle
    document.getElementById('mBtnToggleAreas').addEventListener('click', openAreaOverlay);
    document.getElementById('mBtnToggleNotes').addEventListener('click', openNoteOverlay);
    document.getElementById('mCloseAreaOverlay').addEventListener('click', closeAllOverlays);
    document.getElementById('mCloseNoteOverlay').addEventListener('click', closeAllOverlays);
    document.getElementById('mOverlayMask').addEventListener('click', closeAllOverlays);

    // Thinking panel toggle
    document.getElementById('mThinkingHeader').addEventListener('click', (e) => {
        if (e.target.closest('.m-thinking-toggle')) return;
        if (document.getElementById('mThinkingToggle').style.display !== 'none') {
            toggleThinkingPanel();
        }
    });
    document.getElementById('mThinkingToggle').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleThinkingPanel();
    });

    // Quill init
    if (!quill) {
        try {
            quill = new Quill('#mNoteEditor', {
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

    loadData();
}

// ============================================================
//  Area Tree
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
        document.getElementById('mAreaTree').innerHTML =
            '<div class="m-empty-state"><div class="m-empty-icon">📚</div><p>暂无领域，点击上方创建</p></div>';
        return;
    }
    document.getElementById('mAreaTree').innerHTML = buildTreeHtml(roots);
    bindTreeEvents(document.getElementById('mAreaTree'));
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
        if (hasChildren) {
            html += `<button class="m-tree-examine" title="审查子领域">🔍</button>`;
        }
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
            if (e.target.closest('.m-tree-examine')) return;
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
            if (node) selectArea(node);
        });
        row.querySelector('.m-tree-delete')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const node = findNodeById(treeData, id);
            if (node) deleteArea(node.id, node.name);
        });
        row.querySelector('.m-tree-examine')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const node = findNodeById(treeData, id);
            if (node) examineArea(node.id, node.name);
        });
    });
}

async function deleteArea(id, name) {
    if (!confirm(`确认删除「${name}」及其所有子领域？`)) return;
    try {
        await api(`/areas/${id}`, { method: 'DELETE' });
        if (selectedAreaId === id) { selectedAreaId = null; selectedAreaName = ''; clearArea(); }
        await loadData();
    } catch (err) { alert('删除失败：' + err.message); }
}

// ============================================================
//  Select Area
// ============================================================

function selectArea(nodeData) {
    selectedAreaId = nodeData.id;
    selectedAreaName = nodeData.name;

    document.querySelectorAll('#mAreaTree .m-tree-row').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.id, 10) === selectedAreaId);
    });

    document.getElementById('mAreaTitle').textContent = nodeData.name;
    document.getElementById('mAreaDesc').textContent = nodeData.description || '暂无简介';
    document.getElementById('mChatMessages').innerHTML =
        `<div class="m-empty-state"><div class="m-empty-icon">💬</div><p>已进入 <strong>${nodeData.name}</strong>，开始学习吧！</p></div>`;
    document.getElementById('mChatInput').disabled = false;
    document.getElementById('mChatInput').placeholder = `在「${nodeData.name}」中提问...`;
    document.getElementById('mSendBtn').disabled = false;

    loadHistory(nodeData.id);
    loadNote(nodeData.id);
}

function clearArea() {
    document.getElementById('mAreaTitle').textContent = '请选择一个领域';
    document.getElementById('mAreaDesc').textContent = '';
    document.getElementById('mChatMessages').innerHTML =
        `<div class="m-empty-state"><div class="m-empty-icon">🌱</div><p>选择一个学习领域，开启 AI 引导的深度学习之旅</p></div>`;
    document.getElementById('mChatInput').disabled = true;
    document.getElementById('mSendBtn').disabled = true;
    if (quill) quill.setText('');
    document.getElementById('mNoteView').innerHTML = '<div class="m-empty-note">选择一个领域查看笔记</div>';
    document.getElementById('mNoteView').style.display = 'block';
    document.getElementById('mNoteEditor').style.display = 'none';
    document.getElementById('mBtnEditNote').style.display = 'none';
    document.getElementById('mBtnSaveNote').style.display = 'none';
    document.getElementById('mNoteStatus').textContent = '';
}

// ============================================================
//  Notes
// ============================================================

async function loadNote(areaId) {
    try {
        const note = await api(`/notes/${areaId}`);
        document.getElementById('mNoteTitle').textContent = `📝 笔记 · ${selectedAreaName}`;
        quill.root.innerHTML = note.content || '';
        _isEditingNote = false;
        showNoteView();
    } catch { /* ignore */ }
}

function showNoteView() {
    const view = document.getElementById('mNoteView');
    const editor = document.getElementById('mNoteEditor');
    const content = quill ? quill.root.innerHTML : '';
    if (content && content !== '<p><br></p>') {
        view.innerHTML = content;
    } else {
        view.innerHTML = '<div class="m-empty-note">暂无笔记，点击「✏️ 编辑」添加</div>';
    }
    view.style.display = 'block';
    editor.style.display = 'none';
    document.getElementById('mBtnEditNote').style.display = 'inline-block';
    document.getElementById('mBtnSaveNote').style.display = 'none';
    document.getElementById('mNoteStatus').textContent = '';
}

function showEditNote() {
    const view = document.getElementById('mNoteView');
    const editor = document.getElementById('mNoteEditor');
    view.style.display = 'none';
    editor.style.display = 'flex';
    document.getElementById('mBtnEditNote').style.display = 'none';
    document.getElementById('mBtnSaveNote').style.display = 'inline-block';
    document.getElementById('mNoteStatus').textContent = '编辑中…';
    quill.focus();
}

function enterEditNote() {
    _isEditingNote = true;
    showEditNote();
}

async function saveNote() {
    if (!selectedAreaId || !quill) return;
    const content = quill.root.innerHTML;
    document.getElementById('mNoteStatus').textContent = '保存中…';
    try {
        await api(`/notes/${selectedAreaId}`, { method: 'PUT', body: { content } });
        document.getElementById('mNoteStatus').textContent = '已保存';
        _isEditingNote = false;
        showNoteView();
        setTimeout(() => {
            if (document.getElementById('mNoteStatus').textContent === '已保存')
                document.getElementById('mNoteStatus').textContent = '';
        }, 2000);
    } catch { document.getElementById('mNoteStatus').textContent = '保存失败'; }
}

// ============================================================
//  Chat
// ============================================================

async function loadHistory(areaId) {
    try {
        const messages = await api(`/chat/history/${areaId}`);
        if (messages.length === 0) return;
        document.getElementById('mChatMessages').innerHTML = '';
        messages.forEach(m => appendMessage(m.role, m.content, m.id));
        document.getElementById('mChatMessages').scrollTop = document.getElementById('mChatMessages').scrollHeight;
    } catch { /* ignore */ }
}

function appendMessage(role, content, msgId) {
    const container = document.getElementById('mChatMessages');
    const empty = container.querySelector('.m-empty-state');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = `m-message ${role}`;
    if (role === 'assistant') {
        let html;
        try {
            html = (typeof marked !== 'undefined')
                ? marked.parse(content, { breaks: true, gfm: true })
                : content;
        } catch (e) {
            html = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        div.innerHTML = html
            + '<span class="m-click-hint">👆 点击展开详情</span>'
            + '<div class="m-msg-actions">'
            + '<button class="m-msg-sub-btn">➕ 添加子领域</button>'
            + '<button class="m-msg-gen-btn">✨ 生成子领域</button>'
            + '</div>';
        div.querySelector('.m-click-hint').addEventListener('click', (e) => {
            e.stopPropagation(); showResponseModal(content, msgId);
        });
        div.querySelector('.m-msg-sub-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (selectedAreaId) showCreateModal(selectedAreaId, selectedAreaName);
        });
        div.querySelector('.m-msg-gen-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (selectedAreaId) generateSubareas(selectedAreaId);
        });
    } else {
        div.textContent = content;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
    const msg = document.getElementById('mChatInput').value.trim();
    if (!msg || isSending || !selectedAreaId) return;
    appendMessage('user', msg);
    document.getElementById('mChatInput').value = '';
    isSending = true;
    const btn = document.getElementById('mSendBtn');
    btn.disabled = true; btn.textContent = '发送中...';

    showThinkingPanel();

    try {
        const res = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ area_id: selectedAreaId, message: msg }),
        });

        if (!res.ok) {
            if (res.status === 401) { logout(); showAuth(); throw new Error('登录已过期'); }
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `请求失败 (${res.status})`);
        }

        let resultData = null;

        await readSSEStream(res, {
            thinking: (data) => { if (data.chunk) updateThinkingContent(data.chunk); },
            tool_call: (data) => { if (data.chunk) appendToolCall(data.chunk); },
            result: (data) => {
                resultData = data;
                if (data.reply) {
                    appendMessage('assistant', data.reply, data.message_id);
                }
            },
            error: (data) => { throw new Error(data.detail || 'AI 处理出错'); },
        });

        completeThinking();

        if (resultData) {
            await loadData();
        } else {
            appendMessage('assistant', '⚠️ AI 未返回有效回复');
        }
    } catch (err) {
        appendMessage('assistant', '⚠️ 请求失败：' + err.message);
        const icon = document.getElementById('mThinkingIcon');
        const title = document.getElementById('mThinkingTitle');
        if (icon) { icon.textContent = '⚠️'; icon.classList.remove('loading'); }
        if (title) title.textContent = '思考中断';
        const toggle = document.getElementById('mThinkingToggle');
        if (toggle) toggle.style.display = '';
    } finally {
        isSending = false;
        btn.disabled = false;
        btn.textContent = '发送';
        document.getElementById('mChatInput').focus();
    }
}

// ============================================================
//  Thinking Panel
// ============================================================

function showThinkingPanel() {
    const panel = document.getElementById('mThinkingPanel');
    const icon = document.getElementById('mThinkingIcon');
    const title = document.getElementById('mThinkingTitle');
    const toggle = document.getElementById('mThinkingToggle');
    const body = document.getElementById('mThinkingBody');
    const content = document.getElementById('mThinkingContent');

    panel.style.display = '';
    panel.classList.remove('collapsed');
    toggle.style.display = 'none';
    body.style.display = '';
    icon.textContent = '🤔';
    icon.classList.add('loading');
    title.textContent = 'AI 思考中...';
    content.innerHTML = '';
    _thinkingTokenBuffer = '';
}

function updateThinkingContent(chunk) {
    _thinkingTokenBuffer += chunk;
    if (_thinkingRafId) return;
    _thinkingRafId = requestAnimationFrame(() => {
        _thinkingRafId = null;
        const el = document.getElementById('mThinkingContent');
        if (el) el.innerHTML = escHtml(_thinkingTokenBuffer).replace(/\n/g, '<br>') + '<span class="m-thinking-cursor"></span>';
        const body = document.getElementById('mThinkingBody');
        if (body) body.scrollTop = body.scrollHeight;
    });
}

function appendToolCall(chunk) {
    document.getElementById('mThinkingContent').innerHTML +=
        `<span class="m-tool-call">${escHtml(chunk)}</span>`;
}

function completeThinking() {
    const icon = document.getElementById('mThinkingIcon');
    const title = document.getElementById('mThinkingTitle');
    const toggle = document.getElementById('mThinkingToggle');
    icon.classList.remove('loading');
    icon.textContent = '✅';
    title.textContent = 'AI 思考完成';
    toggle.style.display = '';
    const el = document.getElementById('mThinkingContent');
    if (el) el.innerHTML = escHtml(_thinkingTokenBuffer).replace(/\n/g, '<br>');
}

function toggleThinkingPanel() {
    const panel = document.getElementById('mThinkingPanel');
    const body = document.getElementById('mThinkingBody');
    const toggle = document.getElementById('mThinkingToggle');
    const isCollapsed = panel.classList.toggle('collapsed');
    toggle.textContent = isCollapsed ? '▲' : '▼';
}

// ============================================================
//  Response Modal
// ============================================================

function showResponseModal(content, msgId) {
    document.getElementById('mModalResponseLabel').textContent = `AI 回复详情 · ${selectedAreaName}`;
    let html;
    try {
        html = (typeof marked !== 'undefined')
            ? marked.parse(content, { breaks: true, gfm: true })
            : content;
    } catch (e) {
        html = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    if (msgId) {
        (async () => {
            try { html += buildUsageHtml(await api(`/chat/usage/${msgId}`)); } catch {}
            document.getElementById('mResponseBody').innerHTML = html;
        })();
    } else {
        document.getElementById('mResponseBody').innerHTML = html;
    }
    document.getElementById('mModalResponse').classList.add('active');
}

function closeResponseModal() {
    document.getElementById('mModalResponse').classList.remove('active');
}

function buildUsageHtml(usage) {
    if (!usage) return `<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-light);"><div style="font-size:12px;font-weight:600;color:var(--text-tertiary);">⚙️ 用量数据</div><p style="font-size:11px;color:var(--text-muted);margin-top:4px;">暂无用量记录</p></div>`;
    return `<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-light);"><div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">⚙️ Token 用量</div><table style="width:auto;font-size:12px;"><tr><td style="padding:2px 12px 2px 0;color:var(--text-tertiary);">模型</td><td style="padding:2px 0;">${escHtml(usage.model||'-')}</td></tr><tr><td style="padding:2px 12px 2px 0;color:var(--text-tertiary);">提供商</td><td style="padding:2px 0;">${escHtml(usage.provider||'-')}</td></tr><tr><td style="padding:2px 12px 2px 0;color:var(--text-tertiary);">输入 Token</td><td style="padding:2px 0;">${usage.prompt_tokens?.toLocaleString()||0}</td></tr><tr><td style="padding:2px 12px 2px 0;color:var(--text-tertiary);">输出 Token</td><td style="padding:2px 0;">${usage.completion_tokens?.toLocaleString()||0}</td></tr><tr><td style="padding:2px 12px 2px 0;color:var(--text-tertiary);">合计 Token</td><td style="padding:2px 0;font-weight:600;">${usage.total_tokens?.toLocaleString()||0}</td></tr><tr><td style="padding:2px 12px 2px 0;color:var(--text-tertiary);">耗时</td><td style="padding:2px 0;">${usage.duration_ms?(usage.duration_ms/1000).toFixed(1)+'s':'-'}</td></tr></table></div>`;
}

// ============================================================
//  Create Area Modal
// ============================================================

function showCreateModal(parentId, parentName) {
    document.getElementById('mModalCreateTitle').textContent = parentId
        ? `在「${parentName}」下创建子领域` : '创建顶级学习领域';
    document.getElementById('mCreateParentId').value = parentId || '';
    document.getElementById('mCreateName').value = '';
    document.getElementById('mCreateDesc').value = '';
    document.getElementById('mModalCreate').classList.add('active');
    setTimeout(() => document.getElementById('mCreateName')?.focus(), 100);
}

function closeCreateModal() {
    document.getElementById('mModalCreate').classList.remove('active');
}

document.getElementById('mCreateName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitCreate();
});

async function submitCreate() {
    const name = document.getElementById('mCreateName').value.trim();
    const description = document.getElementById('mCreateDesc').value.trim();
    const parentId = document.getElementById('mCreateParentId').value;
    if (!name) { alert('请输入领域名称'); return; }
    const body = { name, description };
    if (parentId) body.parent_id = parseInt(parentId, 10);
    try {
        await api('/areas', { method: 'POST', body });
        closeCreateModal();
        if (parentId) _expanded[parseInt(parentId, 10)] = true;
        await loadData();
    } catch (err) { alert('创建失败：' + err.message); }
}

// ============================================================
//  RAG Search Modal
// ============================================================

function showRagSearchModal() {
    document.getElementById('mModalRagSearch').classList.add('active');
    document.getElementById('mRagInput').value = '';
    document.getElementById('mRagResults').innerHTML =
        '<div class="m-rag-empty">输入查询内容后点击"搜索"</div>';
    setTimeout(() => document.getElementById('mRagInput')?.focus(), 100);
}

function closeRagSearchModal() {
    document.getElementById('mModalRagSearch').classList.remove('active');
}

async function submitRagSearch() {
    const query = document.getElementById('mRagInput').value.trim();
    if (!query || _ragSearching) return;
    _ragSearching = true;
    const btn = document.getElementById('mRagSearchBtn');
    btn.disabled = true;
    btn.textContent = '搜索中...';
    document.getElementById('mRagResults').innerHTML =
        '<div class="m-rag-empty" style="color:var(--text-tertiary)">🔍 正在搜索...</div>';
    try {
        const data = await api('/rag/search', { method: 'POST', body: { query, top_k: 10 } });
        renderRagResults(data.results || [], query);
    } catch (err) {
        document.getElementById('mRagResults').innerHTML =
            `<div class="m-rag-empty" style="color:var(--danger)">⚠️ 搜索失败：${escHtml(err.message)}</div>`;
    } finally {
        _ragSearching = false;
        btn.disabled = false;
        btn.textContent = '搜索';
    }
}

function renderRagResults(results, query) {
    const container = document.getElementById('mRagResults');
    if (results.length === 0) {
        container.innerHTML = '<div class="m-rag-empty">未找到匹配结果，试试其他关键词</div>';
        return;
    }
    let html = `<div class="m-rag-result-count">共找到 ${results.length} 条相关结果</div>`;
    results.forEach((r, i) => {
        const highlighted = highlightText(escHtml(r.snippet), escHtml(query));
        html += `
            <div class="m-rag-result-item">
                <div class="m-rag-result-index">${i + 1}</div>
                <div class="m-rag-result-content">
                    <div class="m-rag-result-link" data-area-id="${r.area_id}">${escHtml(r.area_name)}</div>
                    <div class="m-rag-result-snippet">${highlighted}</div>
                    <div class="m-rag-result-score">相关度：${(r.score * 100).toFixed(0)}%</div>
                </div>
            </div>`;
    });
    container.innerHTML = html;
    container.querySelectorAll('.m-rag-result-link').forEach(el => {
        el.addEventListener('click', () => {
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
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return text;
    let result = text;
    for (const term of terms) {
        try {
            const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            result = result.replace(re, '<mark class="m-rag-highlight">$1</mark>');
        } catch { /* ignore */ }
    }
    return result;
}

// ============================================================
//  Admin Modal
// ============================================================

function showAdminModal() {
    document.getElementById('mModalAdmin').classList.add('active');
    document.getElementById('mAdminBody').innerHTML = '<div class="m-admin-loading">加载中...</div>';
    loadAdminStats();
}

function closeAdminModal() {
    document.getElementById('mModalAdmin').classList.remove('active');
}

async function loadAdminStats() {
    const body = document.getElementById('mAdminBody');
    body.innerHTML = '<div class="m-admin-loading">加载中...</div>';
    try {
        const data = await api('/admin/stats');
        renderAdminStats(data, body);
    } catch (err) {
        body.innerHTML = `<div class="m-admin-loading" style="color:var(--danger)">⚠️ 加载失败：${escHtml(err.message)}</div>`;
    }
}

function renderAdminStats(data, body) {
    const s = data.summary;
    const users = data.users;
    let html = `
        <div class="m-admin-summary">
            <div class="m-admin-card"><div class="m-admin-card-value">${s.total_users}</div><div class="m-admin-card-label">用户</div></div>
            <div class="m-admin-card"><div class="m-admin-card-value">${s.total_areas}</div><div class="m-admin-card-label">领域</div></div>
            <div class="m-admin-card"><div class="m-admin-card-value">${s.total_messages.toLocaleString()}</div><div class="m-admin-card-label">消息</div></div>
            <div class="m-admin-card"><div class="m-admin-card-value">${s.total_prompt_tokens.toLocaleString()}</div><div class="m-admin-card-label">输入 Token</div></div>
            <div class="m-admin-card"><div class="m-admin-card-value">${s.total_completion_tokens.toLocaleString()}</div><div class="m-admin-card-label">输出 Token</div></div>
            <div class="m-admin-card m-admin-card-primary"><div class="m-admin-card-value">${s.total_tokens.toLocaleString()}</div><div class="m-admin-card-label">总计 Token</div></div>
        </div>`;
    if (users.length === 0) {
        html += '<div style="text-align:center;color:var(--text-muted);padding:20px 0;font-size:13px;">暂无用户数据</div>';
    } else {
        html += '<table class="m-admin-table"><thead><tr>' +
            '<th>用户</th><th>领域</th><th>消息</th><th>输入 Token</th><th>输出 Token</th><th>总计</th>' +
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
//  Examine Subareas
// ============================================================

async function examineArea(areaId, areaName) {
    const btn = document.querySelector(`.m-tree-row[data-id="${areaId}"] .m-tree-examine`);
    if (btn) btn.disabled = true;

    document.getElementById('mModalExamineLabel').textContent = `🔍 审查子领域 · ${areaName}`;
    document.getElementById('mModalExamine').classList.add('active');
    document.getElementById('mExamineBody').innerHTML = `
        <div class="m-examine-loading" id="mExamineThinking">
            <span id="mExamineThinkingIcon">🤔</span>
            <span id="mExamineThinkingText">AI 正在分析子领域...</span>
        </div>
        <div class="m-examine-stream" id="mExamineStream"></div>`;

    try {
        const res = await fetch(`/api/areas/${areaId}/examine/stream`, {
            method: 'POST',
            headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `请求失败 (${res.status})`);
        }

        let resultData = null;
        const streamEl = document.getElementById('mExamineStream');
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
            result: (data) => { resultData = data; },
            error: (data) => { throw new Error(data.detail || '审查出错'); },
        });

        if (resultData) {
            showExamineResult(resultData, areaName);
        } else {
            document.getElementById('mExamineBody').innerHTML =
                '<div class="m-examine-loading" style="color:#ef4444;">⚠️ 审查未返回有效结果</div>';
        }
    } catch (err) {
        document.getElementById('mExamineBody').innerHTML =
            `<div class="m-examine-loading" style="color:#ef4444;">⚠️ 分析失败：${escHtml(err.message)}</div>`;
    } finally {
        if (btn) btn.disabled = false;
    }
}

function showExamineResult(data, areaName) {
    const subs = data.sub_area_summaries || [];
    const missing = data.missing_suggestions || [];
    let html = '';

    if (data.summary) {
        html += `<div class="m-examine-summary">${escHtml(data.summary)}</div>`;
    }

    html += `<div class="m-examine-section-title">📋 子领域摘要 (${subs.length})</div>`;
    if (subs.length === 0) {
        html += '<div style="text-align:center;color:var(--text-muted);padding:20px 0;">暂无子领域摘要</div>';
    } else {
        subs.forEach((s, i) => {
            html += `
                <div class="m-examine-sub-card">
                    <div class="m-examine-sub-index">${i + 1}</div>
                    <div style="flex:1;min-width:0;">
                        <div class="m-examine-sub-name">${escHtml(s.name)}</div>
                        <div class="m-examine-sub-desc">${escHtml(s.summary || '')}</div>
                    </div>
                </div>`;
        });
    }

    html += `<div class="m-examine-section-title" style="margin-top:16px;">💡 建议补充的子领域 (${missing.length})</div>`;
    if (missing.length === 0) {
        html += '<div style="text-align:center;color:#67c23a;padding:12px 0;font-size:13px;">✅ 当前子领域覆盖完整，无需补充</div>';
    } else {
        missing.forEach((m, i) => {
            html += `
                <div class="m-examine-missing-card">
                    <div class="m-examine-missing-icon">${i + 1}</div>
                    <div style="flex:1;min-width:0;">
                        <div class="m-examine-missing-name">${escHtml(m.name)}</div>
                        <div class="m-examine-missing-reason">📌 ${escHtml(m.reason || '')}</div>
                    </div>
                    <button class="m-examine-create-btn" data-name="${escHtml(m.name)}" data-reason="${escHtml(m.reason || '')}"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> 创建</button>
                </div>`;
        });
    }

    const time = data.created_at ? new Date(data.created_at).toLocaleString('zh-CN') : '';
    html += `
        <div class="m-examine-footer">
            <span class="m-examine-time">🕐 ${time || '刚刚'}</span>
            <button class="m-examine-reload-btn" id="mBtnExamineReload">🔄 重新分析</button>
        </div>`;

    document.getElementById('mExamineBody').innerHTML = html;

    document.getElementById('mBtnExamineReload')?.addEventListener('click', () => {
        const id = data.area_id;
        if (id) examineArea(id, areaName);
    });

    document.querySelectorAll('.m-examine-create-btn').forEach(btn => {
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
    document.getElementById('mModalExamine').classList.remove('active');
}

// ============================================================
//  Generate Subareas
// ============================================================

function closeGenModal() {
    document.getElementById('mModalGen').classList.remove('active');
    _genSubareasData = null;
}

function showGenLoading() {
    document.getElementById('mGenBody').innerHTML = `
        <div class="m-gen-thinking-container">
            <div class="m-gen-thinking-content" id="mGenThinkingContent"><span class="m-gen-thinking-cursor"></span></div>
        </div>
        <div class="m-gen-loading" style="padding:16px 0;">⏳ AI 正在思考...</div>`;
}

function updateGenThinking(chunk) {
    const el = document.getElementById('mGenThinkingContent');
    if (!el) return;
    const text = el.textContent || el.innerText || '';
    el.innerHTML = escHtml(text + chunk).replace(/\n/g, '<br>') + '<span class="m-gen-thinking-cursor"></span>';
    const container = document.querySelector('.m-gen-thinking-container');
    if (container) container.scrollTop = container.scrollHeight;
}

function appendGenToolCall(chunk) {
    const el = document.getElementById('mGenThinkingContent');
    if (el) el.innerHTML += `<span style="color:#6366f1;font-weight:500;">🔧 ${escHtml(chunk)}</span><br>`;
}

async function generateSubareas(areaId) {
    document.getElementById('mModalGen').classList.add('active');
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
            if (res.status === 401) { logout(); showAuth(); throw new Error('登录已过期'); }
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
            document.getElementById('mGenBody').innerHTML = '<div style="text-align:center;color:#f56c6c;padding:30px 0;">⚠️ 生成失败，请重试</div>';
        }
    } catch (err) {
        document.getElementById('mGenBody').innerHTML = `<div style="text-align:center;color:#f56c6c;padding:30px 0;">⚠️ 请求失败：${escHtml(err.message)}</div>`;
    }
}

function showGenerateSubareaResult(data) {
    const generated = data.generated_sub_areas || [];
    const existing = data.existing_sub_areas || [];

    let html = `<div class="m-gen-section-title">✅ AI 思考完成</div>`;

    if (existing.length > 0) {
        html += `<div class="m-gen-section-title">📋 已有子领域</div>`;
        html += `<div class="m-gen-existing-badge">已有 ${existing.length} 个子领域</div>`;
        existing.forEach((item, i) => {
            html += `
                <div class="m-gen-item existing">
                    <span class="m-gen-item-index">${i + 1}</span>
                    <input class="m-gen-item-input" value="${escHtml(item.name)}" disabled>
                    <textarea class="m-gen-item-desc" rows="2" disabled>${escHtml(item.description || '')}</textarea>
                    <span style="font-size:11px;color:var(--text-muted);">已存在</span>
                </div>`;
        });
    }

    html += `<div class="m-gen-section-title">💡 AI 建议的子领域 (${generated.length})</div>`;
    html += `<div id="mGenGeneratedList">`;
    generated.forEach((item, i) => {
        html += renderGenItem(i, item.title, item.description);
    });
    html += `</div>`;
    html += `<button class="m-gen-add-btn" id="mGenAddBtn">➕ 添加条目</button>`;
    html += `<div class="m-gen-footer"><button class="m-gen-polish-btn" id="mGenPolishBtn">📝 检查并润色描述</button></div>`;

    document.getElementById('mGenBody').innerHTML = html;

    document.getElementById('mGenAddBtn').addEventListener('click', addGenItem);
    document.getElementById('mGenPolishBtn').addEventListener('click', polishGenItems);
    bindGenItemEvents();
    document.querySelectorAll('#mGenGeneratedList .m-gen-item-desc, .m-gen-item.existing .m-gen-item-desc').forEach(autoResizeTextarea);
}

function renderGenItem(index, title, description) {
    return `
        <div class="m-gen-item" data-index="${index}" data-type="generated">
            <span class="m-gen-item-index">${index + 1}</span>
            <input class="m-gen-item-input m-gen-title-input" value="${escHtml(title || '')}" placeholder="标题">
            <textarea class="m-gen-item-desc m-gen-desc-input" rows="2" placeholder="描述">${escHtml(description || '')}</textarea>
            <button class="m-gen-item-add-btn">➕ 添加子领域</button>
            <button class="m-gen-item-delete">🗑 删除</button>
        </div>`;
}

function bindGenItemEvents() {
    document.querySelectorAll('.m-gen-item:not(.existing) .m-gen-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const item = e.currentTarget.closest('.m-gen-item');
            if (item) item.remove();
            refreshGenIndices();
            updatePolishBtnState();
        });
    });

    document.querySelectorAll('.m-gen-item:not(.existing) .m-gen-item-add-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const item = e.currentTarget.closest('.m-gen-item');
            if (!item) return;
            const title = item.querySelector('.m-gen-title-input')?.value?.trim();
            const desc = item.querySelector('.m-gen-desc-input')?.value?.trim();
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
                if (selectedAreaId) _expanded[selectedAreaId] = true;
                loadData();
            } catch (err) {
                btn.textContent = '❌ 失败';
                setTimeout(() => { btn.textContent = '➕ 添加子领域'; btn.disabled = false; }, 2000);
            }
        });
    });

    document.querySelectorAll('.m-gen-title-input, .m-gen-desc-input').forEach(input => {
        input.addEventListener('input', function() {
            updatePolishBtnState();
            if (this.classList.contains('m-gen-desc-input')) {
                autoResizeTextarea(this);
            }
        });
    });
}

function addGenItem() {
    const list = document.getElementById('mGenGeneratedList');
    if (!list) return;
    const count = list.querySelectorAll('.m-gen-item').length;
    const div = document.createElement('div');
    div.innerHTML = renderGenItem(count, '', '');
    list.appendChild(div.firstElementChild);
    bindGenItemEvents();
    const desc = list.lastElementChild?.querySelector('.m-gen-desc-input');
    if (desc) autoResizeTextarea(desc);
    updatePolishBtnState();
}

function refreshGenIndices() {
    const items = document.querySelectorAll('#mGenGeneratedList .m-gen-item');
    items.forEach((item, i) => {
        item.dataset.index = i;
        const idxEl = item.querySelector('.m-gen-item-index');
        if (idxEl) idxEl.textContent = i + 1;
    });
}

function updatePolishBtnState() {
    const items = document.querySelectorAll('#mGenGeneratedList .m-gen-item');
    const btn = document.getElementById('mGenPolishBtn');
    if (btn) btn.disabled = items.length === 0;
}

function collectGenItems() {
    const items = [];
    document.querySelectorAll('#mGenGeneratedList .m-gen-item').forEach(item => {
        const title = item.querySelector('.m-gen-title-input')?.value?.trim() || '';
        const desc = item.querySelector('.m-gen-desc-input')?.value?.trim() || '';
        if (title) items.push({ title, description: desc });
    });
    return items;
}

async function polishGenItems() {
    const items = collectGenItems();
    if (items.length === 0) { alert('请至少保留一个子领域'); return; }
    if (!confirm(`将发送 ${items.length} 个子领域给 AI 检查和润色描述。\n确定继续吗？`)) return;
    const btn = document.getElementById('mGenPolishBtn');
    btn.disabled = true;
    btn.textContent = '⏳ AI 润色中...';
    try {
        const result = await api(`/areas/${selectedAreaId}/polish-subareas`, {
            method: 'POST',
            body: { sub_areas: items },
        });
        if (result && result.sub_areas) {
            const list = document.getElementById('mGenGeneratedList');
            if (!list) return;
            list.innerHTML = '';
            result.sub_areas.forEach((item, i) => {
                const div = document.createElement('div');
                div.innerHTML = renderGenItem(i, item.title, item.description);
                list.appendChild(div.firstElementChild);
            });
            bindGenItemEvents();
            list.querySelectorAll('.m-gen-desc-input').forEach(autoResizeTextarea);
            btn.textContent = '✅ 润色完成';
            btn.disabled = false;
            setTimeout(() => { btn.textContent = '📝 检查并润色描述'; }, 2000);
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
