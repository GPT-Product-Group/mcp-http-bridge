# MCP HTTP Bridge

将 MCP (Model Context Protocol) 服务包装成标准 HTTP API，供 Dify、N8N 等 AI 平台调用。

## 架构

```
Dify / N8N / 其他 AI 平台
        ↓
  HTTP API 请求
        ↓
┌─────────────────────┐
│  MCP HTTP Bridge    │  ← 本项目
│  (HTTP → MCP 转换)  │
└─────────────────────┘
        ↓
  JSON-RPC 请求
        ↓
┌─────────────────────┐
│   MCP Server        │  ← Shopify 或其他 MCP 服务
│  (Shopify 等)       │
└─────────────────────┘
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
- `MCP_ACCESS_TOKEN`: 访问令牌（用于需要认证的接口）

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

## API 接口

### 健康检查

```bash
GET /api/health
```

响应：
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "config": {
    "storefrontEndpoint": "configured",
    "customerEndpoint": "not configured"
  }
}
```

### 获取工具列表

```bash
GET /api/tools
```

响应：
```json
{
  "success": true,
  "count": 5,
  "tools": [
    {
      "name": "search_products",
      "description": "Search for products in the store",
      "input_schema": {
        "type": "object",
        "properties": {
          "query": { "type": "string" },
          "limit": { "type": "number" }
        }
      }
    }
  ]
}
```

### 调用工具

```bash
POST /api/call
Content-Type: application/json

{
  "tool": "search_products",
  "arguments": {
    "query": "shoes",
    "limit": 10
  }
}
```

响应：
```json
{
  "success": true,
  "tool": "search_products",
  "result": {
    "content": [...]
  }
}
```

## 在 Dify 中使用

1. 进入 Dify 工作室，创建或编辑一个应用
2. 在「工具」面板中，点击「添加自定义工具」
3. 填写配置：
   - **名称**: MCP Bridge
   - **API 基础 URL**: `http://your-server:3000`
   - **认证方式**: 无（或根据需要配置）

4. 添加工具操作：

   **获取工具列表**
   - 方法: GET
   - 路径: /api/tools

   **调用工具**
   - 方法: POST
   - 路径: /api/call
   - 请求体:
     ```json
     {
       "tool": "{{tool_name}}",
       "arguments": {{arguments}}
     }
     ```

5. 保存后即可在 AI 对话中使用 MCP 工具

## 在 N8N 中使用

1. 添加 HTTP Request 节点
2. 配置请求：
   - **Method**: POST
   - **URL**: `http://your-server:3000/api/call`
   - **Body Content Type**: JSON
   - **Body**:
     ```json
     {
       "tool": "search_products",
       "arguments": {
         "query": "{{ $json.query }}"
       }
     }
     ```

## 项目结构

```
mcp-http-bridge/
├── src/
│   ├── server.js          # HTTP 服务入口
│   ├── mcp-client.js      # MCP 客户端
│   └── routes/
│       ├── tools.js       # GET /api/tools
│       └── call.js        # POST /api/call
├── package.json
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 扩展支持其他 MCP 服务

本项目设计为通用的 MCP HTTP 桥接服务，不仅限于 Shopify。

要接入其他 MCP 服务，只需修改 `.env` 中的端点配置即可。

## License

MIT
