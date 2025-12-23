/**
 * MCP Client - 增强版
 * 用于通过 HTTP 调用 MCP (Model Context Protocol) 服务
 * 支持自动获取和使用客户 access token
 */

import { getCustomerToken, getCustomerTokenByShop } from './db.js';
import { generateAuthUrl } from './auth.js';

class MCPClient {
  /**
   * 创建 MCPClient 实例
   * @param {Object} options - 配置选项
   * @param {string} options.storefrontEndpoint - 商店前台 MCP 端点 URL
   * @param {string} options.customerEndpoint - 客户账户 MCP 端点 URL (可选)
   * @param {string} options.accessToken - 访问令牌 (可选，用于需要认证的接口)
   * @param {string} options.shopId - 商店 ID (用于自动获取 token)
   * @param {string} options.clientId - Shopify App Client ID (用于生成认证 URL)
   * @param {string} options.redirectUri - OAuth 回调 URL
   */
  constructor(options = {}) {
    this.storefrontEndpoint = options.storefrontEndpoint;
    this.customerEndpoint = options.customerEndpoint;
    this.accessToken = options.accessToken || "";
    this.shopId = options.shopId || "";
    this.clientId = options.clientId || process.env.SHOPIFY_CLIENT_ID || "";
    this.redirectUri = options.redirectUri || process.env.OAUTH_REDIRECT_URI || "";
    
    this.tools = [];
    this.storefrontTools = [];
    this.customerTools = [];
  }

  /**
   * 设置 Shop ID (动态配置)
   * @param {string} shopId - 商店 ID
   */
  setShopId(shopId) {
    this.shopId = shopId;
    // 自动更新 customer endpoint
    if (shopId && !this.customerEndpoint) {
      const domain = shopId.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const accountDomain = domain.replace(/(\.myshopify\.com)$/, '.account$1');
      this.customerEndpoint = `https://${accountDomain}/customer/api/mcp`;
      console.log('Auto-configured customer endpoint:', this.customerEndpoint);
    }
  }

  /**
   * 连接到商店前台 MCP 服务器并获取可用工具列表
   * @returns {Promise<Array>} 可用工具数组
   */
  async connectToStorefrontServer() {
    if (!this.storefrontEndpoint) {
      console.log("No storefront endpoint configured, skipping...");
      return [];
    }

    try {
      console.log(`Connecting to Storefront MCP at ${this.storefrontEndpoint}`);

      const response = await this._makeJsonRpcRequest(
        this.storefrontEndpoint,
        "tools/list",
        {},
        { "Content-Type": "application/json" }
      );

      const toolsData = response.result?.tools || [];
      this.storefrontTools = this._formatToolsData(toolsData);
      this.tools = [...this.tools, ...this.storefrontTools];

      console.log(`Found ${this.storefrontTools.length} storefront tools`);
      return this.storefrontTools;
    } catch (error) {
      console.error("Failed to connect to Storefront MCP:", error.message);
      throw error;
    }
  }

  /**
   * 连接到客户账户 MCP 服务器并获取可用工具列表
   * @param {Object} options - 可选配置
   * @param {string} options.sessionId - 会话 ID (用于获取存储的 token)
   * @returns {Promise<Array>} 可用工具数组
   */
  async connectToCustomerServer(options = {}) {
    if (!this.customerEndpoint) {
      console.log("No customer endpoint configured, skipping...");
      return [];
    }

    try {
      console.log(`Connecting to Customer MCP at ${this.customerEndpoint}`);

      // 尝试获取 token
      let token = await this._getAccessToken(options);

      // 确保 token 有 Bearer 前缀
      if (token && !token.toLowerCase().startsWith('bearer ')) {
        token = `Bearer ${token}`;
      }

      const headers = {
        "Content-Type": "application/json",
        "Authorization": token || ""
      };

      const response = await this._makeJsonRpcRequest(
        this.customerEndpoint,
        "tools/list",
        {},
        headers
      );

      const toolsData = response.result?.tools || [];
      this.customerTools = this._formatToolsData(toolsData);
      this.tools = [...this.tools, ...this.customerTools];

      console.log(`Found ${this.customerTools.length} customer tools`);
      return this.customerTools;
    } catch (error) {
      console.error("Failed to connect to Customer MCP:", error.message);
      throw error;
    }
  }

