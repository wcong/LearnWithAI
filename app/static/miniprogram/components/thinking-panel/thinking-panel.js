/**
 * Thinking 面板组件
 * 展示 AI 思考过程，支持折叠/展开、自动滚动
 */
Component({
  properties: {
    content: {
      type: String,
      value: '',
      observer: 'onContentChange'
    },
    collapsed: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    onToggle() {
      this.setData({
        collapsed: !this.data.collapsed
      })
      this.triggerEvent('toggle', { collapsed: this.data.collapsed })
    },

    onContentChange(newVal) {
      // 内容变化时自动滚动到底部（由 scroll-into-view 处理）
      if (newVal && this.data.collapsed) {
        // 有内容更新时自动展开
        this.setData({ collapsed: false })
      }
    },

    /**
     * 追加思考内容
     * @param {string} chunk - 追加的文本片段
     */
    appendContent(chunk) {
      this.setData({
        content: this.data.content + chunk
      })
    },

    /**
     * 重置内容
     */
    reset() {
      this.setData({
        content: '',
        collapsed: false
      })
    }
  }
})
