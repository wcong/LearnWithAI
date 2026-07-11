// ============================================================
// LearnWithAI – 前端主逻辑
// ============================================================

// ——— State ———
let treeData = [];
let selectedAreaId = null;
let selectedAreaName = '';
let isSending = false;
let _expanded = {};  // { areaId: true } 记录展开状态

// ——— DOM refs ———
let areaTreeEl;
let chatMessages, chatInput, sendBtn, areaTitle, areaDesc, addSubBtn;
let modalOverlay, modalTitle, modalForm;
let responseOverlay, responseBody, responseLabel, btnCloseResponse;

// ============================================================
//  初始化
// ============================================================

function init() {
    areaTreeEl = document.getElementById('areaTree');
    chatMessages = document.getElementById('chatMessages');
    chatInput = document.getElementById('chatInput');
    sendBtn = document.getElementById('sendBtn');
    areaTitle = document.getElementById('areaTitle');
    areaDesc = document.getElementById('areaDesc');
    addSubBtn = document.getElementById('addSubBtn');
    modalOverlay = document.getElementById('modalOverlay');
    modalTitle = document.getElementById('modalTitle');
    modalForm = document.getElementById('modalForm');
    responseOverlay = document.getElementById('responseOverlay');
    responseBody = document.getElementById('responseBody');
    responseLabel = document.getElementById('responseLabel');
    btnCloseResponse = document.getElementById('btnCloseResponse');

    if (typeof marked !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true });
    }

    bindEvents();
    loadData();
}

// ============================================================
//  事件绑定
// ============================================================

function bindEvents() {
    document.getElementById('btnNewRootArea').addEventListener('click', () => {
        showCreateModal(null, '');
    });

    addSubBtn.addEventListener('click', () => {
        if (selectedAreaId) showCreateModal(selectedAreaId, selectedAreaName);
    });

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    btnCloseResponse.addEventListener('click', closeResponseModal);
    responseOverlay.addEventListener('click', (e) => {
        if (e.target === responseOverlay) closeResponseModal();
    });
}

// ============================================================
//  左侧：可折叠领域树
// ============================================================

async function loadData() {
    try {
        const res = await fetch('/api/areas/tree');
        treeData = await res.json();
    } catch {
        treeData = [];
    }
    renderTree(treeData);

    if (treeData.length > 0) {
        // 如果选中项仍存在则保留，否则选第一个
        const stillExists = selectedAreaId && findNodeById(treeData, selectedAreaId);
        if (stillExists) {
            selectArea(stillExists);
        } else {
            selectArea(treeData[0]);
        }
    } else {
        clearArea();
    }
}

function renderTree(roots) {
    if (!roots || roots.length === 0) {
        areaTreeEl.innerHTML = '<div class="empty-chat" style="margin-top:40px;font-size:13px;">' +
            '<p style="color:#c0c4cc;">暂无领域，点击上方创建</p></div>';
        return;
    }
    areaTreeEl.innerHTML = buildTreeHtml(roots, 0);
    // 绑定事件（需 DOM 就绪后）
    bindTreeEvents(areaTreeEl);
}

function buildTreeHtml(nodes, depth) {
    return nodes.map(n => {
        const hasChildren = n.children && n.children.length > 0;
        const isExpanded = _expanded[n.id] !== false; // 默认展开
        const isActive = n.id === selectedAreaId;

        let html = `<div class="tree-node">`;
        html += `<div class="tree-row ${isActive ? 'active' : ''}" data-id="${n.id}">`;

        // 展开/折叠箭头
        if (hasChildren) {
            html += `<span class="tree-toggle ${isExpanded ? 'expanded' : ''}">▶</span>`;
        } else {
            html += `<span class="tree-toggle leaf">▶</span>`;
        }

        html += `<span class="tree-icon">${hasChildren ? '📂' : '📄'}</span>`;
        html += `<span class="tree-name">${escHtml(n.name)}</span>`;
        html += `<button class="tree-delete" title="删除此领域">✕</button>`;
        html += `</div>`;  // .tree-row

        // 子节点（始终生成，用 display 控制显隐）
        if (hasChildren) {
            html += `<div class="tree-children" style="display:${isExpanded ? '' : 'none'}">${buildTreeHtml(n.children, depth + 1)}</div>`;
        }

        html += `</div>`;  // .tree-node
        return html;
    }).join('');
}

