/**
 * MCP HTTP Bridge Server
 * 将 MCP 服务包装成标准 HTTP API，供 Dify/N8N 等平台调用
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import MCPClient from './mcp-client.js';
import toolsRouter from './routes/tools.js';
import callRouter from './routes/call.js';
import mcpRouter from './routes/mcp.js';

// 加载环境变量
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 请求日志
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// 初始化 MCP 客户端
const mcpClient = new MCPClient({
  storefrontEndpoint: process.env.MCP_STOREFRONT_ENDPOINT,
  customerEndpoint: process.env.MCP_CUSTOMER_ENDPOINT,
  accessToken: process.env.MCP_ACCESS_TOKEN
});

// 将 MCP 客户端挂载到 app 上，供路由使用
app.set('mcpClient', mcpClient);

// 路由
app.use('/api/tools', toolsRouter);
app.use('/api/call', callRouter);

// MCP 协议路由 (用于 Dify MCP HTTP 集成)
app.use('/mcp', mcpRouter);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    config: {
      storefrontEndpoint: process.env.MCP_STOREFRONT_ENDPOINT ? 'configured' : 'not configured',
      customerEndpoint: process.env.MCP_CUSTOMER_ENDPOINT ? 'configured' : 'not configured'
    }
  });
});

// 根路由 - API 文档
app.get('/', (req, res) => {
  const protocol = req.protocol;
  const host = req.get('host');

  res.json({
    name: 'MCP HTTP Bridge',
    version: '1.0.0',
    description: 'HTTP bridge for MCP (Model Context Protocol) services',
    endpoints: {
      'GET /api/health': 'Health check',
      'GET /api/tools': 'List all available MCP tools',
      'POST /api/call': 'Call a specific MCP tool',
      'GET /mcp/sse': 'MCP SSE endpoint for Dify service discovery',
      'POST /mcp/message': 'MCP JSON-RPC message endpoint'
    },
    dify_integration: {
      description: 'To add this service in Dify as an MCP Server (HTTP)',
      sse_url: `${protocol}://${host}/mcp/sse`,
      instructions: [
        '1. In Dify, go to Tools > MCP',
        '2. Click "Add MCP Server (HTTP)"',
        '3. Enter the SSE URL shown above',
        '4. Dify will automatically discover the message endpoint'
      ]
    },
    usage: {
      '/api/call': {
        method: 'POST',
        body: {
          tool: 'tool_name (required)',
          arguments: '{ ... } (optional)'
        },
        example: {
          tool: 'search_products',
          arguments: { query: 'shoes', limit: 10 }
        }
      }
    }
  });
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.path} does not exist`,
    availableEndpoints: [
      'GET /',
      'GET /api/health',
      'GET /api/tools',
      'POST /api/call',
      'GET /mcp/sse',
      'POST /mcp/message'
    ]
  });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// 启动服务器
app.listen(PORT, async () => {
  console.log('========================================');
  console.log('  MCP HTTP Bridge Server');
  console.log('========================================');
  console.log(`  Server running at http://localhost:${PORT}`);
  console.log('');
  console.log('  REST API Endpoints:');
  console.log(`    GET  http://localhost:${PORT}/api/health`);
  console.log(`    GET  http://localhost:${PORT}/api/tools`);
  console.log(`    POST http://localhost:${PORT}/api/call`);
  console.log('');
  console.log('  Dify MCP HTTP Endpoints:');
  console.log(`    GET  http://localhost:${PORT}/mcp/sse     (SSE for service discovery)`);
  console.log(`    POST http://localhost:${PORT}/mcp/message (JSON-RPC messages)`);
  console.log('');
  console.log('  To add in Dify:');
  console.log(`    Use SSE URL: http://localhost:${PORT}/mcp/sse`);
  console.log('========================================');

  // 启动时尝试连接 MCP 服务器
  if (process.env.MCP_STOREFRONT_ENDPOINT || process.env.MCP_CUSTOMER_ENDPOINT) {
    console.log('\nConnecting to MCP servers...');
    try {
      await mcpClient.connectAll();
      console.log(`Connected! Found ${mcpClient.getTools().length} tools.`);
    } catch (error) {
      console.warn('Warning: Could not connect to MCP servers:', error.message);
      console.warn('Tools will be fetched on first request.');
    }
  } else {
    console.log('\nNote: No MCP endpoints configured.');
    console.log('Set MCP_STOREFRONT_ENDPOINT and/or MCP_CUSTOMER_ENDPOINT in .env file.');
  }
});

export default app;
