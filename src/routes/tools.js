/**
 * Tools API 路由
 * GET /api/tools - 获取所有可用工具列表
 */

import { Router } from 'express';

const router = Router();

/**
 * GET /api/tools
 * 获取 MCP 服务器上所有可用的工具列表
 */
router.get('/', async (req, res) => {
  try {
    const mcpClient = req.app.get('mcpClient');
    
    if (!mcpClient) {
      return res.status(503).json({
        error: 'MCP client not initialized',
        message: 'Please check server configuration'
      });
    }

    // 重新连接以获取最新的工具列表
    await mcpClient.connectAll();
    
    const tools = mcpClient.getTools();

    res.json({
      success: true,
      count: tools.length,
      tools: tools
    });
  } catch (error) {
    console.error('Error fetching tools:', error);
    res.status(500).json({
      error: 'Failed to fetch tools',
      message: error.message
    });
  }
});

export default router;
