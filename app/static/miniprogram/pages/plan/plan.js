/**
 * Plan Mode 页面
 * AI 自动递归探索并规划学习路径
 */
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const sse = require('../../utils/sse')
const util = require('../../utils/util')

Page({
  data: {
    // 输入
    topic: '',
    maxDepth: 3,
    starting: false,
    suggestions: [
      '量子力学入门',
      'Python 数据分析',
      '机器学习基础',
      '深度学习与神经网络',
      '数据结构与算法',
      '操作系统原理'
    ],

    // 探索状态
    exploring: false,
    status: '',
    statusText: '',
    progressPercent: 0,
    progressText: '',
    areaCount: 0,
    messageCount: 0,

    // 领域树
    planAreaTree: [],

    // Thinking
    thinkingContent: '',
    thinkingCollapsed: false,

    // 消息流
    planMessages: [],

    // 结果
    showResults: false,
    resultStats: {}
  },

  sseConnection: null,
  startTime: null,

  onLoad() {
    if (!auth.checkLogin()) return
    const app = getApp()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/login/login' })
    }
  },

  onUnload() {
    this.cleanupSSE()
  },

  /* ====== 输入 ====== */

  onTopicInput(e) {
    this.setData({ topic: e.detail.value })
  },

  selectSuggestion(e) {
    const topic = e.currentTarget.dataset.topic
    this.setData({ topic })
  },

  setDepth(e) {
    const depth = parseInt(e.currentTarget.dataset.depth)
    this.setData({ maxDepth: depth })
  },

  /* ====== 启动探索 ====== */

  startExploration() {
    const topic = this.data.topic.trim()
    if (!topic || this.data.starting) return

    this.setData({
      starting: true,
      exploring: true,
      status: 'exploring',
      statusText: '探索中',
      progressPercent: 0,
      areaCount: 0,
      messageCount: 0,
      planAreaTree: [],
      thinkingContent: '',
      planMessages: [],
      showResults: false,
      progressText: '正在启动探索...'
    })

    this.startTime = Date.now()

    this.sseConnection = sse.createSSEConnection({
      url: api.getBaseUrl() + '/api/plan/start',
      data: {
        topic: topic,
        max_depth: this.data.maxDepth
      },
      onThinking: this.handleThinking.bind(this),
      onResult: this.handleResult.bind(this),
      onDone: this.handleDone.bind(this),
      onError: this.handleError.bind(this),
      onComplete: this.handleComplete.bind(this)
    })
  },

  handleThinking(data) {
    if (data.chunk) {
      this.setData({
        thinkingContent: this.data.thinkingContent + data.chunk,
        thinkingCollapsed: false
      })
    }
    if (data.type === 'progress') {
      this.setData({ progressText: data.chunk || '' })
    }
    if (data.type === 'tree_update' && data.tree) {
      this.setData({
        planAreaTree: data.tree,
        areaCount: this.countAreas(data.tree)
      })
    }
  },

  handleResult(data) {
    if (data.content || data.reply) {
      const msg = {
        id: util.genId(),
        type: 'message',
        content: data.content || data.reply,
        area_name: data.area_name || '',
        time: util.formatDate(new Date(), true)
      }
      this.setData({
        planMessages: [...this.data.planMessages, msg],
        messageCount: this.data.messageCount + 1
      })
    }

    // 更新领域树
    if (data.areas) {
      this.setData({
        planAreaTree: data.areas,
        areaCount: this.countAreas(data.areas)
      })
    }

    // 更新进度
    if (data.progress !== undefined) {
      this.setData({ progressPercent: Math.min(data.progress * 100, 99) })
    }
  },

  handleDone(data) {
    const duration = this.formatDuration(Date.now() - this.startTime)
    this.setData({
      status: 'done',
      statusText: '探索完成',
      progressPercent: 100,
      progressText: '探索完成！',
      showResults: true,
      resultStats: {
        areaCount: this.data.areaCount,
        messageCount: this.data.messageCount,
        duration
      },
      starting: false
    })
    util.showToast('探索完成', 'success')
  },

  handleError(msg) {
    util.showToast('探索出错: ' + msg)
    this.setData({
      status: 'error',
      statusText: '出错',
      progressText: '探索出错: ' + msg,
      starting: false
    })
  },

  handleComplete() {
    this.setData({ starting: false })
    this.sseConnection = null
  },

  /* ====== 停止探索 ====== */

  stopExploration() {
    wx.showModal({
      title: '停止探索',
      content: '确定要停止当前的探索吗？已创建的内容将保留。',
      success: res => {
        if (res.confirm) {
          this.cleanupSSE()
          this.setData({
            status: 'stopped',
            statusText: '已停止',
            progressText: '探索已手动停止',
            starting: false
          })
        }
      }
    })
  },

  /* ====== 工具 ====== */

  countAreas(tree) {
    if (!tree) return 0
    let count = 0
    function traverse(nodes) {
      if (!nodes) return
      for (const n of nodes) {
        count++
        if (n.children) traverse(n.children)
      }
    }
    traverse(tree)
    return count
  },

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}秒`
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${minutes}分${secs}秒`
  },

  cleanupSSE() {
    if (this.sseConnection) {
      this.sseConnection.abort()
      this.sseConnection = null
    }
  },

  onPlanAreaTap() {
    // Plan mode 中的领域树点击，暂不处理
  },

  /* ====== 导航 ====== */

  goBack() {
    if (this.data.exploring) {
      this.stopExploration()
    } else {
      wx.navigateBack()
    }
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/home' })
  },

  goToDomain() {
    wx.navigateTo({ url: '/pages/domain/domain' })
  },

  goToNotes() {
    wx.navigateTo({ url: '/pages/notes/notes' })
  },

  goToSkills() {
    wx.navigateTo({ url: '/pages/skills/skills' })
  }
})
