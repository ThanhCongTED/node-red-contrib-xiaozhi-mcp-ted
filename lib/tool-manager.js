/**
 * 工具管理器
 * 负责管理工具的注册、注销和执行
 */

const { ToolDefinition, ToolResponse, ToolParams } = require('./interfaces');
const { validateJsonSchema, Logger, createError } = require('./utils');

class ToolManager {
  constructor(mcpClient) {
    this.mcpClient = mcpClient;
    this.logger = new Logger('ToolManager');
    
    // 工具存储
    this.tools = new Map();
    
    // 执行统计
    this.stats = {
      totalRegistered: 0,
      totalUnregistered: 0,
      totalExecutions: 0,
      totalErrors: 0,
      averageExecutionTime: 0
    };
    
    // 执行队列和状态
    this.executionQueue = [];
    this.isProcessingQueue = false;
    this.maxConcurrentExecutions = 10;
    this.currentExecutions = 0;
  }

  /**
   * 注册工具
   * @param {string} name 工具名称
   * @param {string} description 工具描述
   * @param {object} inputSchema 输入参数schema
   * @param {Function} callback 工具回调函数
   * @returns {boolean} 注册是否成功
   */
  registerTool(name, description, inputSchema, callback) {
    // 参数验证
    if (!name || typeof name !== 'string') {
      throw createError('Tool name must be a non-empty string', 'INVALID_TOOL_NAME');
    }
    
    if (!description || typeof description !== 'string') {
      throw createError('Tool description must be a non-empty string', 'INVALID_TOOL_DESCRIPTION');
    }
    
    if (typeof callback !== 'function') {
      throw createError('Tool callback must be a function', 'INVALID_TOOL_CALLBACK');
    }

    // 检查工具是否已存在
    if (this.tools.has(name)) {
      this.logger.warn(`Tool '${name}' already registered, updating...`);
    } else {
      this.stats.totalRegistered++;
    }

    // 创建工具定义
    const tool = new ToolDefinition(name, description, inputSchema || {}, callback);
    this.tools.set(name, tool);
    
    this.logger.info(`Tool registered: ${name}`);
    
    // 触发事件
    this.mcpClient.emit('tool-registered', {
      name,
      description,
      inputSchema: tool.inputSchema,
      timestamp: tool.registeredAt
    });
    
    return true;
  }

  /**
   * 简化工具注册
   * @param {string} name 工具名称
   * @param {string} description 工具描述
   * @param {string} paramName 参数名称
   * @param {string} paramDesc 参数描述
   * @param {string} paramType 参数类型
   * @param {Function} callback 工具回调函数
   * @returns {boolean} 注册是否成功
   */
  registerSimpleTool(name, description, paramName, paramDesc, paramType, callback) {
    const inputSchema = {
      type: 'object',
      properties: {
        [paramName]: {
          type: paramType,
          description: paramDesc
        }
      },
      required: [paramName]
    };
    
    return this.registerTool(name, description, inputSchema, callback);
  }

  /**
   * 注销工具
   * @param {string} name 工具名称
   * @returns {boolean} 注销是否成功
   */
  unregisterTool(name) {
    if (!this.tools.has(name)) {
      this.logger.warn(`Tool '${name}' not found for unregistration`);
      return false;
    }

    const tool = this.tools.get(name);
    this.tools.delete(name);
    this.stats.totalUnregistered++;
    
    this.logger.info(`Tool unregistered: ${name}`);
    
    // 触发事件
    this.mcpClient.emit('tool-unregistered', {
      name,
      stats: tool.getStats(),
      timestamp: new Date()
    });
    
    return true;
  }

