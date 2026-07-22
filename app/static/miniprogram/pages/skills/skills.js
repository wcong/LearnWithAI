/**
 * 技能管理页面
 * 管理 AI 技能提示词模板的 CRUD
 */
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const util = require('../../utils/util')

Page({
  data: {
    skills: [],
    loading: false,
    // 弹窗表单
    showSkillModal: false,
    editingSkillId: null,
    skillFormName: '',
    skillFormDesc: '',
    skillFormTemplate: '',
    savingSkill: false
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
    this.loadSkills()
  },

  loadSkills() {
    this.setData({ loading: true })
    api.get('/api/skills')
      .then(data => {
        this.setData({ skills: data || [], loading: false })
      })
      .catch(err => {
        this.setData({ loading: false })
        util.showToast('加载技能失败: ' + err.message)
      })
  },

  onAddSkill() {
    this.setData({
      showSkillModal: true,
      editingSkillId: null,
      skillFormName: '',
      skillFormDesc: '',
      skillFormTemplate: ''
    })
  },

  onEditSkill(e) {
    const id = e.currentTarget.dataset.id
    const skill = this.data.skills.find(s => s.id === id)
    if (!skill) return

    this.setData({
      showSkillModal: true,
      editingSkillId: id,
      skillFormName: skill.name,
      skillFormDesc: skill.description || '',
      skillFormTemplate: skill.template || ''
    })
  },

  onDeleteSkill(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    const that = this

    wx.showModal({
      title: '删除技能',
      content: `确定要删除技能「${name}」吗？`,
      confirmColor: '#f56c6c',
      success(res) {
        if (res.confirm) {
          api.delete(`/api/skills/${id}`)
            .then(() => {
              that.loadSkills()
              util.showToast('已删除', 'success')
            })
            .catch(err => util.showToast('删除失败: ' + err.message))
        }
      }
    })
  },

  onSkillFormName(e) {
    this.setData({ skillFormName: e.detail.value })
  },

  onSkillFormDesc(e) {
    this.setData({ skillFormDesc: e.detail.value })
  },

  onSkillFormTemplate(e) {
    this.setData({ skillFormTemplate: e.detail.value })
  },

  onSaveSkill() {
    const { editingSkillId, skillFormName, skillFormDesc, skillFormTemplate, savingSkill } = this.data
    if (savingSkill) return
    if (!skillFormName.trim()) {
      util.showToast('请输入技能名称')
      return
    }
    if (!skillFormTemplate.trim()) {
      util.showToast('请输入提示词模板')
      return
    }

    this.setData({ savingSkill: true })
    const payload = {
      name: skillFormName.trim(),
      description: skillFormDesc.trim(),
      template: skillFormTemplate.trim()
    }

    const promise = editingSkillId
      ? api.patch(`/api/skills/${editingSkillId}`, payload)
      : api.post('/api/skills', payload)

    promise
      .then(() => {
        this.setData({ savingSkill: false, showSkillModal: false })
        this.loadSkills()
        util.showToast(editingSkillId ? '技能已更新' : '技能已创建', 'success')
      })
      .catch(err => {
        this.setData({ savingSkill: false })
        util.showToast('保存失败: ' + err.message)
      })
  },

  closeSkillModal() {
    this.setData({
      showSkillModal: false,
      editingSkillId: null,
      skillFormName: '',
      skillFormDesc: '',
      skillFormTemplate: ''
    })
  },

  stopPropagation() {
    // 阻止冒泡
  },

  /* 导航 */
  goHome() {
    wx.reLaunch({ url: '/pages/home/home' })
  },

  goToDomain() {
    wx.navigateTo({ url: '/pages/domain/domain' })
  },

  goToNotes() {
    wx.navigateTo({ url: '/pages/notes/notes' })
  },

  goToPlan() {
    wx.navigateTo({ url: '/pages/plan/plan' })
  }
})
