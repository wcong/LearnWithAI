// ============================================================
// Plan Mode – 前端主逻辑
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
    if (res.status === 429) {
        const err = await res.json().catch(() => ({}));
        showTokenLimitPanel(err.detail);
        throw new Error(err.detail?.message || '免费 Token 额度已用尽');
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `请求失败 (${res.status})`);
    }
    return res.json();
}

function logout() {
    token = ''; currentUser = null;
    localStorage.removeItem('token'); localStorage.removeItem('user');
    showAuth();
}

// ============================================================
//  SSE 流式读取
// ============================================================

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
            } catch { /* ignore */ }
        }
    }
    return { type, data };
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
//  工具函数
// ============================================================

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

// ============================================================
//  Plan Mode 状态
// ============================================================

let _isExploring = false;
let _areaCount = 0;
let _messageCount = 0;
let _treeData = [];  // { id, name, depth, children }
let _thinkingBuffer = '';
let _thinkingRafId = null;
let _messagesByArea = {};    // { areaId: [{role, content, areaName, depth, msgId}, ...] }
let _selectedAreaId = null;  // 当前选中的领域树节点 ID
let _phase = 'initial';      // 'initial' | 'thinking' | 'exploring' | 'done'
let _progressCloseTimer = null; // 进度框自动关闭定时器

// ============================================================
//  UI 切换
// ============================================================

function showAuth() {
    document.getElementById('planAuthOverlay').style.display = 'flex';
    document.getElementById('planHeader').style.display = 'none';
    document.getElementById('planInputSection').style.display = 'none';
    document.getElementById('planExploreView').style.display = 'none';
}

function showApp() {
    document.getElementById('planAuthOverlay').style.display = 'none';
    document.getElementById('planHeader').style.display = '';
    document.getElementById('planInputSection').style.display = '';
    if (currentUser) {
        document.getElementById('planUserBadge').textContent = currentUser.username;
    }
}

function switchToExplore() {
    document.getElementById('planInputSection').style.display = 'none';
    document.getElementById('planExploreView').style.display = '';
}

function switchToInput() {
    document.getElementById('planInputSection').style.display = '';
    document.getElementById('planExploreView').style.display = 'none';
    document.getElementById('planResultSection').style.display = 'none';
}

// ============================================================
//  思考面板
// ============================================================

function showThinking() {
    const panel = document.getElementById('planThinkingPanel');
    panel.style.display = '';
    document.getElementById('planThinkingIcon').textContent = '🤔';
    document.getElementById('planThinkingIcon').classList.add('loading');
    document.getElementById('planThinkingTitle').textContent = 'AI 思考中...';
    document.getElementById('planThinkingContent').innerHTML = '';
    document.getElementById('planThinkingToggle').style.display = 'none';
    _thinkingBuffer = '';
}

function updateThinking(chunk) {
    _thinkingBuffer += chunk;
    if (_thinkingRafId) return;
    _thinkingRafId = requestAnimationFrame(() => {
        _thinkingRafId = null;
        const el = document.getElementById('planThinkingContent');
        if (el) {
            el.innerHTML = escHtml(_thinkingBuffer).replace(/\n/g, '<br>') + '<span class="thinking-cursor"></span>';
            const body = document.getElementById('planThinkingBody');
            if (body) body.scrollTop = body.scrollHeight;
        }
    });
}

function completeThinking() {
    const icon = document.getElementById('planThinkingIcon');
    icon.classList.remove('loading');
    icon.textContent = '✅';
    document.getElementById('planThinkingTitle').textContent = '思考完成';
    document.getElementById('planThinkingToggle').style.display = '';
    const el = document.getElementById('planThinkingContent');
    if (el) {
        el.innerHTML = escHtml(_thinkingBuffer).replace(/\n/g, '<br>');
    }
}

function toggleThinking() {
    const panel = document.getElementById('planThinkingPanel');
    const body = document.getElementById('planThinkingBody');
    const toggle = document.getElementById('planThinkingToggle');
    const collapsed = panel.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▲' : '▼';
}

// ============================================================
//  树形视图
// ============================================================

