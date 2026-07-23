// ============================================================
// LearnWithAI Mobile – 共享工具函数
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
    token = '';
    currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
}

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function autoResizeTextarea(el) {
    el.style.height = 'auto';
    const minH = el.dataset.minH || (el.dataset.minH = el.scrollHeight + 'px');
    el.style.height = Math.max(parseInt(minH), el.scrollHeight) + 'px';
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
//  查找树节点
// ============================================================

function findNodeById(roots, id) {
    for (const r of roots) {
        if (r.id === id) return r;
        if (r.children) {
            const f = findNodeById(r.children, id);
            if (f) return f;
        }
    }
    return null;
}

// ============================================================
//  Token 限额弹窗（移动端动态创建）
// ============================================================

function _ensureTokenLimitStyles() {
    if (document.getElementById('mobileTokenLimitStyle')) return;
    const style = document.createElement('style');
    style.id = 'mobileTokenLimitStyle';
    style.textContent = `
        .mobile-token-overlay {
            position:fixed; inset:0; background:rgba(0,0,0,0.45);
            z-index:9999; display:flex; align-items:center; justify-content:center;
        }
        .mobile-token-modal {
            background:#fff; border-radius:12px; width:88%; max-width:340px;
            box-shadow:0 12px 40px rgba(0,0,0,.15); overflow:hidden;
        }
        .mobile-token-header {
            display:flex; justify-content:space-between; align-items:center;
            padding:16px 18px; border-bottom:1px solid #eef0f4;
        }
        .mobile-token-label { font-size:15px; font-weight:600; color:#303133; }
        .mobile-token-close {
            width:28px; height:28px; border:none; background:#f5f7fa;
            border-radius:50%; font-size:14px; cursor:pointer;
            display:flex; align-items:center; justify-content:center; color:#909399;
        }
        .mobile-token-body { padding:16px 18px; }
        .mobile-token-details { margin-top:12px; }
        .mobile-limit-row { display:flex; justify-content:space-between; padding:6px 0; font-size:13px; }
        .mobile-limit-row .label { color:#909399; }
        .mobile-limit-row .value { font-weight:600; }
        .mobile-limit-row .value.over { color:#e6a23c; }
        .mobile-token-footer { padding:12px 18px; border-top:1px solid #eef0f4; text-align:center; }
        .mobile-token-btn {
            width:100%; padding:10px; border:none; border-radius:8px;
            background:#409eff; color:#fff; font-size:14px; cursor:pointer;
        }
    `;
    document.head.appendChild(style);
}

function showTokenLimitPanel(detail) {
    _ensureTokenLimitStyles();
    // 如果已有弹窗则复用
    let overlay = document.getElementById('mobileTokenLimitOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'mobile-token-overlay';
        overlay.id = 'mobileTokenLimitOverlay';
        overlay.innerHTML = `
            <div class="mobile-token-modal">
                <div class="mobile-token-header">
                    <span class="mobile-token-label">⚠️ 免费 Token 额度已用尽</span>
                    <button class="mobile-token-close" id="mobileBtnCloseTokenLimit">✕</button>
                </div>
                <div class="mobile-token-body" id="mobileTokenLimitBody">
                    <p style="font-size:14px;color:#333;margin-bottom:12px;">您今日的免费 Token 额度已用尽，请明天再来。</p>
                    <div class="mobile-token-details" id="mobileTokenLimitDetails"></div>
                </div>
                <div class="mobile-token-footer">
                    <button class="mobile-token-btn" id="mobileBtnCloseTokenLimitFooter">我知道了</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        document.getElementById('mobileBtnCloseTokenLimit').addEventListener('click', closeTokenLimitPanel);
        document.getElementById('mobileBtnCloseTokenLimitFooter').addEventListener('click', closeTokenLimitPanel);
        overlay.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeTokenLimitPanel();
        });
    }

    const detailsEl = document.getElementById('mobileTokenLimitDetails');
    if (detail && detail.used_prompt !== undefined) {
        detailsEl.innerHTML =
            '<div class="mobile-limit-row"><span class="label">今日已用输入 Token</span><span class="value over">' +
            (detail.used_prompt || 0).toLocaleString() + '</span></div>' +
            '<div class="mobile-limit-row"><span class="label">今日已用输出 Token</span><span class="value over">' +
            (detail.used_completion || 0).toLocaleString() + '</span></div>' +
            '<div class="mobile-limit-row"><span class="label">每日输入 Token 限额</span><span class="value">' +
            (detail.limit_prompt || 200000).toLocaleString() + '</span></div>' +
            '<div class="mobile-limit-row"><span class="label">每日输出 Token 限额</span><span class="value">' +
            (detail.limit_output || 200000).toLocaleString() + '</span></div>';
    } else {
        detailsEl.innerHTML = '<p style="color:#909399;text-align:center;margin:0;">详情暂不可用</p>';
    }
    overlay.style.display = 'flex';
}

function closeTokenLimitPanel() {
    const overlay = document.getElementById('mobileTokenLimitOverlay');
    if (overlay) overlay.style.display = 'none';
}
