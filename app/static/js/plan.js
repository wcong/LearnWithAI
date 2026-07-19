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
}

function buildTreeHtml(nodes, depth) {
    return nodes.map(n => {
        const hasChildren = n.children && n.children.length > 0;
        const depthClass = `depth-${Math.min(n.depth || depth, 10)}`;
        // 深度对应的颜色
        const colors = ['#00D4FF', '#38BDF8', '#60A5FA', '#818CF8', '#A78BFA',
                        '#C084FC', '#E879F9', '#F472B6', '#FB7185', '#F87171', '#FBBF24'];
        const color = colors[Math.min(n.depth || depth, 10)];
        const indent = (n.depth || depth) * 20;

        let html = `<div class="plan-tree-node" style="margin-left:${indent}px">`;
        html += `<div class="plan-tree-node-row ${depthClass}">`;
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
    const container = document.getElementById('planMessageBody');
    const empty = container.querySelector('.plan-message-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = `plan-message ${role}`;

    // 领域标签
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

    // 重置状态
    _treeData = [];
    _areaCount = 0;
    _messageCount = 0;
    document.getElementById('planMessageBody').innerHTML =
        '<div class="plan-message-empty">AI 正在探索，消息将在此展示...</div>';
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
            body: JSON.stringify({ domain }),
        });

        if (!res.ok) {
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

                // 如果是第一层子领域，也发送用户消息
                if (data.depth === 0) {
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

tabLogin.addEventListener('click', () => {
    isLoginMode = true;
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    document.getElementById('planAuthBtn').textContent = '登录';
    document.getElementById('planAuthError').textContent = '';
});

tabRegister.addEventListener('click', () => {
    isLoginMode = false;
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    document.getElementById('planAuthBtn').textContent = '注册';
    document.getElementById('planAuthError').textContent = '';
});

document.getElementById('planAuthForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('planAuthUsername').value.trim();
    const password = document.getElementById('planAuthPassword').value.trim();
    if (!username || !password) { document.getElementById('planAuthError').textContent = '请填写用户名和密码'; return; }
    const btn = document.getElementById('planAuthBtn');
    btn.disabled = true;
    btn.textContent = '处理中...';
    document.getElementById('planAuthError').textContent = '';
    try {
        const endpoint = isLoginMode ? '/auth/login' : '/auth/register';
        const data = await api(endpoint, { method: 'POST', body: { username, password } });
        token = data.token;
        currentUser = { id: data.user_id, username: data.username };
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(currentUser));
        showApp();
    } catch (err) { document.getElementById('planAuthError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = isLoginMode ? '登录' : '注册'; }
});

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
}

boot();
