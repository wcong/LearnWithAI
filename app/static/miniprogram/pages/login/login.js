/**
 * 登录注册页面
 */
const auth = require('../../utils/auth')
const api = require('../../utils/api')
const { showToast, hideLoading } = require('../../utils/util')

Page({
  data: {
    isLogin: true,
    username: '',
    password: '',
    confirmPassword: '',
    errorMsg: '',
    submitting: false,
    showConfig: false,
    serverUrl: 'http://localhost:8000'
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

  switchToLogin() {
    this.setData({
      isLogin: true,
      errorMsg: ''
    })
  },

  switchToRegister() {
    this.setData({
      isLogin: false,
      errorMsg: ''
    })
  },

  onUsernameInput(e) {
    this.setData({ username: e.detail.value, errorMsg: '' })
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value, errorMsg: '' })
  },

  onConfirmPasswordInput(e) {
    this.setData({ confirmPassword: e.detail.value, errorMsg: '' })
  },

  onSubmit() {
    const { isLogin, username, password, confirmPassword, submitting } = this.data
    if (submitting) return

    // 表单验证
    if (!username.trim()) {
      this.setData({ errorMsg: '请输入用户名' })
      return
    }
    if (!password) {
      this.setData({ errorMsg: '请输入密码' })
      return
    }
    if (!isLogin && password !== confirmPassword) {
      this.setData({ errorMsg: '两次密码输入不一致' })
      return
    }
    if (!isLogin && password.length < 6) {
      this.setData({ errorMsg: '密码长度至少 6 位' })
      return
    }

    this.setData({ submitting: true, errorMsg: '' })
    wx.showLoading({ title: isLogin ? '登录中...' : '注册中...', mask: true })

    const promise = isLogin
      ? auth.login(username, password)
      : auth.register(username, password)

    promise
      .then(() => {
        wx.hideLoading()
        showToast(isLogin ? '登录成功' : '注册成功', 'success')
        setTimeout(() => {
          wx.redirectTo({ url: '/pages/home/home' })
        }, 500)
      })
      .catch(err => {
        wx.hideLoading()
        this.setData({
          submitting: false,
          errorMsg: err.message || '操作失败，请重试'
        })
      })
  },

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
