/**
 * MCP Protocol Routes for Dify Integration
 *
 * 支持两种传输协议：
 * 1. SSE Transport (Dify 使用) - 通过 SSE 流返回响应
 * 2. Streamable HTTP - 新版协议 (2025-03-26)
 *
 * 端点:
 * - GET /sse - 建立 SSE 连接，返回 endpoint 事件指向 /messages?session_id=xxx
 * - POST /messages?session_id=xxx - SSE 传输端点，通过 SSE 流返回响应
 * - POST /sse - Streamable HTTP JSON-RPC 端点（同步响应）
 * - POST /message - JSON-RPC 消息端点（兼容旧版）
 *
 * 支持的 MCP 方法:
 * - initialize
 * - notifications/initialized
 * - tools/list
 * - tools/call
 */

import { Router } from 'express';
import crypto from 'crypto';

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

// Session 存储 - 存储 SSE 连接和 session 信息
// key: sessionId, value: { res: SSE response object, createdAt: timestamp }
const sessions = new Map();

/**
 * 生成 Session ID
 */
function generateSessionId() {
  return crypto.randomUUID();
}

/**
 * 通过 SSE 发送消息事件
 */
function sendSseMessage(res, data) {
  try {
    res.write(`event: message\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    console.error('Error sending SSE message:', e);
  }
}

/**
 * GET /sse
 * SSE 端点 - Dify 用这个端点发现 MCP 消息端点
 * 建立 SSE 连接后，发送 endpoint 事件告诉客户端后续 POST 请求发送到哪里
 *
 * 支持通过 URL 参数传递 accessToken:
 * GET /sse?access_token=xxx
 */
router.get('/sse', (req, res) => {
  console.log('\n========== SSE Connection ==========');
  console.log('Client connected to SSE endpoint');
  console.log('Query params:', req.query);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));

  // 从 URL 参数或请求头获取 accessToken
  const accessToken = req.query.access_token || req.query.accessToken ||
                      req.headers['authorization'] || req.headers['x-access-token'];

  if (accessToken) {
    console.log('AccessToken provided via URL/header:', accessToken.substring(0, 10) + '...');
  } else {
    console.log('WARNING: No accessToken provided in URL or headers');
  }

  // 生成 session ID 用于关联此 SSE 连接
  const sessionId = generateSessionId();
  console.log(`Generated session ID: ${sessionId}`);

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  // 构建消息端点 URL - 必须包含 session_id 以关联 SSE 连接
  const protocol = req.protocol;
  const host = req.get('host');
  // 尝试使用 X-Forwarded 头（如果通过代理）
  const forwardedProto = req.get('X-Forwarded-Proto') || protocol;
  const forwardedHost = req.get('X-Forwarded-Host') || host;
  // 正确的格式：返回 /mcp/messages 端点并带上 session_id
  const messageEndpoint = `${forwardedProto}://${forwardedHost}/mcp/messages?session_id=${sessionId}`;

  console.log(`Sending endpoint event: ${messageEndpoint}`);

  // 立即 flush 头部
  res.flushHeaders();

  // 发送 endpoint 事件
  res.write(`event: endpoint\n`);
  res.write(`data: ${messageEndpoint}\n\n`);

  // 存储 session 信息，包括 SSE response 对象和 accessToken 用于后续发送响应
  sessions.set(sessionId, {
    res: res,
    accessToken: accessToken || null,
    createdAt: Date.now()
  });
  console.log(`Session stored. Active sessions: ${sessions.size}`);

  // 保持连接活跃 - 每 15 秒发送心跳
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(`:heartbeat\n\n`);
    } catch (e) {
      clearInterval(heartbeatInterval);
    }
  }, 15000);

  // 客户端断开连接时清理
  req.on('close', () => {
    console.log(`SSE client disconnected, session: ${sessionId}`);
    clearInterval(heartbeatInterval);
    sessions.delete(sessionId);
    console.log(`Session removed. Active sessions: ${sessions.size}`);
  });
});

/**
 * POST /sse
 * Streamable HTTP 端点 - 处理 JSON-RPC 消息（同步响应模式）
 * 这是新版 MCP 协议的主要端点
 */
router.post('/sse', async (req, res) => {
  await handleMcpMessage(req, res);
});

/**
 * POST /messages
 * SSE 传输协议的消息端点 - 通过 SSE 流返回响应
 * 这是 Dify 使用的标准 MCP SSE 协议端点
 */