  /**
   * 执行工具
   * @param {string} name 工具名称
   * @param {object} args 工具参数
   * @returns {Promise<ToolResponse>} 工具执行结果
   */
  async executeTool(name, args) {
    const startTime = Date.now();
    
    try {
      // 检查工具是否存在
      if (!this.tools.has(name)) {
        throw createError(`Tool '${name}' not found`, 'TOOL_NOT_FOUND');
      }

      const tool = this.tools.get(name);
      
      // 检查并发执行限制
      if (this.currentExecutions >= this.maxConcurrentExecutions) {
        this.logger.warn(`Max concurrent executions reached, queuing tool: ${name}`);
        return await this._queueExecution(name, args, startTime);
      }

      return await this._executeToolInternal(tool, args, startTime);
      
    } catch (error) {
      this.stats.totalErrors++;
      this.logger.error(`Tool execution failed for '${name}':`, error.message);
      
      // 触发错误事件
      this.mcpClient.emit('tool-error', {
        toolName: name,
        error: error.message,
        args,
        timestamp: new Date()
      });
      
      return ToolResponse.error(error);
    }
  }

  /**
   * 内部工具执行逻辑
   * @param {ToolDefinition} tool 工具定义
   * @param {object} args 工具参数
   * @param {number} startTime 开始时间
   * @returns {Promise<ToolResponse>} 工具执行结果
   */
  async _executeToolInternal(tool, args, startTime) {
    this.currentExecutions++;
    
    try {
      // 验证输入参数
      await this._validateToolArguments(tool.inputSchema, args);
      
      // 执行工具回调
      const result = await this._safeExecuteCallback(tool, args);
      
      // 规范化响应格式
      const response = this._normalizeToolResult(result);
      
      // 更新统计信息
      this._updateExecutionStats(startTime);
      
      // 触发执行事件
      this.mcpClient.emit('tool-called', {
        toolName: tool.name,
        args,
        result: response,
        executionTime: Date.now() - startTime,
        timestamp: new Date()
      });
      
      this.logger.debug(`Tool '${tool.name}' executed successfully in ${Date.now() - startTime}ms`);
      
      return response;
      
    } finally {
      this.currentExecutions--;
      
      // 处理队列中的下一个任务
      this._processQueue();
    }
  }

  /**
   * 队列执行工具
   * @param {string} name 工具名称
   * @param {object} args 工具参数
   * @param {number} startTime 开始时间
   * @returns {Promise<ToolResponse>} 工具执行结果
   */
  async _queueExecution(name, args, startTime) {
    return new Promise((resolve, reject) => {
      this.executionQueue.push({
        name,
        args,
        startTime,
        resolve,
        reject,
        queuedAt: Date.now()
      });
    });
  }

