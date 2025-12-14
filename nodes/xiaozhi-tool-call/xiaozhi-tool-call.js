/**
 * xiaozhi-tool-call 工具调用节点
 * 用于主动调用小智平台或其他设备的工具
 */

module.exports = function(RED) {
  const { ToolParams, ToolResponse } = require('../../lib/interfaces');
  const { Logger, safeJsonParse, validateJsonSchema } = require('../../lib/utils');

  function XiaozhiToolCallNode(config) {
    RED.nodes.createNode(this, config);

    // 配置参数
    this.name = config.name;
    this.xiaozhi = RED.nodes.getNode(config.xiaozhi);
    this.targetTool = config.targetTool || '';
    this.toolArguments = config.toolArguments || '{}';
    this.argumentsSource = config.argumentsSource || 'configured'; // configured, msg, flow
    this.outputMode = config.outputMode || 'result'; // result, full, split
    this.errorHandling = config.errorHandling || 'throw'; // throw, output, ignore
    this.callTimeout = parseInt(config.callTimeout) || 30000;
    this.retryAttempts = parseInt(config.retryAttempts) || 0;
    this.retryDelay = parseInt(config.retryDelay) || 1000;

    // 日志记录器
    this.logger = new Logger(`ToolCall[${this.name || this.targetTool || this.id}]`);

    // 调用统计
    this.callStats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      averageResponseTime: 0,
      lastCallAt: null,
      lastError: null
    };

    const node = this;

    /**
     * 解析工具参数
     */
    this.parseToolArguments = function(source, msg, callback) {
      let argsJson;

      try {
        switch (source) {
        case 'configured':
          argsJson = this.toolArguments;
          break;
        case 'msg':
          if (msg.payload && typeof msg.payload === 'object') {
            argsJson = JSON.stringify(msg.payload);
          } else if (typeof msg.payload === 'string') {
            argsJson = msg.payload;
          } else {
            argsJson = '{}';
          }
          break;
        case 'msg.args':
          if (msg.args) {
            argsJson = typeof msg.args === 'string' ? msg.args : JSON.stringify(msg.args);
          } else {
            argsJson = '{}';
          }
          break;
        case 'flow': {
          const flowArgs = this.context().flow.get('toolArguments') || {};
          argsJson = JSON.stringify(flowArgs);
          break;
        }
        case 'global': {
          const globalArgs = this.context().global.get('toolArguments') || {};
          argsJson = JSON.stringify(globalArgs);
          break;
        }
        default:
          argsJson = this.toolArguments;
          break;
        }

        const parsedArgs = safeJsonParse(argsJson, {});
        callback(null, parsedArgs);

      } catch (error) {
        callback(error);
      }
    };

    /**
     * 调用工具
     */
    this.callTool = async function(toolName, args, attempt = 1) {
      const startTime = Date.now();
      
      try {
        this.logger.debug(`Calling tool: ${toolName}, args:`, args);

        // 检查MCP连接
        if (!this.xiaozhi || !this.xiaozhi.mcpClient) {
          throw new Error('MCP connection not available');
        }

        if (!this.xiaozhi.mcpClient.isConnected()) {
          throw new Error('MCP client not connected');
        }

        // 调用工具
        const result = await this.xiaozhi.mcpClient.callTool(toolName, args, {
          timeout: this.callTimeout
        });

        // 更新统计信息
        this.callStats.totalCalls++;
        this.callStats.successfulCalls++;
        this.callStats.lastCallAt = new Date();
        this._updateResponseTime(startTime);

        this.logger.debug(`Tool call successful: ${toolName}, response time: ${Date.now() - startTime}ms`);

        return result;

      } catch (error) {
        this.callStats.totalCalls++;
        this.callStats.failedCalls++;
        this.callStats.lastError = error.message;
        this.callStats.lastCallAt = new Date();

        this.logger.error(`Tool call failed: ${toolName} (attempt ${attempt}):`, error.message);

        // 重试逻辑
        if (attempt <= this.retryAttempts) {
          this.logger.info(`Retrying tool call in ${this.retryDelay}ms (attempt ${attempt + 1}/${this.retryAttempts + 1})`);
          
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
          return await this.callTool(toolName, args, attempt + 1);
        }

        throw error;
      }
    };

    /**
     * 格式化输出结果
     */
    this.formatOutput = function(result, mode, originalMsg) {
      const baseOutput = {
        ...originalMsg,
        _toolCall: {
          toolName: this.targetTool,
          timestamp: new Date().toISOString(),
          success: !result.isError
        }
      };

      switch (mode) {
      case 'result':
        // 只输出结果内容
        if (result.content && result.content.length > 0) {
          if (result.content.length === 1 && result.content[0].type === 'text') {
            // 单个文本结果，尝试解析JSON
            try {
              const parsed = JSON.parse(result.content[0].text);
              baseOutput.payload = parsed;
            } catch {
              baseOutput.payload = result.content[0].text;
            }
          } else {
            baseOutput.payload = result.content;
          }
        } else {
          baseOutput.payload = null;
        }
        return baseOutput;

      case 'full':
        // 输出完整响应
        baseOutput.payload = result;
        return baseOutput;

      case 'split': {
        // 分别输出结果和元数据
        const resultOutput = { ...baseOutput };
        if (result.content && result.content.length > 0) {
          if (result.content.length === 1 && result.content[0].type === 'text') {
            try {
              const parsed = JSON.parse(result.content[0].text);
              resultOutput.payload = parsed;
            } catch {
              resultOutput.payload = result.content[0].text;
            }
          } else {
            resultOutput.payload = result.content;
          }
        } else {
          resultOutput.payload = null;
        }

        const metaOutput = {
          ...originalMsg,
          payload: {
            toolName: this.targetTool,
            isError: result.isError,
            responseTime: Date.now() - (originalMsg._startTime || Date.now()),
            timestamp: new Date().toISOString()
          }
        };

        return [resultOutput, metaOutput];
      }

      default:
        return baseOutput;
      }
    };

    /**
     * 处理错误
     */
    this.handleError = function(error, originalMsg) {
      const errorMsg = {
        ...originalMsg,
        error: {
          message: error.message,
          toolName: this.targetTool,
          timestamp: new Date().toISOString()
        },
        _toolCall: {
          toolName: this.targetTool,
          timestamp: new Date().toISOString(),
          success: false,
          error: error.message
        }
      };

      switch (this.errorHandling) {
      case 'throw':
        // 抛出异常，Node-RED会显示错误状态
        this.error(error.message, errorMsg);
        break;

      case 'output': {
        // 输出错误消息
        errorMsg.payload = {
          error: error.message,
          toolName: this.targetTool
        };
          
        if (this.outputMode === 'split') {
          this.send([null, errorMsg]); // 发送到第二个输出端口
        } else {
          this.send(errorMsg);
        }
        break;
      }

      case 'ignore':
        // 忽略错误，不输出任何内容
        this.logger.warn(`Ignoring tool call error: ${error.message}`);
        break;

      default:
        this.error(error.message, errorMsg);
        break;
      }
    };

    /**
     * 更新响应时间统计
     */
    this._updateResponseTime = function(startTime) {
      const responseTime = Date.now() - startTime;
      
      // 计算移动平均响应时间
      const alpha = 0.1;
      this.callStats.averageResponseTime = 
        this.callStats.averageResponseTime * (1 - alpha) + responseTime * alpha;
    };

    /**
     * 更新节点状态显示
     */
    this.updateStatus = function(state, message) {
      const statusConfig = {
        ready: { fill: 'green', shape: 'dot', text: message },
        calling: { fill: 'blue', shape: 'ring', text: message },
        error: { fill: 'red', shape: 'ring', text: message },
        disconnected: { fill: 'grey', shape: 'ring', text: message }
      };

      const status = statusConfig[state] || { fill: 'grey', shape: 'ring', text: message };
      
      // 添加调用统计信息
      if (this.callStats.totalCalls > 0) {
        status.text += ` (${this.callStats.totalCalls}次)`;
      }
      
      this.status(status);
    };

    /**
     * 获取工具统计信息
     */
    this.getStats = function() {
      return {
        ...this.callStats,
        targetTool: this.targetTool,
        averageResponseTime: Math.round(this.callStats.averageResponseTime),
        successRate: this.callStats.totalCalls > 0 ? 
          (this.callStats.successfulCalls / this.callStats.totalCalls * 100).toFixed(1) + '%' : '0%'
      };
    };

    // 处理输入消息
    this.on('input', async function(msg, send, done) {
      // Node-RED 1.0+兼容
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(error) { 
        if (error) {
          node.error(error, msg);
        }
      };

      try {
        // 记录开始时间
        msg._startTime = Date.now();

        // 确定目标工具名称
        let toolName = this.targetTool;
        if (msg.tool && typeof msg.tool === 'string') {
          toolName = msg.tool;
        } else if (msg.payload && msg.payload.tool) {
          toolName = msg.payload.tool;
        }

        if (!toolName) {
          throw new Error('Tool name not specified');
        }

        // 更新状态
        this.updateStatus('calling', `调用 ${toolName}`);

        // 解析工具参数
        this.parseToolArguments(this.argumentsSource, msg, async (parseError, args) => {
          if (parseError) {
            this.logger.error('Failed to parse tool arguments:', parseError.message);
            this.updateStatus('error', '参数解析失败');
            this.handleError(parseError, msg);
            done();
            return;
          }

          try {
            // 调用工具
            const result = await this.callTool(toolName, args);

            // 格式化输出
            const output = this.formatOutput(result, this.outputMode, msg);

            // 发送结果
            if (Array.isArray(output)) {
              send(output); // split模式
            } else {
              send(output);
            }

            this.updateStatus('ready', '就绪');
            done();

          } catch (callError) {
            this.updateStatus('error', callError.message);
            this.handleError(callError, msg);
            done();
          }
        });

      } catch (error) {
        this.updateStatus('error', error.message);
        this.handleError(error, msg);
        done();
      }
    });

    // 监听MCP连接状态变化
    if (this.xiaozhi) {
      const callbacks = {
        connected: () => {
          this.logger.debug('MCP connected');
          this.updateStatus('ready', '就绪');
        },
        disconnected: () => {
          this.updateStatus('disconnected', 'MCP连接断开');
        },
        error: () => {
          this.updateStatus('error', 'MCP连接错误');
        }
      };

      this.xiaozhi.registerDependentNode(this.id, callbacks);

      // 初始状态
      if (this.xiaozhi.mcpClient && this.xiaozhi.mcpClient.isConnected()) {
        this.updateStatus('ready', '就绪');
      } else {
        this.updateStatus('disconnected', '等待MCP连接');
      }
    } else {
      this.updateStatus('error', '未配置MCP连接');
    }

    // 节点关闭时清理
    this.on('close', function(done) {
      node.logger.info('Closing tool call node');
      
      // 从MCP配置节点注销
      if (node.xiaozhi) {
        node.xiaozhi.unregisterDependentNode(node.id);
      }
      
      done();
    });
  }

  // 注册节点类型
  RED.nodes.registerType('xiaozhi-tool-call', XiaozhiToolCallNode);

  // 提供HTTP端点用于获取工具统计信息
  RED.httpAdmin.get('/xiaozhi-tool-call/:id/stats', RED.auth.needsPermission('xiaozhi-tool-call.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    res.json(node.getStats());
  });

  // 提供HTTP端点用于获取可用工具列表
  RED.httpAdmin.get('/xiaozhi-tool-call/:id/tools', RED.auth.needsPermission('xiaozhi-tool-call.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node || !node.xiaozhi || !node.xiaozhi.mcpClient) {
      res.status(404).json({ error: 'MCP client not available' });
      return;
    }

    try {
      const tools = node.xiaozhi.mcpClient.getAvailableTools();
      res.json({ tools });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 提供HTTP端点用于测试工具调用
  RED.httpAdmin.post('/xiaozhi-tool-call/:id/test', RED.auth.needsPermission('xiaozhi-tool-call.write'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    const { toolName, args } = req.body;
    if (!toolName) {
      res.status(400).json({ error: 'Tool name required' });
      return;
    }

    // 测试工具调用
    node.callTool(toolName, args || {}).then(result => {
      res.json({ 
        success: true, 
        result,
        stats: node.getStats()
      });
    }).catch(error => {
      res.status(500).json({ 
        success: false, 
        error: error.message,
        stats: node.getStats()
      });
    });
  });
};