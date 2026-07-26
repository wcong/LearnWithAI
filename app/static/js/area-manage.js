// ============================================================
// 领域管理页面 – 树形展示 / 批量删除 / Pin 置顶
// ============================================================

let token = localStorage.getItem('token') || '';
let currentUser = null;
let _treeData = [];
let _collapsed = new Set(); // 已折叠的节点 id

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
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function logout() {
    token = ''; currentUser = null;
    localStorage.removeItem('token'); localStorage.removeItem('user');
    window.location.href = '/static/index.html';
}

// ---------- 加载 & 渲染 ----------

async function loadTree() {
    const body = document.getElementById('amTreeBody');
    body.innerHTML = '<div class="am-loading">加载中...</div>';
    try {
        const data = await api('/areas/tree');
        _treeData = data;
        renderTree();
        document.getElementById('amDeleteBtn').disabled = true;
        document.getElementById('amPromoteBtn').disabled = true;
    } catch (err) {
        body.innerHTML = `<div class="am-error">⚠️ 加载失败：${escHtml(err.message)}</div>`;
    }
}

function renderTree() {
    const body = document.getElementById('amTreeBody');
    if (!_treeData || _treeData.length === 0) {
        body.innerHTML = '<div class="am-empty">暂无领域，先去<a href="/domain" class="am-link">创建学习领域</a></div>';
        return;
    }

    let html = '<div class="am-tree-table">';

    // 表头行（含全选）
    html += `<div class="am-tree-header">
        <span class="am-arrow" style="visibility:hidden;">▶</span>
        <input type="checkbox" class="am-checkbox" id="amSelectAll" title="全选/取消全选">
        <span class="am-pin-btn-placeholder"></span>
        <span class="am-node-name" style="font-weight:600;">领域名称</span>
        <span class="am-node-desc" style="font-weight:600;color:#606266;">描述</span>
        <span class="am-node-time" style="font-weight:600;color:#606266;">创建时间</span>
    </div>`;

    for (const node of _treeData) {
        html += _renderNode(node, 0);
    }

    html += '</div>';
    body.innerHTML = html;

    // 绑定事件
    _bindEvents();
}

function _renderNode(node, level) {
    // 检查祖先是否折叠 - 用 _isVisible 判断
    const visible = _isNodeVisible(node);
    if (!visible) return '';

    const hasChildren = node.children && node.children.length > 0;
    const isPinned = node.is_pinned;
    const isCollapsed = _collapsed.has(node.id);
    const indent = level * 24;
    const created = node.created_at ? node.created_at.slice(0, 10) : '';

    let html = `<div class="am-tree-row${isPinned ? ' am-row-pinned' : ''}" data-id="${node.id}">`;

    // Arrow
    const arrowHtml = hasChildren
        ? `<span class="am-arrow am-arrow-btn" data-id="${node.id}">${isCollapsed ? '▶' : '▼'}</span>`
        : `<span class="am-arrow" style="visibility:hidden;">▶</span>`;

    // Checkbox
    const cbHtml = `<input type="checkbox" class="am-checkbox" data-id="${node.id}">`;

    // Pin button
    const pinBtn = `<button class="am-pin-btn${isPinned ? ' am-pinned' : ''}" data-id="${node.id}" title="${isPinned ? '取消置顶' : '置顶'}">📌</button>`;

    // Description
    const desc = node.description
        ? `<span class="am-node-desc">${escHtml(node.description.slice(0, 80))}${node.description.length > 80 ? '…' : ''}</span>`
        : '<span class="am-node-desc am-desc-empty">—</span>';

    html += `
        <span style="display:inline-flex;align-items:center;gap:6px;padding-left:${indent}px;flex-shrink:0;">
            ${arrowHtml}
            ${cbHtml}
            ${pinBtn}
        </span>
        <span class="am-node-name">${escHtml(node.name)}</span>
        ${desc}
        <span class="am-node-time">${created}</span>
    `;

    html += '</div>';

    // 递归渲染子节点（未折叠时）
    if (hasChildren && !isCollapsed) {
        for (const child of node.children) {
            html += _renderNode(child, level + 1);
        }
    }

    return html;
}

function _isNodeVisible(node) {
    // 检查是否有任何祖先被折叠
    if (!node.parent_id) return true;
    // 遍历查找这个节点的所有祖先
    return _isParentVisible(node.parent_id);
}

function _isParentVisible(parentId) {
    if (!parentId) return true;
    if (_collapsed.has(parentId)) return false;
    // 查找父节点，递归检查
    for (const root of _treeData) {
        const found = _findParentInTree(root, parentId);
        if (found !== null) return found;
    }
    return true;
}

function _findParentInTree(node, targetId) {
    if (node.id === targetId) {
        // 找到父节点，检查它是否被折叠
        // 父节点本身是否可见由其祖先决定
        if (_collapsed.has(node.id)) return false;
        return true;
    }
    if (node.children) {
        for (const child of node.children) {
            const result = _findParentInTree(child, targetId);
            if (result !== null) return result;
        }
    }
    return null;
}

function _findNodeById(id, nodes) {
    for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children) {
            const found = _findNodeById(id, node.children);
            if (found) return found;
        }
    }
    return null;
}

function _collectChildIds(node, ids = []) {
    ids.push(node.id);
    if (node.children) {
        for (const child of node.children) {
            _collectChildIds(child, ids);
        }
    }
    return ids;
}

