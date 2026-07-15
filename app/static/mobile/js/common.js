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
