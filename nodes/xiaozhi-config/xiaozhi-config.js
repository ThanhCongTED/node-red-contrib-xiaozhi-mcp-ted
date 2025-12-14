/**
 * xiaozhi-config 配置节点
 * 管理与小智MCP服务器的连接配置
 */

module.exports = function(RED) {
  const WebSocketMCP = require('../../lib/websocket-mcp');
  const { MCPConfig, MCPCredentials } = require('../../lib/interfaces');
  const { Logger } = require('../../lib/utils');

  function XiaozhiConfigNode(config) {
    RED.nodes.createNode(this, config);

    // 配置参数
    this.name = config.name;
    this.endpoint = config.endpoint;
    this.serverName = config.serverName || 'NodeRED-Device';
    this.autoReconnect = config.autoReconnect !== false;
    this.reconnectDelay = parseInt(config.reconnectDelay) || 5000;
    this.heartbeatInterval = parseInt(config.heartbeatInterval) || 30000;
    this.requestTimeout = parseInt(config.requestTimeout) || 30000;

    // 日志记录器
    this.logger = new Logger(`XiaozhiConfig[${this.name || this.id}]`);

    // MCP客户端实例
    this.mcpClient = null;
    this.connectionState = 'disconnected';
    this.lastError = null;

    // 连接统计信息
    this.connectionStats = {
      connectedAt: null,
      disconnectedAt: null,
      connectionAttempts: 0,
      totalUptime: 0
    };

    // 依赖此配置的节点列表
    this.dependentNodes = new Set();

    const node = this;

    /**
     * 初始化MCP客户端
     */
    this.initializeMCPClient = function() {
      if (this.mcpClient) {
        this.mcpClient.destroy();
      }

      try {
        // 验证凭证
        if (!this.credentials.token) {
          throw new Error('Missing access token');
        }

        // 创建配置对象
        const mcpConfig = new MCPConfig({
          endpoint: this.endpoint,
          serverName: this.serverName,
          autoReconnect: this.autoReconnect,
          reconnectDelay: this.reconnectDelay,
          heartbeatInterval: this.heartbeatInterval,
          requestTimeout: this.requestTimeout
        });

        // 创建凭证对象
        const mcpCredentials = new MCPCredentials(this.credentials.token);

        // 创建MCP客户端
        this.mcpClient = new WebSocketMCP(mcpConfig, mcpCredentials);

        // 设置事件监听器
        this.setupEventListeners();

        this.logger.info('MCP client initialized');
        return true;

      } catch (error) {
        this.lastError = error.message;
        this.logger.error('Failed to initialize MCP client:', error.message);
        this.updateStatus('error', error.message);
        return false;
      }
    };

    /**
     * 设置事件监听器
     */
    this.setupEventListeners = function() {
      if (!this.mcpClient) return;

      // 连接成功
      this.mcpClient.on('connected', () => {
        this.connectionState = 'connected';
        this.connectionStats.connectedAt = new Date();
        this.connectionStats.connectionAttempts++;
        this.lastError = null;

        this.logger.info('Connected to MCP server');
        this.updateStatus('connected', '已连接');
        
        // 通知依赖节点
        this.notifyDependentNodes('connected');
      });

      // 连接断开
      this.mcpClient.on('disconnected', (data) => {
        this.connectionState = 'disconnected';
        this.connectionStats.disconnectedAt = new Date();
        
        if (this.connectionStats.connectedAt) {
          this.connectionStats.totalUptime += 
            Date.now() - this.connectionStats.connectedAt.getTime();
        }

        this.logger.info('Disconnected from MCP server:', data.reason);
        this.updateStatus('disconnected', '已断开');
        
        // 通知依赖节点
        this.notifyDependentNodes('disconnected', data);
      });

      // 重连中
      this.mcpClient.on('status-change', (data) => {
        if (data.state === 'reconnecting') {
          this.connectionState = 'reconnecting';
          this.updateStatus('reconnecting', `重连中 (${data.attempt}/${data.maxAttempts})`);
        }
      });

      // 连接错误
      this.mcpClient.on('error', (error) => {
        this.lastError = error.message;
        this.logger.error('MCP client error:', error.message);
        this.updateStatus('error', error.message);
        
        // 通知依赖节点
        this.notifyDependentNodes('error', { error: error.message });
      });

      // 工具注册事件
      this.mcpClient.on('tool-registered', (data) => {
        this.logger.debug(`Tool registered: ${data.name}`);
        this.notifyDependentNodes('tool-registered', data);
      });

      // 工具调用事件
      this.mcpClient.on('tool-called', (data) => {
        this.logger.debug(`Tool called: ${data.toolName}`);
        this.notifyDependentNodes('tool-called', data);
      });
    };

    /**
     * 连接到MCP服务器
     */
    this.connect = async function() {
      if (!this.mcpClient) {
        if (!this.initializeMCPClient()) {
          return false;
        }
      }

      if (this.mcpClient.isConnected()) {
        this.logger.debug('Already connected to MCP server');
        return true;
      }

      try {
        this.updateStatus('connecting', '连接中...');
        await this.mcpClient.connect();
        return true;
      } catch (error) {
        this.lastError = error.message;
        this.logger.error('Failed to connect:', error.message);
        this.updateStatus('error', error.message);
        return false;
      }
    };

    /**
     * 断开连接
     */
    this.disconnect = function() {
      if (this.mcpClient) {
        this.mcpClient.disconnect();
      }
    };

    /**
     * 更新节点状态显示
     */
    this.updateStatus = function(state, message) {
      const statusConfig = {
        connected: { fill: 'green', shape: 'dot', text: message },
        connecting: { fill: 'yellow', shape: 'ring', text: message },
        reconnecting: { fill: 'blue', shape: 'ring', text: message },
        disconnected: { fill: 'red', shape: 'ring', text: message },
        error: { fill: 'red', shape: 'dot', text: message }
      };

      const status = statusConfig[state] || { fill: 'grey', shape: 'ring', text: message };
      this.status(status);
    };

    /**
     * 注册依赖节点
     */
    this.registerDependentNode = function(nodeId, callbacks) {
      this.dependentNodes.add({ nodeId, callbacks });
      this.logger.debug(`Registered dependent node: ${nodeId}`);
    };

    /**
     * 注销依赖节点
     */
    this.unregisterDependentNode = function(nodeId) {
      this.dependentNodes.forEach(dep => {
        if (dep.nodeId === nodeId) {
          this.dependentNodes.delete(dep);
        }
      });
      this.logger.debug(`Unregistered dependent node: ${nodeId}`);
    };

    /**
     * 通知依赖节点
     */
    this.notifyDependentNodes = function(event, data) {
      this.dependentNodes.forEach(dep => {
        if (dep.callbacks && dep.callbacks[event]) {
          try {
            dep.callbacks[event](data);
          } catch (error) {
            this.logger.error(`Error notifying dependent node ${dep.nodeId}:`, error.message);
          }
        }
      });
    };

    /**
     * 获取连接状态
     */
    this.getConnectionState = function() {
      return {
        state: this.connectionState,
        isConnected: this.mcpClient ? this.mcpClient.isConnected() : false,
        lastError: this.lastError,
        stats: this.connectionStats,
        mcpStats: this.mcpClient ? this.mcpClient.getStats() : null
      };
    };

    /**
     * 获取健康状态
     */
    this.getHealth = function() {
      if (!this.mcpClient) {
        return { status: 'unhealthy', reason: 'MCP client not initialized' };
      }
      return this.mcpClient.getHealth();
    };

    // 节点初始化
    if (this.credentials.token && this.endpoint) {
      // 延迟初始化，确保Node-RED完全启动
      setTimeout(() => {
        if (this.initializeMCPClient()) {
          this.connect().catch(error => {
            this.logger.error('Auto-connect failed:', error.message);
          });
        }
      }, 1000);
    } else {
      this.updateStatus('error', '配置不完整');
    }

    // 节点关闭时清理
    this.on('close', function(done) {
      node.logger.info('Closing xiaozhi-config node');
      
      // 断开MCP连接
      if (node.mcpClient) {
        node.mcpClient.destroy();
        node.mcpClient = null;
      }
      
      // 清理依赖节点
      node.dependentNodes.clear();
      
      done();
    });
  }

  // 注册配置节点类型
  RED.nodes.registerType('xiaozhi-config', XiaozhiConfigNode, {
    credentials: {
      token: { type: 'password' }
    }
  });

  // 提供HTTP端点用于配置测试
  RED.httpAdmin.post('/xiaozhi-config/:id/test', RED.auth.needsPermission('xiaozhi-config.write'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Config node not found' });
      return;
    }

    // 测试连接
    node.connect().then(success => {
      if (success) {
        const health = node.getHealth();
        res.json({ 
          success: true, 
          status: 'connected',
          health 
        });
      } else {
        res.json({ 
          success: false, 
          error: node.lastError || 'Connection failed' 
        });
      }
    }).catch(error => {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    });
  });

  // 提供HTTP端点用于获取连接状态
  RED.httpAdmin.get('/xiaozhi-config/:id/status', RED.auth.needsPermission('xiaozhi-config.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Config node not found' });
      return;
    }

    res.json(node.getConnectionState());
  });
};