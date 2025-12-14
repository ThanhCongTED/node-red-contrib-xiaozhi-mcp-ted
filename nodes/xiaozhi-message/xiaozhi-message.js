/**
 * xiaozhi-message 消息处理节点
 * 用于处理MCP消息的发送、接收和格式化
 */

module.exports = function(RED) {
  const { Logger, safeJsonParse } = require('../../lib/utils');

  function XiaozhiMessageNode(config) {
    RED.nodes.createNode(this, config);

    // 配置参数
    this.name = config.name;
    this.xiaozhi = RED.nodes.getNode(config.xiaozhi);
    this.messageMode = config.messageMode || 'send'; // send, receive, bidirectional
    this.messageType = config.messageType || 'notification'; // notification, request, response
    this.method = config.method || '';
    this.params = config.params || '{}';
    this.paramsSource = config.paramsSource || 'configured'; // configured, msg, flow
    this.outputFormat = config.outputFormat || 'payload'; // payload, full, jsonrpc
    this.filterIncoming = config.filterIncoming !== false;
    this.methodFilter = config.methodFilter || '';
    this.enableLogging = config.enableLogging !== false;

    // 日志记录器
    this.logger = new Logger(`Message[${this.name || this.method || this.id}]`);

    // 消息统计
    this.messageStats = {
      messagesSent: 0,
      messagesReceived: 0,
      notificationsSent: 0,
      requestsSent: 0,
      responsesSent: 0,
      errors: 0,
      lastMessageAt: null,
      lastError: null
    };

    // 消息历史（用于调试）
    this.messageHistory = [];
    this.maxHistorySize = 50;

    const node = this;

    /**
     * 解析消息参数
     */
    this.parseMessageParams = function(source, msg, callback) {
      let paramsJson;

      try {
        switch (source) {
        case 'configured':
          paramsJson = this.params;
          break;
        case 'msg':
          if (msg.payload && typeof msg.payload === 'object') {
            paramsJson = JSON.stringify(msg.payload);
          } else if (typeof msg.payload === 'string') {
            paramsJson = msg.payload;
          } else {
            paramsJson = '{}';
          }
          break;
        case 'msg.params':
          if (msg.params) {
            paramsJson = typeof msg.params === 'string' ? msg.params : JSON.stringify(msg.params);
          } else {
            paramsJson = '{}';
          }
          break;
        case 'flow': {
          const flowParams = this.context().flow.get('messageParams') || {};
          paramsJson = JSON.stringify(flowParams);
          break;
        }
        case 'global': {
          const globalParams = this.context().global.get('messageParams') || {};
          paramsJson = JSON.stringify(globalParams);
          break;
        }
        default:
          paramsJson = this.params;
          break;
        }

        const parsedParams = safeJsonParse(paramsJson, {});
        callback(null, parsedParams);

      } catch (error) {
        callback(error);
      }
    };

    /**
     * 生成消息ID
     */
    this.generateMessageId = function() {
      return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    };

    /**
     * 发送MCP消息
     */
    this.sendMessage = async function(messageData, originalMsg) {
      try {
        if (!this.xiaozhi || !this.xiaozhi.mcpClient) {
          throw new Error('MCP connection not available');
        }

        if (!this.xiaozhi.mcpClient.isConnected()) {
          throw new Error('MCP client not connected');
        }

        let mcpMessage;
        const messageId = this.generateMessageId();

        // 构造不同类型的MCP消息
        switch (this.messageType) {
        case 'notification':
          mcpMessage = {
            jsonrpc: '2.0',
            method: messageData.method || this.method,
            params: messageData.params || {}
          };
          this.messageStats.notificationsSent++;
          break;

        case 'request':
          mcpMessage = {
            jsonrpc: '2.0',
            id: messageId,
            method: messageData.method || this.method,
            params: messageData.params || {}
          };
          this.messageStats.requestsSent++;
          break;

        case 'response':
          if (!messageData.id) {
            throw new Error('Response message requires an ID');
          }
          mcpMessage = {
            jsonrpc: '2.0',
            id: messageData.id
          };
            
          if (messageData.error) {
            mcpMessage.error = messageData.error;
          } else {
            mcpMessage.result = messageData.result || {};
          }
          this.messageStats.responsesSent++;
          break;

        default:
          throw new Error('Invalid message type: ' + this.messageType);
        }

        // 发送消息
        await this.xiaozhi.mcpClient.sendRawMessage(mcpMessage);

        // 更新统计
        this.messageStats.messagesSent++;
        this.messageStats.lastMessageAt = new Date();

        // 记录历史
        this.addToHistory('sent', mcpMessage, originalMsg);

        this.logger.debug(`Message sent: ${JSON.stringify(mcpMessage)}`);

        // 输出发送确认（如果是双向模式）
        if (this.messageMode === 'bidirectional') {
          const confirmMsg = {
            ...originalMsg,
            payload: {
              status: 'sent',
              messageId: messageId,
              messageType: this.messageType,
              method: mcpMessage.method,
              timestamp: new Date().toISOString()
            },
            _messageSent: mcpMessage
          };
          this.send([confirmMsg, null]);
        }

        return mcpMessage;

      } catch (error) {
        this.messageStats.errors++;
        this.messageStats.lastError = error.message;
        this.logger.error('Failed to send message:', error.message);
        throw error;
      }
    };

    /**
     * 处理接收到的MCP消息
     */
    this.handleIncomingMessage = function(mcpMessage) {
      try {
        // 过滤消息
        if (this.filterIncoming && this.methodFilter) {
          const filters = this.methodFilter.split(',').map(f => f.trim()).filter(f => f);
          const messageMethod = mcpMessage.method || '';
          
          if (filters.length > 0) {
            const matchesFilter = filters.some(filter => {
              if (filter.includes('*')) {
                // 支持通配符匹配
                const regex = new RegExp(filter.replace(/\*/g, '.*'));
                return regex.test(messageMethod);
              } else {
                return messageMethod === filter;
              }
            });
            
            if (!matchesFilter) {
              return; // 不输出过滤掉的消息
            }
          }
        }

        // 更新统计
        this.messageStats.messagesReceived++;
        this.messageStats.lastMessageAt = new Date();

        // 记录历史
        this.addToHistory('received', mcpMessage);

        // 格式化输出
        const outputMsg = this.formatOutput(mcpMessage);

        // 发送到适当的输出端口
        if (this.messageMode === 'receive') {
          this.send(outputMsg);
        } else if (this.messageMode === 'bidirectional') {
          this.send([null, outputMsg]);
        }

        this.logger.debug(`Message received: ${JSON.stringify(mcpMessage)}`);

      } catch (error) {
        this.messageStats.errors++;
        this.logger.error('Failed to handle incoming message:', error.message);
      }
    };

    /**
     * 格式化输出消息
     */
    this.formatOutput = function(mcpMessage) {
      const outputMsg = {
        topic: 'xiaozhi/message',
        _mcpMessage: mcpMessage,
        _timestamp: new Date().toISOString()
      };

      switch (this.outputFormat) {
      case 'payload':
        // 提取有用的数据到payload
        if (mcpMessage.method) {
          outputMsg.payload = {
            method: mcpMessage.method,
            params: mcpMessage.params || {},
            id: mcpMessage.id
          };
        } else if (mcpMessage.result !== undefined) {
          outputMsg.payload = {
            result: mcpMessage.result,
            id: mcpMessage.id
          };
        } else if (mcpMessage.error) {
          outputMsg.payload = {
            error: mcpMessage.error,
            id: mcpMessage.id
          };
        } else {
          outputMsg.payload = mcpMessage;
        }
        break;

      case 'full':
        // 完整的消息对象
        outputMsg.payload = {
          jsonrpc: mcpMessage.jsonrpc,
          id: mcpMessage.id,
          method: mcpMessage.method,
          params: mcpMessage.params,
          result: mcpMessage.result,
          error: mcpMessage.error,
          messageType: this.detectMessageType(mcpMessage),
          timestamp: new Date().toISOString()
        };
        break;

      case 'jsonrpc':
        // 原始JSON-RPC消息
        outputMsg.payload = mcpMessage;
        break;

      default:
        outputMsg.payload = mcpMessage;
        break;
      }

      return outputMsg;
    };

    /**
     * 检测消息类型
     */
    this.detectMessageType = function(mcpMessage) {
      if (mcpMessage.method && !mcpMessage.id) {
        return 'notification';
      } else if (mcpMessage.method && mcpMessage.id) {
        return 'request';
      } else if (mcpMessage.id && (mcpMessage.result !== undefined || mcpMessage.error)) {
        return 'response';
      } else {
        return 'unknown';
      }
    };

    /**
     * 添加到消息历史
     */
    this.addToHistory = function(direction, mcpMessage, originalMsg) {
      this.messageHistory.push({
        timestamp: new Date().toISOString(),
        direction,
        message: mcpMessage,
        originalMsg: originalMsg ? {
          topic: originalMsg.topic,
          payload: originalMsg.payload
        } : undefined
      });

      // 限制历史大小
      if (this.messageHistory.length > this.maxHistorySize) {
        this.messageHistory.shift();
      }
    };

    /**
     * 更新节点状态显示
     */
    this.updateStatus = function(state, message, extra) {
      const statusConfig = {
        ready: { fill: 'green', shape: 'dot', text: message },
        sending: { fill: 'blue', shape: 'ring', text: message },
        receiving: { fill: 'yellow', shape: 'ring', text: message },
        error: { fill: 'red', shape: 'ring', text: message },
        disconnected: { fill: 'grey', shape: 'ring', text: message }
      };

      const status = statusConfig[state] || { fill: 'grey', shape: 'ring', text: message };
      
      // 添加消息统计
      const totalMessages = this.messageStats.messagesSent + this.messageStats.messagesReceived;
      if (totalMessages > 0) {
        status.text += ` (${totalMessages})`;
      }
      
      if (extra) {
        status.text += ` ${extra}`;
      }
      
      this.status(status);
    };

    /**
     * 获取消息统计信息
     */
    this.getStats = function() {
      return {
        ...this.messageStats,
        messageMode: this.messageMode,
        messageType: this.messageType,
        method: this.method,
        totalMessages: this.messageStats.messagesSent + this.messageStats.messagesReceived,
        historySize: this.messageHistory.length
      };
    };

    /**
     * 获取消息历史
     */
    this.getMessageHistory = function(limit) {
      const history = this.messageHistory.slice();
      if (limit && limit > 0) {
        return history.slice(-limit);
      }
      return history;
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

      // 只有发送模式或双向模式才处理输入
      if (node.messageMode === 'receive') {
        done();
        return;
      }

      try {
        node.updateStatus('sending', '发送中...');

        // 确定消息方法
        let method = node.method;
        if (msg.method && typeof msg.method === 'string') {
          method = msg.method;
        } else if (msg.payload && msg.payload.method) {
          method = msg.payload.method;
        }

        if (!method && node.messageType !== 'response') {
          throw new Error('Message method not specified');
        }

        // 解析消息参数
        node.parseMessageParams(node.paramsSource, msg, async (parseError, params) => {
          if (parseError) {
            node.logger.error('Failed to parse message params:', parseError.message);
            node.updateStatus('error', '参数解析失败');
            node.handleError(parseError, msg);
            done();
            return;
          }

          try {
            // 构造消息数据
            const messageData = {
              method,
              params,
              id: msg.id || (msg.payload && msg.payload.id),
              result: msg.result || (msg.payload && msg.payload.result),
              error: msg.error || (msg.payload && msg.payload.error)
            };

            // 发送消息
            await node.sendMessage(messageData, msg);

            node.updateStatus('ready', '就绪');
            done();

          } catch (sendError) {
            node.updateStatus('error', sendError.message);
            node.handleError(sendError, msg);
            done();
          }
        });

      } catch (error) {
        node.updateStatus('error', error.message);
        node.handleError(error, msg);
        done();
      }
    });

    /**
     * 处理错误
     */
    this.handleError = function(error, msg) {
      const errorMsg = {
        ...msg,
        error: {
          message: error.message,
          timestamp: new Date().toISOString()
        },
        _messageError: true
      };

      this.error(error.message, errorMsg);
    };

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

      // 如果是接收模式或双向模式，监听消息
      if (this.messageMode === 'receive' || this.messageMode === 'bidirectional') {
        if (this.xiaozhi.mcpClient) {
          this.xiaozhi.mcpClient.on('raw-message', (message) => {
            this.handleIncomingMessage(message);
          });
        }
      }

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
      node.logger.info('Closing message node');
      
      // 从MCP配置节点注销
      if (node.xiaozhi) {
        node.xiaozhi.unregisterDependentNode(node.id);
      }
      
      done();
    });
  }

  // 注册节点类型
  RED.nodes.registerType('xiaozhi-message', XiaozhiMessageNode);

  // 提供HTTP端点用于获取消息统计
  RED.httpAdmin.get('/xiaozhi-message/:id/stats', RED.auth.needsPermission('xiaozhi-message.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    res.json(node.getStats());
  });

  // 提供HTTP端点用于获取消息历史
  RED.httpAdmin.get('/xiaozhi-message/:id/history', RED.auth.needsPermission('xiaozhi-message.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    const limit = parseInt(req.query.limit) || 20;
    res.json(node.getMessageHistory(limit));
  });

  // 提供HTTP端点用于测试消息发送
  RED.httpAdmin.post('/xiaozhi-message/:id/test', RED.auth.needsPermission('xiaozhi-message.write'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    const { method, params } = req.body;
    if (!method) {
      res.status(400).json({ error: 'Method required' });
      return;
    }

    // 测试消息发送
    const messageData = { method, params: params || {} };
    node.sendMessage(messageData, {}).then(message => {
      res.json({ 
        success: true, 
        message,
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