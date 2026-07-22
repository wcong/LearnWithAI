/**
 * 首页导航页面
 */
const auth = require('../../utils/auth')
const util = require('../../utils/util')

Page({
  data: {
    username: ''
  },

  onShow() {
    // 检查登录态
    if (!auth.checkLogin()) return

    const userInfo = auth.getUserInfo()
    if (userInfo) {
      this.setData({ username: userInfo.username })
    }
  },

  onLoad() {
    if (auth.isLoggedIn()) {
      const userInfo = auth.getUserInfo()
      if (userInfo) {
        this.setData({ username: userInfo.username })
      }
    }
  },

  navigateTo(e) {
    const page = e.currentTarget.dataset.page
    const pathMap = {
      domain: '/pages/domain/domain',
      notes: '/pages/notes/notes',
      skills: '/pages/skills/skills',
      plan: '/pages/plan/plan'
    }
    const url = pathMap[page]
    if (url) {
      wx.navigateTo({ url })
    }
  },

  goToDomain() {
    wx.navigateTo({ url: '/pages/domain/domain' })
  },

  goToNotes() {
    wx.navigateTo({ url: '/pages/notes/notes' })
  },

  goToPlan() {
    wx.navigateTo({ url: '/pages/plan/plan' })
  },

  goToSkills() {
    wx.navigateTo({ url: '/pages/skills/skills' })
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      confirmColor: '#f56c6c',
      success(res) {
        if (res.confirm) {
          auth.logout()
        }
      }
    })
  }
})