function bindTreeEvents(container) {
    container.querySelectorAll('.tree-row').forEach(row => {
        const id = parseInt(row.dataset.id, 10);

        row.addEventListener('click', (e) => {
            if (e.target.closest('.tree-delete')) return;

            // 展开/折叠：直接切换子节点显示
            if (e.target.closest('.tree-toggle')) {
                const toggle = e.target.closest('.tree-toggle');
                if (toggle.classList.contains('leaf')) return;
                const isExpanded = toggle.classList.toggle('expanded');
                _expanded[id] = isExpanded;
                // 找到同级的 tree-children 容器切换 display
                const childrenDiv = row.nextElementSibling;
                if (childrenDiv && childrenDiv.classList.contains('tree-children')) {
                    childrenDiv.style.display = isExpanded ? '' : 'none';
                }
                return;
            }

            // 点击行 → 选中
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
        if (r.children) {
            const found = findNodeById(r.children, id);
            if (found) return found;
        }
    }
    return null;
}

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ——— 删除 ———
async function deleteArea(id, name) {
    if (!confirm(`确认删除「${name}」及其所有子领域？`)) return;

    try {
        const res = await fetch(`/api/areas/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('删除失败');

        if (selectedAreaId === id) {
            selectedAreaId = null;
            selectedAreaName = '';
            clearArea();
        }

        await loadData();
    } catch (err) {
        alert('删除失败：' + err.message);
    }
}

// ============================================================
//  选择领域
// ============================================================

function selectArea(nodeData) {
    selectedAreaId = nodeData.id;
    selectedAreaName = nodeData.name;

    // 更新左栏高亮
    areaTreeEl.querySelectorAll('.tree-row').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.id, 10) === selectedAreaId);
    });

    // 更新聊天区
    areaTitle.textContent = nodeData.name;
    areaDesc.textContent = nodeData.description || '暂无简介';
    addSubBtn.style.display = 'inline-block';
    chatMessages.innerHTML = `
        <div class="empty-chat">
            <div class="icon">💬</div>
            <p>已进入 <strong>${nodeData.name}</strong>，开始学习吧！</p>
        </div>`;
    chatInput.disabled = false;
    chatInput.placeholder = `在「${nodeData.name}」中提问...`;
    sendBtn.disabled = false;

    loadHistory(nodeData.id);
}

function clearArea() {
    areaTitle.textContent = '请选择一个领域';
    areaDesc.textContent = '';
    addSubBtn.style.display = 'none';
    chatMessages.innerHTML = `
        <div class="empty-chat">
            <div class="icon">🌱</div>
            <p>选择一个学习领域，开启 AI 引导的深度学习之旅</p>
        </div>`;
    chatInput.disabled = true;
    sendBtn.disabled = true;
}

// ============================================================
//  聊天
// ============================================================

async function loadHistory(areaId) {
    try {
        const res = await fetch(`/api/chat/history/${areaId}`);
        const messages = await res.json();
        if (messages.length === 0) return;
        chatMessages.innerHTML = '';
        messages.forEach(m => appendMessage(m.role, m.content, m.id));
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } catch { /* ignore */ }
}

function appendMessage(role, content, msgId) {
    const empty = chatMessages.querySelector('.empty-chat');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = `message ${role}`;

    if (role === 'assistant') {
        div.dataset.msgId = msgId || '';
        div.innerHTML = (typeof marked !== 'undefined'
            ? marked.parse(content) : content)
            + '<span class="click-hint">👆 点击展开详情</span>';
        div.querySelector('.click-hint').addEventListener(
            'click', (e) => { e.stopPropagation(); showResponseModal(content, msgId); });
    } else {
        div.textContent = content;
    }

    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function buildUsageHtml(usage) {
    if (!usage) {
        return `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e4e7ed;">
  <div style="font-size:13px;font-weight:600;color:#909399;">⚙️ 用量数据</div>
  <p style="font-size:12px;color:#c0c4cc;margin-top:6px;">暂无用量记录</p>
</div>`;
    }
    return `
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e4e7ed;">
  <div style="font-size:13px;font-weight:600;color:#606266;margin-bottom:10px;">⚙️ Token 用量</div>
  <table style="width:auto;font-size:13px;">
    <tr><td style="padding:4px 16px 4px 0;color:#909399;">模型</td>
        <td style="padding:4px 0;">${escHtml(usage.model || '-')}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#909399;">提供商</td>
        <td style="padding:4px 0;">${escHtml(usage.provider || '-')}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#909399;">输入 Token</td>
        <td style="padding:4px 0;">${usage.prompt_tokens?.toLocaleString() || 0}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#909399;">输出 Token</td>
        <td style="padding:4px 0;">${usage.completion_tokens?.toLocaleString() || 0}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#909399;">合计 Token</td>
        <td style="padding:4px 0;font-weight:600;">${usage.total_tokens?.toLocaleString() || 0}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#909399;">耗时</td>
        <td style="padding:4px 0;">${usage.duration_ms ? (usage.duration_ms / 1000).toFixed(1) + 's' : '-'}</td></tr>
  </table>
</div>`;
}

async function showResponseModal(content, msgId) {
    responseLabel.textContent = `AI 回复详情 · ${selectedAreaName}`;
    let html = typeof marked !== 'undefined' ? marked.parse(content) : content;

    if (msgId) {
        try {
            const res = await fetch(`/api/chat/usage/${msgId}`);
            const usage = await res.json();
            html += buildUsageHtml(usage);
        } catch { /* ignore */ }
    }

    responseBody.innerHTML = html;
    responseOverlay.classList.add('active');
}

function closeResponseModal() {
    responseOverlay.classList.remove('active');
}

async function sendMessage() {
    const msg = chatInput.value.trim();
    if (!msg || isSending || !selectedAreaId) return;
    appendMessage('user', msg);
    chatInput.value = '';
    await doSendMessage(msg);
}

async function doSendMessage(msg) {
    isSending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = '发送中...';

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ area_id: selectedAreaId, message: msg }),
        });
        const data = await res.json();
        appendMessage('assistant', data.reply, data.message_id);
        // 刷新树（可能有新节点）
        await loadData();
    } catch (err) {
        appendMessage('assistant', '⚠️ 请求失败，请检查服务配置和 API Key：' + err.message);
    } finally {
        isSending = false;
        sendBtn.disabled = false;
        sendBtn.textContent = '发送';
        chatInput.focus();
    }
}

// ============================================================
//  创建领域
// ============================================================

function showCreateModal(parentId, parentName) {
    modalTitle.textContent = parentId
        ? `在「${parentName}」下创建子领域`
        : '创建顶级学习领域';

    modalForm.innerHTML = `
        <label>领域名称 *</label>
        <input type="text" id="modalName" placeholder="例如：机器学习" required>
        <label>简介（选填）</label>
        <textarea id="modalDesc" rows="3" placeholder="描述该领域的核心内容..."></textarea>
        <input type="hidden" id="modalParentId" value="${parentId || ''}">
        <div class="modal-actions">
            <button type="button" id="btnModalCancel">取消</button>
            <button type="button" class="btn-primary" id="btnModalSubmit">创建</button>
        </div>
    `;

    modalOverlay.classList.add('active');
    setTimeout(() => document.getElementById('modalName')?.focus(), 100);

    document.getElementById('btnModalCancel').addEventListener('click', closeModal);
    document.getElementById('btnModalSubmit').addEventListener('click', submitCreate);
    document.getElementById('modalName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitCreate();
    });
}

function closeModal() {
    modalOverlay.classList.remove('active');
}

async function submitCreate() {
    const name = document.getElementById('modalName').value.trim();
    const description = document.getElementById('modalDesc').value.trim();
    const parentId = document.getElementById('modalParentId').value;

    if (!name) { alert('请输入领域名称'); return; }

    const body = { name, description };
    if (parentId) body.parent_id = parseInt(parentId, 10);

    try {
        const res = await fetch('/api/areas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || '创建失败');
        }
        closeModal();

        if (parentId) {
            // 展开父节点
            _expanded[parseInt(parentId, 10)] = true;
        }
        await loadData();
    } catch (err) {
        alert('创建失败：' + err.message);
    }
}

// ============================================================
//  启动
// ============================================================

function boot() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => boot());
        return;
    }
    if (typeof marked === 'undefined') {
        setTimeout(boot, 100);
        return;
    }
    init();
}

boot();
