/**
 * xiaozhi-status 状态监控节点
 * 用于监控MCP连接状态、工具状态和系统健康状况
 */

module.exports = function(RED) {
  const { Logger } = require('../../lib/utils');

  function XiaozhiStatusNode(config) {
    RED.nodes.createNode(this, config);

    // 配置参数
    this.name = config.name;
    this.xiaozhi = RED.nodes.getNode(config.xiaozhi);
    this.monitorMode = config.monitorMode || 'auto'; // auto, manual, scheduled
    this.outputMode = config.outputMode || 'full'; // full, changes, summary
    this.pollingInterval = parseInt(config.pollingInterval) || 10000;
    this.includeStats = config.includeStats !== false;
    this.includeHealth = config.includeHealth !== false;
    this.includeTools = config.includeTools !== false;
    this.autoStart = config.autoStart !== false;

    // 日志记录器
    this.logger = new Logger(`Status[${this.name || this.id}]`);

    // 状态监控
    this.monitoring = false;
    this.pollingTimer = null;
    this.lastStatus = null;
    this.statusHistory = [];
    this.maxHistorySize = 100;

    // 统计信息
    this.monitoringStats = {
      startedAt: null,
      totalOutputs: 0,
      statusChanges: 0,
      connectionChanges: 0,
      errors: 0
    };

    const node = this;

    /**
     * 获取当前状态信息
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

        // 连接统计
        if (this.includeStats && connectionState.stats) {
          status.mcp.stats = connectionState.stats;
        }

        // MCP客户端统计
        if (this.includeStats && connectionState.mcpStats) {
          status.mcp.clientStats = connectionState.mcpStats;
        }

        // 健康状态
        if (this.includeHealth) {
          try {
            status.mcp.health = this.xiaozhi.getHealth();
          } catch (error) {
            status.mcp.health = { status: 'error', reason: error.message };
          }
        }

        // 工具信息
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

      // 系统信息
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
     * 比较状态变化
     */
    this.compareStatus = function(current, previous) {
      if (!previous) return { hasChanges: true, changes: ['initial'] };

      const changes = [];

      // MCP连接状态变化
      if (current.mcp.connected !== previous.mcp.connected) {
        changes.push(current.mcp.connected ? 'mcp_connected' : 'mcp_disconnected');
        this.monitoringStats.connectionChanges++;
      }

      if (current.mcp.connectionState !== previous.mcp.connectionState) {
        changes.push(`mcp_state_${current.mcp.connectionState}`);
      }

      // 工具数量变化
      if (current.tools && previous.tools) {
        if (current.tools.count !== previous.tools.count) {
          changes.push('tools_count_changed');
        }
        
        // 工具列表变化
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

      // 健康状态变化
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
     * 处理状态输出
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

        this.logger.debug(`Status output: changes=${comparison.hasChanges}, mode=${this.outputMode}`);
      }
    };

    /**
     * 执行状态检查
     */
    this.checkStatus = function() {
      try {
        const current = this.getCurrentStatus();
        const comparison = this.compareStatus(current, this.lastStatus);

        // 输出状态
        this.outputStatus(current, comparison);

        // 更新历史记录
        this.statusHistory.push({
          timestamp: current.timestamp,
          status: current,
          changes: comparison.changes
        });

        // 限制历史记录大小
        if (this.statusHistory.length > this.maxHistorySize) {
          this.statusHistory.shift();
        }

        // 更新最后状态
        this.lastStatus = current;

        // 更新节点状态显示
        this.updateNodeStatus(current);

      } catch (error) {
        this.monitoringStats.errors++;
        this.logger.error('Status check failed:', error.message);
        this.updateNodeStatus(null, error);
      }
    };

    /**
     * 开始监控
     */
    this.startMonitoring = function() {
      if (this.monitoring) {
        this.logger.debug('Monitoring already started');
        return;
      }

      this.monitoring = true;
      this.monitoringStats.startedAt = new Date();

      // 立即执行一次检查
      this.checkStatus();

      // 设置定时器
      if (this.monitorMode === 'auto' || this.monitorMode === 'scheduled') {
        this.pollingTimer = setInterval(() => {
          this.checkStatus();
        }, this.pollingInterval);

        this.logger.info(`Monitoring started with ${this.pollingInterval}ms interval`);
      } else {
        this.logger.info('Monitoring started in manual mode');
      }
    };

    /**
     * 停止监控
     */
    this.stopMonitoring = function() {
      if (!this.monitoring) {
        this.logger.debug('Monitoring already stopped');
        return;
      }

      this.monitoring = false;

      if (this.pollingTimer) {
        clearInterval(this.pollingTimer);
        this.pollingTimer = null;
      }

      this.logger.info('Monitoring stopped');
      this.updateNodeStatus(null, null, 'stopped');
    };

    /**
     * 更新节点状态显示
     */
    this.updateNodeStatus = function(status, error, override) {
      if (override) {
        this.status({ fill: 'grey', shape: 'ring', text: override });
        return;
      }

      if (error) {
        this.status({ fill: 'red', shape: 'ring', text: `错误: ${error.message}` });
        return;
      }

      if (!status) {
        this.status({ fill: 'grey', shape: 'ring', text: '未知状态' });
        return;
      }

      let fill, shape, text;

      if (status.mcp.connected) {
        fill = 'green';
        shape = 'dot';
        text = '已连接';
      } else {
        fill = 'red';
        shape = 'ring';
        text = '未连接';
      }

      // 添加工具信息
      if (status.tools && status.tools.count > 0) {
        text += ` (${status.tools.count}个工具)`;
      }

      // 添加监控状态
      if (this.monitoring) {
        text += ' [监控中]';
      }

      this.status({ fill, shape, text });
    };

    /**
     * 获取监控统计信息
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
     * 获取状态历史
     */
    this.getStatusHistory = function(limit) {
      const history = this.statusHistory.slice();
      if (limit && limit > 0) {
        return history.slice(-limit);
      }
      return history;
    };

    // 处理输入消息
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
          node.logger.warn('Unknown command:', command);
          break;
        }
      } else if (command && typeof command === 'object') {
        // 处理对象命令
        if (command.action) {
          switch (command.action) {
          case 'configure':
            if (command.pollingInterval) {
              node.pollingInterval = parseInt(command.pollingInterval);
              node.logger.info(`Polling interval updated to ${node.pollingInterval}ms`);
            }
            if (command.outputMode) {
              node.outputMode = command.outputMode;
              node.logger.info(`Output mode updated to ${node.outputMode}`);
            }
            break;
          default:
            node.logger.warn('Unknown action:', command.action);
            break;
          }
        }
      } else {
        // 默认执行状态检查
        node.checkStatus();
      }
    });

    // 监听MCP连接状态变化
    if (this.xiaozhi) {
      const callbacks = {
        connected: () => {
          this.logger.debug('MCP connected event received');
          if (this.monitoring) {
            // 延迟检查，确保连接稳定
            setTimeout(() => this.checkStatus(), 1000);
          }
        },
        disconnected: (data) => {
          this.logger.debug('MCP disconnected event received:', data.reason);
          if (this.monitoring) {
            this.checkStatus();
          }
        },
        error: (data) => {
          this.logger.debug('MCP error event received:', data.error);
          if (this.monitoring) {
            this.checkStatus();
          }
        },
        'tool-registered': (data) => {
          this.logger.debug('Tool registered event received:', data.name);
          if (this.monitoring) {
            setTimeout(() => this.checkStatus(), 500);
          }
        },
        'tool-unregistered': (data) => {
          this.logger.debug('Tool unregistered event received:', data.name);
          if (this.monitoring) {
            setTimeout(() => this.checkStatus(), 500);
          }
        }
      };

      this.xiaozhi.registerDependentNode(this.id, callbacks);
    }

    // 自动启动监控
    if (this.autoStart) {
      setTimeout(() => {
        this.startMonitoring();
      }, 1000);
    } else {
      this.updateNodeStatus(null, null, '已停止');
    }

    // 节点关闭时清理
    this.on('close', function(done) {
      node.logger.info('Closing status monitoring node');
      
      // 停止监控
      node.stopMonitoring();
      
      // 从MCP配置节点注销
      if (node.xiaozhi) {
        node.xiaozhi.unregisterDependentNode(node.id);
      }
      
      done();
    });
  }

  // 注册节点类型
  RED.nodes.registerType('xiaozhi-status', XiaozhiStatusNode);

  // 提供HTTP端点用于获取状态信息
  RED.httpAdmin.get('/xiaozhi-status/:id/status', RED.auth.needsPermission('xiaozhi-status.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    try {
      const status = node.getCurrentStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 提供HTTP端点用于获取监控统计
  RED.httpAdmin.get('/xiaozhi-status/:id/stats', RED.auth.needsPermission('xiaozhi-status.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    res.json(node.getMonitoringStats());
  });

  // 提供HTTP端点用于获取状态历史
  RED.httpAdmin.get('/xiaozhi-status/:id/history', RED.auth.needsPermission('xiaozhi-status.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    const limit = parseInt(req.query.limit) || 50;
    res.json(node.getStatusHistory(limit));
  });

  // 提供HTTP端点用于控制监控
  RED.httpAdmin.post('/xiaozhi-status/:id/control', RED.auth.needsPermission('xiaozhi-status.write'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
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
        res.status(400).json({ error: 'Invalid action' });
        break;
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};