  /**
   * 连接到所有配置的 MCP 服务器
   * @param {Object} options - 可选配置
   * @returns {Promise<Array>} 所有可用工具的数组
   */
  async connectAll(options = {}) {
    this.tools = [];
    this.storefrontTools = [];
    this.customerTools = [];

    const results = await Promise.allSettled([
      this.connectToStorefrontServer(),
      this.connectToCustomerServer(options)
    ]);

    // 记录失败的连接
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const serverName = index === 0 ? 'Storefront' : 'Customer';
        console.warn(`${serverName} MCP connection failed:`, result.reason?.message);
      }
    });

    return this.tools;
  }

  /**
   * 获取 Access Token (自动从数据库或配置获取)
   * @private
   * @param {Object} options - 选项
   * @param {string} options.accessToken - 直接传入的 token (优先级最高)
   * @param {string} options.sessionId - 会话 ID
   * @returns {Promise<string|null>} Access token
   */
  async _getAccessToken(options = {}) {
    // 1. 优先使用直接传入的 token
    if (options.accessToken) {
      console.log('Using provided accessToken');
      return options.accessToken;
    }

    // 2. 尝试从数据库获取 (通过 sessionId)
    if (options.sessionId) {
      const tokenRecord = getCustomerToken(options.sessionId);
      if (tokenRecord && tokenRecord.access_token) {
        console.log('Using token from database (session):', options.sessionId);
        return tokenRecord.access_token;
      }
    }

    // 3. 尝试从数据库获取 (通过 shopId)
    if (this.shopId) {
      const tokenRecord = getCustomerTokenByShop(this.shopId);
      if (tokenRecord && tokenRecord.access_token) {
        console.log('Using token from database (shop):', this.shopId);
        return tokenRecord.access_token;
      }
    }

    // 4. 使用实例配置的 token
    if (this.accessToken) {
      console.log('Using instance accessToken');
      return this.accessToken;
    }

    console.log('No access token available');
    return null;
  }

  /**
   * 调用指定的工具
   * @param {string} toolName - 工具名称
   * @param {Object} toolArgs - 工具参数
   * @param {Object} options - 可选配置
   * @param {string} options.accessToken - 动态传递的访问令牌（优先于实例配置）
   * @param {string} options.sessionId - 会话 ID (用于自动获取 token)
   * @returns {Promise<Object>} 工具调用结果
   */
  async callTool(toolName, toolArgs = {}, options = {}) {
    // 确定工具属于哪个服务器
    if (this.storefrontTools.some(t => t.name === toolName)) {
      return this._callStorefrontTool(toolName, toolArgs);
    } else if (this.customerTools.some(t => t.name === toolName)) {
      return this._callCustomerTool(toolName, toolArgs, options);
    } else {
      throw new Error(`Tool "${toolName}" not found. Available tools: ${this.tools.map(t => t.name).join(', ')}`);
    }
  }

  /**
   * 调用商店前台工具
   * @private
   */
  async _callStorefrontTool(toolName, toolArgs) {
    // 处理参数 - 确保 search_shop_catalog 有必需的 context 参数
    let processedArgs = { ...toolArgs };
    
    if (toolName === 'search_shop_catalog') {
      if (!processedArgs.context) {
        processedArgs.context = processedArgs.query 
          ? `User is searching for: ${processedArgs.query}`
          : 'General product search';
      }
    }
    
    console.log(`Calling storefront tool: ${toolName}`);
    console.log('Processed arguments:', JSON.stringify(processedArgs, null, 2));

    const response = await this._makeJsonRpcRequest(
      this.storefrontEndpoint,
      "tools/call",
      { name: toolName, arguments: processedArgs },
      { "Content-Type": "application/json" }
    );

    return response.result || response;
  }

  /**
   * 调用客户账户工具 (自动处理认证)
   * @private
   * @param {string} toolName - 工具名称
   * @param {Object} toolArgs - 工具参数
   * @param {Object} options - 可选配置
   * @param {string} options.accessToken - 动态传递的访问令牌（优先于实例配置）
   * @param {string} options.sessionId - 会话 ID
   */
  async _callCustomerTool(toolName, toolArgs, options = {}) {
    console.log(`Calling customer tool: ${toolName}`, toolArgs);

    // 获取 token
    let token = await this._getAccessToken(options);

    // 如果没有 token，直接返回认证要求（不调用 API）
    if (!token) {
      console.log('No access token available, returning auth requirement');
      return this._generateAuthRequiredResponse(options);
    }

    // 确保 token 有 Bearer 前缀（Shopify Customer Account API 需要）
    if (token && !token.toLowerCase().startsWith('bearer ')) {
      token = `Bearer ${token}`;
    }

    console.log('Authorization header:', token ? token.substring(0, 20) + '...' : 'empty');

    const headers = {
      "Content-Type": "application/json",
      "Authorization": token || ""
    };

    try {
      const response = await this._makeJsonRpcRequest(
        this.customerEndpoint,
        "tools/call",
        { name: toolName, arguments: toolArgs },
        headers
      );

      const result = response.result || response;

      // 检查响应是否包含"需要登录"类的消息（Shopify 可能返回成功但内容是认证提示）
      if (this._isAuthRequiredResponse(result)) {
        console.log('Response indicates auth required, returning auth URL');
        return this._generateAuthRequiredResponse(options);
      }

      return result;
    } catch (error) {
      // 处理 401 未授权错误 - 返回认证 URL
      if (error.status === 401) {
        console.log('Unauthorized (401), generating auth URL...');
        return this._generateAuthRequiredResponse(options);
      }

      // 其他错误重新抛出
      throw error;
    }
  }

  /**
   * 检查响应是否表示需要认证
   * @private
   */
  _isAuthRequiredResponse(result) {
    if (!result) return false;

    // 检查 content 数组中的文本
    if (result.content && Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item.type === 'text' && item.text) {
          const text = item.text.toLowerCase();
          // 检查常见的认证提示关键词
          if (text.includes('login') || 
              text.includes('authenticate') || 
              text.includes('sign in') ||
              text.includes('登录') ||
              text.includes('认证') ||
              text.includes('授权')) {
            return true;
          }
        }
      }
    }

    // 检查直接的文本响应
    if (typeof result === 'string') {
      const text = result.toLowerCase();
      if (text.includes('login') || text.includes('登录')) {
        return true;
      }
    }

    return false;
  }

  /**
   * 生成认证要求响应
   * @private
   */
  async _generateAuthRequiredResponse(options = {}) {
    const sessionId = options.sessionId || `session_${Date.now()}`;
    
    if (this.shopId && this.clientId && this.redirectUri) {
      try {
        const authResult = await generateAuthUrl({
          sessionId,
          shopId: this.shopId,
          clientId: this.clientId,
          redirectUri: this.redirectUri,
          scopes: ['customer_read_customers', 'customer_read_orders']
        });

        console.log('Generated auth URL:', authResult.url);

        return {
          error: {
            type: 'auth_required',
            message: `您需要先登录才能查看订单信息。请复制以下链接到浏览器中打开完成授权：

${authResult.url}

授权完成后，请再次查询订单。`,
            auth_url: authResult.url,
            session_id: sessionId
          }
        };
      } catch (authError) {
        console.error('Failed to generate auth URL:', authError);
      }
    }

    // 如果无法生成认证 URL，返回配置提示
    return {
      error: {
        type: 'auth_required',
        message: '需要客户认证才能访问订单数据。请确保已配置 SHOPIFY_CLIENT_ID、SHOPIFY_SHOP_ID 和 OAUTH_REDIRECT_URI 环境变量。',
        config_required: {
          SHOPIFY_CLIENT_ID: this.clientId ? 'configured' : 'missing',
          SHOPIFY_SHOP_ID: this.shopId ? 'configured' : 'missing',
          OAUTH_REDIRECT_URI: this.redirectUri ? 'configured' : 'missing'
        }
      }
    };
  }

  /**
   * 发送 JSON-RPC 请求
   * @private
   */
  async _makeJsonRpcRequest(endpoint, method, params, headers) {
    const requestBody = {
      jsonrpc: "2.0",
      method: method,
      id: Date.now(),
      params: params
    };

    console.log(`\n=== MCP Request ===`);
    console.log(`Endpoint: ${endpoint}`);
    console.log(`Method: ${method}`);
    console.log(`Body: ${JSON.stringify(requestBody, null, 2)}`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();
    console.log(`\n=== MCP Response ===`);
    console.log(`Status: ${response.status}`);
    console.log(`Body: ${responseText.substring(0, 1000)}${responseText.length > 1000 ? '...' : ''}`);

    if (!response.ok) {
      const error = new Error(`MCP request failed: ${response.status} ${responseText}`);
      error.status = response.status;
      throw error;
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Failed to parse MCP response: ${responseText}`);
    }
    
    // 检查 JSON-RPC 错误
    if (result.error) {
      console.error(`MCP Error: ${JSON.stringify(result.error)}`);
      const error = new Error(result.error.message || 'MCP returned an error');
      error.code = result.error.code;
      error.data = result.error.data;
      throw error;
    }

    return result;
  }

  /**
   * 格式化工具数据
   * @private
   */
  _formatToolsData(toolsData) {
    return toolsData.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema || tool.input_schema
    }));
  }

  /**
   * 获取所有已连接的工具列表
   * @returns {Array} 工具列表
   */
  getTools() {
    return this.tools;
  }

  /**
   * 检查工具是否需要客户认证
   * @param {string} toolName - 工具名称
   * @returns {boolean}
   */
  isCustomerTool(toolName) {
    return this.customerTools.some(t => t.name === toolName);
  }
}

export default MCPClient;
