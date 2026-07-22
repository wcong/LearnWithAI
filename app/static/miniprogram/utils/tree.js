/**
 * 树操作工具
 * 处理领域树的查找、遍历、更新等操作
 */

/**
 * 递归查找树中的节点
 * @param {Array} tree - 树结构数组
 * @param {number|string} id - 节点 ID
 * @returns {object|null} 找到的节点
 */
function findNodeById(tree, id) {
  if (!tree || !id) return null
  for (const node of tree) {
    if (node.id === id) return node
    if (node.id == id) return node
    if (node.children && node.children.length > 0) {
      const found = findNodeById(node.children, id)
      if (found) return found
    }
  }
  return null
}

/**
 * 获取节点的完整路径（从根到当前）
 * @param {Array} tree - 树结构数组
 * @param {number|string} id - 节点 ID
 * @returns {Array} 路径节点数组（从根到目标）
 */
function getPathToNode(tree, id) {
  if (!tree || !id) return []

  function findPath(nodes, targetId, path) {
    for (const node of nodes) {
      const currentPath = [...path, node]
      if (node.id === targetId || node.id == targetId) {
        return currentPath
      }
      if (node.children && node.children.length > 0) {
        const result = findPath(node.children, targetId, currentPath)
        if (result) return result
      }
    }
    return null
  }

  return findPath(tree, id, []) || []
}

/**
 * 递归遍历树节点
 * @param {Array} tree - 树结构数组
 * @param {function} callback - 对每个节点执行的回调
 */
function traverse(tree, callback) {
  if (!tree) return
  for (const node of tree) {
    callback(node)
    if (node.children && node.children.length > 0) {
      traverse(node.children, callback)
    }
  }
}

/**
 * 获取树的叶子节点数
 * @param {Array} tree - 树结构数组
 * @returns {number}
 */
function countLeaves(tree) {
  let count = 0
  traverse(tree, (node) => {
    if (!node.children || node.children.length === 0) {
      count++
    }
  })
  return count
}

/**
 * 获取树的总节点数
 * @param {Array} tree - 树结构数组
 * @returns {number}
 */
function countNodes(tree) {
  let count = 0
  traverse(tree, () => count++)
  return count
}

/**
 * 收集树中所有节点 ID
 * @param {Array} tree - 树结构数组
 * @returns {Array<number>}
 */
function getAllIds(tree) {
  const ids = []
  traverse(tree, (node) => ids.push(node.id))
  return ids
}

/**
 * 展平树为列表（包含层级信息）
 * @param {Array} tree - 树结构数组
 * @param {number} depth - 起始深度（默认0）
 * @returns {Array<{node, depth}>}
 */
function flattenTree(tree, depth = 0) {
  const result = []
  if (!tree) return result
  for (const node of tree) {
    result.push({ node, depth })
    if (node.children && node.children.length > 0) {
      result.push(...flattenTree(node.children, depth + 1))
    }
  }
  return result
}

module.exports = {
  findNodeById,
  getPathToNode,
  traverse,
  countLeaves,
  countNodes,
  getAllIds,
  flattenTree
}
