/**
 * API 封装模块
 * 统一封装 wx.request，自动附加 JWT Token 和基础 URL
 */

/** 动态获取基础 URL（从 storage 读取，而非模块加载时缓存） */
function getBaseUrl() {
  return wx.getStorageSync('baseUrl') || 'http://localhost:8000'
}

/**
 * 发送 HTTP 请求
 * @param {string} method - 请求方法 GET/POST/PATCH/DELETE
 * @param {string} path - API 路径（不含基础 URL）
 * @param {object} data - 请求体数据
 * @param {object} options - 额外选项
 * @returns {Promise}
 */
function request(method, path, data = null, options = {}) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token')
    const header = {
      'Content-Type': 'application/json'
    }
    if (token) {
      header['Authorization'] = `Bearer ${token}`
    }
    // 合并自定义 headers
    if (options.headers) {
      Object.assign(header, options.headers)
    }

    const url = getBaseUrl() + path
    const reqData = data !== null ? JSON.stringify(data) : undefined

    console.debug(`[API] ${method} ${path}`, data || '')

    wx.request({
      url,
      method,
      data: reqData,
      header,
      enableChunked: !!options.enableChunked,
      enableHttp2: true,
      enableQuic: true,
      success(res) {
        console.debug(`[API] ${method} ${path} -> ${res.statusCode}`)
        if (res.statusCode === 401) {
          // Token 过期或无效，跳转登录
          wx.removeStorageSync('token')
          wx.removeStorageSync('userInfo')
          wx.redirectTo({ url: '/pages/login/login' })
          reject(new Error('登录已过期，请重新登录'))
          return
        }
        if (res.statusCode === 429) {
          const msg = res.data?.detail?.message || '今日免费 Token 额度已用尽，请明天再来'
          wx.showModal({ title: '⚠️ 额度用尽', content: msg, showCancel: false })
          reject(new Error(msg))
          return
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else {
          const errMsg = res.data?.detail || res.data?.message || `请求失败(${res.statusCode})`
          reject(new Error(errMsg))
        }
      },
      fail(err) {
        console.error(`[API] ${method} ${path} FAIL`, err)
        reject(new Error('网络请求失败，请检查网络连接'))
      }
    })
  })
}

/**
 * SSE 流式请求
 * 使用 wx.request + enableChunked 实现
 * @param {string} path - API 路径
 * @param {object} body - 请求体
 * @param {object} handlers - 事件处理函数 { onThinking, onToolCall, onResult, onDone, onError }
 * @returns {Promise}
 */
