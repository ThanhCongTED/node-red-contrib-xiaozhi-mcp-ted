/**
 * Nút xử lý tin nhắn xiaozhi-message
 * Dùng để xử lý việc gửi, nhận và định dạng tin nhắn MCP
 */

module.exports = function(RED) {
  const { Logger, safeJsonParse } = require('../../lib/utils');

  function XiaozhiMessageNode(config) {
    RED.nodes.createNode(this, config);

    // Tham số cấu hình
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

    // Trình ghi nhật ký
    this.logger = new Logger(`Message[${this.name || this.method || this.id}]`);

    // Thống kê tin nhắn
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

    // Lịch sử tin nhắn (dùng để gỡ lỗi)
    this.messageHistory = [];
    this.maxHistorySize = 50;

    const node = this;

    /**
     * Phân tích tham số tin nhắn
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
     * Tạo ID tin nhắn
     */
    this.generateMessageId = function() {
      return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    };

    /**
     * Gửi tin nhắn MCP
     */
    this.sendMessage = async function(messageData, originalMsg) {
      try {
        if (!this.xiaozhi || !this.xiaozhi.mcpClient) {
          throw new Error('Kết nối MCP không khả dụng');
        }

        if (!this.xiaozhi.mcpClient.isConnected()) {
          throw new Error('Khách hàng MCP chưa kết nối');
        }

        let mcpMessage;
        const messageId = this.generateMessageId();

        // Xây dựng các loại tin nhắn MCP khác nhau
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
            throw new Error('Tin nhắn phản hồi yêu cầu một ID');
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
          throw new Error('Loại tin nhắn không hợp lệ: ' + this.messageType);
        }

        // Gửi tin nhắn
        await this.xiaozhi.mcpClient.sendRawMessage(mcpMessage);

        // Cập nhật thống kê
        this.messageStats.messagesSent++;
        this.messageStats.lastMessageAt = new Date();

        // Ghi lại lịch sử
        this.addToHistory('sent', mcpMessage, originalMsg);

        this.logger.debug(`Đã gửi tin nhắn: ${JSON.stringify(mcpMessage)}`);

        // Đầu ra xác nhận gửi (nếu là chế độ hai chiều)
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
        this.logger.error('Không thể gửi tin nhắn:', error.message);
        throw error;
      }
    };

    /**
     * Xử lý tin nhắn MCP nhận được
     */
    this.handleIncomingMessage = function(mcpMessage) {
      try {
        // Lọc tin nhắn
        if (this.filterIncoming && this.methodFilter) {
          const filters = this.methodFilter.split(',').map(f => f.trim()).filter(f => f);
          const messageMethod = mcpMessage.method || '';
          
          if (filters.length > 0) {
            const matchesFilter = filters.some(filter => {
              if (filter.includes('*')) {
                // Hỗ trợ khớp ký tự đại diện
                const regex = new RegExp(filter.replace(/\*/g, '.*'));
                return regex.test(messageMethod);
              } else {
                return messageMethod === filter;
              }
            });
            
            if (!matchesFilter) {
              return; // Không xuất tin nhắn đã bị lọc
            }
          }
        }

        // Cập nhật thống kê
        this.messageStats.messagesReceived++;
        this.messageStats.lastMessageAt = new Date();

        // Ghi lại lịch sử
        this.addToHistory('received', mcpMessage);

        // Định dạng đầu ra
        const outputMsg = this.formatOutput(mcpMessage);

        // Gửi đến cổng đầu ra thích hợp
        if (this.messageMode === 'receive') {
          this.send(outputMsg);
        } else if (this.messageMode === 'bidirectional') {
          this.send([null, outputMsg]);
        }

        this.logger.debug(`Đã nhận tin nhắn: ${JSON.stringify(mcpMessage)}`);

      } catch (error) {
        this.messageStats.errors++;
        this.logger.error('Không thể xử lý tin nhắn đến:', error.message);
      }
    };

    /**
     * Định dạng tin nhắn đầu ra
     */
    this.formatOutput = function(mcpMessage) {
      const outputMsg = {
        topic: 'xiaozhi/message',
        _mcpMessage: mcpMessage,
        _timestamp: new Date().toISOString()
      };

      switch (this.outputFormat) {
      case 'payload':
        // Trích xuất dữ liệu hữu ích vào payload
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
        // Đối tượng tin nhắn đầy đủ
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
        // Tin nhắn JSON-RPC gốc
        outputMsg.payload = mcpMessage;
        break;

      default:
        outputMsg.payload = mcpMessage;
        break;
      }

      return outputMsg;
    };

    /**
     * Phát hiện loại tin nhắn
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
     * Thêm vào lịch sử tin nhắn
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

      // Giới hạn kích thước lịch sử
      if (this.messageHistory.length > this.maxHistorySize) {
        this.messageHistory.shift();
      }
    };

    /**
     * Cập nhật hiển thị trạng thái nút
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
      
      // Thêm thống kê tin nhắn
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
     * Lấy thông tin thống kê tin nhắn
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
     * Lấy lịch sử tin nhắn
     */
    this.getMessageHistory = function(limit) {
      const history = this.messageHistory.slice();
      if (limit && limit > 0) {
        return history.slice(-limit);
      }
      return history;
    };

    // Xử lý tin nhắn đầu vào
    this.on('input', async function(msg, send, done) {
      // Tương thích Node-RED 1.0+
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(error) { 
        if (error) {
          node.error(error, msg);
        }
      };

      // Chỉ xử lý đầu vào ở chế độ gửi hoặc hai chiều
      if (node.messageMode === 'receive') {
        done();
        return;
      }

      try {
        node.updateStatus('sending', 'Đang gửi...');

        // Xác định phương thức tin nhắn
        let method = node.method;
        if (msg.method && typeof msg.method === 'string') {
          method = msg.method;
        } else if (msg.payload && msg.payload.method) {
          method = msg.payload.method;
        }

        if (!method && node.messageType !== 'response') {
          throw new Error('Chưa xác định phương thức tin nhắn');
        }

        // Phân tích tham số tin nhắn
        node.parseMessageParams(node.paramsSource, msg, async (parseError, params) => {
          if (parseError) {
            node.logger.error('Không thể phân tích tham số tin nhắn:', parseError.message);
            node.updateStatus('error', 'Phân tích tham số thất bại');
            node.handleError(parseError, msg);
            done();
            return;
          }

          try {
            // Xây dựng dữ liệu tin nhắn
            const messageData = {
              method,
              params,
              id: msg.id || (msg.payload && msg.payload.id),
              result: msg.result || (msg.payload && msg.payload.result),
              error: msg.error || (msg.payload && msg.payload.error)
            };

            // Gửi tin nhắn
            await node.sendMessage(messageData, msg);

            node.updateStatus('ready', 'Sẵn sàng');
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
     * Xử lý lỗi
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

    // Lắng nghe thay đổi trạng thái kết nối MCP
    if (this.xiaozhi) {
      const callbacks = {
        connected: () => {
          this.logger.debug('Đã kết nối MCP');
          this.updateStatus('ready', 'Sẵn sàng');
        },
        disconnected: () => {
          this.updateStatus('disconnected', 'Kết nối MCP bị ngắt');
        },
        error: () => {
          this.updateStatus('error', 'Lỗi kết nối MCP');
        }
      };

      this.xiaozhi.registerDependentNode(this.id, callbacks);

      // Nếu ở chế độ nhận hoặc hai chiều, lắng nghe tin nhắn
      if (this.messageMode === 'receive' || this.messageMode === 'bidirectional') {
        if (this.xiaozhi.mcpClient) {
          this.xiaozhi.mcpClient.on('raw-message', (message) => {
            this.handleIncomingMessage(message);
          });
        }
      }

      // Trạng thái ban đầu
      if (this.xiaozhi.mcpClient && this.xiaozhi.mcpClient.isConnected()) {
        this.updateStatus('ready', 'Sẵn sàng');
      } else {
        this.updateStatus('disconnected', 'Đang chờ kết nối MCP');
      }
    } else {
      this.updateStatus('error', 'Chưa cấu hình kết nối MCP');
    }

    // Dọn dẹp khi đóng nút
    this.on('close', function(done) {
      node.logger.info('Đang đóng nút tin nhắn');
      
      // Hủy đăng ký khỏi nút cấu hình MCP
      if (node.xiaozhi) {
        node.xiaozhi.unregisterDependentNode(node.id);
      }
      
      done();
    });
  }

  // Đăng ký loại nút
  RED.nodes.registerType('xiaozhi-message', XiaozhiMessageNode);

  // Cung cấp điểm cuối HTTP để lấy thống kê tin nhắn
  RED.httpAdmin.get('/xiaozhi-message/:id/stats', RED.auth.needsPermission('xiaozhi-message.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Không tìm thấy nút' });
      return;
    }

    res.json(node.getStats());
  });

  // Cung cấp điểm cuối HTTP để lấy lịch sử tin nhắn
  RED.httpAdmin.get('/xiaozhi-message/:id/history', RED.auth.needsPermission('xiaozhi-message.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Không tìm thấy nút' });
      return;
    }

    const limit = parseInt(req.query.limit) || 20;
    res.json(node.getMessageHistory(limit));
  });

  // Cung cấp điểm cuối HTTP để kiểm tra gửi tin nhắn
  RED.httpAdmin.post('/xiaozhi-message/:id/test', RED.auth.needsPermission('xiaozhi-message.write'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Không tìm thấy nút' });
      return;
    }

    const { method, params } = req.body;
    if (!method) {
      res.status(400).json({ error: 'Yêu cầu phương thức' });
      return;
    }

    // Kiểm tra gửi tin nhắn
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