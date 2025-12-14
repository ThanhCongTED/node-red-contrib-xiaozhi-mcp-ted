/**
 * 消息处理器
 * 负责处理JSON-RPC 2.0消息的解析、路由和响应
 */

const { generateId, Logger, createError, safeJsonParse } = require('./utils');
const { MCPEvent } = require('./interfaces');

class MessageHandler {
  constructor(mcpClient) {
    this.mcpClient = mcpClient;
    this.logger = new Logger('MessageHandler');
    
    // 待处理请求映射
    this.pendingRequests = new Map();
    this.requestTimeout = mcpClient.config.requestTimeout;
    
    // 消息统计
    this.stats = {
      messagesReceived: 0,
      messagesSent: 0,
      requestsReceived: 0,
      responsesReceived: 0,
      errorsReceived: 0,
      invalidMessages: 0
    };
    
    // 消息处理器映射
    this.handlers = new Map([
      ['ping', this._handlePing.bind(this)],
      ['initialize', this._handleInitialize.bind(this)],
      ['tools/list', this._handleToolsList.bind(this)],
      ['tools/call', this._handleToolCall.bind(this)]
    ]);
  }

  /**
   * 处理收到的消息
   * @param {string|object} message 消息内容
   */
  handleMessage(message) {
    let parsedMessage;
    
    try {
      // 解析消息
      if (typeof message === 'string') {
        parsedMessage = safeJsonParse(message);
        if (!parsedMessage) {
          throw createError('Invalid JSON format', 'INVALID_JSON');
        }
      } else {
        parsedMessage = message;
      }

      this.stats.messagesReceived++;
      
      // 验证JSON-RPC格式
      if (!this._isValidJsonRpc(parsedMessage)) {
        this.stats.invalidMessages++;
        throw createError('Invalid JSON-RPC message format', 'INVALID_JSONRPC');
      }

      this.logger.debug('Processing message:', parsedMessage);

      // 路由消息
      if (parsedMessage.method) {
        // 这是请求或通知
        this._handleRequest(parsedMessage);
      } else if (parsedMessage.result !== undefined || parsedMessage.error !== undefined) {
        // 这是响应
        this._handleResponse(parsedMessage);
      } else {
        throw createError('Unknown message type', 'UNKNOWN_MESSAGE_TYPE');
      }

    } catch (error) {
      this.logger.error('Message handling error:', error.message);
      this.mcpClient.emit(MCPEvent.ERROR, error);
      
      // 如果是请求消息且有ID，发送错误响应
      if (parsedMessage && parsedMessage.id !== undefined && parsedMessage.method) {
        this._sendErrorResponse(parsedMessage.id, -32603, 'Internal error', error.message);
      }
    }
  }