function addTreeArea(id, name, description, parentId, depth) {
    // 如果是根节点
    if (!parentId) {
        _treeData = [{ id, name, description, depth, children: [] }];
        renderTree();
        return;
    }

    // 找到父节点并添加子节点
    const node = findTreeNode(_treeData, parentId);
    if (node) {
        if (!node.children) node.children = [];
        node.children.push({ id, name, description, depth, children: [] });
        renderTree();
    }
}

function findTreeNode(nodes, id) {
    for (const n of nodes) {
        if (n.id === id) return n;
        if (n.children) {
            const found = findTreeNode(n.children, id);
            if (found) return found;
        }
    }
    return null;
}

function renderTree() {
    const container = document.getElementById('planTreeBody');
    if (_treeData.length === 0) {
        container.innerHTML = '<div class="plan-tree-empty">等待探索开始...</div>';
        return;
    }
    container.innerHTML = buildTreeHtml(_treeData, 0);
    bindTreeNodeEvents();
}

function bindTreeNodeEvents() {
    document.querySelectorAll('#planTreeBody .plan-tree-node').forEach(node => {
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
    return nodes.map(n => {
        const hasChildren = n.children && n.children.length > 0;
        // 深度对应的颜色
        const colors = ['#00D4FF', '#38BDF8', '#60A5FA', '#818CF8', '#A78BFA',
                        '#C084FC', '#E879F9', '#F472B6', '#FB7185', '#F87171', '#FBBF24'];
        const color = colors[Math.min(n.depth || depth, 10)];
        const indent = (n.depth || depth) * 20;
        const selectedClass = _selectedAreaId === n.id ? ' selected' : '';

        let html = `<div class="plan-tree-node" data-area-id="${n.id}" style="margin-left:${indent}px">`;
        html += `<div class="plan-tree-node-row${selectedClass}">`;
        html += `<span class="plan-tree-bullet" style="background:${color}"></span>`;
        html += `<span class="plan-tree-node-name">${escHtml(n.name)}</span>`;
        if (hasChildren) {
            html += `<span class="plan-tree-badge">${n.children.length}</span>`;
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
//  消息面板
// ============================================================

function appendPlanMessage(areaId, areaName, depth, role, content, msgId) {
    // 按 area_id 存储消息
    if (areaId !== null && areaId !== undefined) {
        if (!_messagesByArea[areaId]) _messagesByArea[areaId] = [];
        _messagesByArea[areaId].push({ role, content, areaName, depth, msgId });
    }

    // 仅在选中领域匹配时渲染到右侧"探索过程"面板
    if (_selectedAreaId === null || areaId !== _selectedAreaId) return;

    const container = document.getElementById('planMessageBody');
    const empty = container.querySelector('.plan-message-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = `plan-message ${role}`;

    const colors = ['#00D4FF', '#38BDF8', '#60A5FA', '#818CF8', '#A78BFA',
                    '#C084FC', '#E879F9', '#F472B6', '#FB7185', '#F87171', '#FBBF24'];
    const tagColor = colors[Math.min(depth, 10)];

    let tagHtml = '';
    if (role === 'assistant') {
        tagHtml = `<div class="plan-message-tag" style="border-left:3px solid ${tagColor}">
            <span class="plan-message-depth" style="color:${tagColor}">L${depth}</span>
            <span class="plan-message-area">${escHtml(areaName)}</span>
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
        div.innerHTML = tagHtml + `<div class="plan-message-content">${html}</div>`;
    } else {
        div.innerHTML = `<div class="plan-message-content">${escHtml(content)}</div>`;
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ============================================================
//  更新状态栏
// ============================================================

function updateStatus(depth, areas, messages, text, isDone) {
    if (depth !== undefined) {
        document.getElementById('statusDepth').textContent = `${depth} / 10`;
    }
    if (areas !== undefined) {
        document.getElementById('statusAreas').textContent = areas;
        _areaCount = areas;
    }
    if (messages !== undefined) {
        document.getElementById('statusMessages').textContent = messages;
        _messageCount = messages;
    }
    if (text !== undefined) {
        const el = document.getElementById('statusText');
        if (isDone) {
            el.innerHTML = `<span class="status-dot done"></span> ${escHtml(text)}`;
        } else {
            el.innerHTML = `<span class="status-dot pulse"></span> ${escHtml(text)}`;
        }
    }
}

// ============================================================
//  Progress Box
// ============================================================

function showProgressBox(text) {
    const box = document.getElementById('planProgressBox');
    box.style.display = '';
    box.classList.remove('done');
    document.getElementById('planProgressIcon').textContent = '⏳';
    document.getElementById('planProgressTitle').textContent = '探索进度';
    document.getElementById('planProgressText').textContent = text;
    document.querySelectorAll('.plan-progress-stat').forEach(el => el.remove());
}

function setProgressText(text) {
    document.getElementById('planProgressText').textContent = text;
}

function completeProgressBox(totalAreas, totalMessages, maxDepth) {
    const box = document.getElementById('planProgressBox');
    box.classList.add('done');
    document.getElementById('planProgressIcon').textContent = '✅';
    document.getElementById('planProgressTitle').textContent = '探索完成';
    const body = document.getElementById('planProgressBody');
    body.innerHTML = `
        <span class="plan-progress-text">全部探索完成！</span>
        <span class="plan-progress-stat">📚 领域: ${totalAreas}</span>
        <span class="plan-progress-stat">💬 消息: ${totalMessages}</span>
        <span class="plan-progress-stat">📊 深度: ${maxDepth}</span>
    `;
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
    const container = document.getElementById('planMessageBody');

    document.querySelectorAll('.plan-tree-node-row').forEach(r => r.classList.remove('selected'));
    if (areaId !== null) {
        const nodeEl = document.querySelector(`.plan-tree-node[data-area-id="${areaId}"]`);
        if (nodeEl) {
            const row = nodeEl.querySelector('.plan-tree-node-row');
            if (row) row.classList.add('selected');
        }
    }

    if (areaId === null) {
        container.innerHTML = '<div class="plan-message-empty">请点击左侧领域节点查看 AI 响应...</div>';
        return;
    }

    const areaMsgs = _messagesByArea[areaId];
    let areaName = '';
    const node = findTreeNode(_treeData, areaId);
    if (node) areaName = node.name;

    if (!areaMsgs || areaMsgs.length === 0) {
        const label = areaName ? `「${escHtml(areaName)}」` : '该领域';
        container.innerHTML = `<div class="plan-message-empty">${label} 正在探索中，请稍候...</div>`;
        return;
    }

    renderMessagesView(container, areaMsgs, areaName);
}

function renderMessagesView(container, messages, areaName) {
    container.innerHTML = '';
    if (areaName) {
        const header = document.createElement('div');
        header.className = 'plan-msg-filter-header';
        header.innerHTML = `<span>📂 ${escHtml(areaName)}</span>`;
        container.appendChild(header);
    }
    if (messages.length === 0) {
        container.innerHTML += '<div class="plan-message-empty">暂无消息</div>';
        return;
    }
    for (const msg of messages) {
        const div = document.createElement('div');
        div.className = `plan-message ${msg.role}`;
        const colors = ['#00D4FF', '#38BDF8', '#60A5FA', '#818CF8', '#A78BFA',
                        '#C084FC', '#E879F9', '#F472B6', '#FB7185', '#F87171', '#FBBF24'];
        const tagColor = colors[Math.min(msg.depth, 10)];
        let tagHtml = '';
        if (msg.role === 'assistant') {
            tagHtml = `<div class="plan-message-tag" style="border-left:3px solid ${tagColor}">
                <span class="plan-message-depth" style="color:${tagColor}">L${msg.depth}</span>
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
            div.innerHTML = tagHtml + `<div class="plan-message-content">${html}</div>`;
        } else {
            div.innerHTML = `<div class="plan-message-content">${escHtml(msg.content)}</div>`;
        }
        container.appendChild(div);
    }
    container.scrollTop = container.scrollHeight;
}

// ============================================================
//  展示结果
// ============================================================

function showResult(data) {
    document.getElementById('resultAreas').textContent = data.total_areas || 0;
    document.getElementById('resultMessages').textContent = data.total_messages || 0;
    document.getElementById('resultDepth').textContent = data.max_depth || 0;
    document.getElementById('planResultSection').style.display = '';
    updateStatus(undefined, data.total_areas, data.total_messages, '探索完成 ✅', true);
}

// ============================================================
//  主流程：开始探索
// ============================================================

async function startPlan() {
    const domain = document.getElementById('planDomainInput').value.trim();
    if (!domain) {
        alert('请输入要探索的领域名称');
        return;
    }
    if (_isExploring) return;
    _isExploring = true;

    const depthInput = document.getElementById('planDepthInput');
    const maxDepth = depthInput ? Math.max(1, Math.min(10, parseInt(depthInput.value, 10) || 2)) : 2;

    // 重置状态
    _treeData = [];
    _areaCount = 0;
    _messageCount = 0;
    _messagesByArea = {};
    _selectedAreaId = null;
    _phase = 'initial';
    if (_progressCloseTimer) { clearTimeout(_progressCloseTimer); _progressCloseTimer = null; }
    document.getElementById('planProgressBox').style.display = 'none';
    document.getElementById('planMessageBody').innerHTML =
        '<div class="plan-message-empty">请点击左侧领域节点查看 AI 响应...</div>';
    document.getElementById('planTreeBody').innerHTML =
        '<div class="plan-tree-empty">等待探索开始...</div>';
    document.getElementById('planResultSection').style.display = 'none';

    const btn = document.getElementById('planStartBtn');
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
            if (res.status === 429) {
                const err = await res.json().catch(() => ({}));
                showTokenLimitPanel(err.detail);
                throw new Error(err.detail?.message || '免费 Token 额度已用尽');
            }
            if (res.status === 401) { logout(); throw new Error('登录已过期'); }
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `请求失败 (${res.status})`);
        }

        let resultData = null;

        await readSSEStream(res, {
            thinking: (data) => {
                if (data.chunk) updateThinking(data.chunk);
            },
            tool_call: (data) => {
                if (data.chunk) {
                    const el = document.getElementById('planThinkingContent');
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
                    completeThinking();
                    const panel = document.getElementById('planThinkingPanel');
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
            result: (data) => {
                resultData = data;
            },
            error: (data) => {
                throw new Error(data.detail || '探索过程出错');
            },
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
        const icon = document.getElementById('planThinkingIcon');
        if (icon) { icon.textContent = '⚠️'; icon.classList.remove('loading'); }
        document.getElementById('planThinkingTitle').textContent = '思考中断';
        document.getElementById('planThinkingToggle').style.display = '';
    } finally {
        _isExploring = false;
        btn.disabled = false;
        btn.textContent = '开始探索';
    }
}

// ============================================================
//  Auth UI
// ============================================================

const tabLogin = document.getElementById('planTabLogin');
const tabRegister = document.getElementById('planTabRegister');
let isLoginMode = true;

function togglePlanAuthRegisterFields(show) {
    const el = document.getElementById('planAuthRegisterFields');
    if (el) el.style.display = show ? '' : 'none';
}

function resetPlanAuthStep() {
    const s1 = document.getElementById('planAuthRegStep1');
    const s2 = document.getElementById('planAuthRegStep2');
    if (s1) s1.style.display = '';
    if (s2) s2.style.display = 'none';
    document.getElementById('planAuthPassword').style.display = '';
    document.getElementById('planAuthEmail').removeAttribute('readonly');
}

tabLogin.addEventListener('click', () => {
    isLoginMode = true;
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    document.getElementById('planAuthBtn').textContent = '登录';
    document.getElementById('planAuthBtn').style.display = '';
    document.getElementById('planAuthError').textContent = '';
    document.getElementById('planAuthError').style.color = '#ef4444';
    togglePlanAuthRegisterFields(false);
    document.getElementById('planAuthPassword').style.display = '';
    document.getElementById('planAuthEmail').removeAttribute('readonly');
});

tabRegister.addEventListener('click', () => {
    isLoginMode = false;
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    document.getElementById('planAuthBtn').textContent = '注册';
    document.getElementById('planAuthBtn').style.display = 'none';
    document.getElementById('planAuthError').textContent = '';
    document.getElementById('planAuthError').style.color = '#ef4444';
    togglePlanAuthRegisterFields(true);
    resetPlanAuthStep();
    document.getElementById('planAuthPassword').style.display = 'none';
});

document.getElementById('planAuthForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const authEmail = document.getElementById('planAuthEmail');
    const authError = document.getElementById('planAuthError');
    const authBtn = document.getElementById('planAuthBtn');
    const email = authEmail.value.trim();

    if (isLoginMode) {
        const password = document.getElementById('planAuthPassword').value.trim();
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
        const step2 = document.getElementById('planAuthRegStep2');
        if (!step2 || step2.style.display === 'none') {
            if (!email || email.indexOf('@') === -1) { authError.textContent = '请输入有效的邮箱'; return; }
            const sendBtn = document.getElementById('planAuthRegSendBtn');
            if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '发送中...'; }
            authError.textContent = '';
            authError.style.color = '#ef4444';
            try {
                await api('/auth/register-send-code', { method: 'POST', body: { email } });
                document.getElementById('planAuthRegStep1').style.display = 'none';
                document.getElementById('planAuthRegStep2').style.display = '';
                authBtn.style.display = '';
                document.getElementById('planAuthPassword').style.display = 'none';
                authEmail.setAttribute('readonly', 'readonly');
                authError.textContent = '验证码已发送，请查收邮件';
                authError.style.color = '#67c23a';
            } catch (err) {
                if (err.message.includes('已注册')) {
                    tabLogin.click();
                    authError.textContent = '该邮箱已注册，请直接登录';
                } else {
                    authError.textContent = err.message;
                }
            }
            finally { if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '发送验证码'; } }
        } else {
            const code = document.getElementById('planAuthRegCode')?.value?.trim();
            const password = document.getElementById('planAuthRegPassword')?.value?.trim();
            const confirmPw = document.getElementById('planAuthConfirmPassword')?.value || '';
            const nickname = document.getElementById('planAuthNickname')?.value?.trim() || '';
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
document.getElementById('planAuthOverlay').addEventListener('click', (e) => {
    const target = e.target;
    if (target.id === 'planAuthForgotLink') {
        document.getElementById('planAuthForm').style.display = 'none';
        document.getElementById('planAuthForgotPanel').style.display = '';
        document.getElementById('planAuthForgotError').textContent = '';
        document.getElementById('planAuthForgotResetError').textContent = '';
        document.getElementById('planAuthForgotStep2').style.display = 'none';
        document.getElementById('planAuthForgotStep1').style.display = '';
    } else if (target.id === 'planAuthForgotBack') {
        document.getElementById('planAuthForgotPanel').style.display = 'none';
        document.getElementById('planAuthForm').style.display = '';
    } else if (target.id === 'planAuthForgotSendBtn') {
        handlePlanForgotSend();
    } else if (target.id === 'planAuthForgotResetBtn') {
        handlePlanForgotReset();
    }
});

async function handlePlanForgotSend() {
    const email = document.getElementById('planAuthForgotEmail')?.value?.trim();
    if (!email) { document.getElementById('planAuthForgotError').textContent = '请输入邮箱'; return; }
    const btn = document.getElementById('planAuthForgotSendBtn');
    btn.disabled = true;
    btn.textContent = '发送中...';
    document.getElementById('planAuthForgotError').textContent = '';
    try {
        await api('/auth/forgot-password', { method: 'POST', body: { email } });
        document.getElementById('planAuthForgotStep1').style.display = 'none';
        document.getElementById('planAuthForgotStep2').style.display = '';
    } catch (err) { document.getElementById('planAuthForgotError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = '发送验证码'; }
}

async function handlePlanForgotReset() {
    const email = document.getElementById('planAuthForgotEmail')?.value?.trim();
    const code = document.getElementById('planAuthForgotCode')?.value?.trim();
    const newPassword = document.getElementById('planAuthForgotNewPassword')?.value?.trim();
    if (!code || !newPassword) { document.getElementById('planAuthForgotResetError').textContent = '请填写验证码和新密码'; return; }
    const btn = document.getElementById('planAuthForgotResetBtn');
    btn.disabled = true;
    btn.textContent = '重置中...';
    document.getElementById('planAuthForgotResetError').textContent = '';
    try {
        await api('/auth/reset-password', { method: 'POST', body: { email, code, new_password: newPassword } });
        document.getElementById('planAuthForgotResetError').style.color = '#67c23a';
        document.getElementById('planAuthForgotResetError').textContent = '密码重置成功，请返回登录';
        setTimeout(() => { document.getElementById('planAuthForgotBack')?.click(); }, 2000);
    } catch (err) { document.getElementById('planAuthForgotResetError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = '重置密码'; }
}

// ============================================================
//  事件绑定
// ============================================================

document.getElementById('planStartBtn').addEventListener('click', startPlan);
document.getElementById('planDomainInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startPlan(); }
});

document.getElementById('planRestartBtn').addEventListener('click', () => {
    document.getElementById('planDomainInput').value = '';
    switchToInput();
});

// 层级分段按钮交互
const DEPTH_HINTS = { 1: '快速概览', 2: '浅层概览', 3: '中等深度', 5: '深度探索', 10: '全量递归' };
document.querySelectorAll('#planDepthPills .plan-depth-pill').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#planDepthPills .plan-depth-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const value = parseInt(btn.dataset.value, 10);
        const hidden = document.getElementById('planDepthInput');
        if (hidden) hidden.value = value;
        const hintEl = document.getElementById('planDepthHint');
        if (hintEl) hintEl.textContent = DEPTH_HINTS[value] || '';
    });
});

// 热门领域按钮
document.querySelectorAll('.plan-hint-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById('planDomainInput').value = btn.dataset.domain;
        startPlan();
    });
});

// Thinking 面板折叠
document.getElementById('planThinkingHeader').addEventListener('click', (e) => {
    if (e.target.closest('.plan-thinking-toggle')) return;
    if (document.getElementById('planThinkingToggle').style.display !== 'none') {
        toggleThinking();
    }
});
document.getElementById('planThinkingToggle').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleThinking();
});

// 退出登录
const planLogoutBtn = document.getElementById('logoutBtn');
if (planLogoutBtn) planLogoutBtn.addEventListener('click', logout);

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

    // Token limit panel close
    document.getElementById('btnCloseTokenLimit')?.addEventListener('click', closeTokenLimitPanel);
    document.getElementById('btnCloseTokenLimitFooter')?.addEventListener('click', closeTokenLimitPanel);
    document.getElementById('tokenLimitOverlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeTokenLimitPanel();
    });
}

