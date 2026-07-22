// ============================================================
// LearnWithAI Mobile – Plan Mode 逻辑
// ============================================================

// ============================================================
//  State
// ============================================================

let _isExploring = false;
let _areaCount = 0;
let _messageCount = 0;
let _treeData = [];
let _thinkingBuffer = '';
let _thinkingRafId = null;
let _messagesByArea = {};    // { areaId: [{role, content, areaName, depth, msgId}, ...] }
let _selectedAreaId = null;  // 当前选中的领域树节点 ID
let _phase = 'initial';      // 'initial' | 'thinking' | 'exploring' | 'done'
let _progressCloseTimer = null; // 进度框自动关闭定时器

// ============================================================
//  Auth UI
// ============================================================

function showAuth() {
    document.getElementById('mPlanAuthOverlay').style.display = 'flex';
    document.getElementById('mPlanHeader').style.display = 'none';
    document.getElementById('mPlanInputSection').style.display = 'none';
    document.getElementById('mPlanExploreView').style.display = 'none';
}

function showApp() {
    document.getElementById('mPlanAuthOverlay').style.display = 'none';
    document.getElementById('mPlanHeader').style.display = '';
    document.getElementById('mPlanInputSection').style.display = '';
    if (currentUser) {
        document.getElementById('mPlanUserBadge').textContent = currentUser.username;
    }
}

function switchToExplore() {
    document.getElementById('mPlanInputSection').style.display = 'none';
    document.getElementById('mPlanExploreView').style.display = '';
}

function switchToInput() {
    document.getElementById('mPlanInputSection').style.display = '';
    document.getElementById('mPlanExploreView').style.display = 'none';
    document.getElementById('mPlanResultSection').style.display = 'none';
}

// ============================================================
//  Auth form
// ============================================================

let isLoginMode = true;

function toggleMobilePlanAuthRegisterFields(show) {
    const el = document.getElementById('mPlanAuthRegisterFields');
    if (el) el.style.display = show ? '' : 'none';
}

function resetMPlanRegStep() {
    const s1 = document.getElementById('mPlanAuthRegStep1');
    const s2 = document.getElementById('mPlanAuthRegStep2');
    if (s1) s1.style.display = '';
    if (s2) s2.style.display = 'none';
    document.getElementById('mPlanAuthPassword').style.display = '';
    document.getElementById('mPlanAuthEmail').removeAttribute('readonly');
}

document.getElementById('mPlanTabLogin').addEventListener('click', () => {
    isLoginMode = true;
    document.getElementById('mPlanTabLogin').classList.add('active');
    document.getElementById('mPlanTabRegister').classList.remove('active');
    document.getElementById('mPlanAuthBtn').textContent = '登录';
    document.getElementById('mPlanAuthBtn').style.display = '';
    document.getElementById('mPlanAuthError').textContent = '';
    document.getElementById('mPlanAuthError').style.color = '#ef4444';
    toggleMobilePlanAuthRegisterFields(false);
    document.getElementById('mPlanAuthPassword').style.display = '';
    document.getElementById('mPlanAuthEmail').removeAttribute('readonly');
});

document.getElementById('mPlanTabRegister').addEventListener('click', () => {
    isLoginMode = false;
    document.getElementById('mPlanTabRegister').classList.add('active');
    document.getElementById('mPlanTabLogin').classList.remove('active');
    document.getElementById('mPlanAuthBtn').textContent = '注册';
    document.getElementById('mPlanAuthBtn').style.display = 'none';
    document.getElementById('mPlanAuthError').textContent = '';
    document.getElementById('mPlanAuthError').style.color = '#ef4444';
    toggleMobilePlanAuthRegisterFields(true);
    resetMPlanRegStep();
    document.getElementById('mPlanAuthPassword').style.display = 'none';
});

