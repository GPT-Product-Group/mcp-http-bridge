/**
 * MCP Client - 精简版
 * 用于通过 HTTP 调用 MCP (Model Context Protocol) 服务
 * 从 shop-chat-agent 提取并精简，移除了 Shopify App 特定依赖
 */

class MCPClient {
  /**
   * 创建 MCPClient 实例
   * @param {Object} options - 配置选项
   * @param {string} options.storefrontEndpoint - 商店前台 MCP 端点 URL
   * @param {string} options.customerEndpoint - 客户账户 MCP 端点 URL (可选)
   * @param {string} options.accessToken - 访问令牌 (可选，用于需要认证的接口)
   */
  constructor(options = {}) {
    this.storefrontEndpoint = options.storefrontEndpoint;
    this.customerEndpoint = options.customerEndpoint;
    this.accessToken = options.accessToken || "";
    
    this.tools = [];
    this.storefrontTools = [];
    this.customerTools = [];
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
   * @returns {Promise<Array>} 可用工具数组
   */
  async connectToCustomerServer() {
    if (!this.customerEndpoint) {
      console.log("No customer endpoint configured, skipping...");
      return [];
    }

    try {
      console.log(`Connecting to Customer MCP at ${this.customerEndpoint}`);

      const headers = {
        "Content-Type": "application/json",
        "Authorization": this.accessToken || ""
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
   * @returns {Promise<Array>} 所有可用工具的数组
   */
  async connectAll() {
    this.tools = [];
    this.storefrontTools = [];
    this.customerTools = [];

    const results = await Promise.allSettled([
      this.connectToStorefrontServer(),
      this.connectToCustomerServer()
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
   * 调用指定的工具
   * @param {string} toolName - 工具名称
   * @param {Object} toolArgs - 工具参数
   * @returns {Promise<Object>} 工具调用结果
   */
  async callTool(toolName, toolArgs = {}) {
    // 确定工具属于哪个服务器
    if (this.storefrontTools.some(t => t.name === toolName)) {
      return this._callStorefrontTool(toolName, toolArgs);
    } else if (this.customerTools.some(t => t.name === toolName)) {
      return this._callCustomerTool(toolName, toolArgs);
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
   * 调用客户账户工具
   * @private
   */
  async _callCustomerTool(toolName, toolArgs) {
    console.log(`Calling customer tool: ${toolName}`, toolArgs);

    const headers = {
      "Content-Type": "application/json",
      "Authorization": this.accessToken || ""
    };

    const response = await this._makeJsonRpcRequest(
      this.customerEndpoint,
      "tools/call",
      { name: toolName, arguments: toolArgs },
      headers
    );

    return response.result || response;
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
}

export default MCPClient;