  /**
   * 发送请求消息
   * @param {string} method 方法名
   * @param {object} params 参数
   * @param {string|number} id 请求ID
   * @returns {Promise<*>} 响应结果
   */
  async sendRequest(method, params = null, id = null) {
    if (!this.mcpClient.isConnected()) {
      throw createError('Not connected to MCP server', 'NOT_CONNECTED');
    }

    const requestId = id || generateId();
    const request = {
      jsonrpc: '2.0',
      method,
      id: requestId
    };

    if (params !== null) {
      request.params = params;
    }

    return new Promise((resolve, reject) => {
      // 设置超时处理
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(createError(`Request timeout: ${method}`, 'REQUEST_TIMEOUT'));
      }, this.requestTimeout);

      // 存储待处理请求
      this.pendingRequests.set(requestId, {
        method,
        resolve,
        reject,
        timeout,
        timestamp: Date.now()
      });

      // 发送请求
      this.mcpClient.sendMessage(request).catch((error) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(error);
      });
    });
  }

  /**
   * 发送通知消息（无需响应）
   * @param {string} method 方法名
   * @param {object} params 参数
   * @returns {Promise<void>}
   */
  async sendNotification(method, params = null) {
    if (!this.mcpClient.isConnected()) {
      throw createError('Not connected to MCP server', 'NOT_CONNECTED');
    }

    const notification = {
      jsonrpc: '2.0',
      method
    };

    if (params !== null) {
      notification.params = params;
    }

    await this.mcpClient.sendMessage(notification);
  }

  /**
   * 处理请求消息
   * @param {object} message 请求消息
   */
  _handleRequest(message) {
    const { method, params, id } = message;
    this.stats.requestsReceived++;

    this.logger.debug(`Handling request: ${method}`);

    // 查找处理器
    const handler = this.handlers.get(method);
    if (handler) {
      try {
        handler(id, params);
      } catch (error) {
        this.logger.error(`Handler error for ${method}:`, error.message);
        if (id !== undefined) {
          this._sendErrorResponse(id, -32603, 'Internal error', error.message);
        }
      }
    } else {
      this.logger.warn(`Unknown method: ${method}`);
      if (id !== undefined) {
        this._sendErrorResponse(id, -32601, 'Method not found');
      }
    }
  }

  /**
   * 处理响应消息
   * @param {object} message 响应消息
   */
  _handleResponse(message) {
    const { id, result, error } = message;
    this.stats.responsesReceived++;
    
    if (error) {
      this.stats.errorsReceived++;
    }
    
    if (!this.pendingRequests.has(id)) {
      this.logger.warn(`Received response for unknown request: ${id}`);
      return;
    }

    const pendingRequest = this.pendingRequests.get(id);
    this.pendingRequests.delete(id);
    
    clearTimeout(pendingRequest.timeout);

    if (error) {
      const errorObj = createError(
        error.message || 'RPC Error',
        error.code || 'RPC_ERROR',
        error.data
      );
      pendingRequest.reject(errorObj);
    } else {
      pendingRequest.resolve(result);
    }
  }

  /**
   * 处理ping请求
   * @param {string|number} id 请求ID
   */
  _handlePing(id) {
    this.logger.debug('Handling ping request');
    this._sendSuccessResponse(id, {});
  }

  /**
   * 处理初始化请求
   * @param {string|number} id 请求ID
   * @param {object} params 参数
   */
  _handleInitialize(id, params) {
    this.logger.info('Handling initialize request');
    
    const response = {
      protocolVersion: '2024-11-05',
      capabilities: {
        experimental: {},
        prompts: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
        tools: { listChanged: false }
      },
      serverInfo: {
        name: this.mcpClient.config.serverName,
        version: '1.0.0'
      }
    };

    this._sendSuccessResponse(id, response);
    
    // 发送initialized通知
    this.sendNotification('notifications/initialized').catch(error => {
      this.logger.error('Failed to send initialized notification:', error.message);
    });
  }

  /**
   * 处理工具列表请求
   * @param {string|number} id 请求ID
   */
  _handleToolsList(id) {
    this.logger.debug('Handling tools/list request');
    
    const tools = this.mcpClient.toolManager.getToolsListResponse();
    const response = { tools };

    this._sendSuccessResponse(id, response);
    this.logger.debug(`Responded with ${tools.length} tools`);
  }

  /**
   * 处理工具调用请求
   * @param {string|number} id 请求ID
   * @param {object} params 参数
   */
  async _handleToolCall(id, params) {
    const { name: toolName, arguments: toolArgs } = params;
    this.logger.debug(`Handling tools/call request: ${toolName}`);
    
    try {
      const result = await this.mcpClient.toolManager.executeTool(toolName, toolArgs);
      
      const response = {
        content: result.content,
        isError: result.isError
      };

      this._sendSuccessResponse(id, response);
      this.logger.debug(`Tool call completed: ${toolName}`);
      
    } catch (error) {
      this.logger.error(`Tool call failed: ${toolName}`, error.message);
      
      // 发送工具执行错误作为成功响应，但标记为错误
      const errorResponse = {
        content: [{ type: 'text', text: error.message }],
        isError: true
      };

      this._sendSuccessResponse(id, errorResponse);
    }
  }

  /**
   * 发送成功响应
   * @param {string|number} id 请求ID
   * @param {*} result 结果
   */
  _sendSuccessResponse(id, result) {
    const response = {
      jsonrpc: '2.0',
      id,
      result
    };

    this.mcpClient.sendMessage(response).catch(error => {
      this.logger.error('Failed to send success response:', error.message);
    });
  }

  /**
   * 发送错误响应
   * @param {string|number} id 请求ID
   * @param {number} code 错误代码
   * @param {string} message 错误消息
   * @param {*} data 错误数据
   */
  _sendErrorResponse(id, code, message, data = null) {
    const response = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(data && { data })
      }
    };

    this.mcpClient.sendMessage(response).catch(error => {
      this.logger.error('Failed to send error response:', error.message);
    });
  }

  /**
   * 验证JSON-RPC格式
   * @param {object} message 消息对象
   * @returns {boolean} 格式是否有效
   */
  _isValidJsonRpc(message) {
    if (!message || typeof message !== 'object') {
      return false;
    }

    // 必须有jsonrpc字段且值为"2.0"
    if (message.jsonrpc !== '2.0') {
      return false;
    }

    // 必须是请求、响应或通知之一
    const hasMethod = typeof message.method === 'string';
    const hasResult = message.result !== undefined;
    const hasError = message.error !== undefined;

    return hasMethod || hasResult || hasError;
  }

  /**
   * 注册自定义消息处理器
   * @param {string} method 方法名
   * @param {Function} handler 处理函数
   */
  registerHandler(method, handler) {
    if (typeof handler !== 'function') {
      throw createError('Handler must be a function', 'INVALID_HANDLER');
    }

    this.handlers.set(method, handler);
    this.logger.debug(`Registered handler for method: ${method}`);
  }

  /**
   * 注销消息处理器
   * @param {string} method 方法名
   * @returns {boolean} 是否成功注销
   */
  unregisterHandler(method) {
    const result = this.handlers.delete(method);
    if (result) {
      this.logger.debug(`Unregistered handler for method: ${method}`);
    }
    return result;
  }

  /**
   * 获取统计信息
   * @returns {object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      pendingRequests: this.pendingRequests.size,
      registeredHandlers: this.handlers.size
    };
  }

  /**
   * 清理超时请求
   */
  cleanup() {
    const now = Date.now();
    const timeoutRequests = [];

    this.pendingRequests.forEach((request, id) => {
      if (now - request.timestamp > this.requestTimeout) {
        timeoutRequests.push(id);
      }
    });

    timeoutRequests.forEach(id => {
      const request = this.pendingRequests.get(id);
      if (request) {
        clearTimeout(request.timeout);
        request.reject(createError('Request timeout during cleanup', 'CLEANUP_TIMEOUT'));
        this.pendingRequests.delete(id);
      }
    });

    if (timeoutRequests.length > 0) {
      this.logger.warn(`Cleaned up ${timeoutRequests.length} timeout requests`);
    }
  }

  /**
   * 取消所有待处理请求
   */
  cancelAllRequests() {
    const count = this.pendingRequests.size;
    
    this.pendingRequests.forEach(request => {
      clearTimeout(request.timeout);
      request.reject(createError('Connection closed', 'CONNECTION_CLOSED'));
    });
    
    this.pendingRequests.clear();
    
    if (count > 0) {
      this.logger.info(`Cancelled ${count} pending requests`);
    }
  }

  /**
   * 销毁消息处理器
   */
  destroy() {
    this.cancelAllRequests();
    this.handlers.clear();
    this.logger.debug('MessageHandler destroyed');
  }
}

module.exports = MessageHandler;