function streamRequest(path, body, handlers) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token')
    const url = getBaseUrl() + path
    let buffer = ''
    let isResolved = false

    const requestTask = wx.request({
      url,
      method: 'POST',
      data: JSON.stringify(body),
      header: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      enableChunked: true,
      enableHttp2: true,
      enableQuic: true,
      responseType: 'text',
      success(res) {
        if (!isResolved) {
          isResolved = true
          if (res.statusCode === 429) {
            const msg = res.data?.detail?.message || '今日免费 Token 额度已用尽，请明天再来'
            wx.showModal({ title: '⚠️ 额度用尽', content: msg, showCancel: false })
            reject(new Error(msg))
          } else if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data)
          } else {
            reject(new Error(res.data?.detail || `请求失败(${res.statusCode})`))
          }
        }
      },
      fail(err) {
        if (!isResolved) {
          isResolved = true
          reject(new Error('流式请求失败'))
        }
      }
    })

    requestTask.onChunkReceived(response => {
      const arrayBuffer = response.data
      const uint8Array = new Uint8Array(arrayBuffer)
      const text = decodeURIComponent(
        Array.from(uint8Array)
          .map(b => '%' + b.toString(16).padStart(2, '0'))
          .join('')
      )
      // 处理可能的解码问题，直接使用 TextDecoder 风格
      let chunk = ''
      for (let i = 0; i < uint8Array.length; i++) {
        chunk += String.fromCharCode(uint8Array[i])
      }
      // 尝试 UTF-8 解码
      try {
        chunk = decodeURIComponent(
          Array.from(uint8Array)
            .map(b => '%' + b.toString(16).padStart(2, '0').toUpperCase())
            .join('')
        )
      } catch (e) {
        // fallback: 逐字节解析 UTF-8
        chunk = ''
        let i = 0
        while (i < uint8Array.length) {
          const byte1 = uint8Array[i]
          if (byte1 < 0x80) {
            chunk += String.fromCharCode(byte1)
            i++
          } else if (byte1 >= 0xC0 && byte1 < 0xE0 && i + 1 < uint8Array.length) {
            const byte2 = uint8Array[i + 1]
            if ((byte2 & 0xC0) === 0x80) {
              chunk += String.fromCharCode(((byte1 & 0x1F) << 6) | (byte2 & 0x3F))
              i += 2
            } else {
              chunk += String.fromCharCode(byte1)
              i++
            }
          } else if (byte1 >= 0xE0 && byte1 < 0xF0 && i + 2 < uint8Array.length) {
            const byte2 = uint8Array[i + 1]
            const byte3 = uint8Array[i + 2]
            if ((byte2 & 0xC0) === 0x80 && (byte3 & 0xC0) === 0x80) {
              chunk += String.fromCharCode(((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F))
              i += 3
            } else {
              chunk += String.fromCharCode(byte1)
              i++
            }
          } else {
            chunk += String.fromCharCode(byte1)
            i++
          }
        }
      }

      buffer += chunk

      // 按 SSE 格式解析：双换行分割
      const parts = buffer.split('\n\n')
      // 最后一部分可能不完整，保留到下一次
      buffer = parts.pop() || ''

      for (const part of parts) {
        if (!part.trim()) continue
        parseSSELine(part.trim(), handlers, requestTask)
      }
    })
  })
}

/**
 * 解析单条 SSE 消息
 */
function parseSSELine(text, handlers, requestTask) {
  const lines = text.split('\n')
  let eventType = 'message'
  let dataLines = []

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.substring(7).trim()
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.substring(6))
    } else if (line.startsWith('data:')) {
      dataLines.push(line.substring(5))
    }
  }

  if (dataLines.length === 0) return

  const dataStr = dataLines.join('\n')
  let data
  try {
    data = JSON.parse(dataStr)
  } catch (e) {
    console.warn('[SSE] 解析数据失败:', dataStr)
    return
  }

  switch (eventType) {
    case 'thinking':
      handlers.onThinking && handlers.onThinking(data)
      break
    case 'tool_call':
      handlers.onToolCall && handlers.onToolCall(data)
      break
    case 'result':
      handlers.onResult && handlers.onResult(data)
      break
    case 'error':
      handlers.onError && handlers.onError(data.detail || '未知错误')
      break
    case 'done':
      handlers.onDone && handlers.onDone(data)
      break
    default:
      // message 类型或未知事件，尝试按 result 处理
      if (data.reply || data.chunk) {
        handlers.onResult && handlers.onResult(data)
      }
      break
  }
}

/**
 * 构建带查询参数的 URL
 */
function buildUrl(path, params = {}) {
  const query = Object.entries(params)
    .filter(([_, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return query ? `${path}?${query}` : path
}

module.exports = {
  // GET 请求
  get(path, params = {}, options = {}) {
    return request('GET', buildUrl(path, params), null, options)
  },
  // POST 请求
  post(path, data = {}, options = {}) {
    return request('POST', path, data, options)
  },
  // PATCH 请求
  patch(path, data = {}, options = {}) {
    return request('PATCH', path, data, options)
  },
  // PUT 请求
  put(path, data = {}, options = {}) {
    return request('PUT', path, data, options)
  },
  // DELETE 请求
  delete(path, options = {}) {
    return request('DELETE', path, null, options)
  },
  // SSE 流式请求
  stream: streamRequest,
  // 获取基础 URL
  getBaseUrl
}
