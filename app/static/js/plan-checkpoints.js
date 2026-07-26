// ============================================================
// Plan 检查点页面 – 展示 plan_checkpoints.db 分析结果
// ============================================================

let token = localStorage.getItem('token') || '';
let currentUser = null;
let _expandedRow = null;
let _detailCache = {};

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

// ============================================================
//  数据加载 & 渲染
// ============================================================

async function loadPlanRuns() {
    const body = document.getElementById('pcBody');
    body.innerHTML = '<div class="pc-loading">加载中...</div>';
    try {
        const data = await api('/admin/plan-runs');
        renderPlanRuns(data, body);
    } catch (err) {
        if (err.message.includes('403') || err.message.includes('仅管理员')) {
            body.innerHTML = '<div class="pc-error">⚠️ 仅管理员可访问此页面</div>';
        } else {
            body.innerHTML = `<div class="pc-error">⚠️ 加载失败：${escHtml(err.message)}</div>`;
        }
    }
}

function renderPlanRuns(data, body) {
    if (!data || data.length === 0) {
        body.innerHTML = '<div class="pc-empty">暂无 Plan 运行记录</div>';
        return;
    }

    // 汇总
    const totalRuns = data.length;
    const totalAreas = data.reduce((s, r) => s + r.total_areas, 0);
    const totalMsgs = data.reduce((s, r) => s + r.total_messages, 0);
    const finishedCount = data.filter(r => r.finished).length;

    let html = `
        <div class="pc-summary">
            <div class="pc-card"><div class="pc-card-value">${totalRuns}</div><div class="pc-card-label">运行次数</div></div>
            <div class="pc-card"><div class="pc-card-value">${totalAreas}</div><div class="pc-card-label">总领域数</div></div>
            <div class="pc-card"><div class="pc-card-value">${totalMsgs.toLocaleString()}</div><div class="pc-card-label">总消息数</div></div>
            <div class="pc-card pc-card-primary"><div class="pc-card-value">${finishedCount} / ${totalRuns}</div><div class="pc-card-label">完成</div></div>
        </div>
    `;

    // 表格
    html += '<table class="pc-table"><thead><tr>' +
        '<th>#</th><th>主题</th><th>用户</th><th>领域</th><th>深度</th><th>消息</th><th>步骤</th><th>状态</th><th>开始时间</th><th>内容预览</th>' +
        '</tr></thead><tbody>';

    data.forEach((r, i) => {
        const time = r.start_time || '-';
        const depthColor = r.max_depth >= 5 ? '#ef4444' : r.max_depth >= 3 ? '#f59e0b' : '#67c23a';
        const statusHtml = r.finished
            ? '<span class="pc-status-done">✅ 完成</span>'
            : '<span class="pc-status-pending">⏳ 进行中</span>';

        const hasPreview = !!r.overview_preview;
        const previewId = `pv_${i}`;

        html += `<tr data-thread-id="${escHtml(r.thread_id)}" data-preview-id="${hasPreview ? previewId : ''}">
            <td style="color:#909399;font-size:11px;">${i + 1}</td>
            <td><strong>${escHtml(r.topic || '(未知)')}</strong></td>
            <td>${escHtml(r.username || `user_${r.user_id}`)}</td>
            <td>${r.total_areas}</td>
            <td><span class="pc-depth-badge" style="background:${depthColor};">L${r.max_depth}</span></td>
            <td>${r.total_messages}</td>
            <td style="color:#909399;font-size:12px;">${r.steps}</td>
            <td>${statusHtml}</td>
            <td style="color:#909399;font-size:12px;white-space:nowrap;">${time}</td>
            <td><span class="pc-overview-cell">${hasPreview ? escHtml(r.overview_preview.slice(0, 80)) + '…' : '—'}</span></td>
        </tr>`;
    });

    html += '</tbody></table>';
    body.innerHTML = html;

    // 点击行展开/收起检查点详情
    body.querySelectorAll('.pc-table tbody tr').forEach(row => {
        if (row.classList.contains('pc-preview-row')) return;
        const tid = row.dataset.threadId;
        if (!tid) return;
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => toggleDetail(tid, row, body));
    });
}

// ============================================================
//  检查点详情面板
// ============================================================

async function toggleDetail(threadId, row, container) {
    // 如果已展开当前行，则收起
    if (_expandedRow === threadId) {
        closeDetail(row);
        return;
    }

    // 收起之前的展开行
    if (_expandedRow) {
        const prevRow = container.querySelector(`tr[data-thread-id="${_expandedRow}"]`);
        if (prevRow) closeDetail(prevRow);
    }

    // 插入详情行
    const detailRow = document.createElement('tr');
    detailRow.className = 'pc-detail-row';
    detailRow.dataset.threadId = threadId;
    const td = document.createElement('td');
    td.colSpan = 10;
    td.innerHTML = '<div class="pc-detail-loading">🔄 加载检查点数据...</div>';
    detailRow.appendChild(td);
    row.parentNode.insertBefore(detailRow, row.nextSibling);
    row.classList.add('pc-row-expanded');
    _expandedRow = threadId;

    try {
        let detail = _detailCache[threadId];
        if (!detail) {
            detail = await api(`/admin/plan-checkpoints/${encodeURIComponent(threadId)}`);
            _detailCache[threadId] = detail;
        }
        td.innerHTML = renderDetailContent(detail);
    } catch (err) {
        td.innerHTML = `<div class="pc-detail-error">⚠️ 加载失败: ${escHtml(err.message)}</div>`;
    }
}

