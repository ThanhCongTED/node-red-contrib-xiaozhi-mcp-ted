/**
 * Nút cấu hình xiaozhi-config
 * Quản lý cấu hình kết nối với máy chủ MCP Xiaozhi
 */

module.exports = function(RED) {
  const WebSocketMCP = require('../../lib/websocket-mcp');
  const { MCPConfig, MCPCredentials } = require('../../lib/interfaces');
  const { Logger } = require('../../lib/utils');

  function XiaozhiConfigNode(config) {
    RED.nodes.createNode(this, config);

    // Tham số cấu hình
    this.name = config.name;
    this.endpoint = config.endpoint;
    this.serverName = config.serverName || 'Thiết bị NodeRED';
    this.autoReconnect = config.autoReconnect !== false;
    this.reconnectDelay = parseInt(config.reconnectDelay) || 5000;
    this.heartbeatInterval = parseInt(config.heartbeatInterval) || 30000;
    this.requestTimeout = parseInt(config.requestTimeout) || 30000;

    // Trình ghi nhật ký
    this.logger = new Logger(`XiaozhiConfig[${this.name || this.id}]`);

    // Phiên bản khách hàng MCP
    this.mcpClient = null;
    this.connectionState = 'disconnected';
    this.lastError = null;

    // Thông tin thống kê kết nối
    this.connectionStats = {
      connectedAt: null,
      disconnectedAt: null,
      connectionAttempts: 0,
      totalUptime: 0
    };

    // Danh sách các nút phụ thuộc vào cấu hình này
    this.dependentNodes = new Set();

    const node = this;

    /**
     * Khởi tạo khách hàng MCP
     */
    this.initializeMCPClient = function() {
      if (this.mcpClient) {
        this.mcpClient.destroy();
      }

      try {
        // Xác thực thông tin xác thực
        if (!this.credentials.token) {
          throw new Error('Thiếu mã truy cập');
        }

        // Tạo đối tượng cấu hình
        const mcpConfig = new MCPConfig({
          endpoint: this.endpoint,
          serverName: this.serverName,
          autoReconnect: this.autoReconnect,
          reconnectDelay: this.reconnectDelay,
          heartbeatInterval: this.heartbeatInterval,
          requestTimeout: this.requestTimeout
        });

        // Tạo đối tượng thông tin xác thực
        const mcpCredentials = new MCPCredentials(this.credentials.token);

        // Tạo khách hàng MCP
        this.mcpClient = new WebSocketMCP(mcpConfig, mcpCredentials);

        // Thiết lập trình lắng nghe sự kiện
        this.setupEventListeners();

        this.logger.info('Đã khởi tạo khách hàng MCP');
        return true;

      } catch (error) {
        this.lastError = error.message;
        this.logger.error('Không thể khởi tạo khách hàng MCP:', error.message);
        this.updateStatus('error', error.message);
        return false;
      }
    };

    /**
     * Thiết lập trình lắng nghe sự kiện
     */
    this.setupEventListeners = function() {
      if (!this.mcpClient) return;

      // Kết nối thành công
      this.mcpClient.on('connected', () => {
        this.connectionState = 'connected';
        this.connectionStats.connectedAt = new Date();
        this.connectionStats.connectionAttempts++;
        this.lastError = null;

        this.logger.info('Đã kết nối đến máy chủ MCP');
        this.updateStatus('connected', 'Đã kết nối');
        
        // Thông báo cho các nút phụ thuộc
        this.notifyDependentNodes('connected');
      });

      // Kết nối bị ngắt
      this.mcpClient.on('disconnected', (data) => {
        this.connectionState = 'disconnected';
        this.connectionStats.disconnectedAt = new Date();
        
        if (this.connectionStats.connectedAt) {
          this.connectionStats.totalUptime += 
            Date.now() - this.connectionStats.connectedAt.getTime();
        }

        this.logger.info('Đã ngắt kết nối khỏi máy chủ MCP:', data.reason);
        this.updateStatus('disconnected', 'Đã ngắt kết nối');
        
        // Thông báo cho các nút phụ thuộc
        this.notifyDependentNodes('disconnected', data);
      });

      // Đang kết nối lại
      this.mcpClient.on('status-change', (data) => {
        if (data.state === 'reconnecting') {
          this.connectionState = 'reconnecting';
          this.updateStatus('reconnecting', `Đang kết nối lại (${data.attempt}/${data.maxAttempts})`);
        }
      });

      // Lỗi kết nối
      this.mcpClient.on('error', (error) => {
        this.lastError = error.message;
        this.logger.error('Lỗi khách hàng MCP:', error.message);
        this.updateStatus('error', error.message);
        
        // Thông báo cho các nút phụ thuộc
        this.notifyDependentNodes('error', { error: error.message });
      });

      // Sự kiện đăng ký công cụ
      this.mcpClient.on('tool-registered', (data) => {
        this.logger.debug(`Đã đăng ký công cụ: ${data.name}`);
        this.notifyDependentNodes('tool-registered', data);
      });

      // Sự kiện gọi công cụ
      this.mcpClient.on('tool-called', (data) => {
        this.logger.debug(`Đã gọi công cụ: ${data.toolName}`);
        this.notifyDependentNodes('tool-called', data);
      });
    };

    /**
     * Kết nối đến máy chủ MCP
     */
    this.connect = async function() {
      if (!this.mcpClient) {
        if (!this.initializeMCPClient()) {
          return false;
        }
      }

      if (this.mcpClient.isConnected()) {
        this.logger.debug('Đã kết nối đến máy chủ MCP');
        return true;
      }

      try {
        this.updateStatus('connecting', 'Đang kết nối...');
        await this.mcpClient.connect();
        return true;
      } catch (error) {
        this.lastError = error.message;
        this.logger.error('Không thể kết nối:', error.message);
        this.updateStatus('error', error.message);
        return false;
      }
    };

    /**
     * Ngắt kết nối
     */
    this.disconnect = function() {
      if (this.mcpClient) {
        this.mcpClient.disconnect();
      }
    };

    /**
     * Cập nhật hiển thị trạng thái nút
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
     * Đăng ký nút phụ thuộc
     */
    this.registerDependentNode = function(nodeId, callbacks) {
      this.dependentNodes.add({ nodeId, callbacks });
      this.logger.debug(`Đã đăng ký nút phụ thuộc: ${nodeId}`);
    };

    /**
     * Hủy đăng ký nút phụ thuộc
     */
    this.unregisterDependentNode = function(nodeId) {
      this.dependentNodes.forEach(dep => {
        if (dep.nodeId === nodeId) {
          this.dependentNodes.delete(dep);
        }
      });
      this.logger.debug(`Đã hủy đăng ký nút phụ thuộc: ${nodeId}`);
    };

    /**
     * Thông báo cho các nút phụ thuộc
     */
    this.notifyDependentNodes = function(event, data) {
      this.dependentNodes.forEach(dep => {
        if (dep.callbacks && dep.callbacks[event]) {
          try {
            dep.callbacks[event](data);
          } catch (error) {
            this.logger.error(`Lỗi khi thông báo cho nút phụ thuộc ${dep.nodeId}:`, error.message);
          }
        }
      });
    };

    /**
     * Lấy trạng thái kết nối
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
     * Lấy trạng thái sức khỏe
     */
    this.getHealth = function() {
      if (!this.mcpClient) {
        return { status: 'unhealthy', reason: 'Chưa khởi tạo khách hàng MCP' };
      }
      return this.mcpClient.getHealth();
    };

    // Khởi tạo nút
    if (this.credentials.token && this.endpoint) {
      // Trì hoãn khởi tạo, đảm bảo Node-RED khởi động hoàn toàn
      setTimeout(() => {
        if (this.initializeMCPClient()) {
          this.connect().catch(error => {
            this.logger.error('Tự động kết nối thất bại:', error.message);
          });
        }
      }, 1000);
    } else {
      this.updateStatus('error', 'Cấu hình không đầy đủ');
    }

    // Dọn dẹp khi đóng nút
    this.on('close', function(done) {
      node.logger.info('Đang đóng nút xiaozhi-config');
      
      // Ngắt kết nối MCP
      if (node.mcpClient) {
        node.mcpClient.destroy();
        node.mcpClient = null;
      }
      
      // Dọn dẹp các nút phụ thuộc
      node.dependentNodes.clear();
      
      done();
    });
  }

  // Đăng ký loại nút cấu hình
  RED.nodes.registerType('xiaozhi-config', XiaozhiConfigNode, {
    credentials: {
      token: { type: 'password' }
    }
  });

  // Cung cấp điểm cuối HTTP để kiểm tra cấu hình
  RED.httpAdmin.post('/xiaozhi-config/:id/test', RED.auth.needsPermission('xiaozhi-config.write'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Không tìm thấy nút cấu hình' });
      return;
    }

    // Kiểm tra kết nối
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
          error: node.lastError || 'Kết nối thất bại' 
        });
      }
    }).catch(error => {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    });
  });

  // Cung cấp điểm cuối HTTP để lấy trạng thái kết nối
  RED.httpAdmin.get('/xiaozhi-config/:id/status', RED.auth.needsPermission('xiaozhi-config.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Không tìm thấy nút cấu hình' });
      return;
    }

    res.json(node.getConnectionState());
  });
};