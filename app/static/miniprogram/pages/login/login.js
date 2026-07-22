/**
 * 微信小程序一键登录页面（移除用户名密码注册）
 */
const auth = require('../../utils/auth')
const api = require('../../utils/api')
const { showToast } = require('../../utils/util')

Page({
  data: {
    loggingIn: false,
    showConfig: false,
    serverUrl: 'http://localhost:8000',
  },

  onLoad() {
    // 检查是否已登录
    if (auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/home/home' })
      return
    }
    // 读取保存的服务器地址
    const savedUrl = wx.getStorageSync('baseUrl')
    if (savedUrl) {
      this.setData({ serverUrl: savedUrl })
    }
  },

  /** 微信一键登录 */
  onWechatLogin() {
    if (this.data.loggingIn) return
    this.setData({ loggingIn: true })
    wx.showLoading({ title: '登录中...', mask: true })

    wx.login({
      success: (res) => {
        if (res.code) {
          auth.wechatLogin(res.code)
            .then(() => {
              wx.hideLoading()
              showToast('登录成功', 'success')
              setTimeout(() => {
                wx.redirectTo({ url: '/pages/home/home' })
              }, 500)
            })
            .catch(err => {
              wx.hideLoading()
              this.setData({ loggingIn: false })
              showToast(err.message || '登录失败，请重试')
            })
        } else {
          wx.hideLoading()
          this.setData({ loggingIn: false })
          showToast('获取微信登录凭证失败')
        }
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ loggingIn: false })
        showToast('微信登录失败，请检查网络')
      }
    })
  },

  /** 显示服务器配置 */
  showServerConfig() {
    this.setData({ showConfig: true })
  },

  hideServerConfig() {
    this.setData({ showConfig: false })
  },

  onServerUrlInput(e) {
    this.setData({ serverUrl: e.detail.value })
  },

  onSaveServerConfig() {
    const url = this.data.serverUrl.trim()
    if (!url) {
      showToast('请输入有效的服务器地址')
      return
    }
    const app = getApp()
    app.setBaseUrl(url)
    this.setData({ showConfig: false })
    showToast('服务器地址已保存')
  },

  stopPropagation() {
    // 阻止事件冒泡
  },

  preventMove() {
    // 阻止滚动穿透
  }
})
