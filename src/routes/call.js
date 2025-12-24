/**
 * Tool Call API 路由
 * POST /api/call - 调用指定的 MCP 工具
 *
 * 增强功能：
 * - 支持通过 session_id 自动获取存储的 customer token
 * - 调用需要认证的工具时自动使用 token
 * - 支持 Shopify Admin API (admin_token 参数)
 */

import { Router } from 'express';
import { getCustomerToken } from '../db.js';

const router = Router();

/**
 * POST /api/call
 * 调用指定的 MCP 工具
 *
 * Request Body:
 * {
 *   "tool": "tool_name",           // 必填：工具名称
 *   "arguments": { ... },          // 可选：工具参数
 *   "session_id": "xxx",           // 可选：会话 ID（用于自动获取存储的 token）
 *   "accessToken": "xxx",          // 可选：直接传递 access token（优先级最高）
 *   "admin_token": "shpat_xxx",    // 可选：Shopify Admin API Token
 *   "shop_id": "xxx.myshopify.com" // 可选：店铺域名（Admin API 必须）
 * }
 *
 * Request Headers (alternative):
 * - X-Admin-Token: shpat_xxx
 * - X-Shopify-Access-Token: shpat_xxx
 * - X-Shop-Id: xxx.myshopify.com
 *
 * Response:
 * {
 *   "success": true,
 *   "result": { ... }              // 工具返回结果
 * }
 *
 * 如果需要认证但没有有效 token，返回：
 * {
 *   "success": false,
 *   "error": "auth_required",
 *   "auth_url": "https://...",     // 认证 URL
 *   "session_id": "xxx"            // 用于后续调用的 session ID
 * }
 */
router.post('/', async (req, res) => {
  try {
    const mcpClient = req.app.get('mcpClient');
    
    if (!mcpClient) {
      return res.status(503).json({
        error: 'MCP client not initialized',
        message: 'Please check server configuration'
      });
    }

    console.log('\n========== Incoming Request ==========');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const { tool, arguments: toolArgs, accessToken, session_id, admin_token, shop_id } = req.body;

    // 从请求头或请求体提取 accessToken（请求体优先）
    const headerToken = req.headers['authorization'] || req.headers['x-access-token'];
    let dynamicToken = accessToken || headerToken;

    // 从请求头或请求体提取 adminToken 和 shopId
    const headerAdminToken = req.headers['x-admin-token'] || req.headers['x-shopify-access-token'];
    const headerShopId = req.headers['x-shop-id'];
    const adminToken = admin_token || headerAdminToken;
    const shopId = shop_id || headerShopId;

    if (adminToken) {
      console.log('Admin token provided:', adminToken.substring(0, 15) + '...');
    }
    if (shopId) {
      console.log('Shop ID provided:', shopId);
    }

    // 如果没有直接传递 token，尝试从数据库获取
    if (!dynamicToken && session_id) {
      console.log('Attempting to get token from database for session:', session_id);
      const tokenRecord = getCustomerToken(session_id);
      if (tokenRecord && tokenRecord.access_token) {
        dynamicToken = tokenRecord.access_token;
        console.log('Found token in database, expires:', tokenRecord.expires_at);
      } else {
        console.log('No valid token found in database for session:', session_id);
      }
    }

    // 如果还没有 token，使用环境变量中的 MCP_ACCESS_TOKEN（兜底）
    if (!dynamicToken && process.env.MCP_ACCESS_TOKEN) {
      dynamicToken = process.env.MCP_ACCESS_TOKEN;
      console.log('Using MCP_ACCESS_TOKEN from environment');
    }

    if (dynamicToken) {
      console.log('Using accessToken:', dynamicToken.substring(0, 15) + '...');
    }

    // 处理 arguments 可能是字符串的情况（Dify 有时会这样传）
    let parsedArgs = toolArgs;
    if (typeof toolArgs === 'string') {
      console.log('Arguments is a string, attempting to parse...');
      console.log('Raw string:', toolArgs);
      
      try {
        // 先尝试标准 JSON 解析
        parsedArgs = JSON.parse(toolArgs);
        console.log('Parsed with JSON.parse:', parsedArgs);
      } catch (e) {
        console.log('Standard JSON.parse failed, trying to fix format...');
        try {
          // Dify 可能传递 Python 风格的字符串（单引号），尝试转换
          // 将单引号替换为双引号（注意处理转义）
          const fixedJson = toolArgs
            .replace(/'/g, '"')  // 单引号 -> 双引号
            .replace(/True/g, 'true')  // Python True -> JSON true
            .replace(/False/g, 'false')  // Python False -> JSON false
            .replace(/None/g, 'null');  // Python None -> JSON null
          
          console.log('Fixed JSON string:', fixedJson);
          parsedArgs = JSON.parse(fixedJson);
          console.log('Parsed with fixed format:', parsedArgs);
        } catch (e2) {
          console.error('Failed to parse arguments:', e2.message);
          // 如果还是失败，返回空对象
          parsedArgs = {};
        }
      }
    }
    
    // 确保 parsedArgs 是对象
    if (typeof parsedArgs !== 'object' || parsedArgs === null) {
      console.log('parsedArgs is not an object, using empty object');
      parsedArgs = {};
    }

    // 验证必填参数
    if (!tool) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'Parameter "tool" is required'
      });
    }

    // 确保已连接
    if (mcpClient.getTools().length === 0) {
      console.log('No tools loaded, connecting to MCP servers...');
      await mcpClient.connectAll({ sessionId: session_id, accessToken: dynamicToken, adminToken, shopId });
    }

    // 如果有 adminToken，确保加载 Admin 工具
    if (adminToken && mcpClient.adminTools.length === 0) {
      console.log('Loading Admin API tools...');
      mcpClient.loadAdminTools({ adminToken });
    }

    // 调用工具
    console.log(`Calling tool: ${tool}`);
    console.log('Arguments:', JSON.stringify(parsedArgs, null, 2));

    // 构建调用选项，包含动态 token、admin token 和 session_id
    const callOptions = {
      accessToken: dynamicToken,
      adminToken: adminToken,
      shopId: shopId,
      sessionId: session_id
    };

    const result = await mcpClient.callTool(tool, parsedArgs || {}, callOptions);

    // 检查是否返回了认证错误
    if (result && result.error && result.error.type === 'auth_required') {
      console.log('Authentication required, returning auth URL');
      return res.status(401).json({
        success: false,
        error: 'auth_required',
        message: result.error.message,
        auth_url: result.error.auth_url,
        session_id: result.error.session_id || session_id
      });
    }

    console.log('Tool call successful!');
    console.log('Result preview:', JSON.stringify(result).substring(0, 500));

    res.json({
      success: true,
      tool: tool,
      result: result
    });
  } catch (error) {
    console.error('Error calling tool:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      data: error.data
    });
    
    // 根据错误类型返回不同的状态码
    const statusCode = error.message.includes('not found') ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: 'Tool call failed',
      message: error.message,
      details: error.data || null
    });
  }
});

export default router;
