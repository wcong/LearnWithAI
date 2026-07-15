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

document.getElementById('mPlanTabLogin').addEventListener('click', () => {
    isLoginMode = true;
    document.getElementById('mPlanTabLogin').classList.add('active');
    document.getElementById('mPlanTabRegister').classList.remove('active');
    document.getElementById('mPlanAuthBtn').textContent = '登录';
    document.getElementById('mPlanAuthError').textContent = '';
});

document.getElementById('mPlanTabRegister').addEventListener('click', () => {
    isLoginMode = false;
    document.getElementById('mPlanTabRegister').classList.add('active');
    document.getElementById('mPlanTabLogin').classList.remove('active');
    document.getElementById('mPlanAuthBtn').textContent = '注册';
    document.getElementById('mPlanAuthError').textContent = '';
});

document.getElementById('mPlanAuthForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('mPlanAuthUsername').value.trim();
    const password = document.getElementById('mPlanAuthPassword').value.trim();
    if (!username || !password) { document.getElementById('mPlanAuthError').textContent = '请填写用户名和密码'; return; }
    const btn = document.getElementById('mPlanAuthBtn');
    btn.disabled = true;
    btn.textContent = '处理中...';
    document.getElementById('mPlanAuthError').textContent = '';
    try {
        const endpoint = isLoginMode ? '/auth/login' : '/auth/register';
        const data = await api(endpoint, { method: 'POST', body: { username, password } });
        token = data.token;
        currentUser = { id: data.user_id, username: data.username };
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(currentUser));
        showApp();
    } catch (err) { document.getElementById('mPlanAuthError').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = isLoginMode ? '登录' : '注册'; }
});

// ============================================================
//  View Switcher (Tree / Messages)
// ============================================================

document.querySelectorAll('.m-plan-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.m-plan-view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const view = btn.dataset.view;
        document.getElementById('mPlanTreePanel').classList.toggle('hidden', view !== 'tree');
        document.getElementById('mPlanMessagePanel').classList.toggle('hidden', view !== 'messages');
    });
});

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
}

function buildTreeHtml(nodes, depth) {
    const colors = ['#00D4FF', '#38BDF8', '#60A5FA', '#818CF8', '#A78BFA',
                    '#C084FC', '#E879F9', '#F472B6', '#FB7185', '#F87171', '#FBBF24'];
    return nodes.map(n => {
        const hasChildren = n.children && n.children.length > 0;
        const color = colors[Math.min(n.depth || depth, 10)];
        const indent = (n.depth || depth) * 16;

        let html = `<div class="m-plan-tree-node" style="margin-left:${indent}px">`;
        html += `<div class="m-plan-tree-node-row">`;
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

    _treeData = [];
    _areaCount = 0;
    _messageCount = 0;
    document.getElementById('mPlanMessageBody').innerHTML =
        '<div class="m-plan-message-empty">AI 正在探索，消息将在此展示...</div>';
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
            body: JSON.stringify({ domain }),
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
