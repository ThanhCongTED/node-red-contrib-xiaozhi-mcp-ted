/**
 * xiaozhi-tool-register Nút đăng ký công cụ
 * Dùng để đăng ký công cụ thiết bị với máy chủ MCP Xiaozhi
 */

module.exports = function(RED) {
  const { ToolParams, ToolResponse } = require('../../lib/interfaces');
  const { Logger, safeJsonParse, validateJsonSchema } = require('../../lib/utils');

  function XiaozhiToolRegisterNode(config) {
    RED.nodes.createNode(this, config);

    // Tham số cấu hình
    this.name = config.name;
    this.xiaozhi = RED.nodes.getNode(config.xiaozhi);
    this.toolName = config.toolName || '';
    this.toolDescription = config.toolDescription || '';
    this.inputSchema = config.inputSchema || '{}';
    this.outputToFlow = config.outputToFlow !== false;
    this.enableValidation = config.enableValidation !== false;
    this.asyncExecution = config.asyncExecution !== false;
    this.executionTimeout = parseInt(config.executionTimeout) || 30000;

    // Trình ghi nhật ký
    this.logger = new Logger(`ToolRegister[${this.name || this.toolName || this.id}]`);

    // Trạng thái công cụ
    this.registered = false;
    this.registrationError = null;
    this.callCount = 0;
    this.lastCalledAt = null;
    this.averageExecutionTime = 0;

    // Hàng đợi cuộc gọi công cụ đang chờ xử lý (dùng để khớp phản hồi)
    this.pendingCalls = new Map();

    const node = this;

    /**
     * Phân tích và xác thực JSON Schema
     */
    this.parseInputSchema = function() {
      try {
        return safeJsonParse(this.inputSchema, {});
      } catch (error) {
        this.logger.error('Schema đầu vào không hợp lệ:', error.message);
        return {};
      }
    };

    /**
     * Hàm gọi lại công cụ
     * Xử lý cuộc gọi công cụ từ nền tảng Xiaozhi
     */
    this.toolCallback = function(args) {
      const callId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const startTime = Date.now();

      node.logger.debug(`Công cụ được gọi: ${node.toolName}, args:`, args);

      // Cập nhật thông tin thống kê
      node.callCount++;
      node.lastCalledAt = new Date();

      if (node.outputToFlow) {
        // Xuất ra luồng để xử lý
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

        // Tạo Promise chờ phản hồi
        return new Promise((resolve, reject) => {
          // Thiết lập xử lý thời gian chờ
          const timeout = setTimeout(() => {
            node.pendingCalls.delete(callId);
            const errorMsg = `Thực thi công cụ quá thời gian chờ sau ${node.executionTimeout}ms`;
            node.logger.warn(errorMsg);
            reject(new Error(errorMsg));
          }, node.executionTimeout);

          // Lưu trữ cuộc gọi đang chờ
          node.pendingCalls.set(callId, {
            resolve,
            reject,
            timeout,
            startTime,
            args
          });

          // Gửi thông điệp đến luồng
          node.send(msg);
          node.logger.debug(`Cuộc gọi công cụ đã gửi đến luồng: ${callId}`);
        });
      } else {
        // Trực tiếp trả về phản hồi mặc định
        const response = ToolResponse.success(`Công cụ ${node.toolName} đã được gọi`);
        node._updateExecutionStats(startTime);
        return response;
      }
    };

    /**
     * Đăng ký công cụ với máy chủ MCP
     */
    this.registerTool = function() {
      if (!this.xiaozhi || !this.xiaozhi.mcpClient) {
        this.registrationError = 'Kết nối MCP chưa được cấu hình hoặc chưa kết nối';
        this.updateStatus('error', this.registrationError);
        return false;
      }

      if (!this.toolName) {
        this.registrationError = 'Tên công cụ không được để trống';
        this.updateStatus('error', this.registrationError);
        return false;
      }

      try {
        const parsedSchema = this.parseInputSchema();
        
        // Xác thực tính hợp lệ của schema
        if (this.enableValidation && parsedSchema && Object.keys(parsedSchema).length > 0) {
          // Xác thực đơn giản cấu trúc schema
          if (!parsedSchema.type && !parsedSchema.properties) {
            this.logger.warn('Schema đầu vào có thể không hợp lệ - thiếu type hoặc properties');
          }
        }

        // Đăng ký công cụ
        const success = this.xiaozhi.mcpClient.registerTool(
          this.toolName,
          this.toolDescription || this.toolName,
          parsedSchema,
          this.toolCallback
        );

        if (success) {
          this.registered = true;
          this.registrationError = null;
          this.updateStatus('registered', 'Đã đăng ký');
          this.logger.info(`Đã đăng ký công cụ thành công: ${this.toolName}`);
          
          // Gửi sự kiện đăng ký thành công
          this.emit('tool-registered', {
            toolName: this.toolName,
            description: this.toolDescription,
            schema: parsedSchema
          });
          
          return true;
        } else {
          this.registrationError = 'Đăng ký công cụ thất bại';
          this.updateStatus('error', this.registrationError);
          return false;
        }

      } catch (error) {
        this.registrationError = error.message;
        this.logger.error('Đăng ký công cụ thất bại:', error.message);
        this.updateStatus('error', this.registrationError);
        return false;
      }
    };

    /**
     * Hủy đăng ký công cụ
     */
    this.unregisterTool = function() {
      if (this.xiaozhi && this.xiaozhi.mcpClient && this.registered) {
        try {
          this.xiaozhi.mcpClient.unregisterTool(this.toolName);
          this.registered = false;
          this.updateStatus('unregistered', 'Đã hủy đăng ký');
          this.logger.info(`Đã hủy đăng ký công cụ: ${this.toolName}`);
          
          // Dọn dẹp các cuộc gọi đang chờ
          this.pendingCalls.forEach(call => {
            clearTimeout(call.timeout);
            call.reject(new Error('Công cụ đã bị hủy đăng ký'));
          });
          this.pendingCalls.clear();

        } catch (error) {
          this.logger.error('Hủy đăng ký công cụ thất bại:', error.message);
        }
      }
    };

    /**
     * Xử lý thông điệp phản hồi từ luồng
     */
    this.handleResponse = function(msg) {
      const callId = msg._mcpCallId;
      
      if (!callId || !this.pendingCalls.has(callId)) {
        this.logger.warn('Đã nhận phản hồi cho ID cuộc gọi không xác định:', callId);
        return;
      }

      const pendingCall = this.pendingCalls.get(callId);
      this.pendingCalls.delete(callId);
      
      clearTimeout(pendingCall.timeout);

      try {
        // Xây dựng phản hồi công cụ
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
          response = ToolResponse.success(msg.payload || 'Thành công');
        }

        // Cập nhật thống kê thực thi
        this._updateExecutionStats(pendingCall.startTime);

        // Giải quyết Promise
        pendingCall.resolve(response);
        
        this.logger.debug(`Đã xử lý phản hồi công cụ: ${callId}`);

      } catch (error) {
        this.logger.error('Lỗi khi xử lý phản hồi công cụ:', error.message);
        pendingCall.reject(error);
      }
    };

    /**
     * Cập nhật thông tin thống kê thực thi
     */
    this._updateExecutionStats = function(startTime) {
      const executionTime = Date.now() - startTime;
      
      // Tính thời gian thực thi trung bình (trung bình di động)
      const alpha = 0.1;
      this.averageExecutionTime = 
        this.averageExecutionTime * (1 - alpha) + executionTime * alpha;
    };

    /**
     * Cập nhật hiển thị trạng thái nút
     */
    this.updateStatus = function(state, message) {
      const statusConfig = {
        registered: { fill: 'green', shape: 'dot', text: message },
        unregistered: { fill: 'grey', shape: 'ring', text: message },
        error: { fill: 'red', shape: 'ring', text: message },
        connecting: { fill: 'yellow', shape: 'ring', text: message }
      };

      const status = statusConfig[state] || { fill: 'grey', shape: 'ring', text: message };
      
      // Thêm thông tin thống kê cuộc gọi
      if (this.callCount > 0) {
        status.text += ` (${this.callCount} lần gọi)`;
      }
      
      this.status(status);
    };

    /**
     * Lấy thông tin thống kê công cụ
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

    // Xử lý thông điệp đầu vào (dùng cho phản hồi cuộc gọi công cụ)
    this.on('input', function(msg) {
      // Kiểm tra xem có phải là phản hồi cuộc gọi công cụ không
      if (msg._mcpCallId) {
        node.handleResponse(msg);
      } else {
        // Xử lý các loại thông điệp khác (như đăng ký động)
        if (msg.payload && msg.payload.action) {
          switch (msg.payload.action) {
          case 'register':
            node.registerTool();
            break;
          case 'unregister':
            node.unregisterTool();
            break;
          default:
            node.logger.warn('Hành động không xác định:', msg.payload.action);
          }
        }
      }
    });

    // Lắng nghe thay đổi trạng thái kết nối MCP
    if (this.xiaozhi) {
      // Đăng ký làm nút phụ thuộc
      const callbacks = {
        connected: () => {
          this.logger.debug('Đã kết nối MCP, đang thử đăng ký công cụ');
          setTimeout(() => this.registerTool(), 1000); // Trì hoãn đăng ký để đảm bảo kết nối ổn định
        },
        disconnected: () => {
          this.registered = false;
          this.updateStatus('unregistered', 'MCP đã ngắt kết nối');
        },
        error: (data) => {
          this.updateStatus('error', 'Lỗi kết nối MCP');
        }
      };

      this.xiaozhi.registerDependentNode(this.id, callbacks);

      // Nếu đã kết nối, thử đăng ký
      if (this.xiaozhi.mcpClient && this.xiaozhi.mcpClient.isConnected()) {
        setTimeout(() => this.registerTool(), 500);
      } else {
        this.updateStatus('connecting', 'Đang chờ kết nối MCP');
      }
    } else {
      this.updateStatus('error', 'Chưa cấu hình kết nối MCP');
    }

    // Dọn dẹp khi đóng nút
    this.on('close', function(done) {
      node.logger.info('Đang đóng nút đăng ký công cụ');
      
      // Hủy đăng ký công cụ
      node.unregisterTool();
      
      // Hủy đăng ký khỏi nút cấu hình MCP
      if (node.xiaozhi) {
        node.xiaozhi.unregisterDependentNode(node.id);
      }
      
      // Dọn dẹp các cuộc gọi đang chờ
      node.pendingCalls.forEach(call => {
        clearTimeout(call.timeout);
        call.reject(new Error('Nút đang đóng'));
      });
      node.pendingCalls.clear();
      
      done();
    });
  }

  // Đăng ký loại nút
  RED.nodes.registerType('xiaozhi-tool-register', XiaozhiToolRegisterNode);

  // Cung cấp endpoint HTTP để lấy thông tin thống kê công cụ
  RED.httpAdmin.get('/xiaozhi-tool-register/:id/stats', RED.auth.needsPermission('xiaozhi-tool-register.read'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Không tìm thấy nút' });
      return;
    }

    res.json(node.getStats());
  });

  // Cung cấp endpoint HTTP để đăng ký/hủy đăng ký công cụ thủ công
  RED.httpAdmin.post('/xiaozhi-tool-register/:id/:action', RED.auth.needsPermission('xiaozhi-tool-register.write'), function(req, res) {
    const node = RED.nodes.getNode(req.params.id);
    const action = req.params.action;
    
    if (!node) {
      res.status(404).json({ error: 'Không tìm thấy nút' });
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
        res.status(400).json({ error: 'Hành động không hợp lệ' });
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