document.getElementById('mPlanAuthForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const authEmail = document.getElementById('mPlanAuthEmail');
    const authError = document.getElementById('mPlanAuthError');
    const authBtn = document.getElementById('mPlanAuthBtn');
    const email = authEmail.value.trim();

    if (isLoginMode) {
        const password = document.getElementById('mPlanAuthPassword').value.trim();
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
        const step2 = document.getElementById('mPlanAuthRegStep2');
        if (!step2 || step2.style.display === 'none') {
            if (!email || email.indexOf('@') === -1) { authError.textContent = '请输入有效的邮箱'; return; }
            const sendBtn = document.getElementById('mPlanAuthRegSendBtn');
            if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '发送中...'; }
            authError.textContent = '';
            authError.style.color = '#ef4444';
            try {
                await api('/auth/register-send-code', { method: 'POST', body: { email } });
                document.getElementById('mPlanAuthRegStep1').style.display = 'none';
                document.getElementById('mPlanAuthRegStep2').style.display = '';
                authBtn.style.display = '';
                document.getElementById('mPlanAuthPassword').style.display = 'none';
                authEmail.setAttribute('readonly', 'readonly');
                authError.textContent = '验证码已发送，请查收邮件';
                authError.style.color = '#67c23a';
            } catch (err) {
                if (err.message.includes('已注册')) {
                    document.getElementById('mPlanTabLogin').click();
                    authError.textContent = '该邮箱已注册，请直接登录';
                } else {
                    authError.textContent = err.message;
                }
            }
            finally { if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '发送验证码'; } }
        } else {
            const code = document.getElementById('mPlanAuthRegCode')?.value?.trim();
            const password = document.getElementById('mPlanAuthRegPassword')?.value?.trim();
            const confirmPw = document.getElementById('mPlanAuthConfirmPassword')?.value || '';
            const nickname = document.getElementById('mPlanAuthNickname')?.value?.trim() || '';
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
document.getElementById('mPlanAuthOverlay').addEventListener('click', (e) => {
    const target = e.target;
    if (target.id === 'mPlanAuthForgotLink') {
        document.getElementById('mPlanAuthForm').style.display = 'none';
        document.getElementById('mPlanAuthForgotPanel').style.display = '';
        document.getElementById('mPlanAuthForgotError').textContent = '';
        document.getElementById('mPlanAuthForgotResetError').textContent = '';
        document.getElementById('mPlanAuthForgotStep2').style.display = 'none';
        document.getElementById('mPlanAuthForgotStep1').style.display = '';
    } else if (target.id === 'mPlanAuthForgotBack') {
        document.getElementById('mPlanAuthForgotPanel').style.display = 'none';
        document.getElementById('mPlanAuthForm').style.display = '';
    } else if (target.id === 'mPlanAuthForgotSendBtn') {
        handleMPlanForgotSend();
    } else if (target.id === 'mPlanAuthForgotResetBtn') {
        handleMPlanForgotReset();
    }
});

async function handleMPlanForgotSend() {
    const email = document.getElementById('mPlanAuthForgotEmail')?.value?.trim();
    if (!email) { document.getElementById('mPlanAuthForgotError').textContent = '请输入邮箱'; return; }
    const btn = document.getElementById('mPlanAuthForgotSendBtn');
    btn.disabled = true;
    btn.textContent = '发送中...';
    document.getElementById('mPlanAuthForgotError').textContent = '';
    try {
        await api('/auth/forgot-password', { method: 'POST', body: { email } });
        document.getElementById('mPlanAuthForgotStep1').style.display = 'none';
        document.getElementById('mPlanAuthForgotStep2').style.display = '';
    } catch (err) { document.getElementById('mPlanAuthForgotError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = '发送验证码'; }
}

async function handleMPlanForgotReset() {
    const email = document.getElementById('mPlanAuthForgotEmail')?.value?.trim();
    const code = document.getElementById('mPlanAuthForgotCode')?.value?.trim();
    const newPassword = document.getElementById('mPlanAuthForgotNewPassword')?.value?.trim();
    if (!code || !newPassword) { document.getElementById('mPlanAuthForgotResetError').textContent = '请填写验证码和新密码'; return; }
    const btn = document.getElementById('mPlanAuthForgotResetBtn');
    btn.disabled = true;
    btn.textContent = '重置中...';
    document.getElementById('mPlanAuthForgotResetError').textContent = '';
    try {
        await api('/auth/reset-password', { method: 'POST', body: { email, code, new_password: newPassword } });
        document.getElementById('mPlanAuthForgotResetError').style.color = '#67c23a';
        document.getElementById('mPlanAuthForgotResetError').textContent = '密码重置成功，请返回登录';
        setTimeout(() => { document.getElementById('mPlanAuthForgotBack')?.click(); }, 2000);
    } catch (err) { document.getElementById('mPlanAuthForgotResetError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = '重置密码'; }
}

// ============================================================
//  Thinking Panel
// ============================================================

function showThinking() {
    const panel = document.getElementById('mPlanThinkingPanel');
    panel.style.display = '';
    document.getElementById('mPlanThinkingIcon').textContent = '🤔';
    document.getElementById('mPlanThinkingIcon').classList.add('loading');
    document.getElementById('mPlanThinkingTitle').textContent = 'AI 思考中...';
    document.getElementById('mPlanThinkingContent').innerHTML = '';
    document.getElementById('mPlanThinkingToggle').style.display = 'none';
    _thinkingBuffer = '';
}

function updateThinking(chunk) {
    _thinkingBuffer += chunk;
    if (_thinkingRafId) return;
    _thinkingRafId = requestAnimationFrame(() => {
        _thinkingRafId = null;
        const el = document.getElementById('mPlanThinkingContent');
        if (el) {
            el.innerHTML = escHtml(_thinkingBuffer).replace(/\n/g, '<br>') + '<span class="m-plan-thinking-cursor"></span>';
            const body = document.getElementById('mPlanThinkingBody');
            if (body) body.scrollTop = body.scrollHeight;
        }
    });
}

function completeThinking() {
    const icon = document.getElementById('mPlanThinkingIcon');
    icon.classList.remove('loading');
    icon.textContent = '✅';
    document.getElementById('mPlanThinkingTitle').textContent = '思考完成';
    document.getElementById('mPlanThinkingToggle').style.display = '';
    const el = document.getElementById('mPlanThinkingContent');
    if (el) {
        el.innerHTML = escHtml(_thinkingBuffer).replace(/\n/g, '<br>');
    }
}

function toggleThinking() {
    const panel = document.getElementById('mPlanThinkingPanel');
    const body = document.getElementById('mPlanThinkingBody');
    const toggle = document.getElementById('mPlanThinkingToggle');
    const collapsed = panel.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▲' : '▼';
}

document.getElementById('mPlanThinkingHeader').addEventListener('click', (e) => {
    if (e.target.closest('.m-plan-thinking-toggle')) return;
    if (document.getElementById('mPlanThinkingToggle').style.display !== 'none') {
        toggleThinking();
    }
});
document.getElementById('mPlanThinkingToggle').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleThinking();
});

// ============================================================
//  Tree View
// ============================================================

function addTreeArea(id, name, description, parentId, depth) {
    if (!parentId) {
        _treeData = [{ id, name, description, depth, children: [] }];
        renderTree();
        return;
    }
    const node = findTreeAreaNode(_treeData, parentId);
    if (node) {
        if (!node.children) node.children = [];
        node.children.push({ id, name, description, depth, children: [] });
        renderTree();
    }
}

function findTreeAreaNode(nodes, id) {
    for (const n of nodes) {
        if (n.id === id) return n;
        if (n.children) {
            const found = findTreeAreaNode(n.children, id);
            if (found) return found;
        }
    }
    return null;
}

function renderTree() {
    const container = document.getElementById('mPlanTreeBody');
    if (_treeData.length === 0) {
        container.innerHTML = '<div class="m-plan-tree-empty">等待探索开始...</div>';
        return;
    }
    container.innerHTML = buildTreeHtml(_treeData, 0);
    bindTreeNodeEvents();
}

function bindTreeNodeEvents() {
    document.querySelectorAll('#mPlanTreeBody .m-plan-tree-node').forEach(node => {
        if (node.dataset.bound === '1') return;
        node.dataset.bound = '1';
        node.addEventListener('click', (e) => {
            e.stopPropagation();
            const areaId = parseInt(node.dataset.areaId, 10);
            if (!areaId) return;
            showAreaMessages(areaId);
        });
    });
}

function buildTreeHtml(nodes, depth) {
    const colors = ['#00D4FF', '#38BDF8', '#60A5FA', '#818CF8', '#A78BFA',
                    '#C084FC', '#E879F9', '#F472B6', '#FB7185', '#F87171', '#FBBF24'];
    return nodes.map(n => {
        const hasChildren = n.children && n.children.length > 0;
        const color = colors[Math.min(n.depth || depth, 10)];
        const indent = (n.depth || depth) * 16;

        let html = `<div class="m-plan-tree-node" data-area-id="${n.id}" style="margin-left:${indent}px">`;
        html += `<div class="m-plan-tree-node-row ${_selectedAreaId === n.id ? 'selected' : ''}">`;
        html += `<span class="m-plan-tree-bullet" style="background:${color}"></span>`;
        html += `<span class="m-plan-tree-node-name">${escHtml(n.name)}</span>`;
        if (hasChildren) {
            html += `<span class="m-plan-tree-badge">${n.children.length}</span>`;
        }
        html += `</div>`;
        if (hasChildren) {
            html += buildTreeHtml(n.children, (n.depth || depth) + 1);
        }
        html += `</div>`;
        return html;
    }).join('');
}

// ============================================================
//  Message Panel
// ============================================================

function appendPlanMessage(areaId, areaName, depth, role, content, msgId) {
    // 按 area_id 存储消息
    if (areaId !== null && areaId !== undefined) {
        if (!_messagesByArea[areaId]) _messagesByArea[areaId] = [];
        _messagesByArea[areaId].push({ role, content, areaName, depth, msgId });
    }

    // 仅在选中领域匹配时渲染到右侧"探索过程"面板
    if (_selectedAreaId === null || areaId !== _selectedAreaId) return;

    const container = document.getElementById('mPlanMessageBody');
    const empty = container.querySelector('.m-plan-message-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = `m-plan-message ${role}`;

    const colors = ['#00D4FF', '#38BDF8', '#60A5FA', '#818CF8', '#A78BFA',
                    '#C084FC', '#E879F9', '#F472B6', '#FB7185', '#F87171', '#FBBF24'];
    const tagColor = colors[Math.min(depth, 10)];

    let tagHtml = '';
    if (role === 'assistant') {
        tagHtml = `<div class="m-plan-message-tag" style="border-left:3px solid ${tagColor}">
            <span class="m-plan-message-depth" style="color:${tagColor}">L${depth}</span>
            <span class="m-plan-message-area">${escHtml(areaName)}</span>
        </div>`;
    }

    if (role === 'assistant') {
        let html;
        try {
            html = (typeof marked !== 'undefined')
                ? marked.parse(content, { breaks: true, gfm: true })
                : content;
        } catch (e) {
            html = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        div.innerHTML = tagHtml + `<div class="m-plan-message-content">${html}</div>`;
    } else {
        div.innerHTML = `<div class="m-plan-message-content">${escHtml(content)}</div>`;
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ============================================================
//  Status Bar
// ============================================================

function updateStatus(depth, areas, messages, text, isDone) {
    if (depth !== undefined) {
        document.getElementById('mStatusDepth').textContent = `${depth} / 10`;
    }
    if (areas !== undefined) {
        document.getElementById('mStatusAreas').textContent = areas;
        _areaCount = areas;
    }
    if (messages !== undefined) {
        document.getElementById('mStatusMessages').textContent = messages;
        _messageCount = messages;
    }
    if (text !== undefined) {
        const el = document.getElementById('mStatusText');
        if (isDone) {
            el.innerHTML = `<span class="m-plan-status-dot done"></span> ${escHtml(text)}`;
        } else {
            el.innerHTML = `<span class="m-plan-status-dot pulse"></span> ${escHtml(text)}`;
        }
    }
}

// ============================================================
//  Progress Box
// ============================================================

function showProgressBox(text) {
    const box = document.getElementById('mPlanProgressBox');
    box.style.display = '';
    box.classList.remove('done');
    document.getElementById('mPlanProgressIcon').textContent = '⏳';
    document.getElementById('mPlanProgressTitle').textContent = '探索进度';
    document.getElementById('mPlanProgressText').textContent = text;
    // 清除 body 中多余的统计标签
    document.querySelectorAll('.m-plan-progress-stat').forEach(el => el.remove());
}

function setProgressText(text) {
    document.getElementById('mPlanProgressText').textContent = text;
}

function completeProgressBox(totalAreas, totalMessages, maxDepth) {
    const box = document.getElementById('mPlanProgressBox');
    box.classList.add('done');
    document.getElementById('mPlanProgressIcon').textContent = '✅';
    document.getElementById('mPlanProgressTitle').textContent = '探索完成';
    const body = document.getElementById('mPlanProgressBody');
    body.innerHTML = `
        <span class="m-plan-progress-text">全部探索完成！</span>
        <span class="m-plan-progress-stat">📚 领域: ${totalAreas}</span>
        <span class="m-plan-progress-stat">💬 消息: ${totalMessages}</span>
        <span class="m-plan-progress-stat">📊 深度: ${maxDepth}</span>
    `;
    // 2秒后自动收起
    if (_progressCloseTimer) clearTimeout(_progressCloseTimer);
    _progressCloseTimer = setTimeout(() => {
        box.style.display = 'none';
        _progressCloseTimer = null;
    }, 2000);
}

// ============================================================
//  Area Message Filter
// ============================================================

function showAreaMessages(areaId) {
    _selectedAreaId = areaId;
    const container = document.getElementById('mPlanMessageBody');

    // 更新树节点选中态
    document.querySelectorAll('.m-plan-tree-node-row').forEach(r => r.classList.remove('selected'));
    if (areaId !== null) {
        const nodeEl = document.querySelector(`.m-plan-tree-node[data-area-id="${areaId}"]`);
        if (nodeEl) {
            const row = nodeEl.querySelector('.m-plan-tree-node-row');
            if (row) row.classList.add('selected');
        }
    }

    if (areaId === null) {
        container.innerHTML = '<div class="m-plan-message-empty">请点击左侧领域节点查看 AI 响应...</div>';
        return;
    }

    const areaMsgs = _messagesByArea[areaId];
    let areaName = '';
    const node = findTreeAreaNode(_treeData, areaId);
    if (node) areaName = node.name;

    if (!areaMsgs || areaMsgs.length === 0) {
        const label = areaName ? `「${escHtml(areaName)}」` : '该领域';
        container.innerHTML = `<div class="m-plan-message-empty">${label} 正在探索中，请稍候...</div>`;
        return;
    }

    renderMessagesView(container, areaMsgs, areaName);
}

function renderMessagesView(container, messages, areaName) {
    container.innerHTML = '';
    if (areaName) {
        const header = document.createElement('div');
        header.className = 'm-plan-msg-filter-header';
        header.innerHTML = `<span>📂 ${escHtml(areaName)}</span>`;
        container.appendChild(header);
    }
    if (messages.length === 0) {
        container.innerHTML += '<div class="m-plan-message-empty">暂无消息</div>';
        return;
    }
    for (const msg of messages) {
        const div = document.createElement('div');
        div.className = `m-plan-message ${msg.role}`;
        const colors = ['#00D4FF', '#38BDF8', '#60A5FA', '#818CF8', '#A78BFA',
                        '#C084FC', '#E879F9', '#F472B6', '#FB7185', '#F87171', '#FBBF24'];
        const tagColor = colors[Math.min(msg.depth, 10)];
        let tagHtml = '';
        if (msg.role === 'assistant') {
            tagHtml = `<div class="m-plan-message-tag" style="border-left:3px solid ${tagColor}">
                <span class="m-plan-message-depth" style="color:${tagColor}">L${msg.depth}</span>
            </div>`;
        }
        if (msg.role === 'assistant') {
            let html;
            try {
                html = (typeof marked !== 'undefined')
                    ? marked.parse(msg.content, { breaks: true, gfm: true })
                    : msg.content;
            } catch (e) {
                html = msg.content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }
            div.innerHTML = tagHtml + `<div class="m-plan-message-content">${html}</div>`;
        } else {
            div.innerHTML = `<div class="m-plan-message-content">${escHtml(msg.content)}</div>`;
        }
        container.appendChild(div);
    }
    container.scrollTop = container.scrollHeight;
}

// ============================================================
//  Show Result
// ============================================================

function showResult(data) {
    document.getElementById('mResultAreas').textContent = data.total_areas || 0;
    document.getElementById('mResultMessages').textContent = data.total_messages || 0;
    document.getElementById('mResultDepth').textContent = data.max_depth || 0;
    document.getElementById('mPlanResultSection').style.display = '';
    updateStatus(undefined, data.total_areas, data.total_messages, '探索完成 ✅', true);
}

// ============================================================
//  Start Plan
// ============================================================

async function startPlan() {
    const domain = document.getElementById('mPlanDomainInput').value.trim();
    if (!domain) { alert('请输入要探索的领域名称'); return; }
    if (_isExploring) return;
    _isExploring = true;

    const depthInput = document.getElementById('mPlanDepthInput');
    const maxDepth = depthInput ? Math.max(1, Math.min(10, parseInt(depthInput.value, 10) || 2)) : 2;

    // 重置状态
    _treeData = [];
    _areaCount = 0;
    _messageCount = 0;
    _messagesByArea = {};
    _selectedAreaId = null;
    _phase = 'initial';
    if (_progressCloseTimer) { clearTimeout(_progressCloseTimer); _progressCloseTimer = null; }
    document.getElementById('mPlanProgressBox').style.display = 'none';
    document.getElementById('mPlanMessageBody').innerHTML =
        '<div class="m-plan-message-empty">请点击左侧领域节点查看 AI 响应...</div>';
    document.getElementById('mPlanTreeBody').innerHTML =
        '<div class="m-plan-tree-empty">等待探索开始...</div>';
    document.getElementById('mPlanResultSection').style.display = 'none';

    const btn = document.getElementById('mPlanStartBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 探索中...';

    switchToExplore();
    showThinking();
    updateStatus(0, 0, 0, '正在初始化...', false);

    try {
        const res = await fetch('/api/plan/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ domain, max_depth: maxDepth }),
        });

        if (!res.ok) {
            if (res.status === 401) { logout(); throw new Error('登录已过期'); }
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `请求失败 (${res.status})`);
        }

        let resultData = null;

        await readSSEStream(res, {
            thinking: (data) => { if (data.chunk) updateThinking(data.chunk); },
            tool_call: (data) => {
                if (data.chunk) {
                    const el = document.getElementById('mPlanThinkingContent');
                    if (el) el.innerHTML += `<span style="color:#6366f1;font-weight:500;">🔧 ${escHtml(data.chunk)}</span><br>`;
                }
            },
            area_created: (data) => {
                _areaCount++;
                updateStatus(undefined, _areaCount, undefined, undefined, false);
                addTreeArea(data.area_id, data.name, data.description, data.parent_id, data.depth);
                // 根领域自动选中，展示在右侧
                if (data.depth === 0) {
                    _selectedAreaId = data.area_id;
                    renderTree();
                    appendPlanMessage(data.area_id, data.name, data.depth, 'user', `开始探索领域：${data.name}`, null);
                } else {
                    appendPlanMessage(data.area_id, data.name, data.depth, 'user', `深入探索子领域：${data.name}`, null);
                }
            },
            message: (data) => {
                _messageCount++;
                updateStatus(undefined, undefined, _messageCount, undefined, false);
                appendPlanMessage(data.area_id, data.area_name, data.depth, 'assistant', data.content, data.message_id);
            },
            progress: (data) => {
                if (data.status) {
                    updateStatus(data.current_depth, undefined, undefined, data.status, false);
                }
                // 阶段处理
                if (data.phase === 'overview_complete') {
                    // 第一次流式输出结束 → 收起思考面板，显示进度框
                    completeThinking();
                    const panel = document.getElementById('mPlanThinkingPanel');
                    if (!panel.classList.contains('collapsed')) toggleThinking();
                    if (data.current_depth === 0) {
                        _phase = 'exploring';
                        showProgressBox('概况已生成，正在深入探索子领域...');
                    } else {
                        setProgressText(`「${data.current_area}」概况已生成`);
                    }
                } else if (data.phase === 'subdomains_ready') {
                    _phase = 'exploring';
                    const total = data.total_subdomains || 0;
                    setProgressText(`发现 ${total} 个子领域，正在并发深入探索...`);
                } else if (data.phase === 'all_complete') {
                    _phase = 'done';
                    completeProgressBox(data.total_areas, data.total_messages, data.max_depth);
                }
            },
            result: (data) => { resultData = data; },
            error: (data) => { throw new Error(data.detail || '探索过程出错'); },
        });

        completeThinking();

        if (resultData) {
            if (resultData.finished) {
                showResult(resultData);
            } else {
                updateStatus(undefined, undefined, undefined, '探索未完成', true);
            }
        } else {
            appendPlanMessage(null, '系统', 0, 'assistant', '⚠️ 探索未能完成，请重试', null);
            updateStatus(undefined, undefined, undefined, '异常结束 ⚠️', true);
        }
    } catch (err) {
        completeThinking();
        appendPlanMessage(null, '系统', 0, 'assistant', '⚠️ 请求失败：' + err.message, null);
        updateStatus(undefined, undefined, undefined, '错误：' + err.message, true);
        const icon = document.getElementById('mPlanThinkingIcon');
        if (icon) { icon.textContent = '⚠️'; icon.classList.remove('loading'); }
        document.getElementById('mPlanThinkingTitle').textContent = '思考中断';
        document.getElementById('mPlanThinkingToggle').style.display = '';
    } finally {
        _isExploring = false;
        btn.disabled = false;
        btn.textContent = '开始探索';
    }
}

// ============================================================
//  Event Bindings
// ============================================================

document.getElementById('mPlanStartBtn').addEventListener('click', startPlan);
document.getElementById('mPlanDomainInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startPlan(); }
});

document.getElementById('mPlanRestartBtn').addEventListener('click', () => {
    document.getElementById('mPlanDomainInput').value = '';
    switchToInput();
});

// 层级分段按钮交互
const M_DEPTH_HINTS = { 1: '快速概览', 2: '浅层概览', 3: '中等深度', 5: '深度探索', 10: '全量递归' };
document.querySelectorAll('#mPlanDepthPills .m-plan-depth-pill').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#mPlanDepthPills .m-plan-depth-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const value = parseInt(btn.dataset.value, 10);
        const hidden = document.getElementById('mPlanDepthInput');
        if (hidden) hidden.value = value;
        const hintEl = document.getElementById('mPlanDepthHint');
        if (hintEl) hintEl.textContent = M_DEPTH_HINTS[value] || '';
    });
});

// 树节点点击事件由 renderTree() 后的 bindTreeNodeEvents() 直接绑定

// 退出登录
const mPlanLogoutBtn = document.getElementById('mPLogoutBtn');
if (mPlanLogoutBtn) mPlanLogoutBtn.addEventListener('click', () => { logout(); showAuth(); });

document.querySelectorAll('.m-plan-hint-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById('mPlanDomainInput').value = btn.dataset.domain;
        startPlan();
    });
});

// ============================================================
//  Boot
// ============================================================

function boot() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => boot());
        return;
    }
    const saved = localStorage.getItem('user');
    if (token && saved) {
        currentUser = JSON.parse(saved);
        showApp();
    } else {
        showAuth();
    }
}
boot();
