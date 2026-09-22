# Barbara

一个跑在自己电脑上的桌面对话 AI。支持多模型切换、角色扮演和酒馆角色卡导入。

基于 **Electron + OpenAI 兼容接口**，没有任何后台服务器 —— 主进程就是本地的 Node.js 后端，
聊天记录和 API Key 全部只存在本机。

---

## 功能

### 多模型 / 多服务商

- 可以同时配置多个服务商，每个都有自己的**接口地址、API Key 和模型列表**。
- 内置 DeepSeek / OpenAI / 通义千问 / 智谱 GLM / Kimi 预设，也可完全自定义。
- 聊天窗口右上角的下拉框按服务商分组列出所有模型，**选中立刻生效**。
- **每个会话记住自己用的模型**，A 会话用 `gpt-4o`、B 会话用 `deepseek-chat` 互不影响。
- 每条回答上标注是哪个模型答的，方便对比。
- 支持一键「拉取可用模型」和「测试连接」。
- 所有 API Key 用系统级 `safeStorage` 加密后落盘。

### 角色扮演 / 角色卡

- **直接导入酒馆（SillyTavern）的 PNG 角色卡** —— 解析 PNG 里的 `tEXt` 数据块，
  把设定、头像、开场白、示例对话一起读进来；也支持 JSON 卡（v1 / v2 / v3）。
- 内置角色编辑器，可以完全手写一个角色。
- **每个会话独立绑定角色**，新建对话会继承当前角色。
- 支持 `{{char}}` / `{{user}}` / `<BOT>` / `<USER>` 宏。
- **开场白**：空对话绑定角色时自动插入第一句话。
- **示例对话**：解析成真正的 user/assistant 消息一起发给模型，显著提升扮演质量。
- **头像可以自己上传**，会自动压成 256×256 存起来。

### 其他

- 流式输出（打字机效果），逐帧渲染，长回答也不卡。
- 显示 `deepseek-reasoner` 这类模型的思考过程（可折叠）。
- **白天 / 夜间模式**一键切换，选择会记住。
- 单条消息删除、重新生成、复制全文、token 用量统计。
- 断点安全的本地存储：每次写入前自动留一份 `.backup`。

---

## 快速开始

### 环境要求

- **Node.js 18 或更高**（[下载 LTS 版](https://nodejs.org)）
- Windows / macOS / Linux

### 运行

```bash
# 1. 装依赖（首次大约要下载 100MB 的 Electron 运行时）
npm install

# 2. 启动
npm start
```

Windows 用户也可以直接**双击 `Start-Barbara.cmd`**，它会自动检查环境、首次自动
`npm install`，并给出中文的错误提示。

### 配置

启动后点左下角**「设置」**，填入服务商的接口地址和 API Key：

| 服务商 | 接口地址 |
| --- | --- |
| DeepSeek | `https://api.deepseek.com` |
| OpenAI | `https://api.openai.com/v1` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` |
| Kimi | `https://api.moonshot.cn/v1` |

> 接口地址是**原样拼接**的（后面直接接 `/chat/completions`），
> 所以该带 `/v1` 的服务商必须带上，否则会 404。

详细用法见 **[使用说明.md](使用说明.md)**。

---

## 开发

**这个项目没有构建步骤** —— 没有 webpack / vite / babel，`renderer/` 里的文件
是 Chromium 直接从磁盘加载的，改完刷新就是新的。

```bash
npm run dev
```

这条命令会：
- 自动打开 **DevTools**
- 监听 `renderer/` 目录，**文件一保存就自动刷新窗口**

| 改什么 | 怎么生效 |
| --- | --- |
| `renderer/style.css` | 保存即刷新 |
| `renderer/js/` 里的文件 / `index.html` | 保存即刷新（但页面状态会重置） |
| `main.js` / `preload.js` | **必须重启**，这两个只在启动时读一次 |

`F12` 或 `Ctrl + Shift + I` 开关 DevTools，`Ctrl + R` 刷新窗口。

> 没有热更新（HMR）。因为那需要引入打包器，会把「零构建」这个最大的便利丢掉。

---

## 项目结构

```
barbara/
├── main.js          Node.js 主进程（本地后端）
│                    · 读写本地文件
│                    · API Key 加解密（safeStorage）
│                    · 向模型服务商发 HTTP / SSE 请求
│                    · 解析 PNG 角色卡
├── preload.js       contextBridge 安全桥，把主进程能力暴露给页面
├── package.json
└── renderer/        前端（Chromium 页面）
    ├── index.html
    ├── style.css
    └── js/          界面逻辑（ES module，不需要打包器）
        ├── main.js      入口 · 组装消息（人设、宏、示例对话）· 大部分功能还在这
        ├── core/        常量 / 状态 / DOM 引用 / preload 桥 / 工具
        ├── ui/          提示条 / 确认框 / 主题 / Markdown / 建 DOM 的小工具
        └── data/        持久化等纯逻辑
```

**为什么文件操作都在 `main.js`？** 因为页面被 CSP 锁死了：

```
default-src 'none'; script-src 'self'; img-src 'self' data:;
```

页面连网络请求都发不出去，所以所有系统能力都必须走 IPC 交给主进程。
这是刻意设计 —— 即使页面上被塞了恶意脚本，它也没法往外发数据。

---

## 数据存在哪

```
%APPDATA%\Barbara\           (Windows)
~/Library/Application Support/Barbara/    (macOS)
~/.config/Barbara/           (Linux)
├── config.json          设置（API Key 已加密）
├── conversations.json   所有聊天记录
└── characters.json      角色库
```

窗口里点**「打开数据文件夹」**可以直接跳过去。

> **数据不在仓库里，也不会跟着 git 同步。** 换电脑 clone 代码后需要重新填 API Key，
> 聊天记录也不会带过去 —— 这是「没有服务器」的代价，也是隐私的保证。

---

## 已知限制

- **发图给模型看**：已经支持（输入框左边的图片按钮，也可以直接粘贴 / 拖进来），
  但**模型本身得支持视觉** —— 纯文本模型收到图会报错。这不需要另外接一个服务商，
  只是模型要选对。
- **让模型生图**：还没做。各家文生图接口差异较大（OpenAI 是同步返回、通义万相是异步任务），
  要做的话得单独配一个「生图服务商 + 生图模型」——它和聊天模型是两个东西。
- 不同电脑之间无法同步聊天记录。

---

## License

MIT
