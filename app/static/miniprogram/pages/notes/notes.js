/**
 * 笔记管理页面
 */
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const tree = require('../../utils/tree')
const util = require('../../utils/util')

Page({
  data: {
    areaTree: [],
    currentAreaId: null,
    currentAreaName: '',
    drawerOpen: false,
    noteContent: '',
    editContent: '',
    editing: false,
    hasChange: false,
    saving: false,
    loading: false
  },

  onLoad() {
    if (!auth.checkLogin()) return
    const app = getApp()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    this.loadAreaTree()
    this.loadSavedState()
  },

  loadSavedState() {
    const saved = wx.getStorageSync('notesState')
    if (saved) {
      try {
        const state = JSON.parse(saved)
        if (state.currentAreaId && state.currentAreaId !== this.data.currentAreaId) {
          this.setData({ currentAreaId: state.currentAreaId })
        }
      } catch (e) {}
    }
  },

  saveCurrentState() {
    if (this.data.currentAreaId) {
      wx.setStorageSync('notesState', JSON.stringify({
        currentAreaId: this.data.currentAreaId
      }))
    }
  },

  loadAreaTree() {
    api.get('/api/areas/tree')
      .then(data => {
        const treeData = data || []
        this.expandTree(treeData)
        this.setData({ areaTree: treeData })
        // 恢复选中状态
        if (this.data.currentAreaId) {
          const node = tree.findNodeById(treeData, this.data.currentAreaId)
          if (node) {
            this.setData({ currentAreaName: node.name })
            this.loadNoteContent()
          }
        }
      })
      .catch(() => {})
  },

  expandTree(nodes) {
    if (!nodes) return
    for (const node of nodes) {
      node.expanded = true
      if (node.children) this.expandTree(node.children)
    }
  },

  onAreaSelect(e) {
    const { node } = e.detail
    if (!node) return
    this.setData({
      currentAreaId: node.id,
      currentAreaName: node.name,
      drawerOpen: false,
      editing: false,
      hasChange: false,
      noteContent: '',
      editContent: ''
    })
    this.loadNoteContent()
    this.saveCurrentState()
  },

  toggleDrawer() {
    this.setData({ drawerOpen: !this.data.drawerOpen })
  },

  closeDrawer() {
    this.setData({ drawerOpen: false })
  },

  loadNoteContent() {
    if (!this.data.currentAreaId) return
    this.setData({ loading: true })
    api.get(`/api/notes/${this.data.currentAreaId}`)
      .then(data => {
        this.setData({
          noteContent: data.content || '',
          editContent: data.content || '',
          loading: false
        })
      })
      .catch(() => {
        this.setData({ loading: false })
      })
  },

  switchToView() {
    if (this.data.hasChange) {
      wx.showModal({
        title: '未保存',
        content: '当前编辑内容尚未保存，是否放弃？',
        success: res => {
          if (res.confirm) {
            this.setData({
              editing: false,
              editContent: this.data.noteContent,
              hasChange: false
            })
          }
        }
      })
    } else {
      this.setData({ editing: false })
    }
  },

  switchToEdit() {
    this.setData({
      editing: true,
      editContent: this.data.noteContent
    })
  },

  onEditInput(e) {
    const value = e.detail.value
    this.setData({
      editContent: value,
      hasChange: value !== this.data.noteContent
    })
  },

  onSaveNote() {
    if (!this.data.currentAreaId || !this.data.hasChange || this.data.saving) return

    this.setData({ saving: true })
    api.put(`/api/notes/${this.data.currentAreaId}`, {
      content: this.data.editContent
    })
      .then(() => {
        this.setData({
          saving: false,
          hasChange: false,
          noteContent: this.data.editContent
        })
        util.showToast('笔记已保存', 'success')
      })
      .catch(err => {
        this.setData({ saving: false })
        util.showToast('保存失败: ' + err.message)
      })
  },

  /* 导航 */
  goHome() {
    wx.reLaunch({ url: '/pages/home/home' })
  },

  goToDomain() {
    wx.navigateTo({ url: '/pages/domain/domain' })
  },

  goToPlan() {
    wx.navigateTo({ url: '/pages/plan/plan' })
  },

  goToSkills() {
    wx.navigateTo({ url: '/pages/skills/skills' })
  }
})