  /**
   * 处理执行队列
   */
  async _processQueue() {
    if (this.isProcessingQueue || this.executionQueue.length === 0) {
      return;
    }
    
    if (this.currentExecutions >= this.maxConcurrentExecutions) {
      return;
    }

    this.isProcessingQueue = true;
    
    try {
      const queuedExecution = this.executionQueue.shift();
      if (queuedExecution) {
        const { name, args, startTime, resolve, reject } = queuedExecution;
        
        try {
          if (!this.tools.has(name)) {
            throw createError(`Tool '${name}' not found`, 'TOOL_NOT_FOUND');
          }
          
          const tool = this.tools.get(name);
          const result = await this._executeToolInternal(tool, args, startTime);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }
    } finally {
      this.isProcessingQueue = false;
      
      // 继续处理队列
      if (this.executionQueue.length > 0 && this.currentExecutions < this.maxConcurrentExecutions) {
        setImmediate(() => this._processQueue());
      }
    }
  }

  /**
   * 安全执行工具回调
   * @param {ToolDefinition} tool 工具定义
   * @param {object} args 工具参数
   * @returns {Promise<*>} 执行结果
   */
  async _safeExecuteCallback(tool, args) {
    return new Promise((resolve, reject) => {
      try {
        const result = tool.execute(args);
        
        // 处理Promise
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        } else {
          resolve(result);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 验证工具参数
   * @param {object} schema JSON Schema
   * @param {object} args 参数
   * @returns {Promise<void>}
   */
  async _validateToolArguments(schema, args) {
    if (!schema || Object.keys(schema).length === 0) {
      return; // 无需验证
    }

    const validation = validateJsonSchema(schema, args);
    if (!validation.valid) {
      throw createError(
        `Invalid tool arguments: ${validation.errors.join(', ')}`,
        'INVALID_TOOL_ARGUMENTS',
        { schema, args, errors: validation.errors }
      );
    }
  }

  /**
   * 规范化工具结果
   * @param {*} result 原始结果
   * @returns {ToolResponse} 规范化的响应
   */
  _normalizeToolResult(result) {
    // 如果已经是ToolResponse实例
    if (result instanceof ToolResponse) {
      return result;
    }

    // 如果是字符串
    if (typeof result === 'string') {
      return ToolResponse.success(result);
    }

    // 如果是对象且包含content属性
    if (result && typeof result === 'object' && result.content) {
      return new ToolResponse(result.content, result.isError || false);
    }

    // 如果是其他对象，转换为JSON字符串
    if (result && typeof result === 'object') {
      return ToolResponse.fromJson(result);
    }

    // 默认情况
    return ToolResponse.success(String(result || 'No result'));
  }

  /**
   * 更新执行统计信息
   * @param {number} startTime 开始时间
   */
  _updateExecutionStats(startTime) {
    this.stats.totalExecutions++;
    const executionTime = Date.now() - startTime;
    
    // 计算平均执行时间（移动平均）
    const alpha = 0.1; // 平滑因子
    this.stats.averageExecutionTime = 
      this.stats.averageExecutionTime * (1 - alpha) + executionTime * alpha;
  }

  /**
   * 获取已注册工具列表
   * @returns {Map<string, ToolDefinition>} 工具映射
   */
  getRegisteredTools() {
    return this.tools;
  }

  /**
   * 获取工具名称列表
   * @returns {string[]} 工具名称数组
   */
  getToolNames() {
    return Array.from(this.tools.keys());
  }

  /**
   * 获取工具信息
   * @param {string} name 工具名称
   * @returns {object|null} 工具信息
   */
  getToolInfo(name) {
    if (!this.tools.has(name)) {
      return null;
    }

    const tool = this.tools.get(name);
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      stats: tool.getStats()
    };
  }

  /**
   * 获取所有工具信息（用于tools/list响应）
   * @returns {object[]} 工具信息数组
   */
  getToolsListResponse() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
  }

  /**
   * 清空所有工具
   */
  clearAllTools() {
    const count = this.tools.size;
    this.tools.clear();
    
    this.logger.info(`All tools cleared (${count} tools)`);
    
    // 触发事件
    this.mcpClient.emit('tools-cleared', { count, timestamp: new Date() });
  }

  /**
   * 启用/禁用工具
   * @param {string} name 工具名称
   * @param {boolean} enabled 是否启用
   * @returns {boolean} 操作是否成功
   */
  setToolEnabled(name, enabled) {
    if (!this.tools.has(name)) {
      return false;
    }

    const tool = this.tools.get(name);
    tool.setEnabled(enabled);
    
    this.logger.info(`Tool '${name}' ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  }

  /**
   * 获取工具管理器统计信息
   * @returns {object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      registeredCount: this.tools.size,
      queueLength: this.executionQueue.length,
      currentExecutions: this.currentExecutions,
      maxConcurrentExecutions: this.maxConcurrentExecutions
    };
  }

  /**
   * 设置最大并发执行数
   * @param {number} max 最大并发数
   */
  setMaxConcurrentExecutions(max) {
    this.maxConcurrentExecutions = Math.max(1, Math.floor(max));
    this.logger.debug(`Max concurrent executions set to: ${this.maxConcurrentExecutions}`);
  }

  /**
   * 清空执行队列
   */
  clearQueue() {
    const queuedCount = this.executionQueue.length;
    this.executionQueue.forEach(item => {
      item.reject(createError('Execution queue cleared', 'QUEUE_CLEARED'));
    });
    this.executionQueue.length = 0;
    
    this.logger.info(`Execution queue cleared (${queuedCount} items)`);
  }

  /**
   * 销毁工具管理器
   */
  destroy() {
    this.clearQueue();
    this.clearAllTools();
    this.logger.debug('ToolManager destroyed');
  }
}

module.exports = ToolManager;