/**
 * 笔记查看/编辑器组件
 * 支持 rich-text 渲染 HTML 内容，以及 textarea 编辑
 */
Component({
  properties: {
    content: {
      type: String,
      value: '',
      observer: 'onContentPropChange'
    },
    areaName: {
      type: String,
      value: ''
    },
    areaId: {
      type: Number,
      value: null
    }
  },

  data: {
    editing: false,
    editContent: '',
    hasChange: false
  },

  methods: {
    onContentPropChange(newVal) {
      // 外部更新内容时，同步到编辑内容
      if (!this.data.editing) {
        this.setData({ editContent: newVal || '' })
      }
    },

    onToggleEdit() {
      const editing = !this.data.editing
      this.setData({
        editing,
        editContent: editing ? this.data.editContent || this.data.content || '' : this.data.content,
        hasChange: false
      })
    },

    onContentInput(e) {
      this.setData({
        editContent: e.detail.value,
        hasChange: e.detail.value !== this.data.content
      })
    },

    onSave() {
      if (!this.data.hasChange) return
      const newContent = this.data.editContent
      this.setData({ content: newContent, hasChange: false })
      this.triggerEvent('save', {
        areaId: this.properties.areaId,
        content: newContent
      })
    },

    /**
     * 设置笔记内容
     */
    setContent(content, areaName) {
      this.setData({
        content: content || '',
        editContent: content || '',
        areaName: areaName || '',
        hasChange: false
      })
    },

    /**
     * 重置
     */
    reset() {
      this.setData({
        content: '',
        editContent: '',
        areaName: '',
        editing: false,
        hasChange: false
      })
    }
  }
})
