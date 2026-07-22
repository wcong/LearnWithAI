/**
 * 通用工具函数
 */

/**
 * HTML 转义，防止 XSS
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
function escHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * 简单的 Markdown 转 HTML（仅支持基础语法）
 * @param {string} md - Markdown 文本
 * @returns {string} HTML 文本
 */
function mdToHtml(md) {
  if (!md) return ''
  let html = escHtml(md)
  // 代码块
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  // 加粗
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // 列表
  html = html.replace(/^- (.+)/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  // 换行
  html = html.replace(/\n/g, '<br>')
  return html
}

/**
 * 格式化日期时间
 * @param {string|Date} dateStr - 日期字符串或 Date 对象
 * @param {boolean} showTime - 是否显示时分
 * @returns {string} 格式化后的日期
 */
function formatDate(dateStr, showTime = false) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return String(dateStr)

  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  if (showTime) {
    return `${month}-${day} ${hours}:${minutes}`
  }
  return `${month}-${day}`
}

/**
 * 防抖函数
 * @param {function} fn - 要防抖的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {function} 防抖后的函数
 */
function debounce(fn, delay = 300) {
  let timer = null
  return function (...args) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn.apply(this, args)
      timer = null
    }, delay)
  }
}

/**
 * 节流函数
 * @param {function} fn - 要节流的函数
 * @param {number} interval - 间隔时间（毫秒）
 * @returns {function} 节流后的函数
 */
function throttle(fn, interval = 300) {
  let lastTime = 0
  return function (...args) {
    const now = Date.now()
    if (now - lastTime >= interval) {
      lastTime = now
      fn.apply(this, args)
    }
  }
}

/**
 * 截断文本
 * @param {string} text - 原始文本
 * @param {number} maxLen - 最大长度
 * @returns {string} 截断后的文本
 */
function truncate(text, maxLen = 100) {
  if (!text) return ''
  if (text.length <= maxLen) return text
  return text.substring(0, maxLen) + '...'
}

/**
 * 显示 Toast 提示
 * @param {string} title - 提示内容
 * @param {'success'|'error'|'none'} icon - 图标类型
 */
function showToast(title, icon = 'none') {
  wx.showToast({
    title,
    icon,
    duration: 2000
  })
}

/**
 * 显示加载中
 * @param {string} title - 加载提示文字
 */
function showLoading(title = '加载中...') {
  wx.showLoading({ title, mask: true })
}

/**
 * 隐藏加载中
 */
function hideLoading() {
  wx.hideLoading()
}

/**
 * 生成唯一 ID（用于消息临时标识）
 * @returns {string}
 */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
}

module.exports = {
  escHtml,
  mdToHtml,
  formatDate,
  debounce,
  throttle,
  truncate,
  showToast,
  showLoading,
  hideLoading,
  genId
}
