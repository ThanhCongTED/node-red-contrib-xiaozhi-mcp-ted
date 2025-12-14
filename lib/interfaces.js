/**
 * MCP核心接口和类定义
 * 定义了WebSocket MCP客户端的基础数据结构和接口
 */

/**
 * MCP配置类
 * 包含连接配置、重连设置、心跳设置等参数
 */
class MCPConfig {
  constructor(options = {}) {
    this.endpoint = options.endpoint || '';
    this.serverName = options.serverName || 'NodeRED-Device';
    this.autoReconnect = options.autoReconnect !== false;
    this.reconnectDelay = options.reconnectDelay || 5000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.heartbeatInterval = options.heartbeatInterval || 30000;
    this.requestTimeout = options.requestTimeout || 30000;
    this.pingTimeout = options.pingTimeout || 60000;
    this.maxBackoff = options.maxBackoff || 60000;
  }

  /**
   * 验证配置参数有效性
   * @returns {boolean} 配置是否有效
   */
  isValid() {
    if (!this.endpoint) return false;
    if (!this.endpoint.startsWith('ws://') && !this.endpoint.startsWith('wss://')) {
      return false;
    }
    return true;
  }

  /**
   * 获取配置摘要信息
   * @returns {object} 配置摘要
   */
  getSummary() {
    return {
      endpoint: this.endpoint,
      serverName: this.serverName,
      autoReconnect: this.autoReconnect,
      heartbeatInterval: this.heartbeatInterval
    };
  }
}

/**
 * MCP凭证类
 * 管理访问令牌等认证信息
 */
class MCPCredentials {
  constructor(token) {
    this.token = token || '';
  }

  /**
   * 检查凭证是否有效
   * @returns {boolean} 凭证是否有效
   */
  isValid() {
    return this.token && this.token.length > 0;
  }

  /**
   * 获取认证头信息
   * @returns {object} 认证头
   */
  getAuthHeaders() {
    return {
      'Authorization': `Bearer ${this.token}`
    };
  }
}

/**
 * 工具定义类
 * 描述单个工具的完整信息
 */
class ToolDefinition {
  constructor(name, description, inputSchema, callback) {
    this.name = name;
    this.description = description;
    this.inputSchema = inputSchema || {};
    this.callback = callback;
    this.registeredAt = new Date();
    this.callCount = 0;
    this.lastCalled = null;
    this.enabled = true;
  }

  /**
   * 执行工具回调
   * @param {object} args 工具参数
   * @returns {Promise<ToolResponse>} 工具响应
   */
  async execute(args) {
    if (!this.enabled) {
      throw new Error(`Tool '${this.name}' is disabled`);
    }

    this.callCount++;
    this.lastCalled = new Date();

    return await this.callback(args);
  }

  /**
   * 获取工具统计信息
   * @returns {object} 统计信息
   */
  getStats() {
    return {
      name: this.name,
      callCount: this.callCount,
      lastCalled: this.lastCalled,
      registeredAt: this.registeredAt,
      enabled: this.enabled
    };
  }

  /**
   * 启用/禁用工具
   * @param {boolean} enabled 是否启用
   */
  setEnabled(enabled) {
    this.enabled = !!enabled;
  }
}

/**
 * 工具响应内容项
 */
class ToolContentItem {
  constructor(type, text) {
    this.type = type || 'text';
    this.text = text || '';
  }

  /**
   * 验证内容项格式
   * @returns {boolean} 格式是否有效
   */
  isValid() {
    return this.type && typeof this.text === 'string';
  }
}

/**
 * 工具响应类
 * 包装工具执行结果
 */
class ToolResponse {
  constructor(content, isError = false) {
    this.content = [];
    this.isError = !!isError;

    if (typeof content === 'string') {
      this.content.push(new ToolContentItem('text', content));
    } else if (Array.isArray(content)) {
      this.content = content.map(item => {
        if (typeof item === 'string') {
          return new ToolContentItem('text', item);
        } else if (item instanceof ToolContentItem) {
          return item;
        } else {
          return new ToolContentItem(item.type, item.text);
        }
      });
    } else if (content && content.content) {
      this.content = content.content;
      this.isError = content.isError || false;
    }
  }

  /**
   * 创建成功响应
   * @param {string|array} content 响应内容
   * @returns {ToolResponse} 工具响应
   */
  static success(content) {
    return new ToolResponse(content, false);
  }

