# 更新日志

## 2026-03-06 v4 - 增强自动检测和多协议兼容能力

### 核心改进

1. **Base URL 智能处理**
   - 新增 `buildUrl` 函数，自动处理 `/v1` 重复拼接问题
   - 用户填写 Base URL 时带不带 `/v1` 均可，系统自动适配
   - 彻底解决 `/v1/v1/models` 等路径拼接错误

2. **Gemini 原生协议支持**
   - 注册 Gemini provider，支持 Google Gemini 原生 API
   - 自动检测流程加入 Gemini（OpenAI → Anthropic → Gemini）
   - 前端协议选择器、创建对话框均加入 Gemini 选项

3. **验证能力增强**
   - `/v1/models` 不可用时，自动 fallback 到 Chat Completions 端点验证
   - `detectCapabilities` 不再硬编码 `gpt-3.5-turbo`，改用通用占位模型名
   - 400/401/404 状态码均视为端点存在（只是参数/模型/认证问题）

4. **Responses API 端点修正**
   - 默认端点从 `/responses` 修正为 `/v1/responses`，与 NewAPI 等中继站对齐

---

## 2026-03-05 v3 - 拆分模型列表来源和对话协议

### 核心改进

**解决中继渠道的协议混用问题**：很多中继渠道（如 newapi、sub2api）使用 OpenAI 兼容的接口格式（`/v1/models`），但实际转发的是 Anthropic 等其他提供商的模型。之前的设计只能选一个协议，导致：
- 选 OpenAI 通用 → 模型列表正确，但对话调不通
- 选 Anthropic → 对话能通，但模型列表是硬编码的老版本

现在拆分成两个独立配置：
1. **模型列表来源**：控制从哪个协议获取模型列表
2. **对话/测试协议**：控制实际调用时使用的消息格式

### 使用方法

#### 典型场景：中继渠道转发 Anthropic 模型

1. 验证渠道后，在状态卡片中：
   - **模型列表来源** 选择 "OpenAI 通用"（获取正确的模型列表）
   - **对话/测试协议** 选择 "Anthropic"（使用 Anthropic 消息格式调用）

2. 点击"刷新"重新加载模型列表，现在会显示正确的模型名称

3. 测试模型或进行对话，会使用 Anthropic 协议调用，能正常工作

### 技术细节

- 数据库增加 `models_protocol` 字段（自动迁移）
- 新增 API 端点：`POST /api/channels/:id/switch-models-protocol`
- 协议优先级：
  - 模型列表：`models_protocol > force_protocol > detected_protocol > protocol`
  - 对话/测试：`force_protocol > detected_protocol > protocol`

---

## 2026-03-05 v2 - 支持手动切换 API 类型

### 新增功能

1. **手动切换 API 类型**
   - 在渠道状态卡片中增加 API 类型切换按钮（`/v1/chat/completions` / `/v1/responses`）
   - 针对中继渠道（如 newapi、sub2api）可能使用不同的 API 端点
   - 切换后会立即生效，影响模型测试和对话功能

2. **优化 API 类型显示**
   - 状态卡片中显示当前使用的 API 类型（chat / responses）
   - 支持手动指定，覆盖自动检测结果

### 使用场景

#### 场景：中继渠道返回 "Unsupported legacy protocol" 错误

如果你看到类似错误：
```
HTTP 400: {"error":{"message":"Unsupported legacy protocol: /v1/chat/completions is not supported. Please use /v1/responses."}}
```

**解决方法：**
1. 在渠道状态卡片中找到"手动切换 API 类型"区域
2. 点击 `/v1/responses` 按钮
3. 重新测试模型或进行对话

### 技术细节

- 数据库增加 `force_api_type` 字段（自动迁移）
- 新增 API 端点：`POST /api/channels/:id/switch-api-type`
- OpenAI 协议适配器支持两种端点：
  - `/v1/chat/completions`（标准 OpenAI 格式）
  - `/v1/responses`（部分中继渠道使用）

---

## 2026-03-05 v1 - 支持中继渠道和手动协议切换

### 新增功能

1. **手动切换协议**
   - 在渠道状态卡片中增加协议切换按钮（OpenAI / Anthropic / Gemini）
   - 如果自动检测的协议不正确，可以手动切换
   - 切换后会自动重新加载模型列表

2. **手动添加模型**
   - 在模型列表上方增加手动输入框
   - 适用于中继渠道（如 newapi、sub2api）返回的模型列表不准确的情况
   - 可以直接输入模型名称（如 `gpt-4`、`claude-3-5-sonnet-20241022`）进行测试

3. **协议优先级**
   - 新增 `force_protocol` 字段，优先级：手动指定 > 自动检测 > 配置默认值
   - 状态卡片会显示当前实际使用的协议

### 使用场景

#### 场景 1：中继渠道自动检测错误

如果你的中继渠道（如 newapi）被错误识别为 OpenAI 协议，但实际需要使用其他协议：

1. 验证渠道后，查看状态卡片中的"协议类型"
2. 如果不正确，点击下方的协议切换按钮（OpenAI / Anthropic / Gemini）
3. 系统会自动重新加载模型列表

#### 场景 2：模型列表不准确

如果 `/v1/models` 返回的模型列表不完整或不准确：

1. 在"模型列表"卡片上方的输入框中手动输入模型名称
2. 点击"添加"按钮
3. 手动添加的模型会出现在列表中，可以进行测试和对话

#### 场景 3：API 返回 "Unsupported legacy protocol" 错误

如果看到类似错误：
```
/v1/chat/completions is not supported. Please use /v1/responses.
```

这说明该渠道使用了非标准协议。目前工具支持三种标准协议，如果都不匹配，建议：
1. 联系渠道提供商确认 API 格式
2. 或使用支持标准 OpenAI/Anthropic/Gemini 协议的渠道

### 技术细节

- 数据库增加 `force_protocol` 字段（自动迁移，无需手动操作）
- 新增 API 端点：`POST /api/channels/:id/switch-protocol`
- 协议解析优先级：`force_protocol > detected_protocol > protocol`

### 重启服务

如果服务正在运行，重启以应用更新：

```bash
cd ~/code/llm-tester
npm start
```
