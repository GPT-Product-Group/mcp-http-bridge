# MCP HTTP Bridge

将 MCP (Model Context Protocol) 服务包装成标准 HTTP API，供 Dify、N8N 等 AI 平台调用。

**v1.1.0 新增功能：** 自动获取和存储客户 access token，调用订单等需要认证的工具时自动使用存储的 token。

## 架构

```
Dify / N8N / 其他 AI 平台
        ↓
  HTTP API 请求
        ↓
┌─────────────────────────────────┐
│     MCP HTTP Bridge             │  ← 本项目
│  (HTTP → MCP 转换)              │
│  + 自动 OAuth 认证              │
│  + Token 存储和管理             │
└─────────────────────────────────┘
        ↓
  JSON-RPC 请求 (带 Access Token)
        ↓
┌─────────────────────────────────┐
│   MCP Server                    │  ← Shopify 或其他 MCP 服务
│  (Shopify Customer API 等)      │
└─────────────────────────────────┘
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填写配置：

```bash
cp .env.example .env
```

配置说明：
- `PORT`: 服务端口，默认 3000
- `MCP_STOREFRONT_ENDPOINT`: Shopify 商店前台 MCP 端点
- `MCP_CUSTOMER_ENDPOINT`: Shopify 客户账户 MCP 端点
- `SHOPIFY_CLIENT_ID`: Shopify App Client ID (用于 OAuth)
- `SHOPIFY_SHOP_ID`: 商店 ID (如 xxx.myshopify.com)
- `OAUTH_REDIRECT_URI`: OAuth 回调 URL

### 3. 启动服务

```bash
# 开发模式（自动重启）
npm run dev

# 生产模式
npm start
```

### 4. Docker 部署

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f
```

## 客户认证流程

当调用需要认证的工具（如订单查询）时，系统会自动：

1. 检查是否有存储的有效 token
2. 如果有，自动使用该 token 调用 API
3. 如果没有，返回认证 URL，引导用户完成 OAuth 认证
4. 认证完成后，token 自动存储，后续调用自动使用

### 手动触发认证

```bash
# 获取认证 URL
GET /auth/url?session_id=my_session&shop_id=xxx.myshopify.com

# 或直接重定向到认证页面
GET /auth/login?session_id=my_session&shop_id=xxx.myshopify.com

# 检查认证状态
GET /auth/status?session_id=my_session
```

### 在 API 调用中使用

```bash
POST /api/call
Content-Type: application/json

{
  "tool": "get_customer_orders",
  "arguments": { "first": 10 },
  "session_id": "my_session"  // 系统会自动查找该 session 的 token
}
```

## API 接口

### 健康检查

```bash
GET /api/health
```

### 获取工具列表

```bash
GET /api/tools
```

### 调用工具

```bash
POST /api/call
Content-Type: application/json

{
  "tool": "search_products",
  "arguments": { "query": "shoes", "limit": 10 },
  "session_id": "optional_session_id"
}
```

### OAuth 认证

```bash
# 发起认证
GET /auth/login?session_id=xxx&shop_id=xxx.myshopify.com

# OAuth 回调 (自动处理)
GET /auth/callback

# 检查状态
GET /auth/status?session_id=xxx

# 获取认证 URL (不重定向)
GET /auth/url?session_id=xxx&shop_id=xxx.myshopify.com
```

## 在 Dify 中使用

### 方式一：MCP 服务 (HTTP) - 推荐

本服务完全支持 Dify 的原生 MCP HTTP 协议集成：

1. 进入 Dify，点击「工具」→「MCP」
2. 点击「添加 MCP 服务 (HTTP)」
3. 输入 SSE URL：
   ```
   http://your-server:3000/mcp/sse?shop_id=xxx.myshopify.com
   ```
   > 提示：添加 `shop_id` 参数可以自动配置客户 API 端点
4. Dify 会自动发现服务并获取可用工具
5. 完成！现在可以在 Agent 或 Workflow 中使用 MCP 工具

**MCP HTTP 端点说明：**
- `GET /mcp/sse` - SSE 端点，用于服务发现
- `POST /mcp/messages?session_id=xxx` - JSON-RPC 消息端点

### 方式二：自定义 HTTP 工具

也可以作为自定义 HTTP 工具使用：

1. 进入 Dify 工作室，创建或编辑一个应用
2. 在「工具」面板中，点击「添加自定义工具」
3. 填写配置：
   - **名称**: MCP Bridge
   - **API 基础 URL**: `http://your-server:3000`

4. 添加工具操作：

   **调用工具**
   - 方法: POST
   - 路径: /api/call
   - 请求体:
     ```json
     {
       "tool": "{{tool_name}}",
       "arguments": {{arguments}},
       "session_id": "{{session_id}}"
     }
     ```

## 在 N8N 中使用

1. 添加 HTTP Request 节点
2. 配置请求：
   - **Method**: POST
   - **URL**: `http://your-server:3000/api/call`
   - **Body Content Type**: JSON
   - **Body**:
     ```json
     {
       "tool": "get_customer_orders",
       "arguments": {
         "first": 10
       },
       "session_id": "{{ $json.session_id }}"
     }
     ```

## 项目结构

```
mcp-http-bridge/
├── src/
│   ├── server.js          # HTTP 服务入口
│   ├── mcp-client.js      # MCP 客户端 (支持自动认证)
│   ├── db.js              # SQLite 数据库 (token 存储)
│   ├── auth.js            # OAuth 认证模块
│   └── routes/
│       ├── tools.js       # GET /api/tools
│       ├── call.js        # POST /api/call
│       ├── mcp.js         # MCP 协议端点
│       └── auth.js        # OAuth 路由
├── data/                  # SQLite 数据库文件 (自动创建)
├── package.json
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 数据存储

Token 和认证信息存储在本地 SQLite 数据库中：
- 位置：`data/tokens.db`
- 自动创建，无需手动配置
- 过期数据自动清理

## 扩展支持其他 MCP 服务

本项目设计为通用的 MCP HTTP 桥接服务，不仅限于 Shopify。

要接入其他 MCP 服务，只需修改 `.env` 中的端点配置即可。

## License

MIT