  /**
   * 创建错误响应
   * @param {string|Error} error 错误信息
   * @returns {ToolResponse} 工具响应
   */
  static error(error) {
    const message = error instanceof Error ? error.message : String(error);
    return new ToolResponse(message, true);
  }

  /**
   * 从JSON对象创建响应
   * @param {object} json JSON对象
   * @param {boolean} isError 是否为错误
   * @returns {ToolResponse} 工具响应
   */
  static fromJson(json, isError = false) {
    const jsonStr = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
    return new ToolResponse(jsonStr, isError);
  }

  /**
   * 添加内容项
   * @param {string} type 内容类型
   * @param {string} text 文本内容
   */
  addContent(type, text) {
    this.content.push(new ToolContentItem(type, text));
  }

  /**
   * 转换为JSON格式
   * @returns {object} JSON对象
   */
  toJSON() {
    return {
      content: this.content,
      isError: this.isError
    };
  }
}

/**
 * 工具参数解析器
 * 提供类型安全的参数获取方法
 */
class ToolParams {
  constructor(jsonData) {
    this.data = {};
    this.valid = true;

    try {
      if (typeof jsonData === 'string') {
        this.data = JSON.parse(jsonData);
      } else if (typeof jsonData === 'object' && jsonData !== null) {
        this.data = jsonData;
      } else {
        this.valid = false;
      }
    } catch (error) {
      this.valid = false;
      this.error = error;
    }
  }

  /**
   * 检查参数是否有效
   * @returns {boolean} 参数是否有效
   */
  isValid() {
    return this.valid;
  }

  /**
   * 获取字符串参数
   * @param {string} key 参数键
   * @param {string} defaultValue 默认值
   * @returns {string} 参数值
   */
  getString(key, defaultValue = '') {
    const value = this.data[key];
    return typeof value === 'string' ? value : String(defaultValue);
  }

  /**
   * 获取数字参数
   * @param {string} key 参数键
   * @param {number} defaultValue 默认值
   * @returns {number} 参数值
   */
  getNumber(key, defaultValue = 0) {
    const value = this.data[key];
    if (typeof value === 'number') return value;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * 获取布尔参数
   * @param {string} key 参数键
   * @param {boolean} defaultValue 默认值
   * @returns {boolean} 参数值
   */
  getBoolean(key, defaultValue = false) {
    const value = this.data[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    return defaultValue;
  }

  /**
   * 获取对象参数
   * @param {string} key 参数键
   * @param {object} defaultValue 默认值
   * @returns {object} 参数值
   */
  getObject(key, defaultValue = {}) {
    const value = this.data[key];
    return typeof value === 'object' && value !== null ? value : defaultValue;
  }

  /**
   * 获取数组参数
   * @param {string} key 参数键
   * @param {array} defaultValue 默认值
   * @returns {array} 参数值
   */
  getArray(key, defaultValue = []) {
    const value = this.data[key];
    return Array.isArray(value) ? value : defaultValue;
  }

  /**
   * 检查参数是否存在
   * @param {string} key 参数键
   * @returns {boolean} 参数是否存在
   */
  has(key) {
    return key in this.data;
  }

  /**
   * 获取所有参数键
   * @returns {array} 参数键列表
   */
  getKeys() {
    return Object.keys(this.data);
  }

  /**
   * 获取原始数据
   * @returns {object} 原始数据对象
   */
  getRawData() {
    return this.data;
  }

  /**
   * 转换为调试字符串
   * @returns {string} 调试信息
   */
  toString() {
    if (!this.valid) {
      return `[Invalid ToolParams: ${this.error?.message || 'Unknown error'}]`;
    }
    return JSON.stringify(this.data, null, 2);
  }
}

/**
 * MCP连接状态枚举
 */
const ConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  ERROR: 'error'
};

/**
 * MCP事件类型枚举
 */
const MCPEvent = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
  MESSAGE: 'message',
  TOOL_REGISTERED: 'tool-registered',
  TOOL_UNREGISTERED: 'tool-unregistered',
  TOOL_CALLED: 'tool-called',
  STATUS_CHANGE: 'status-change'
};

module.exports = {
  MCPConfig,
  MCPCredentials,
  ToolDefinition,
  ToolContentItem,
  ToolResponse,
  ToolParams,
  ConnectionState,
  MCPEvent
};