# LLM API Tester

轻量级 LLM API 渠道测试工具。在接入各种 LLM 中继渠道（newapi、sub2api 等）之前，快速验证连通性、查看可用模型、测试对话能力。

![Node.js](https://img.shields.io/badge/Node.js-22+-339933.svg)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

## 功能

- **渠道管理** — 添加、编辑、删除 API 渠道，支持导入/导出配置
- **连通性验证** — 一键检测渠道是否可用，显示延迟
- **模型列表** — 自动获取渠道支持的模型列表，支持手动输入模型名
- **模型测试** — 逐个测试模型可用性和响应延迟
- **交互式对话** — 选择模型直接对话，支持流式/非流式输出
- **请求日志** — 完整记录请求 URL、Body、响应状态，方便调试
- **多协议支持** — OpenAI / Anthropic / OpenAI 兼容（中继渠道通用）
- **双格式兼容** — 同时支持 Chat Completions (`/v1/chat/completions`) 和 Responses API (`/responses`) 两种请求格式
- **独立配置** — 模型列表来源和对话协议可分别设置，适配中继渠道混合路由场景

## 快速开始

```bash
# 克隆项目
git clone https://github.com/kyodule/llm-tester.git
cd llm-tester

# 安装依赖
npm install

# 启动服务
npm start
```

浏览器打开 `http://localhost:5678`

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `5678` |
| `LLM_TESTER_SECRET` | API Key 加密密钥 | `llm-tester-local-key` |

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | [Hono](https://hono.dev/) + Node.js |
| 前端 | [Alpine.js](https://alpinejs.dev/) + [Tailwind CSS](https://tailwindcss.com/) (CDN) |
| 存储 | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (本地文件) |

零构建、零配置、单命令启动。

## 使用说明

### 添加渠道

点击「新建渠道」，填写：
- **名称** — 渠道标识（如 "sub2api-主力"）
- **Base URL** — 渠道地址（如 `https://api.example.com`，不带 `/v1`）
- **API Key** — 渠道密钥（本地 AES-256-CBC 加密存储）

保存后自动检测连通性和协议类型。

### 协议配置

对于中继渠道（newapi、sub2api 等），可能需要手动配置：

- **提供商** — 选择 OpenAI / Anthropic / OpenAI 兼容
- **模型列表来源** — 获取模型列表时使用的协议（通常是 OpenAI 兼容）
- **对话协议** — 实际对话时使用的协议（取决于上游模型）
- **支持能力** — Chat Completions 或 Responses API
- **自定义端点** — 覆盖默认 API 路径（如 `/v1/responses`）

### 批量导入

点击「导入配置」，粘贴 JSON：

```json
[
  {
    "name": "渠道名称",
    "base_url": "https://api.example.com",
    "api_key": "sk-xxx",
    "protocol": "openai-compatible"
  }
]
```

## 项目结构

```
llm-tester/
├── server.js                  # Hono 服务入口
├── public/index.html          # 单文件 SPA 前端
├── src/
│   ├── db.js                  # SQLite 数据库 + API Key 加密
│   ├── utils.js               # 工具函数
│   ├── providers/
│   │   ├── openai.js          # OpenAI / 兼容协议（含 Responses API）
│   │   ├── anthropic.js       # Anthropic Claude 协议
│   │   └── index.js           # 协议注册与自动检测
│   └── routes/
│       ├── channels.js        # 渠道 CRUD + 验证 + 模型 + 测试
│       └── chat.js            # SSE 流式对话
└── data/                      # SQLite 数据库文件（自动创建，已 gitignore）
```

## License

MIT