function _getSelectedIds() {
    const cbs = document.querySelectorAll('.am-checkbox:not(#amSelectAll):checked');
    return Array.from(cbs).map(cb => parseInt(cb.dataset.id));
}

// ---------- 事件绑定 ----------

function _bindEvents() {
    // 展开/折叠
    document.querySelectorAll('.am-arrow-btn').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(el.dataset.id);
            if (_collapsed.has(id)) {
                _collapsed.delete(id);
            } else {
                _collapsed.add(id);
            }
            renderTree();
        });
    });

    // Pin 切换
    document.querySelectorAll('.am-pin-btn').forEach(el => {
        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = parseInt(el.dataset.id);
            try {
                await api(`/areas/${id}/pin`, { method: 'PATCH' });
                await loadTree();
            } catch (err) {
                alert('操作失败：' + err.message);
            }
        });
    });

    // 复选框：选中父节点时递归选中子节点
    document.querySelectorAll('.am-checkbox:not(#amSelectAll)').forEach(el => {
        el.addEventListener('change', () => {
            const id = parseInt(el.dataset.id);
            const node = _findNodeById(id, _treeData);
            if (node) {
                const allIds = _collectChildIds(node, []);
                for (const childId of allIds) {
                    const childCb = document.querySelector(`.am-checkbox[data-id="${childId}"]`);
                    if (childCb) childCb.checked = el.checked;
                }
            }
            _updateDeleteBtn();
            _updateSelectAll();
            _updatePromoteBtn();
        });
    });

    // 全选/取消全选
    const selectAll = document.getElementById('amSelectAll');
    if (selectAll) {
        selectAll.addEventListener('change', () => {
            const checked = selectAll.checked;
            document.querySelectorAll('.am-checkbox:not(#amSelectAll)').forEach(cb => {
                cb.checked = checked;
            });
            _updateDeleteBtn();
            _updatePromoteBtn();
        });
    }

    // 删除按钮
    document.getElementById('amDeleteBtn').addEventListener('click', () => {
        const ids = _getSelectedIds();
        if (ids.length === 0) return;
        const count = ids.length;
        if (!confirm(`确定要删除选中的 ${count} 个领域吗？\n子领域将被递归删除，此操作不可恢复！`)) return;
        _doDelete(ids);
    });

    // 提升为顶级领域按钮
    document.getElementById('amPromoteBtn').addEventListener('click', () => {
        const ids = _getSelectedIds();
        if (ids.length !== 1) return;
        const node = _findNodeById(ids[0], _treeData);
        if (!node || !node.parent_id) return;
        const name = node.name;
        if (!confirm(`确定要将「${name}」提升为顶级领域吗？\n提升后，该领域的对话将不再继承父领域的上下文。`)) return;
        _doPromote(ids[0]);
    });

    // 刷新按钮
    document.getElementById('amRefreshBtn').addEventListener('click', loadTree);
}

function _updateDeleteBtn() {
    const btn = document.getElementById('amDeleteBtn');
    const count = _getSelectedIds().length;
    btn.disabled = count === 0;
    if (count > 0) {
        btn.textContent = `🗑️ 删除选中 (${count})`;
    } else {
        btn.textContent = '🗑️ 删除选中';
    }
}

function _updateSelectAll() {
    const all = document.querySelectorAll('.am-checkbox:not(#amSelectAll)');
    const checked = document.querySelectorAll('.am-checkbox:not(#amSelectAll):checked');
    const selectAll = document.getElementById('amSelectAll');
    if (selectAll) {
        selectAll.checked = all.length > 0 && checked.length === all.length;
        selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
    }
}

async function _doDelete(ids) {
    const btn = document.getElementById('amDeleteBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 删除中...';
    try {
        const result = await api('/areas/batch-delete', {
            method: 'POST',
            body: { area_ids: ids }
        });
        alert(`✅ 成功删除 ${result.deleted_count} 个领域`);
        await loadTree();
    } catch (err) {
        alert('删除失败：' + err.message);
        btn.disabled = false;
        _updateDeleteBtn();
    }
}

async function _doPromote(areaId) {
    const btn = document.getElementById('amPromoteBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 提升中...';
    try {
        await api(`/areas/${areaId}/promote`, { method: 'POST' });
        alert(`✅ 已成功提升为顶级领域`);
        await loadTree();
    } catch (err) {
        alert('提升失败：' + err.message);
        btn.disabled = false;
        _updatePromoteBtn();
    }
}

function _updatePromoteBtn() {
    const btn = document.getElementById('amPromoteBtn');
    const ids = _getSelectedIds();
    // 只允许选中单个节点，且该节点是子领域（有 parent_id）
    let canPromote = false;
    if (ids.length === 1) {
        const node = _findNodeById(ids[0], _treeData);
        canPromote = !!(node && node.parent_id);
    }
    btn.disabled = !canPromote;
}

// ---------- Boot ----------

function boot() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => boot());
        return;
    }
    const saved = localStorage.getItem('user');
    if (token && saved) {
        currentUser = JSON.parse(saved);
        document.getElementById('amUserBadge').textContent = currentUser.username;
        loadTree();
    } else {
        window.location.href = '/static/index.html';
    }

    document.getElementById('logoutBtn').addEventListener('click', logout);
}

boot();
