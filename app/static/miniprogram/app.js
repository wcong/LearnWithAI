App({
  globalData: {
    token: null,
    userInfo: null,
    baseUrl: 'http://localhost:8000',
    selectedAreaId: null,
    areaTree: [],
    statusBarHeight: 20
  },

  onLaunch() {
    const token = wx.getStorageSync('token')
    const userInfo = wx.getStorageSync('userInfo')
    if (token) {
      this.globalData.token = token
      this.globalData.userInfo = userInfo
    }
    // 读取状态栏高度（确保最小 20px，避免模拟器返回 0 导致按钮被遮挡）
    try {
      const systemInfo = wx.getSystemInfoSync()
      this.globalData.statusBarHeight = Math.max(systemInfo.statusBarHeight || 0, 20)
    } catch (e) {
      this.globalData.statusBarHeight = 20
    }
  },

  setToken(token) {
    this.globalData.token = token
    wx.setStorageSync('token', token)
  },

  setUserInfo(userInfo) {
    this.globalData.userInfo = userInfo
    wx.setStorageSync('userInfo', userInfo)
  },

  logout() {
    this.globalData.token = null
    this.globalData.userInfo = null
    wx.removeStorageSync('token')
    wx.removeStorageSync('userInfo')
    wx.removeStorageSync('areaTree')
  },

  getBaseUrl() {
    return this.globalData.baseUrl
  },

  setBaseUrl(url) {
    this.globalData.baseUrl = url
    wx.setStorageSync('baseUrl', url)
  }
})
