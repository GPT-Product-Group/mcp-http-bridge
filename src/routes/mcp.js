/**
 * MCP Protocol Routes for Dify Integration
 *
 * 实现 Dify MCP HTTP 服务所需的端点:
 * - GET /sse - SSE 端点用于服务发现
 * - POST /message - JSON-RPC 消息端点
 *
 * 支持的 MCP 方法:
 * - initialize
 * - notifications/initialized
 * - tools/list
 * - tools/call
 */

import { Router } from 'express';

const router = Router();

// MCP 协议版本
const PROTOCOL_VERSION = '2024-11-05';

// 服务器信息
const SERVER_INFO = {
  name: 'mcp-http-bridge',
  version: '1.0.0'
};

// 服务器能力
const SERVER_CAPABILITIES = {
  tools: {}
};

/**
 * GET /sse
 * SSE 端点 - Dify 用这个端点发现 MCP 消息端点
 *
 * 返回格式:
 * event: endpoint
 * data: <message_endpoint_url>
 */
router.get('/sse', (req, res) => {
  console.log('\n========== SSE Connection ==========');
  console.log('Client connected to SSE endpoint');

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 构建消息端点 URL
  const protocol = req.protocol;
  const host = req.get('host');
  const messageEndpoint = `${protocol}://${host}/mcp/message`;

  console.log(`Sending endpoint event: ${messageEndpoint}`);

  // 发送 endpoint 事件
  res.write(`event: endpoint\n`);
  res.write(`data: ${messageEndpoint}\n\n`);

  // 保持连接活跃 - 每 30 秒发送心跳
  const heartbeatInterval = setInterval(() => {
    res.write(`:heartbeat\n\n`);
  }, 30000);

  // 客户端断开连接时清理
  req.on('close', () => {
    console.log('SSE client disconnected');
    clearInterval(heartbeatInterval);
  });
});

/**
 * POST /message
 * MCP JSON-RPC 消息端点
 *
 * 处理所有 MCP 方法:
 * - initialize
 * - notifications/initialized
 * - tools/list
 * - tools/call
 */
router.post('/message', async (req, res) => {
  const mcpClient = req.app.get('mcpClient');

  console.log('\n========== MCP Message ==========');
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  const { jsonrpc, id, method, params } = req.body;

  // 验证 JSON-RPC 格式
  if (jsonrpc !== '2.0') {
    return res.json({
      jsonrpc: '2.0',
      id: id || null,
      error: {
        code: -32600,
        message: 'Invalid Request: jsonrpc must be "2.0"'
      }
    });
  }

  try {
    let result;

    switch (method) {
      case 'initialize':
        result = await handleInitialize(params);
        break;

      case 'notifications/initialized':
        // 这是一个通知，返回空结果
        result = {};
        break;

      case 'tools/list':
        result = await handleToolsList(mcpClient);
        break;

      case 'tools/call':
        result = await handleToolsCall(mcpClient, params);
        break;

      default:
        return res.json({
          jsonrpc: '2.0',
          id: id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        });
    }

    console.log('Response result:', JSON.stringify(result).substring(0, 500));

    // 对于通知(没有 id)，仍然返回响应但不包含 id
    if (method.startsWith('notifications/')) {
      return res.json({
        jsonrpc: '2.0',
        result: result
      });
    }

    res.json({
      jsonrpc: '2.0',
      id: id,
      result: result
    });

  } catch (error) {
    console.error('MCP method error:', error);
    res.json({
      jsonrpc: '2.0',
      id: id,
      error: {
        code: -32000,
        message: error.message,
        data: error.data || null
      }
    });
  }
});

/**
 * 处理 initialize 方法
 */
async function handleInitialize(params) {
  console.log('Handling initialize:', params);

  return {
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: SERVER_INFO,
    capabilities: SERVER_CAPABILITIES
  };
}

/**
 * 处理 tools/list 方法
 */
async function handleToolsList(mcpClient) {
  console.log('Handling tools/list');

  if (!mcpClient) {
    throw new Error('MCP client not initialized');
  }

  // 确保已连接
  if (mcpClient.getTools().length === 0) {
    console.log('No tools loaded, connecting to MCP servers...');
    await mcpClient.connectAll();
  }

  const tools = mcpClient.getTools();

  // 转换为 MCP 标准格式
  const formattedTools = tools.map(tool => ({
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.input_schema || {
      type: 'object',
      properties: {},
      required: []
    }
  }));

  console.log(`Returning ${formattedTools.length} tools`);

  return {
    tools: formattedTools
  };
}

/**
 * 处理 tools/call 方法
 */
async function handleToolsCall(mcpClient, params) {
  console.log('Handling tools/call:', params);

  if (!mcpClient) {
    throw new Error('MCP client not initialized');
  }

  const { name, arguments: toolArgs } = params || {};

  if (!name) {
    throw new Error('Tool name is required');
  }

  // 确保已连接
  if (mcpClient.getTools().length === 0) {
    console.log('No tools loaded, connecting to MCP servers...');
    await mcpClient.connectAll();
  }

  // 解析参数（处理可能的字符串格式）
  let parsedArgs = toolArgs || {};
  if (typeof toolArgs === 'string') {
    try {
      parsedArgs = JSON.parse(toolArgs);
    } catch (e) {
      try {
        // 处理 Python 风格字符串
        const fixedJson = toolArgs
          .replace(/'/g, '"')
          .replace(/True/g, 'true')
          .replace(/False/g, 'false')
          .replace(/None/g, 'null');
        parsedArgs = JSON.parse(fixedJson);
      } catch (e2) {
        parsedArgs = {};
      }
    }
  }

  console.log(`Calling tool: ${name}`);
  console.log('Arguments:', JSON.stringify(parsedArgs, null, 2));

  const result = await mcpClient.callTool(name, parsedArgs);

  // 返回 MCP 标准格式的工具调用结果
  return {
    content: [
      {
        type: 'text',
        text: typeof result === 'string' ? result : JSON.stringify(result)
      }
    ]
  };
}

// 不支持 GET 请求到 /message
router.get('/message', (req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32600,
      message: 'Method not allowed. Use POST for JSON-RPC messages.'
    }
  });
});

export default router;