// —— Token 限额提示面板 ——
function showTokenLimitPanel(detail) {
    const overlay = document.getElementById('tokenLimitOverlay');
    const detailsEl = document.getElementById('tokenLimitDetails');
    if (!overlay) return;
    if (detail && detail.used_prompt !== undefined) {
        detailsEl.innerHTML =
            '<div class="limit-row"><span class="label">今日已用输入 Token</span><span class="value over">' +
            (detail.used_prompt || 0).toLocaleString() + '</span></div>' +
            '<div class="limit-row"><span class="label">今日已用输出 Token</span><span class="value over">' +
            (detail.used_completion || 0).toLocaleString() + '</span></div>' +
            '<div class="limit-row"><span class="label">每日输入 Token 限额</span><span class="value">' +
            (detail.limit_prompt || 200000).toLocaleString() + '</span></div>' +
            '<div class="limit-row"><span class="label">每日输出 Token 限额</span><span class="value">' +
            (detail.limit_output || 200000).toLocaleString() + '</span></div>';
    } else {
        detailsEl.innerHTML = '<p style="color:#909399;text-align:center;margin:0;">详情暂不可用</p>';
    }
    overlay.classList.add('active');
}
function closeTokenLimitPanel() {
    const overlay = document.getElementById('tokenLimitOverlay');
    if (overlay) overlay.classList.remove('active');
}

boot();