function closeDetail(row) {
    const detailRow = row.parentNode.querySelector(`tr.pc-detail-row[data-thread-id="${_expandedRow}"]`);
    if (detailRow) detailRow.remove();
    row.classList.remove('pc-row-expanded');
    _expandedRow = null;
}

function renderDetailContent(detail) {
    const { thread_id, checkpoints, writes } = detail;
    const totalCP = checkpoints.length;
    const totalWrites = writes.length;

    let html = `<div class="pc-detail-container">
        <div class="pc-detail-header">
            <div class="pc-detail-title">检查点详情</div>
            <div class="pc-detail-meta">
                <span class="pc-detail-meta-item">📌 ${escHtml(thread_id)}</span>
                <span class="pc-detail-meta-item">📦 ${totalCP} 个检查点</span>
                <span class="pc-detail-meta-item">✏️ ${totalWrites} 条写入</span>
                <a href="/api/admin/plan-checkpoints/${encodeURIComponent(thread_id)}" target="_blank" class="pc-detail-raw-link">查看原始 JSON</a>
            </div>
        </div>`;

    // 分组 writes 按 checkpoint_id
    const writesByCP = {};
    for (const w of writes) {
        (writesByCP[w.checkpoint_id] = writesByCP[w.checkpoint_id] || []).push(w);
    }

    // 渲染每个检查点
    for (let i = 0; i < checkpoints.length; i++) {
        const cp = checkpoints[i];
        const cpWrites = writesByCP[cp.checkpoint_id] || [];

        html += `<div class="pc-cp-card">
            <div class="pc-cp-card-header" onclick="toggleCPBody(this)">
                <div class="pc-cp-card-title">
                    <span class="pc-cp-step-badge">#${cp.step}</span>
                    <span class="pc-cp-source-badge pc-cp-source-${cp.source}">${cp.source}</span>
                    <code class="pc-cp-id">${cp.checkpoint_id}</code>
                </div>
                <div class="pc-cp-card-meta">
                    <span>parent: <code>${cp.parent_checkpoint_id || '—'}</code></span>
                    <span>${cpWrites.length} 条写入</span>
                    <span class="pc-cp-toggle-icon">▼</span>
                </div>
            </div>
            <div class="pc-cp-card-body" style="display:${i === checkpoints.length - 1 ? '' : 'none'};">`;

        // Channel values
        const cvKeys = Object.keys(cp.channel_values);
        if (cvKeys.length > 0) {
            html += '<div class="pc-cp-section"><div class="pc-cp-section-title">📊 Channel Values</div><table class="pc-cp-table">';
            for (const key of cvKeys.sort()) {
                const val = cp.channel_values[key];
                const valStr = formatValue(val);
                html += `<tr><td class="pc-cp-key">${escHtml(key)}</td><td class="pc-cp-val">${valStr}</td></tr>`;
            }
            html += '</table></div>';
        }

        // Writes for this checkpoint
        if (cpWrites.length > 0) {
            html += '<div class="pc-cp-section"><div class="pc-cp-section-title">✏️ Writes</div><table class="pc-cp-table">';
            for (const w of cpWrites) {
                const valStr = formatValue(w.value);
                const taskShort = w.task_id ? w.task_id.substring(0, 8) + '…' : '—';
                html += `<tr>
                    <td class="pc-cp-key">${escHtml(w.channel)}</td>
                    <td class="pc-cp-val">${valStr}
                        <span class="pc-cp-task-id">task: ${escHtml(taskShort)}</span>
                    </td>
                </tr>`;
            }
            html += '</table></div>';
        }

        html += `</div></div>`; // cp-card-body + cp-card
    }

    html += '</div>';
    return html;
}

function toggleCPBody(headerEl) {
    const body = headerEl.parentNode.querySelector('.pc-cp-card-body');
    const icon = headerEl.querySelector('.pc-cp-toggle-icon');
    if (!body) return;
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? '' : 'none';
    if (icon) icon.textContent = isHidden ? '▼' : '▶';
}

function formatValue(val) {
    if (val === null || val === undefined) return '<span class="pc-cp-null">null</span>';
    if (typeof val === 'string') {
        if (val.length > 500) return `<pre class="pc-cp-pre">${escHtml(val.slice(0, 500))}…</pre>`;
        return `<pre class="pc-cp-pre">${escHtml(val)}</pre>`;
    }
    if (typeof val === 'boolean') return `<span class="pc-cp-bool">${val}</span>`;
    if (typeof val === 'number') return `<span class="pc-cp-num">${val}</span>`;
    try {
        const json = JSON.stringify(val, null, 2);
        if (json.length > 1000) return `<pre class="pc-cp-pre">${escHtml(json.slice(0, 1000))}…</pre>`;
        return `<pre class="pc-cp-pre">${escHtml(json)}</pre>`;
    } catch {
        return `<pre class="pc-cp-pre">${escHtml(String(val))}</pre>`;
    }
}

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
        document.getElementById('pcUserBadge').textContent = currentUser.username;
        loadPlanRuns();
    } else {
        window.location.href = '/static/index.html';
    }

    // 刷新按钮
    document.getElementById('pcRefreshBtn').addEventListener('click', () => {
        _detailCache = {};
        loadPlanRuns();
    });
    document.getElementById('logoutBtn').addEventListener('click', logout);
}

boot();
