/**
 * 认证管理模块
 * 处理微信登录、Token 管理、登录态检查
 */
const api = require('./api')

/**
 * 微信小程序一键登录
 * @param {string} code - wx.login 获取的临时 code
 * @returns {Promise<object>} { token, user_id, username }
 */
function wechatLogin(code) {
  return api.post('/api/auth/wechat-login', { code }).then(data => {
    // 保存认证信息
    wx.setStorageSync('token', data.token || data.access_token)
    wx.setStorageSync('userInfo', {
      user_id: data.user_id,
      username: data.username,
      nickname: data.nickname || ''
    })
    // 更新全局数据
    const app = getApp()
    app.setToken(data.token || data.access_token)
    app.setUserInfo({
      user_id: data.user_id,
      username: data.username,
      nickname: data.nickname || ''
    })
    return data
  })
}

/**
 * 退出登录
 */
function logout() {
  wx.removeStorageSync('token')
  wx.removeStorageSync('userInfo')
  wx.removeStorageSync('areaTree')
  const app = getApp()
  app.logout()
  // 跳转到登录页
  wx.reLaunch({ url: '/pages/login/login' })
}

/**
 * 检查是否已登录
 * @returns {boolean}
 */
function isLoggedIn() {
  const token = wx.getStorageSync('token')
  return !!token
}

/**
 * 获取当前 Token
 * @returns {string|null}
 */
function getToken() {
  return wx.getStorageSync('token') || null
}

/**
 * 获取当前用户信息
 * @returns {object|null}
 */
function getUserInfo() {
  return wx.getStorageSync('userInfo') || null
}

/**
 * 页面登录态检查（在页面 onShow 中调用）
 * 未登录时跳转登录页
 */
function checkLogin() {
  if (!isLoggedIn()) {
    wx.redirectTo({ url: '/pages/login/login' })
    return false
  }
  return true
}

module.exports = {
  wechatLogin,
  logout,
  isLoggedIn,
  getToken,
  getUserInfo,
  checkLogin
}
