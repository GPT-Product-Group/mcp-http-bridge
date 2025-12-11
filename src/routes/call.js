/**
 * Tool Call API 路由
 * POST /api/call - 调用指定的 MCP 工具
 */

import { Router } from 'express';

const router = Router();

/**
 * POST /api/call
 * 调用指定的 MCP 工具
 * 
 * Request Body:
 * {
 *   "tool": "tool_name",           // 必填：工具名称
 *   "arguments": { ... }           // 可选：工具参数
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "result": { ... }              // 工具返回结果
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

    const { tool, arguments: toolArgs } = req.body;

    // 验证必填参数
    if (!tool) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'Parameter "tool" is required'
      });
    }

    // 确保已连接
    if (mcpClient.getTools().length === 0) {
      await mcpClient.connectAll();
    }

    // 调用工具
    console.log(`Calling tool: ${tool} with args:`, toolArgs);
    const result = await mcpClient.callTool(tool, toolArgs || {});

    res.json({
      success: true,
      tool: tool,
      result: result
    });
  } catch (error) {
    console.error('Error calling tool:', error);
    
    // 根据错误类型返回不同的状态码
    const statusCode = error.message.includes('not found') ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: 'Tool call failed',
      message: error.message
    });
  }
});

export default router;
