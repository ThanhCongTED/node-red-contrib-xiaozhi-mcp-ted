/**
/**
 * WebSocketMCP核心库
 * 封装与小智MCP服务器的WebSocket连接和通信
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const { 
  MCPConfig, 
  MCPCredentials, 
  ConnectionState, 
  MCPEvent 
} = require('./interfaces');
const ReconnectManager = require('./reconnect-manager');
const MessageHandler = require('./message-handler');
const ToolManager = require('./tool-manager');
const { 
  buildWebSocketUrl, 
  Logger, 
  createError, 
  debounce,
  formatDuration 
} = require('./utils');

class WebSocketMCP extends EventEmitter {
  constructor(config = {}, credentials = {}) {
    super();
    
    // 配置和凭证
    this.config = new MCPConfig(config);
    this.credentials = new MCPCredentials(credentials.token);
    
    // 验证配置
    if (!this.config.isValid()) {
      throw createError('Invalid MCP configuration', 'INVALID_CONFIG');
    }
    
    if (!this.credentials.isValid()) {
      throw createError('Invalid MCP credentials', 'INVALID_CREDENTIALS');
    }
    
    // 连接状态
    this.ws = null;
    this.connectionState = ConnectionState.DISCONNECTED;
    this.connected = false;
    this.connecting = false;
    
    // 组件管理器
    this.reconnectManager = new ReconnectManager(this);
    this.messageHandler = new MessageHandler(this);
    this.toolManager = new ToolManager(this);
    this.logger = new Logger('WebSocketMCP');
    
    // 心跳管理
    this.heartbeatInterval = null;
    this.lastPingTime = 0;
    this.lastPongTime = 0;
    
    // 统计信息
    this.stats = {
      connectionAttempts: 0,
      messagesReceived: 0,
      messagesSent: 0,
      toolsRegistered: 0,
      toolsCalled: 0,
      errors: 0,
      lastConnected: null,
      lastDisconnected: null,
      totalUptime: 0,
      connectionStartTime: null
    };
    
    // 防抖函数
    this._debouncedReconnect = debounce(() => {
      this.reconnectManager.scheduleReconnect();
    }, 1000);
  }

  /**
   * 连接到MCP服务器
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.connecting || this.connected) {
      throw createError('Already connected or connecting', 'ALREADY_CONNECTING');
    }

    this.connecting = true;
    this.connectionState = ConnectionState.CONNECTING;
    this.stats.connectionAttempts++;
    this.stats.connectionStartTime = Date.now();

    this.logger.info(`Connecting to MCP server: ${this.config.endpoint}`);
    this.emit(MCPEvent.STATUS_CHANGE, { state: this.connectionState });

    try {
      // 构建连接URL
      const url = buildWebSocketUrl(this.config.endpoint, {
        token: this.credentials.token
      });

      // 创建WebSocket连接
      this.ws = new WebSocket(url, {
        handshakeTimeout: this.config.requestTimeout,
        perMessageDeflate: false
      });

      // 设置事件处理器
      this._setupWebSocketEventHandlers();

      // 等待连接完成
      await this._waitForConnection();

      // 连接成功处理
      this.connected = true;
      this.connecting = false;
      this.connectionState = ConnectionState.CONNECTED;
      this.stats.lastConnected = new Date();

      this.logger.info('Successfully connected to MCP server');
      this.emit(MCPEvent.CONNECTED);
      this.emit(MCPEvent.STATUS_CHANGE, { state: this.connectionState });

      // 启动心跳
      this._startHeartbeat();

      // 执行初始化握手
      await this._performHandshake();

    } catch (error) {
      this.connecting = false;
      this.connectionState = ConnectionState.ERROR;
      this.stats.errors++;
      
      this.logger.error('Connection failed:', error.message);
      this.emit(MCPEvent.ERROR, error);
      this.emit(MCPEvent.STATUS_CHANGE, { state: this.connectionState });
      
      throw error;
    }
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.logger.info('Disconnecting from MCP server');
    
    // 取消重连
    this.reconnectManager.cancel();
    
    // 停止心跳
    this._stopHeartbeat();
    
    // 关闭WebSocket
    if (this.ws) {
      this.ws.close(1000, 'Normal closure');
      this.ws = null;
    }
    
    this._handleDisconnection('Manual disconnect');
  }

  /**
   * 发送消息到服务器
   * @param {string|object} message 消息内容
   * @returns {Promise<void>}
   */
  async sendMessage(message) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw createError('Not connected to MCP server', 'NOT_CONNECTED');
    }

    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
    
    return new Promise((resolve, reject) => {
      this.ws.send(messageStr, (error) => {
        if (error) {
          this.stats.errors++;
          this.logger.error('Send message failed:', error.message);
          reject(createError(`Failed to send message: ${error.message}`, 'SEND_FAILED'));
        } else {
          this.stats.messagesSent++;
          this.logger.debug('Message sent successfully');
          resolve();
        }
      });
    });
  }

  /**
   * 注册工具
   * @param {string} name 工具名称
   * @param {string} description 工具描述
   * @param {object} inputSchema 输入参数schema
   * @param {Function} callback 工具回调函数
   * @returns {boolean} 注册是否成功
   */
  registerTool(name, description, inputSchema, callback) {
    const result = this.toolManager.registerTool(name, description, inputSchema, callback);
    if (result) {
      this.stats.toolsRegistered = this.toolManager.getToolNames().length;
    }
    return result;
  }

  /**
   * 简化工具注册
   * @param {string} name 工具名称
   * @param {string} description 工具描述
   * @param {string} paramName 参数名称
   * @param {string} paramDesc 参数描述
   * @param {string} paramType 参数类型
   * @param {Function} callback 工具回调函数
   * @returns {boolean} 注册是否成功
   */
  registerSimpleTool(name, description, paramName, paramDesc, paramType, callback) {
    return this.toolManager.registerSimpleTool(name, description, paramName, paramDesc, paramType, callback);
  }

  /**
   * 注销工具
   * @param {string} name 工具名称
   * @returns {boolean} 注销是否成功
   */
  unregisterTool(name) {
    const result = this.toolManager.unregisterTool(name);
    if (result) {
      this.stats.toolsRegistered = this.toolManager.getToolNames().length;
    }
    return result;
  }

  /**
   * 获取已注册工具列表
   * @returns {string[]} 工具名称列表
   */
  getRegisteredTools() {
    return this.toolManager.getToolNames();
  }

  /**
   * 检查连接状态
   * @returns {boolean} 是否已连接
   */
  isConnected() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 检查是否正在连接
   * @returns {boolean} 是否正在连接
   */
  isConnecting() {
    return this.connecting;
  }

  /**
   * 获取连接状态
   * @returns {string} 连接状态
   */
  getConnectionState() {
    return this.connectionState;
  }

  /**
   * 获取统计信息
   * @returns {object} 统计信息
   */
  getStats() {
    const currentTime = Date.now();
    const uptime = this.connected && this.stats.connectionStartTime ? 
      currentTime - this.stats.connectionStartTime : 0;

    return {
      ...this.stats,
      currentUptime: uptime,
      toolManagerStats: this.toolManager.getStats(),
      messageHandlerStats: this.messageHandler.getStats(),
      reconnectStats: this.reconnectManager.getStats(),
      connectionState: this.connectionState,
      isConnected: this.isConnected()
    };
  }

  /**
   * 设置WebSocket事件处理器
   */
  _setupWebSocketEventHandlers() {
    this.ws.on('open', () => {
      this.logger.debug('WebSocket connection opened');
    });

    this.ws.on('message', (data) => {
      try {
        this.stats.messagesReceived++;
        const message = data.toString();
        this.logger.debug('Received message:', message);
        
        // 委托给消息处理器
        this.messageHandler.handleMessage(message);
        
        this.emit(MCPEvent.MESSAGE, message);
      } catch (error) {
        this.stats.errors++;
        this.logger.error('Message processing error:', error.message);
        this.emit(MCPEvent.ERROR, error);
      }
    });

    this.ws.on('close', (code, reason) => {
      this.logger.info(`WebSocket connection closed: ${code} - ${reason}`);
      this._handleDisconnection(reason.toString());
    });

    this.ws.on('error', (error) => {
      this.stats.errors++;
      this.logger.error('WebSocket error:', error.message);
      this.emit(MCPEvent.ERROR, error);
    });

    this.ws.on('ping', (data) => {
      this.logger.debug('Received ping, sending pong');
      this.ws.pong(data);
    });

    this.ws.on('pong', (data) => {
      this.lastPongTime = Date.now();
      this.logger.debug('Received pong');
    });
  }

  /**
   * 等待连接完成
   * @returns {Promise<void>}
   */
  _waitForConnection() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(createError('Connection timeout', 'CONNECTION_TIMEOUT'));
      }, this.config.requestTimeout);

      this.ws.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.ws.once('error', (error) => {
        clearTimeout(timeout);
        reject(createError(`Connection error: ${error.message}`, 'CONNECTION_ERROR'));
      });
    });
  }

  /**
   * 执行初始化握手
   * @returns {Promise<void>}
   */
  async _performHandshake() {
    try {
      this.logger.debug('Performing MCP handshake');
      
      // 发送初始化请求
      const initResponse = await this.messageHandler.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false }
        },
        clientInfo: {
          name: this.config.serverName,
          version: '1.0.0'
        }
      });

      this.logger.info('MCP handshake completed successfully');
      this.logger.debug('Server info:', initResponse.serverInfo);

    } catch (error) {
      this.logger.error('MCP handshake failed:', error.message);
      throw createError(`Handshake failed: ${error.message}`, 'HANDSHAKE_FAILED');
    }
  }

  /**
   * 启动心跳
   */
  _startHeartbeat() {
    this._stopHeartbeat(); // 确保之前的定时器被清除
    
    if (this.config.heartbeatInterval <= 0) {
      return; // 心跳已禁用
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingTime = Date.now();
        
        // 发送ping
        this.messageHandler.sendRequest('ping').catch(error => {
          this.logger.warn('Heartbeat ping failed:', error.message);
        });

        // 检查是否超时
        if (this.lastPongTime > 0 && 
            this.lastPingTime - this.lastPongTime > this.config.pingTimeout) {
          this.logger.warn('Heartbeat timeout detected, disconnecting');
          this.disconnect();
        }
      }
    }, this.config.heartbeatInterval);

    this.logger.debug(`Heartbeat started with interval: ${this.config.heartbeatInterval}ms`);
  }

  /**
   * 停止心跳
   */
  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      this.logger.debug('Heartbeat stopped');
    }
  }

  /**
   * 处理断开连接
   * @param {string} reason 断开原因
   */
  _handleDisconnection(reason) {
    const wasConnected = this.connected;
    
    this.connected = false;
    this.connecting = false;
    this.connectionState = ConnectionState.DISCONNECTED;
    
    // 更新统计信息
    if (wasConnected) {
      this.stats.lastDisconnected = new Date();
      if (this.stats.connectionStartTime) {
        this.stats.totalUptime += Date.now() - this.stats.connectionStartTime;
        this.stats.connectionStartTime = null;
      }
    }

    // 停止心跳
    this._stopHeartbeat();
    
    // 清理消息处理器
    this.messageHandler.cancelAllRequests();

    this.logger.info(`Disconnected from MCP server: ${reason}`);
    this.emit(MCPEvent.DISCONNECTED, { reason });
    this.emit(MCPEvent.STATUS_CHANGE, { state: this.connectionState });

    // 如果是意外断开且启用了自动重连，则安排重连
    if (wasConnected && this.config.autoReconnect && reason !== 'Manual disconnect') {
      this._debouncedReconnect();
    }
  }

  /**
   * 强制重连
   * @returns {Promise<void>}
   */
  async forceReconnect() {
    this.logger.info('Force reconnecting...');
    
    if (this.connected) {
      this.disconnect();
    }
    
    // 等待一小段时间确保清理完成
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return this.connect();
  }

  /**
   * 更新配置
   * @param {object} newConfig 新配置
   */
  updateConfig(newConfig) {
    const oldConfig = this.config;
    this.config = new MCPConfig({ ...this.config, ...newConfig });
    
    // 更新重连管理器配置
    this.reconnectManager.updateConfig({
      maxAttempts: this.config.maxReconnectAttempts,
      baseDelay: this.config.reconnectDelay,
      maxDelay: this.config.maxBackoff
    });

    this.logger.info('Configuration updated');
    
    // 如果心跳间隔改变，重启心跳
    if (oldConfig.heartbeatInterval !== this.config.heartbeatInterval && this.connected) {
      this._startHeartbeat();
    }
  }

  /**
   * 健康检查
   * @returns {object} 健康状态
   */
  getHealth() {
    const now = Date.now();
    const stats = this.getStats();
    
    return {
      status: this.isConnected() ? 'healthy' : 'unhealthy',
      connectionState: this.connectionState,
      uptime: stats.currentUptime,
      uptimeFormatted: formatDuration(stats.currentUptime),
      lastPing: this.lastPingTime > 0 ? now - this.lastPingTime : null,
      lastPong: this.lastPongTime > 0 ? now - this.lastPongTime : null,
      stats,
      timestamp: now
    };
  }

  /**
   * 销毁客户端
   */
  destroy() {
    this.logger.info('Destroying WebSocketMCP client');
    
    // 断开连接
    this.disconnect();
    
    // 销毁组件
    this.reconnectManager.destroy();
    this.messageHandler.destroy();
    this.toolManager.destroy();
    
    // 移除所有监听器
    this.removeAllListeners();
    
    this.logger.debug('WebSocketMCP client destroyed');
  }
}

module.exports = WebSocketMCP;