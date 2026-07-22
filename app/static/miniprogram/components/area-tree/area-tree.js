/**
 * 领域树自定义组件
 * 递归渲染无限层级领域树
 */
Component({
  properties: {
    treeData: {
      type: Array,
      value: []
    },
    depth: {
      type: Number,
      value: 0
    },
    currentId: {
      type: Number,
      value: null,
      observer: 'onCurrentIdChange'
    }
  },

  data: {
    nodes: []
  },

  methods: {
    onTapNode(e) {
      const id = e.currentTarget.dataset.id
      const node = this.findNode(this.properties.treeData, id)
      if (!node) return

      // 如果有子节点，切换展开/折叠
      if (node.children && node.children.length > 0) {
        node.expanded = !node.expanded
        this.setData({ treeData: this.properties.treeData })
      }

      // 触发选中事件
      this.triggerEvent('nodeTap', { node })
    },

    onLongPress(e) {
      const id = e.currentTarget.dataset.id
      const node = this.findNode(this.properties.treeData, id)
      if (node) {
        this.triggerEvent('nodeLongPress', { node })
      }
    },

    onChildNodeTap(e) {
      // 子组件冒泡事件
      this.triggerEvent('nodeTap', e.detail)
    },

    onChildNodeLongPress(e) {
      this.triggerEvent('nodeLongPress', e.detail)
    },

    findNode(nodes, id) {
      if (!nodes || !id) return null
      for (const node of nodes) {
        if (node.id === id || node.id == id) return node
        if (node.children && node.children.length > 0) {
          const found = this.findNode(node.children, id)
          if (found) return found
        }
      }
      return null
    },

    onCurrentIdChange(newVal) {
      // 可以在这里实现自动展开到当前节点的逻辑
    }
  }
})