router.post('/messages', async (req, res) => {
  const mcpClient = req.app.get('mcpClient');
  const sessionId = req.query.session_id;

  console.log('\n========== MCP Messages (SSE Transport) ==========');
  console.log('Session ID:', sessionId);
  console.log('URL:', req.originalUrl);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  // 验证 session
  if (!sessionId) {
    return res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: 'Missing session_id parameter'
      }
    });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    return res.status(404).json({
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: 'Session not found'
      }
    });
  }

  const sseRes = session.res;
  const { jsonrpc, id, method, params } = req.body;

  // 验证 JSON-RPC 格式
  if (jsonrpc !== '2.0') {
    const errorResponse = {
      jsonrpc: '2.0',
      id: id || null,
      error: {
        code: -32600,
        message: 'Invalid Request: jsonrpc must be "2.0"'
      }
    };
    sendSseMessage(sseRes, errorResponse);
    return res.status(202).send('Accepted');
  }

  try {
    let result;

    switch (method) {
      case 'initialize':
        result = await handleInitialize(params);
        break;

      case 'notifications/initialized':
      case 'initialized':
        // 这是一个通知，返回空结果
        result = {};
        break;

      case 'tools/list':
        result = await handleToolsList(mcpClient);
        break;

      case 'tools/call':
        // 优先从 session 中获取 accessToken（SSE 连接时通过 URL 参数传递）
        // 其次从请求头提取
        const sessionToken = session.accessToken;
        const headerToken = req.headers['authorization'] || req.headers['x-access-token'];
        const sseToken = sessionToken || headerToken;
        console.log('=== Token Debug ===');
        console.log('Session accessToken:', sessionToken ? sessionToken.substring(0, 10) + '...' : 'null');
        console.log('Header accessToken:', headerToken ? headerToken.substring(0, 10) + '...' : 'null');
        console.log('Final token:', sseToken ? sseToken.substring(0, 10) + '...' : 'null');
        result = await handleToolsCall(mcpClient, params, { accessToken: sseToken });
        break;

      default:
        const errorResponse = {
          jsonrpc: '2.0',
          id: id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        };
        sendSseMessage(sseRes, errorResponse);
        return res.status(202).send('Accepted');
    }

    // 构建完整的 JSON-RPC 2.0 响应
    let response;
    if (id === undefined || id === null) {
      // 通知不需要发送响应
      console.log('Notification received, no response needed');
    } else {
      response = {
        jsonrpc: '2.0',
        id: id,
        result: result
      };
      console.log('Sending SSE response:', JSON.stringify(response).substring(0, 500));
      sendSseMessage(sseRes, response);
    }

    // 返回 202 Accepted
    res.status(202).send('Accepted');

  } catch (error) {
    console.error('MCP method error:', error);
    const errorResponse = {
      jsonrpc: '2.0',
      id: id,
      error: {
        code: -32000,
        message: error.message,
        data: error.data || null
      }
    };
    sendSseMessage(sseRes, errorResponse);
    res.status(202).send('Accepted');
  }
});

/**
 * OPTIONS /messages（CORS 预检）
 */
router.options('/messages', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
});

/**
 * POST /message
 * 传统 JSON-RPC 消息端点（保持向后兼容）
 */
router.post('/message', async (req, res) => {
  await handleMcpMessage(req, res);
});

/**
 * 处理 MCP JSON-RPC 消息
 */
async function handleMcpMessage(req, res) {
  const mcpClient = req.app.get('mcpClient');

  console.log('\n========== MCP Message ==========');
  console.log('URL:', req.originalUrl);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  // 设置响应头
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

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
    let sessionId = req.get('Mcp-Session-Id');

    switch (method) {
      case 'initialize':
        result = await handleInitialize(params);
        // 生成新的 Session ID
        sessionId = generateSessionId();
        sessions.set(sessionId, { createdAt: Date.now() });
        res.setHeader('Mcp-Session-Id', sessionId);
        console.log(`Created session: ${sessionId}`);
        break;

      case 'notifications/initialized':
      case 'initialized':
        // 这是一个通知，返回空结果
        result = {};
        break;

      case 'tools/list':
        result = await handleToolsList(mcpClient);
        break;

      case 'tools/call':
        // 从请求头提取 accessToken
        const httpToken = req.headers['authorization'] || req.headers['x-access-token'];
        result = await handleToolsCall(mcpClient, params, { accessToken: httpToken });
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

    // 构建完整的 JSON-RPC 2.0 响应
    let response;

    // 对于通知(没有 id 或 id 为 null)，返回空响应体或简单确认
    if (id === undefined || id === null) {
      response = {
        jsonrpc: '2.0',
        result: {}
      };
    } else {
      // 标准 JSON-RPC 2.0 响应格式
      response = {
        jsonrpc: '2.0',
        id: id,
        result: result
      };
    }

    console.log('Sending JSON-RPC response:', JSON.stringify(response).substring(0, 1000));
    res.json(response);

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
}

/**
 * OPTIONS 请求处理（CORS 预检）
 */
router.options('/sse', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
});

router.options('/message', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
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
 * @param {Object} mcpClient - MCP 客户端实例
 * @param {Object} params - 工具调用参数
 * @param {Object} options - 可选配置
 * @param {string} options.accessToken - 动态传递的访问令牌
 */
async function handleToolsCall(mcpClient, params, options = {}) {
  console.log('Handling tools/call:', params);

  if (!mcpClient) {
    throw new Error('MCP client not initialized');
  }

  const { name, arguments: toolArgs, accessToken: paramToken } = params || {};

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

  // 支持从参数中传递 accessToken（优先于 options）
  const dynamicToken = paramToken || options.accessToken;
  const callOptions = dynamicToken ? { accessToken: dynamicToken } : {};

  if (dynamicToken) {
    console.log('Using dynamic accessToken for tool call');
  }

  console.log(`Calling tool: ${name}`);
  console.log('Arguments:', JSON.stringify(parsedArgs, null, 2));

  const result = await mcpClient.callTool(name, parsedArgs, callOptions);

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
