/**
 * Nút gọi công cụ xiaozhi-tool-call
 * Dùng để chủ động gọi các công cụ trên nền tảng Xiaozhi hoặc các thiết bị khác
 */

module.exports = function(RED) {
  const { ToolParams, ToolResponse } = require('../../lib/interfaces');
  const { Logger, safeJsonParse, validateJsonSchema } = require('../../lib/utils');

  function XiaozhiToolCallNode(config) {
    RED.nodes.createNode(this, config);

    // Tham số cấu hình
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

    // Trình ghi nhật ký
    this.logger = new Logger(`ToolCall[${this.name || this.targetTool || this.id}]`);

    // Thống kê gọi
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
     * Phân tích đối số công cụ
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
     * Gọi công cụ
     */
    this.callTool = async function(toolName, args, attempt = 1) {
      const startTime = Date.now();
      
      try {
        this.logger.debug(`Đang gọi công cụ: ${toolName}, args:`, args);

        // Kiểm tra kết nối MCP
        if (!this.xiaozhi || !this.xiaozhi.mcpClient) {
          throw new Error('Kết nối MCP không khả dụng');
        }

        if (!this.xiaozhi.mcpClient.isConnected()) {
          throw new Error('Khách hàng MCP chưa kết nối');
        }

        // Gọi công cụ
        const result = await this.xiaozhi.mcpClient.callTool(toolName, args, {
          timeout: this.callTimeout
        });

        // Cập nhật thông tin thống kê
        this.callStats.totalCalls++;
        this.callStats.successfulCalls++;
        this.callStats.lastCallAt = new Date();
        this._updateResponseTime(startTime);

        this.logger.debug(`Gọi công cụ thành công: ${toolName}, thời gian phản hồi: ${Date.now() - startTime}ms`);

        return result;

      } catch (error) {
        this.callStats.totalCalls++;
        this.callStats.failedCalls++;
        this.callStats.lastError = error.message;
        this.callStats.lastCallAt = new Date();

        this.logger.error(`Gọi công cụ thất bại: ${toolName} (lần thử ${attempt}):`, error.message);

        // Logic thử lại
        if (attempt <= this.retryAttempts) {
          this.logger.info(`Sẽ thử lại gọi công cụ sau ${this.retryDelay}ms (lần thử ${attempt + 1}/${this.retryAttempts + 1})`);
          
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
          return await this.callTool(toolName, args, attempt + 1);
        }

        throw error;
      }
    };

    /**
     * Định dạng kết quả đầu ra
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
        // Chỉ xuất nội dung kết quả
        if (result.content && result.content.length > 0) {
          if (result.content.length === 1 && result.content[0].type === 'text') {
            // Kết quả văn bản đơn lẻ, thử phân tích JSON
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
        // Xuất phản hồi đầy đủ
        baseOutput.payload = result;
        return baseOutput;

      case 'split': {
        // Xuất riêng kết quả và siêu dữ liệu
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
     * Xử lý lỗi
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
        // Ném ngoại lệ, Node-RED sẽ hiển thị trạng thái lỗi
        this.error(error.message, errorMsg);
        break;

      case 'output': {
        // Xuất thông báo lỗi
        errorMsg.payload = {
          error: error.message,
          toolName: this.targetTool
        };
          
        if (this.outputMode === 'split') {
          this.send([null, errorMsg]); // Gửi đến cổng đầu ra thứ hai
        } else {
          this.send(errorMsg);
        }
        break;
      }

      case 'ignore':
        // Bỏ qua lỗi, không xuất bất kỳ nội dung nào
        this.logger.warn(`Bỏ qua lỗi gọi công cụ: ${error.message}`);
        break;

      default:
        this.error(error.message, errorMsg);
        break;
      }
    };

    /**
     * Cập nhật thống kê thời gian phản hồi
     */
    this._updateResponseTime = function(startTime) {
      const responseTime = Date.now() - startTime;
      
      // Tính thời gian phản hồi trung bình di động
      const alpha = 0.1;
      this.callStats.averageResponseTime = 
        this.callStats.averageResponseTime * (1 - alpha) + responseTime * alpha;
    };

    /**
     * Cập nhật hiển thị trạng thái nút
     */
    this.updateStatus = function(state, message) {
      const statusConfig = {
        ready: { fill: 'green', shape: 'dot', text: message },
        calling: { fill: 'blue', shape: 'ring', text: message },
        error: { fill: 'red', shape: 'ring', text: message },
        disconnected: { fill: 'grey', shape: 'ring', text: message }
      };

      const status = statusConfig[state] || { fill: 'grey', shape: 'ring', text: message };
      
      // Thêm thông tin thống kê gọi
      if (this.callStats.totalCalls > 0) {
        status.text += ` (${this.callStats.totalCalls} lần)`;
      }
      
      this.status(status);
    };

    /**
     * Lấy thông tin thống kê công cụ
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

    // Xử lý tin nhắn đầu vào
    this.on('input', async function(msg, send, done) {
      // Tương thích Node-RED 1.0+
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(error) { 
        if (error) {
          node.error(error, msg);
        }
      };

      try {
        // Ghi lại thời gian bắt đầu
        msg._startTime = Date.now();

        // Xác định tên công cụ mục tiêu
        let toolName = this.targetTool;
        if (msg.tool && typeof msg.tool === 'string') {
          toolName = msg.tool;
        } else if (msg.payload && msg.payload.tool) {
          toolName = msg.payload.tool;
        }

        if (!toolName) {
          throw new Error('Chưa xác định tên công cụ');
        }

        // Cập nhật trạng thái
        this.updateStatus('calling', `Đang gọi ${toolName}`);

        // Phân tích đối số công cụ
        this.parseToolArguments(this.argumentsSource, msg, async (parseError, args) => {
          if (parseError) {
            this.logger.error('Không thể phân tích đối số công cụ:', parseError.message);
            this.updateStatus('error', 'Phân tích tham số thất bại');
            this.handleError(parseError, msg);
            done();
            return;
          }

          try {
            // Gọi công cụ
            const result = await this.callTool(toolName, args);

            // Định dạng đầu ra
            const output = this.formatOutput(result, this.outputMode, msg);

            // Gửi kết quả
            if (Array.isArray(output)) {
              send(output); // Chế độ tách
            } else {
              send(output);
            }

            this.updateStatus('ready', 'Sẵn sàng');
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
      node.logger.info('Đang đóng nút gọi công cụ');
      
      // Hủy đăng ký khỏi nút cấu hình MCP
      if (node.xiaozhi) {
        node.xiaozhi.unregisterDependentNode(node.id);
      }
      
      done();
    });
  }

  // Đăng ký loại nút
  RED.nodes.registerType('xiaozhi-tool-call', XiaozhiToolCallNode);

  // Cung cấp điểm cuối HTTP để lấy thông tin thống kê công cụ
  RED.httpAdmin.get('/xiaozhi-tool-call/:id/stats', RED.auth.needsPermission('xiaozhi-tool-call.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Không tìm thấy nút' });
      return;
    }

    res.json(node.getStats());
  });

  // Cung cấp điểm cuối HTTP để lấy danh sách công cụ có sẵn
  RED.httpAdmin.get('/xiaozhi-tool-call/:id/tools', RED.auth.needsPermission('xiaozhi-tool-call.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node || !node.xiaozhi || !node.xiaozhi.mcpClient) {
      res.status(404).json({ error: 'Khách hàng MCP không khả dụng' });
      return;
    }

    try {
      const tools = node.xiaozhi.mcpClient.getAvailableTools();
      res.json({ tools });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Cung cấp điểm cuối HTTP để kiểm tra gọi công cụ
  RED.httpAdmin.post('/xiaozhi-tool-call/:id/test', RED.auth.needsPermission('xiaozhi-tool-call.write'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Không tìm thấy nút' });
      return;
    }

    const { toolName, args } = req.body;
    if (!toolName) {
      res.status(400).json({ error: 'Yêu cầu tên công cụ' });
      return;
    }

    // Kiểm tra gọi công cụ
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