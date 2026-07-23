/**
 * SSE 流式解析器
 * 封装基于 wx.request enableChunked 的 SSE 流式请求
 *
 * 支持事件类型：
 *   - thinking: AI 思考过程片段
 *   - tool_call: AI 工具调用
 *   - result: 最终结果回复
 *   - done: 流完成
 *   - error: 错误
 */

/**
 * 创建 SSE 流式连接
 * @param {object} options
 * @param {string} options.url - 请求 URL
 * @param {object} options.data - 请求体
 * @param {function} options.onThinking - thinking 事件回调 (data)
 * @param {function} options.onToolCall - tool_call 事件回调 (data)
 * @param {function} options.onResult - result 事件回调 (data)
 * @param {function} options.onDone - done 事件回调 (data)
 * @param {function} options.onError - error 事件回调 (msg)
 * @param {function} options.onComplete - 流完成（无论成功或失败）
 * @returns {object} { abort } - 返回中止函数
 */
function createSSEConnection(options) {
  const {
    url,
    data,
    onThinking,
    onToolCall,
    onResult,
    onDone,
    onError,
    onComplete
  } = options

  const token = wx.getStorageSync('token')
  let buffer = ''
  let aborted = false

  const requestTask = wx.request({
    url,
    method: 'POST',
    data: JSON.stringify(data),
    header: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    enableChunked: true,
    enableHttp2: true,
    responseType: 'arraybuffer',
    success(res) {
      // 检查 429（token 耗尽）
      if (res && res.statusCode === 429) {
        const detail = typeof res.data === 'object' ? res.data?.detail : null
        const msg = detail?.message || '今日免费 Token 额度已用尽，请明天再来'
        wx.showModal({ title: '⚠️ 额度用尽', content: msg, showCancel: false })
        onError && onError(msg)
        onComplete && onComplete()
        return
      }
      // 流正常结束
      if (!aborted) {
        onComplete && onComplete()
      }
    },
    fail(err) {
      if (!aborted) {
        onError && onError('连接中断: ' + (err.errMsg || '网络异常'))
        onComplete && onComplete()
      }
    }
  })

  // 注册 chunk 接收回调
  requestTask.onChunkReceived(response => {
    if (aborted) return
    const arrayBuffer = response.data
    const uint8Array = new Uint8Array(arrayBuffer)
    const chunk = decodeUTF8(uint8Array)
    buffer += chunk
    processBuffer(handlers)
  })

  const handlers = {
    onThinking,
    onToolCall,
    onResult,
    onDone,
    onError
  }

  /**
   * 处理缓冲区中的 SSE 数据
   */
  function processBuffer(h) {
    const parts = buffer.split('\n\n')
    // 最后一个片段可能不完整，保留
    buffer = parts.pop() || ''

    for (const part of parts) {
      if (!part.trim()) continue
      parseEvent(part.trim(), h)
    }
  }

  /**
   * 解析单个 SSE 事件
   */
  function parseEvent(text, h) {
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
    let parsedData
    try {
      parsedData = JSON.parse(dataStr)
    } catch (e) {
      console.warn('[SSE] 数据解析失败:', dataStr.slice(0, 100))
      return
    }

    switch (eventType) {
      case 'thinking':
        h.onThinking && h.onThinking(parsedData)
        break
      case 'tool_call':
        h.onToolCall && h.onToolCall(parsedData)
        break
      case 'result':
        if (parsedData.reply) {
          h.onResult && h.onResult(parsedData)
        }
        break
      case 'error':
        h.onError && h.onError(parsedData.detail || '服务端错误')
        break
      case 'done':
        h.onDone && h.onDone(parsedData)
        break
      default:
        // 通用事件，尝试按 result 处理
        if (parsedData.reply || parsedData.chunk) {
          h.onResult && h.onResult(parsedData)
        }
        break
    }
  }

  /**
   * 中止 SSE 连接
   */
  function abort() {
    if (!aborted) {
      aborted = true
      requestTask.abort()
      onComplete && onComplete()
    }
  }

  return { abort }
}

/**
 * UTF-8 解码 Uint8Array
 */
function decodeUTF8(uint8Array) {
  // 使用 escape/unescape 方式解码 UTF-8
  let binary = ''
  for (let i = 0; i < uint8Array.length; i++) {
    binary += '%' + uint8Array[i].toString(16).padStart(2, '0').toUpperCase()
  }
  try {
    return decodeURIComponent(binary)
  } catch (e) {
    // fallback 手动解码
    let result = ''
    let i = 0
    while (i < uint8Array.length) {
      const b = uint8Array[i]
      if (b < 0x80) {
        result += String.fromCharCode(b)
        i++
      } else if (b >= 0xC0 && b < 0xE0 && i + 1 < uint8Array.length) {
        const b2 = uint8Array[i + 1]
        if ((b2 & 0xC0) === 0x80) {
          result += String.fromCharCode(((b & 0x1F) << 6) | (b2 & 0x3F))
          i += 2
        } else { result += String.fromCharCode(b); i++ }
      } else if (b >= 0xE0 && b < 0xF0 && i + 2 < uint8Array.length) {
        const b2 = uint8Array[i + 1]; const b3 = uint8Array[i + 2]
        if ((b2 & 0xC0) === 0x80 && (b3 & 0xC0) === 0x80) {
          result += String.fromCharCode(((b & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F))
          i += 3
        } else { result += String.fromCharCode(b); i++ }
      } else {
        result += String.fromCharCode(b)
        i++
      }
    }
    return result
  }
}

module.exports = {
  createSSEConnection
}
