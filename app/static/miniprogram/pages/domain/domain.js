/**
 * 核心领域+AI对话页面
 * 包含：领域树、聊天、笔记、SSE流式、模态弹窗等
 */
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const sse = require('../../utils/sse')
const tree = require('../../utils/tree')
const util = require('../../utils/util')

Page({
  data: {
    // 顶部状态栏高度
    statusBarHeight: 20,

    // 领域树
    areaTree: [],
    currentAreaId: null,
    currentAreaName: '',
    loadingAreas: false,
    drawerOpen: false,
    noteDrawerOpen: false,

    // 聊天
    messages: [],
    inputMessage: '',
    sending: false,
    loadingChat: false,
    hasMoreMessages: false,
    autoScroll: true,
    inputFocus: false,

    // Thinking
    thinkingContent: '',
    thinkingCollapsed: false,

    // 创建/编辑领域
    showAreaModal: false,
    editingArea: false,
    editingAreaId: null,
    areaFormName: '',
    areaFormDesc: '',
    parentAreaId: null,
    parentAreaName: '',

    // 操作菜单
    showActionMenu: false,
    actionAreaId: null,
    actionAreaNode: null,

    // RAG搜索
    showSearchModal: false,
    searchQuery: '',
    searchResults: [],

    // 审查子领域
    showExaminePanel: false,
    examineResult: '',
    examineDone: false,
    examineError: '',

    // 生成子领域
    showGeneratePanel: false,
    generateSubareas: [],
    generateDone: false,
    generateError: '',

    // 技能
    selectedSkillId: null,
    selectedSkillName: '默认技能',
    skills: [],
    showSkillPicker: false,

    // 笔记
    noteContent: ''
  },

  // SSE 连接引用
  sseConnection: null,

  onLoad() {
    if (!auth.checkLogin()) return
    // 读取状态栏高度
    const app = getApp()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    this.loadAreaTree()
    this.loadSkills()
    this.loadSavedState()
  },

  onUnload() {
    // 保存状态
    this.saveCurrentState()
    // 中止 SSE
    if (this.sseConnection) {
      this.sseConnection.abort()
      this.sseConnection = null
    }
  },

  /* ====== 状态持久化 ====== */

  loadSavedState() {
    const saved = wx.getStorageSync('domainState')
    if (saved) {
      try {
        const state = JSON.parse(saved)
        if (state.currentAreaId) {
          this.setData({ currentAreaId: state.currentAreaId })
        }
      } catch (e) {}
    }
  },

  saveCurrentState() {
    if (this.data.currentAreaId) {
      wx.setStorageSync('domainState', JSON.stringify({
        currentAreaId: this.data.currentAreaId
      }))
    }
  },

  /* ====== 领域树 ====== */

  loadAreaTree() {
    this.setData({ loadingAreas: true })
    api.get('/api/areas/tree')
      .then(data => {
        const treeData = data || []
        // 添加 expanded 属性
        this.expandTree(treeData)
        this.setData({ areaTree: treeData, loadingAreas: false })
        // 恢复选中状态
        if (this.data.currentAreaId) {
          const node = tree.findNodeById(treeData, this.data.currentAreaId)
          if (node) {
            this.setData({ currentAreaName: node.name })
            this.loadChatHistory(this.data.currentAreaId)
            this.loadNote()
          } else {
            this.setData({ currentAreaId: null, currentAreaName: '' })
          }
        }
      })
      .catch(err => {
        this.setData({ loadingAreas: false })
        util.showToast('加载领域树失败: ' + err.message)
      })
  },

  expandTree(nodes) {
    if (!nodes) return
    for (const node of nodes) {
      node.expanded = true
      if (node.children && node.children.length > 0) {
        this.expandTree(node.children)
      }
    }
  },

  onAreaSelect(e) {
    const { node } = e.detail
    if (!node) return
    this.setData({
      currentAreaId: node.id,
      currentAreaName: node.name,
      drawerOpen: false,
      messages: [],
      thinkingContent: '',
      noteContent: ''
    })
    this.loadChatHistory(node.id)
    this.loadNote()
    this.saveCurrentState()
  },

  onAreaLongPress(e) {
    const { node } = e.detail
    if (!node) return
    this.setData({
      showActionMenu: true,
      actionAreaId: node.id,
      actionAreaNode: node
    })
  },

  toggleDrawer() {
    this.setData({ drawerOpen: !this.data.drawerOpen })
  },

  closeDrawer() {
    this.setData({ drawerOpen: false })
  },

  /* ====== 笔记 ====== */

  toggleNoteDrawer() {
    if (!this.data.currentAreaId) return
    this.setData({ noteDrawerOpen: !this.data.noteDrawerOpen })
  },

  closeNoteDrawer() {
    this.setData({ noteDrawerOpen: false })
  },

  loadNote() {
    if (!this.data.currentAreaId) return
    api.get(`/api/notes/${this.data.currentAreaId}`)
      .then(data => {
        this.setData({ noteContent: data.content || '' })
      })
      .catch(() => {
        // 没有笔记也行
      })
  },

  onNoteSave(e) {
    const { areaId, content } = e.detail
    if (!areaId) return
    api.put(`/api/notes/${areaId}`, { content })
      .then(() => {
        util.showToast('笔记已保存', 'success')
      })
      .catch(err => {
        util.showToast('保存失败: ' + err.message)
      })
  },

  /* ====== 聊天 ====== */

  loadChatHistory(areaId) {
    if (!areaId) return
    this.setData({ loadingChat: true })
    api.get(`/api/chat/history/${areaId}`)
      .then(messages => {
        const msgs = messages || []
        const formatted = msgs.map((m, i) => ({
          ...m,
          id: m.id || `msg-${i}`,
          displayContent: util.mdToHtml(m.content)
        }))
        this.setData({
          messages: formatted,
          loadingChat: false,
          hasMoreMessages: false
        })
        this.scrollToBottom()
      })
      .catch(err => {
        this.setData({ loadingChat: false })
        util.showToast('加载聊天记录失败: ' + err.message)
      })
  },

  onInputChange(e) {
    this.setData({ inputMessage: e.detail.value })
  },

  onSendMessage() {
    const { inputMessage, currentAreaId, sending, selectedSkillId } = this.data
    if (!inputMessage.trim() || !currentAreaId || sending) return

    // 添加用户消息
    const userMsg = {
      id: util.genId(),
      role: 'user',
      content: inputMessage.trim()
    }
    this.setData({
      messages: [...this.data.messages, userMsg],
      inputMessage: '',
      sending: true,
      thinkingContent: '',
      thinkingCollapsed: false,
      autoScroll: true
    })
    this.scrollToBottom()

    // 创建消息占位
    const assistantMsgId = util.genId()
    const assistMsg = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      displayContent: ''
    }
    this.setData({
      messages: [...this.data.messages, assistMsg]
    })

    // 发起 SSE 流式请求
    const body = {
      area_id: currentAreaId,
      message: userMsg.content
    }
    if (selectedSkillId) {
      body.skill_id = selectedSkillId
    }

    this.startChatStream(body, assistantMsgId)
  },

  startChatStream(body, msgId) {
    const that = this
    let fullReply = ''

    this.sseConnection = sse.createSSEConnection({
      url: api.getBaseUrl() + '/api/chat/stream',
      data: body,
      onThinking(data) {
        if (data.chunk) {
          that.setData({
            thinkingContent: that.data.thinkingContent + data.chunk,
            thinkingCollapsed: false
          })
        }
      },
      onToolCall(data) {
        if (data.chunk) {
          const toolText = `\n[工具调用] ${data.chunk}\n`
          that.setData({
            thinkingContent: that.data.thinkingContent + toolText
          })
        }
      },
      onResult(data) {
        if (data.reply) {
          fullReply += data.reply
          that.updateMessage(msgId, fullReply)
        }
        if (data.area_id) {
          that.setData({ currentAreaId: data.area_id })
        }
      },
      onDone() {
        that.setData({ sending: false, autoScroll: true })
        that.sseConnection = null
        // 刷新领域树
        that.loadAreaTree()
      },
      onError(msg) {
        that.setData({ sending: false })
        util.showToast('聊天出错: ' + msg)
        that.sseConnection = null
      },
      onComplete() {
        that.setData({ sending: false })
        that.sseConnection = null
      }
    })
  },

  updateMessage(msgId, content) {
    const messages = this.data.messages.map(m => {
      if (m.id === msgId) {
        return {
          ...m,
          content: content,
          displayContent: util.mdToHtml(content)
        }
      }
      return m
    })
    this.setData({ messages })
    this.scrollToBottom()
  },

  loadMoreMessages() {
    // 分页加载历史
    // 当前简化处理，暂不实现分页
  },

  scrollToBottom() {
    setTimeout(() => {
      wx.createSelectorQuery()
        .select('#msg-bottom')
        .boundingClientRect(rect => {
          if (rect) {
            wx.pageScrollTo({ scrollTop: rect.top, duration: 100 })
          }
        })
        .exec()
    }, 100)
  },

  /* ====== 创建/编辑领域 ====== */

  onAddArea() {
    const node = this.data.actionAreaNode
    this.setData({
      showActionMenu: false,
      showAreaModal: true,
      editingArea: false,
      editingAreaId: null,
      areaFormName: '',
      areaFormDesc: '',
      parentAreaId: node ? node.id : null,
      parentAreaName: node ? node.name : '根目录'
    })
  },

  onAddChildArea() {
    const node = this.data.actionAreaNode
    this.setData({
      showActionMenu: false,
      showAreaModal: true,
      editingArea: false,
      editingAreaId: null,
      areaFormName: '',
      areaFormDesc: '',
      parentAreaId: node.id,
      parentAreaName: node.name
    })
  },

  onEditArea() {
    const node = this.data.actionAreaNode
    this.setData({
      showActionMenu: false,
      showAreaModal: true,
      editingArea: true,
      editingAreaId: node.id,
      areaFormName: node.name,
      areaFormDesc: node.description || '',
      parentAreaId: node.parent_id,
      parentAreaName: ''
    })
  },

  onAreaNameInput(e) {
    this.setData({ areaFormName: e.detail.value })
  },

  onAreaDescInput(e) {
    this.setData({ areaFormDesc: e.detail.value })
  },

  onSaveArea() {
    const { editingArea, editingAreaId, areaFormName, areaFormDesc, parentAreaId } = this.data
    if (!areaFormName.trim()) {
      util.showToast('请输入领域名称')
      return
    }

    if (editingArea) {
      api.patch(`/api/areas/${editingAreaId}`, {
        name: areaFormName.trim(),
        description: areaFormDesc.trim()
      })
        .then(() => {
          this.closeAreaModal()
          this.loadAreaTree()
          util.showToast('领域已更新', 'success')
        })
        .catch(err => util.showToast('更新失败: ' + err.message))
    } else {
      api.post('/api/areas', {
        name: areaFormName.trim(),
        description: areaFormDesc.trim(),
        parent_id: parentAreaId
      })
        .then(data => {
          this.closeAreaModal()
          this.loadAreaTree()
          if (data && data.id) {
            this.setData({
              currentAreaId: data.id,
              currentAreaName: data.name
            })
          }
          util.showToast('领域已创建', 'success')
        })
        .catch(err => util.showToast('创建失败: ' + err.message))
    }
  },

  closeAreaModal() {
    this.setData({
      showAreaModal: false,
      editingArea: false,
      editingAreaId: null,
      areaFormName: '',
      areaFormDesc: ''
    })
  },

  onDeleteArea() {
    const node = this.data.actionAreaNode
    const that = this
    wx.showModal({
      title: '确认删除',
      content: `确定要删除「${node.name}」及其所有子领域吗？此操作不可恢复。`,
      confirmColor: '#f56c6c',
      success(res) {
        if (res.confirm) {
          api.delete(`/api/areas/${node.id}`)
            .then(() => {
              that.setData({ showActionMenu: false })
              that.loadAreaTree()
              if (that.data.currentAreaId === node.id) {
                that.setData({
                  currentAreaId: null,
                  currentAreaName: '',
                  messages: [],
                  noteContent: ''
                })
              }
              util.showToast('领域已删除', 'success')
            })
            .catch(err => util.showToast('删除失败: ' + err.message))
        }
      }
    })
  },

  closeActionMenu() {
    this.setData({ showActionMenu: false })
  },

  /* ====== 审查子领域 ====== */

  onExamineArea() {
    const node = this.data.actionAreaNode
    const that = this
    this.setData({
      showActionMenu: false,
      showExaminePanel: true,
      examineResult: '',
      examineDone: false,
      examineError: ''
    })

    // 发起 SSE 审查
    sse.createSSEConnection({
      url: api.getBaseUrl() + `/api/areas/${node.id}/examine/stream`,
      data: {},
      onThinking(data) {
        if (data.chunk) {
          that.setData({
            examineResult: that.data.examineResult + data.chunk
          })
        }
      },
      onResult(data) {
        if (data.chunk) {
          that.setData({
            examineResult: that.data.examineResult + data.chunk
          })
        }
      },
      onDone() {
        that.setData({ examineDone: true })
      },
      onError(msg) {
        that.setData({ examineError: msg, examineDone: true })
      }
    })
  },

  closeExaminePanel() {
    this.setData({
      showExaminePanel: false,
      examineResult: '',
      examineDone: false,
      examineError: ''
    })
  },

  /* ====== 生成子领域 ====== */

  onGenerateSubareas() {
    const node = this.data.actionAreaNode
    const that = this
    this.setData({
      showActionMenu: false,
      showGeneratePanel: true,
      generateSubareas: [],
      generateDone: false,
      generateError: ''
    })

    let subareasBuffer = ''

    sse.createSSEConnection({
      url: api.getBaseUrl() + `/api/areas/${node.id}/generate-subareas/stream`,
      data: {},
      onResult(data) {
        if (data.chunk) {
          subareasBuffer += data.chunk
          // 尝试解析 JSON
          try {
            const parsed = JSON.parse(subareasBuffer)
            if (Array.isArray(parsed)) {
              that.setData({
                generateSubareas: parsed.map((item, i) => ({
                  ...item,
                  index: i
                }))
              })
            }
          } catch (e) {
            // 还未完整，继续累积
          }
        }
      },
      onDone() {
        that.setData({ generateDone: true })
        // 尝试最终解析
        try {
          const parsed = JSON.parse(subareasBuffer)
          if (Array.isArray(parsed)) {
            that.setData({
              generateSubareas: parsed.map((item, i) => ({
                ...item,
                index: i
              }))
            })
          }
        } catch (e) {}
      },
      onError(msg) {
        that.setData({ generateError: msg, generateDone: true })
      }
    })
  },

  onSubareaNameEdit(e) {
    const index = e.currentTarget.dataset.index
    const value = e.detail.value
    const subareas = this.data.generateSubareas.map((item, i) => {
      if (i === index) return { ...item, name: value }
      return item
    })
    this.setData({ generateSubareas: subareas })
  },

  onSubareaDescEdit(e) {
    const index = e.currentTarget.dataset.index
    const value = e.detail.value
    const subareas = this.data.generateSubareas.map((item, i) => {
      if (i === index) return { ...item, description: value }
      return item
    })
    this.setData({ generateSubareas: subareas })
  },

  onPolishSubareas() {
    if (this.data.generateSubareas.length === 0) return
    util.showLoading('润色中...')
    api.post(`/api/areas/${this.data.actionAreaNode.id}/polish-subareas`, {
      subareas: this.data.generateSubareas
    })
      .then(data => {
        util.hideLoading()
        if (data && data.subareas) {
          this.setData({
            generateSubareas: data.subareas.map((item, i) => ({
              ...item,
              index: i
            }))
          })
        }
        util.showToast('润色完成', 'success')
      })
      .catch(err => {
        util.hideLoading()
        util.showToast('润色失败: ' + err.message)
      })
  },

  onCreateSubareas() {
    const { actionAreaId, generateSubareas } = this.data
    if (!actionAreaId || generateSubareas.length === 0) return

    util.showLoading('批量创建中...')
    const promises = generateSubareas.map(item =>
      api.post('/api/areas', {
        name: item.name,
        description: item.description || '',
        parent_id: actionAreaId
      })
    )

    Promise.all(promises)
      .then(() => {
        util.hideLoading()
        this.closeGeneratePanel()
        this.loadAreaTree()
        util.showToast('子领域创建完成', 'success')
      })
      .catch(err => {
        util.hideLoading()
        util.showToast('创建失败: ' + err.message)
      })
  },

  closeGeneratePanel() {
    this.setData({
      showGeneratePanel: false,
      generateSubareas: [],
      generateDone: false,
      generateError: ''
    })
  },

  /* ====== RAG 搜索 ====== */

  onSearch() {
    if (!this.data.currentAreaId) {
      util.showToast('请先选择学习领域')
      return
    }
    this.setData({
      showSearchModal: true,
      searchQuery: '',
      searchResults: []
    })
  },

  onSearchQueryInput(e) {
    this.setData({ searchQuery: e.detail.value })
  },

  onDoSearch() {
    const { searchQuery, currentAreaId } = this.data
    if (!searchQuery.trim() || !currentAreaId) return

    util.showLoading('搜索中...')
    api.post('/api/rag/search', {
      query: searchQuery.trim(),
      area_id: currentAreaId
    })
      .then(data => {
        util.hideLoading()
        this.setData({ searchResults: data || [] })
        if (!data || data.length === 0) {
          util.showToast('未找到相关结果')
        }
      })
      .catch(err => {
        util.hideLoading()
        util.showToast('搜索失败: ' + err.message)
      })
  },

  closeSearchModal() {
    this.setData({
      showSearchModal: false,
      searchQuery: '',
      searchResults: []
    })
  },

  /* ====== 技能 ====== */

  loadSkills() {
    api.get('/api/skills')
      .then(data => {
        this.setData({ skills: data || [] })
      })
      .catch(() => {})
  },

  showSkillSelector() {
    this.setData({ showSkillPicker: true })
  },

  closeSkillPicker() {
    this.setData({ showSkillPicker: false })
  },

  selectSkill(e) {
    const id = e.currentTarget.dataset.id || null
    const name = e.currentTarget.dataset.name || '默认技能'
    this.setData({
      selectedSkillId: id,
      selectedSkillName: name,
      showSkillPicker: false
    })
  },

  /* ====== 导航 ====== */

  goHome() {
    wx.reLaunch({ url: '/pages/home/home' })
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

  stopPropagation() {
    // 阻止冒泡
  }
})
