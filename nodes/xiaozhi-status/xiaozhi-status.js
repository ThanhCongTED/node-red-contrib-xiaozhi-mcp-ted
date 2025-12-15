/**
 * xiaozhi-status Nút giám sát trạng thái
 * Dùng để giám sát trạng thái kết nối MCP, trạng thái công cụ và tình trạng sức khỏe hệ thống
 */

module.exports = function(RED) {
  const { Logger } = require('../../lib/utils');

  function XiaozhiStatusNode(config) {
    RED.nodes.createNode(this, config);

    // Tham số cấu hình
    this.name = config.name;
    this.xiaozhi = RED.nodes.getNode(config.xiaozhi);
    this.monitorMode = config.monitorMode || 'auto'; // auto, manual, scheduled
    this.outputMode = config.outputMode || 'full'; // full, changes, summary
    this.pollingInterval = parseInt(config.pollingInterval) || 10000;
    this.includeStats = config.includeStats !== false;
    this.includeHealth = config.includeHealth !== false;
    this.includeTools = config.includeTools !== false;
    this.autoStart = config.autoStart !== false;

    // Trình ghi nhật ký
    this.logger = new Logger(`Status[${this.name || this.id}]`);

    // Giám sát trạng thái
    this.monitoring = false;
    this.pollingTimer = null;
    this.lastStatus = null;
    this.statusHistory = [];
    this.maxHistorySize = 100;

    // Thông tin thống kê
    this.monitoringStats = {
      startedAt: null,
      totalOutputs: 0,
      statusChanges: 0,
      connectionChanges: 0,
      errors: 0
    };

    const node = this;

    /**
     * Lấy thông tin trạng thái hiện tại
     */
    this.getCurrentStatus = function() {
      const timestamp = new Date().toISOString();
      const status = {
        timestamp,
        mcp: {
          configured: !!this.xiaozhi,
          connected: false,
          endpoint: null,
          connectionState: 'unknown',
          lastError: null
        }
      };

      if (this.xiaozhi) {
        const connectionState = this.xiaozhi.getConnectionState();
        status.mcp.connected = connectionState.isConnected;
        status.mcp.connectionState = connectionState.state;
        status.mcp.endpoint = this.xiaozhi.endpoint;
        status.mcp.lastError = connectionState.lastError;

        // Thống kê kết nối
        if (this.includeStats && connectionState.stats) {
          status.mcp.stats = connectionState.stats;
        }

        // Thống kê máy khách MCP
        if (this.includeStats && connectionState.mcpStats) {
          status.mcp.clientStats = connectionState.mcpStats;
        }

        // Trạng thái sức khỏe
        if (this.includeHealth) {
          try {
            status.mcp.health = this.xiaozhi.getHealth();
          } catch (error) {
            status.mcp.health = { status: 'error', reason: error.message };
          }
        }

        // Thông tin công cụ
        if (this.includeTools && this.xiaozhi.mcpClient) {
          try {
            const tools = this.xiaozhi.mcpClient.getRegisteredTools();
            status.tools = {
              count: tools.size,
              names: Array.from(tools.keys()),
              details: this.includeStats ? 
                Array.from(tools.values()).map(tool => ({
                  name: tool.name,
                  description: tool.description,
                  enabled: tool.enabled,
                  stats: tool.getStats()
                })) : undefined
            };
          } catch (error) {
            status.tools = { error: error.message };
          }
        }
      }

      // Thông tin hệ thống
      status.system = {
        nodeId: this.id,
        nodeName: this.name,
        monitoring: this.monitoring,
        uptime: this.monitoringStats.startedAt ? 
          Date.now() - this.monitoringStats.startedAt.getTime() : 0
      };

      if (this.includeStats) {
        status.system.stats = { ...this.monitoringStats };
      }

      return status;
    };

    /**
     * So sánh thay đổi trạng thái
     */
    this.compareStatus = function(current, previous) {
      if (!previous) return { hasChanges: true, changes: ['initial'] };

      const changes = [];

      // Thay đổi trạng thái kết nối MCP
      if (current.mcp.connected !== previous.mcp.connected) {
        changes.push(current.mcp.connected ? 'mcp_connected' : 'mcp_disconnected');
        this.monitoringStats.connectionChanges++;
      }

      if (current.mcp.connectionState !== previous.mcp.connectionState) {
        changes.push(`mcp_state_${current.mcp.connectionState}`);
      }

      // Thay đổi số lượng công cụ
      if (current.tools && previous.tools) {
        if (current.tools.count !== previous.tools.count) {
          changes.push('tools_count_changed');
        }
        
        // Thay đổi danh sách công cụ
        const currentTools = new Set(current.tools.names || []);
        const previousTools = new Set(previous.tools.names || []);
        
        const addedTools = [...currentTools].filter(name => !previousTools.has(name));
        const removedTools = [...previousTools].filter(name => !currentTools.has(name));
        
        if (addedTools.length > 0) {
          changes.push(`tools_added:${addedTools.join(',')}`);
        }
        if (removedTools.length > 0) {
          changes.push(`tools_removed:${removedTools.join(',')}`);
        }
      }

      // Thay đổi trạng thái sức khỏe
      if (current.mcp.health && previous.mcp.health) {
        if (current.mcp.health.status !== previous.mcp.health.status) {
          changes.push(`health_${current.mcp.health.status}`);
        }
      }

      return {
        hasChanges: changes.length > 0,
        changes
      };
    };

    /**
     * Xử lý xuất trạng thái
     */
    this.outputStatus = function(current, comparison) {
      let outputPayload;
      let shouldOutput = true;

      switch (this.outputMode) {
      case 'full':
        outputPayload = current;
        break;

      case 'changes':
        if (!comparison.hasChanges) {
          shouldOutput = false;
        } else {
          outputPayload = {
            ...current,
            changes: comparison.changes,
            previousStatus: this.lastStatus
          };
        }
        break;

      case 'summary':
        outputPayload = {
          timestamp: current.timestamp,
          mcp: {
            connected: current.mcp.connected,
            state: current.mcp.connectionState,
            endpoint: current.mcp.endpoint
          },
          tools: current.tools ? {
            count: current.tools.count,
            names: current.tools.names
          } : undefined,
          health: current.mcp.health ? current.mcp.health.status : undefined,
          changes: comparison.changes
        };
        break;

      default:
        outputPayload = current;
        break;
      }

      if (shouldOutput) {
        const msg = {
          payload: outputPayload,
          topic: 'xiaozhi/status',
          _statusUpdate: {
            type: 'status',
            hasChanges: comparison.hasChanges,
            changes: comparison.changes,
            timestamp: current.timestamp
          }
        };

        this.send(msg);
        this.monitoringStats.totalOutputs++;

        if (comparison.hasChanges) {
          this.monitoringStats.statusChanges++;
        }

        this.logger.debug(`Xuất trạng thái: changes=${comparison.hasChanges}, mode=${this.outputMode}`);
      }
    };

    /**
     * Thực hiện kiểm tra trạng thái
     */
    this.checkStatus = function() {
      try {
        const current = this.getCurrentStatus();
        const comparison = this.compareStatus(current, this.lastStatus);

        // Xuất trạng thái
        this.outputStatus(current, comparison);

        // Cập nhật lịch sử
        this.statusHistory.push({
          timestamp: current.timestamp,
          status: current,
          changes: comparison.changes
        });

        // Giới hạn kích thước lịch sử
        if (this.statusHistory.length > this.maxHistorySize) {
          this.statusHistory.shift();
        }

        // Cập nhật trạng thái cuối cùng
        this.lastStatus = current;

        // Cập nhật hiển thị trạng thái nút
        this.updateNodeStatus(current);

      } catch (error) {
        this.monitoringStats.errors++;
        this.logger.error('Kiểm tra trạng thái thất bại:', error.message);
        this.updateNodeStatus(null, error);
      }
    };

    /**
     * Bắt đầu giám sát
     */
    this.startMonitoring = function() {
      if (this.monitoring) {
        this.logger.debug('Đã bắt đầu giám sát');
        return;
      }

      this.monitoring = true;
      this.monitoringStats.startedAt = new Date();

      // Thực hiện kiểm tra ngay lập tức
      this.checkStatus();

      // Thiết lập bộ đếm thời gian
      if (this.monitorMode === 'auto' || this.monitorMode === 'scheduled') {
        this.pollingTimer = setInterval(() => {
          this.checkStatus();
        }, this.pollingInterval);

        this.logger.info(`Đã bắt đầu giám sát với khoảng thời gian ${this.pollingInterval}ms`);
      } else {
        this.logger.info('Đã bắt đầu giám sát ở chế độ thủ công');
      }
    };

    /**
     * Dừng giám sát
     */
    this.stopMonitoring = function() {
      if (!this.monitoring) {
        this.logger.debug('Đã dừng giám sát');
        return;
      }

      this.monitoring = false;

      if (this.pollingTimer) {
        clearInterval(this.pollingTimer);
        this.pollingTimer = null;
      }

      this.logger.info('Đã dừng giám sát');
      this.updateNodeStatus(null, null, 'stopped');
    };

    /**
     * Cập nhật hiển thị trạng thái nút
     */
    this.updateNodeStatus = function(status, error, override) {
      if (override) {
        this.status({ fill: 'grey', shape: 'ring', text: override });
        return;
      }

      if (error) {
        this.status({ fill: 'red', shape: 'ring', text: `Lỗi: ${error.message}` });
        return;
      }

      if (!status) {
        this.status({ fill: 'grey', shape: 'ring', text: 'Trạng thái không xác định' });
        return;
      }

      let fill, shape, text;

      if (status.mcp.connected) {
        fill = 'green';
        shape = 'dot';
        text = 'Đã kết nối';
      } else {
        fill = 'red';
        shape = 'ring';
        text = 'Chưa kết nối';
      }

      // Thêm thông tin công cụ
      if (status.tools && status.tools.count > 0) {
        text += ` (${status.tools.count} công cụ)`;
      }

      // Thêm trạng thái giám sát
      if (this.monitoring) {
        text += ' [Đang giám sát]';
      }

      this.status({ fill, shape, text });
    };

    /**
     * Lấy thông tin thống kê giám sát
     */
    this.getMonitoringStats = function() {
      return {
        ...this.monitoringStats,
        monitoring: this.monitoring,
        pollingInterval: this.pollingInterval,
        historySize: this.statusHistory.length,
        uptime: this.monitoringStats.startedAt ? 
          Date.now() - this.monitoringStats.startedAt.getTime() : 0
      };
    };

    /**
     * Lấy lịch sử trạng thái
     */
    this.getStatusHistory = function(limit) {
      const history = this.statusHistory.slice();
      if (limit && limit > 0) {
        return history.slice(-limit);
      }
      return history;
    };

    // Xử lý tin nhắn đầu vào
    this.on('input', function(msg) {
      const command = msg.payload;

      if (typeof command === 'string') {
        switch (command.toLowerCase()) {
        case 'start':
          node.startMonitoring();
          break;
        case 'stop':
          node.stopMonitoring();
          break;
        case 'check':
        case 'status':
          node.checkStatus();
          break;
        case 'stats':
          node.send({
            ...msg,
            payload: node.getMonitoringStats(),
            topic: 'xiaozhi/monitoring/stats'
          });
          break;
        case 'history': {
          const limit = msg.limit || 10;
          node.send({
            ...msg,
            payload: node.getStatusHistory(limit),
            topic: 'xiaozhi/monitoring/history'
          });
          break;
        }
        default:
          node.logger.warn('Lệnh không xác định:', command);
          break;
        }
      } else if (command && typeof command === 'object') {
        // Xử lý lệnh đối tượng
        if (command.action) {
          switch (command.action) {
          case 'configure':
            if (command.pollingInterval) {
              node.pollingInterval = parseInt(command.pollingInterval);
              node.logger.info(`Đã cập nhật khoảng thời gian kiểm tra thành ${node.pollingInterval}ms`);
            }
            if (command.outputMode) {
              node.outputMode = command.outputMode;
              node.logger.info(`Đã cập nhật chế độ xuất thành ${node.outputMode}`);
            }
            break;
          default:
            node.logger.warn('Hành động không xác định:', command.action);
            break;
          }
        }
      } else {
        // Mặc định thực hiện kiểm tra trạng thái
        node.checkStatus();
      }
    });

    // Lắng nghe thay đổi trạng thái kết nối MCP
    if (this.xiaozhi) {
      const callbacks = {
        connected: () => {
          this.logger.debug('Đã nhận sự kiện kết nối MCP');
          if (this.monitoring) {
            // Trì hoãn kiểm tra để đảm bảo kết nối ổn định
            setTimeout(() => this.checkStatus(), 1000);
          }
        },
        disconnected: (data) => {
          this.logger.debug('Đã nhận sự kiện ngắt kết nối MCP:', data.reason);
          if (this.monitoring) {
            this.checkStatus();
          }
        },
        error: (data) => {
          this.logger.debug('Đã nhận sự kiện lỗi MCP:', data.error);
          if (this.monitoring) {
            this.checkStatus();
          }
        },
        'tool-registered': (data) => {
          this.logger.debug('Đã nhận sự kiện đăng ký công cụ:', data.name);
          if (this.monitoring) {
            setTimeout(() => this.checkStatus(), 500);
          }
        },
        'tool-unregistered': (data) => {
          this.logger.debug('Đã nhận sự kiện hủy đăng ký công cụ:', data.name);
          if (this.monitoring) {
            setTimeout(() => this.checkStatus(), 500);
          }
        }
      };

      this.xiaozhi.registerDependentNode(this.id, callbacks);
    }

    // Tự động khởi động giám sát
    if (this.autoStart) {
      setTimeout(() => {
        this.startMonitoring();
      }, 1000);
    } else {
      this.updateNodeStatus(null, null, 'Đã dừng');
    }

    // Dọn dẹp khi đóng nút
    this.on('close', function(done) {
      node.logger.info('Đang đóng nút giám sát trạng thái');
      
      // Dừng giám sát
      node.stopMonitoring();
      
      // Hủy đăng ký khỏi nút cấu hình MCP
      if (node.xiaozhi) {
        node.xiaozhi.unregisterDependentNode(node.id);
      }
      
      done();
    });
  }

  // Đăng ký loại nút
  RED.nodes.registerType('xiaozhi-status', XiaozhiStatusNode);

  // Cung cấp endpoint HTTP để lấy thông tin trạng thái
  RED.httpAdmin.get('/xiaozhi-status/:id/status', RED.auth.needsPermission('xiaozhi-status.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Không tìm thấy nút' });
      return;
    }

    try {
      const status = node.getCurrentStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Cung cấp endpoint HTTP để lấy thống kê giám sát
  RED.httpAdmin.get('/xiaozhi-status/:id/stats', RED.auth.needsPermission('xiaozhi-status.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Không tìm thấy nút' });
      return;
    }

    res.json(node.getMonitoringStats());
  });

  // Cung cấp endpoint HTTP để lấy lịch sử trạng thái
  RED.httpAdmin.get('/xiaozhi-status/:id/history', RED.auth.needsPermission('xiaozhi-status.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Không tìm thấy nút' });
      return;
    }

    const limit = parseInt(req.query.limit) || 50;
    res.json(node.getStatusHistory(limit));
  });

  // Cung cấp endpoint HTTP để điều khiển giám sát
  RED.httpAdmin.post('/xiaozhi-status/:id/control', RED.auth.needsPermission('xiaozhi-status.write'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Không tìm thấy nút' });
      return;
    }

    const { action } = req.body;

    try {
      switch (action) {
      case 'start':
        node.startMonitoring();
        res.json({ success: true, monitoring: node.monitoring });
        break;
      case 'stop':
        node.stopMonitoring();
        res.json({ success: true, monitoring: node.monitoring });
        break;
      case 'check':
        node.checkStatus();
        res.json({ success: true, timestamp: new Date().toISOString() });
        break;
      default:
        res.status(400).json({ error: 'Hành động không hợp lệ' });
        break;
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};