/**
 * xiaozhi-tool-register 工具注册节点
 * 用于向小智MCP服务器注册设备工具
 */

module.exports = function(RED) {
  const { ToolParams, ToolResponse } = require('../../lib/interfaces');
  const { Logger, safeJsonParse, validateJsonSchema } = require('../../lib/utils');

  function XiaozhiToolRegisterNode(config) {
    RED.nodes.createNode(this, config);

    // 配置参数
    this.name = config.name;
    this.xiaozhi = RED.nodes.getNode(config.xiaozhi);
    this.toolName = config.toolName || '';
    this.toolDescription = config.toolDescription || '';
    this.inputSchema = config.inputSchema || '{}';
    this.outputToFlow = config.outputToFlow !== false;
    this.enableValidation = config.enableValidation !== false;
    this.asyncExecution = config.asyncExecution !== false;
    this.executionTimeout = parseInt(config.executionTimeout) || 30000;

    // 日志记录器
    this.logger = new Logger(`ToolRegister[${this.name || this.toolName || this.id}]`);

    // 工具状态
    this.registered = false;
    this.registrationError = null;
    this.callCount = 0;
    this.lastCalledAt = null;
    this.averageExecutionTime = 0;

    // 待处理的工具调用队列（用于响应匹配）
    this.pendingCalls = new Map();

    const node = this;

    /**
     * 解析和验证JSON Schema
     */
    this.parseInputSchema = function() {
      try {
        return safeJsonParse(this.inputSchema, {});
      } catch (error) {
        this.logger.error('Invalid input schema:', error.message);
        return {};
      }
    };

    /**
     * 工具回调函数
     * 处理来自小智平台的工具调用
     */
    this.toolCallback = function(args) {
      const callId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const startTime = Date.now();

      node.logger.debug(`Tool called: ${node.toolName}, args:`, args);

      // 更新统计信息
      node.callCount++;
      node.lastCalledAt = new Date();

      if (node.outputToFlow) {
        // 输出到流程进行处理
        const msg = {
          payload: {
            toolName: node.toolName,
            arguments: args,
            callId: callId,
            timestamp: new Date().toISOString()
          },
          _mcpCallId: callId,
          _mcpStartTime: startTime
        };

        // 创建Promise等待响应
        return new Promise((resolve, reject) => {
          // 设置超时处理
          const timeout = setTimeout(() => {
            node.pendingCalls.delete(callId);
            const errorMsg = `Tool execution timeout after ${node.executionTimeout}ms`;
            node.logger.warn(errorMsg);
            reject(new Error(errorMsg));
          }, node.executionTimeout);

          // 存储待处理调用
          node.pendingCalls.set(callId, {
            resolve,
            reject,
            timeout,
            startTime,
            args
          });

          // 发送消息到流程
          node.send(msg);
          node.logger.debug(`Tool call sent to flow: ${callId}`);
        });
      } else {
        // 直接返回默认响应
        const response = ToolResponse.success(`工具 ${node.toolName} 已被调用`);
        node._updateExecutionStats(startTime);
        return response;
      }
    };

    /**
     * 注册工具到MCP服务器
     */
    this.registerTool = function() {
      if (!this.xiaozhi || !this.xiaozhi.mcpClient) {
        this.registrationError = 'MCP连接未配置或未连接';
        this.updateStatus('error', this.registrationError);
        return false;
      }

      if (!this.toolName) {
        this.registrationError = '工具名称不能为空';
        this.updateStatus('error', this.registrationError);
        return false;
      }

      try {
        const parsedSchema = this.parseInputSchema();
        
        // 验证schema有效性
        if (this.enableValidation && parsedSchema && Object.keys(parsedSchema).length > 0) {
          // 简单验证schema结构
          if (!parsedSchema.type && !parsedSchema.properties) {
            this.logger.warn('Input schema may be invalid - missing type or properties');
          }
        }

        // 注册工具
        const success = this.xiaozhi.mcpClient.registerTool(
          this.toolName,
          this.toolDescription || this.toolName,
          parsedSchema,
          this.toolCallback
        );

        if (success) {
          this.registered = true;
          this.registrationError = null;
          this.updateStatus('registered', '已注册');
          this.logger.info(`Tool registered successfully: ${this.toolName}`);
          
          // 发送注册成功事件
          this.emit('tool-registered', {
            toolName: this.toolName,
            description: this.toolDescription,
            schema: parsedSchema
          });
          
          return true;
        } else {
          this.registrationError = '工具注册失败';
          this.updateStatus('error', this.registrationError);
          return false;
        }

      } catch (error) {
        this.registrationError = error.message;
        this.logger.error('Tool registration failed:', error.message);
        this.updateStatus('error', this.registrationError);
        return false;
      }
    };

    /**
     * 注销工具
     */
    this.unregisterTool = function() {
      if (this.xiaozhi && this.xiaozhi.mcpClient && this.registered) {
        try {
          this.xiaozhi.mcpClient.unregisterTool(this.toolName);
          this.registered = false;
          this.updateStatus('unregistered', '已注销');
          this.logger.info(`Tool unregistered: ${this.toolName}`);
          
          // 清理待处理调用
          this.pendingCalls.forEach(call => {
            clearTimeout(call.timeout);
            call.reject(new Error('Tool unregistered'));
          });
          this.pendingCalls.clear();

        } catch (error) {
          this.logger.error('Tool unregistration failed:', error.message);
        }
      }
    };

    /**
     * 处理来自流程的响应消息
     */
    this.handleResponse = function(msg) {
      const callId = msg._mcpCallId;
      
      if (!callId || !this.pendingCalls.has(callId)) {
        this.logger.warn('Received response for unknown call ID:', callId);
        return;
      }

      const pendingCall = this.pendingCalls.get(callId);
      this.pendingCalls.delete(callId);
      
      clearTimeout(pendingCall.timeout);

      try {
        // 构造工具响应
        let response;
        
        if (msg.payload && typeof msg.payload === 'object') {
          if (msg.payload.error) {
            response = ToolResponse.error(msg.payload.error);
          } else if (msg.payload.result !== undefined) {
            response = ToolResponse.success(msg.payload.result);
          } else {
            response = ToolResponse.fromJson(msg.payload);
          }
        } else {
          response = ToolResponse.success(msg.payload || 'Success');
        }

        // 更新执行统计
        this._updateExecutionStats(pendingCall.startTime);

        // 解析Promise
        pendingCall.resolve(response);
        
        this.logger.debug(`Tool response processed: ${callId}`);

      } catch (error) {
        this.logger.error('Error processing tool response:', error.message);
        pendingCall.reject(error);
      }
    };

    /**
     * 更新执行统计信息
     */
    this._updateExecutionStats = function(startTime) {
      const executionTime = Date.now() - startTime;
      
      // 计算平均执行时间（移动平均）
      const alpha = 0.1;
      this.averageExecutionTime = 
        this.averageExecutionTime * (1 - alpha) + executionTime * alpha;
    };

    /**
     * 更新节点状态显示
     */
    this.updateStatus = function(state, message) {
      const statusConfig = {
        registered: { fill: 'green', shape: 'dot', text: message },
        unregistered: { fill: 'grey', shape: 'ring', text: message },
        error: { fill: 'red', shape: 'ring', text: message },
        connecting: { fill: 'yellow', shape: 'ring', text: message }
      };

      const status = statusConfig[state] || { fill: 'grey', shape: 'ring', text: message };
      
      // 添加调用统计信息
      if (this.callCount > 0) {
        status.text += ` (${this.callCount}次调用)`;
      }
      
      this.status(status);
    };

    /**
     * 获取工具统计信息
     */
    this.getStats = function() {
      return {
        toolName: this.toolName,
        registered: this.registered,
        callCount: this.callCount,
        lastCalledAt: this.lastCalledAt,
        averageExecutionTime: Math.round(this.averageExecutionTime),
        pendingCalls: this.pendingCalls.size,
        registrationError: this.registrationError
      };
    };

    // 处理输入消息（用于响应工具调用）
    this.on('input', function(msg) {
      // 检查是否是工具调用响应
      if (msg._mcpCallId) {
        node.handleResponse(msg);
      } else {
        // 其他消息类型的处理（如动态注册）
        if (msg.payload && msg.payload.action) {
          switch (msg.payload.action) {
          case 'register':
            node.registerTool();
            break;
          case 'unregister':
            node.unregisterTool();
            break;
          default:
            node.logger.warn('Unknown action:', msg.payload.action);
          }
        }
      }
    });

    // 监听MCP连接状态变化
    if (this.xiaozhi) {
      // 注册为依赖节点
      const callbacks = {
        connected: () => {
          this.logger.debug('MCP connected, attempting to register tool');
          setTimeout(() => this.registerTool(), 1000); // 延迟注册确保连接稳定
        },
        disconnected: () => {
          this.registered = false;
          this.updateStatus('unregistered', 'MCP连接断开');
        },
        error: (data) => {
          this.updateStatus('error', 'MCP连接错误');
        }
      };

      this.xiaozhi.registerDependentNode(this.id, callbacks);

      // 如果已经连接，尝试注册
      if (this.xiaozhi.mcpClient && this.xiaozhi.mcpClient.isConnected()) {
        setTimeout(() => this.registerTool(), 500);
      } else {
        this.updateStatus('connecting', '等待MCP连接');
      }
    } else {
      this.updateStatus('error', '未配置MCP连接');
    }

    // 节点关闭时清理
    this.on('close', function(done) {
      node.logger.info('Closing tool register node');
      
      // 注销工具
      node.unregisterTool();
      
      // 从MCP配置节点注销
      if (node.xiaozhi) {
        node.xiaozhi.unregisterDependentNode(node.id);
      }
      
      // 清理待处理调用
      node.pendingCalls.forEach(call => {
        clearTimeout(call.timeout);
        call.reject(new Error('Node closing'));
      });
      node.pendingCalls.clear();
      
      done();
    });
  }

  // 注册节点类型
  RED.nodes.registerType('xiaozhi-tool-register', XiaozhiToolRegisterNode);

  // 提供HTTP端点用于获取工具统计信息
  RED.httpAdmin.get('/xiaozhi-tool-register/:id/stats', RED.auth.needsPermission('xiaozhi-tool-register.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    res.json(node.getStats());
  });

  // 提供HTTP端点用于手动注册/注销工具
  RED.httpAdmin.post('/xiaozhi-tool-register/:id/:action', RED.auth.needsPermission('xiaozhi-tool-register.write'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    const action = req.params.action;
    
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    try {
      let result = false;
      
      switch (action) {
      case 'register':
        result = node.registerTool();
        break;
      case 'unregister':
        result = node.unregisterTool();
        break;
      default:
        res.status(400).json({ error: 'Invalid action' });
        return;
      }

      res.json({ 
        success: result, 
        stats: node.getStats() 
      });

    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });
};