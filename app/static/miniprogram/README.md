# LearnWithAI 微信小程序

AI 辅助深度学习平台 — 微信小程序前端。

## 环境准备

### 1. 安装依赖

```bash
cd app/static/miniprogram
npm install
```

### 2. 修改 AppID

打开 `project.config.json`，将 `appid` 替换为你的微信小程序 AppID：

```json
"appid": "wx你的AppID"
```

> 如果没有 AppID，可前往 [微信公众平台](https://mp.weixin.qq.com/) 注册获取。
> 开发调试可使用"测试号"，但**上传/发布正式版必须使用正式 AppID**。

### 3. 启动后端服务

确保后端 FastAPI 服务已启动（默认端口 8000）：

```bash
# 在项目根目录执行
python main.py
```

小程序启动后，在登录页点击右上角 **"服务器配置"**，填入后端地址（如 `http://192.168.1.100:8000`）。

> **注意**：微信开发者工具模拟器访问 `localhost` 可以正常连接。
> 真机调试/预览时需填写局域网 IP 或已部署的公网地址，且后端服务必须配置 HTTPS（微信小程序生产环境强制要求 HTTPS）。

---

## 构建与上传

### 方式一：微信开发者工具（推荐）

1. **打开项目**
   - 启动[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
   - 点击 **"导入项目"**
   - 选择目录：`app/static/miniprogram`
   - 填入 AppID，点击导入

2. **构建 npm**
   - 顶部菜单栏 → **工具** → **构建 npm**
   - 等待构建完成（底部控制台显示"构建完成"）

3. **本地调试**
   - 点击工具栏 **"编译"** 按钮
   - 在模拟器中预览效果
   - 可使用 **"预览"** 生成二维码，在手机上真机调试

4. **上传代码**
   - 点击工具栏右上角 **"上传"** 按钮（或菜单：工具 → 上传）
   - 填写版本号（如 `1.0.0`）和项目备注
   - 确认上传

5. **提交审核与发布**
   - 登录[微信公众平台](https://mp.weixin.qq.com/)
   - 进入 **版本管理** → **开发版本**，找到刚上传的版本
   - 点击 **"提交审核"**，填写审核说明
   - 审核通过后，点击 **"发布"** 即可上线

### 方式二：命令行工具（CI/CD）

使用微信官方提供的 [miniprogram-ci](https://www.npmjs.com/package/miniprogram-ci) 进行自动化上传。

#### 1. 安装 miniprogram-ci

```bash
npm install -g miniprogram-ci
```

#### 2. 配置密钥

在[微信公众平台](https://mp.weixin.qq.com/) → **开发** → **开发管理** → **开发设置** → **小程序代码上传**，生成上传密钥（`.key` 文件），下载保存。

#### 3. 编写上传脚本

创建 `upload.js`：

```javascript
const ci = require('miniprogram-ci');
const path = require('path');

(async () => {
  const project = new ci.Project({
    appid: 'wx你的AppID',
    type: 'miniProgram',
    projectPath: path.join(__dirname, '.'),
    privateKeyPath: path.join(__dirname, 'private.xxxxxx.key'),
    ignores: ['node_modules/**/*'],
  });

  const result = await ci.upload({
    project,
    version: '1.0.0',       // 每次上传更新版本号
    desc: '描述本次更新的内容',
    setting: {
      es6: true,
      minify: true,
      autoPrefixWXSS: true,
    },
  });

  console.log('上传成功', result);
})();
```

#### 4. 执行上传

```bash
node upload.js
```

---

## 项目结构

```
app/static/miniprogram/
├── app.js                       # 全局逻辑
├── app.json                     # 全局配置（页面注册、导航栏）
├── app.wxss                     # 全局样式
├── project.config.json          # 开发者工具配置
├── package.json                 # npm 依赖
├── sitemap.json                 # 搜索索引配置
│
├── utils/                       # 工具库
│   ├── api.js                   # API 封装（JWT + SSE 流式）
│   ├── auth.js                  # 登录认证
│   ├── sse.js                   # SSE 流式解析器
│   ├── util.js                  # 通用工具函数
│   └── tree.js                  # 树结构操作
│
├── components/                  # 自定义组件
│   ├── area-tree/               # 领域树组件
│   ├── thinking-panel/          # AI 思考面板
│   └── note-viewer/             # 笔记查看/编辑器
│
├── pages/                       # 页面
│   ├── login/                   # 登录注册
│   ├── home/                    # 首页导航
│   ├── domain/                  # 领域树 + AI 对话
│   ├── notes/                   # 笔记管理
│   ├── plan/                    # Plan Mode 探索
│   └── skills/                  # 技能管理
│
└── images/                      # 图片资源
```

## 底部导航 Tab 说明

| Tab | 页面 | 说明 |
|-----|------|------|
| 🏠 首页 | home | 功能导航入口 |
| 📚 领域 | domain | 领域树 + AI 对话 |
| 📝 笔记 | notes | 笔记查看/编辑 |
| 🚀 探索 | plan | Plan Mode 递归探索 |
| ⚙️ 技能 | skills | 技能模板管理 |

## 常见问题

**Q: 上传后首页空白怎么办？**
- 检查 `app.json` 中 `pages` 路径是否与实际文件路径一致
- 确认已执行 **工具 → 构建 npm**

**Q: 真机调试无法连接后端？**
- 开发版：确保手机和服务器在同一局域网，使用局域网 IP
- 正式版：后端必须配置 HTTPS 域名，并在小程序后台添加 `request` 合法域名

**Q: 构建 npm 报错？**
- 确认已执行 `npm install`
- 确认 `project.config.json` 中 `packNpmRelationList` 配置正确
- 尝试删除 `miniprogram_npm` 目录后重新构建
