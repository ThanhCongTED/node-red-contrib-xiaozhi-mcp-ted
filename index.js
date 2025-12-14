/**
 * xiaozhi-mcp 库入口文件
 * 导出所有核心类和接口
 */

// 核心类
const WebSocketMCP = require('./lib/websocket-mcp');

// 管理器类
const ReconnectManager = require('./lib/reconnect-manager');
const MessageHandler = require('./lib/message-handler');
const ToolManager = require('./lib/tool-manager');

// 接口和数据类
const {
  MCPConfig,
  MCPCredentials,
  ToolDefinition,
  ToolContentItem,
  ToolResponse,
  ToolParams,
  ConnectionState,
  MCPEvent
} = require('./lib/interfaces');

// 工具函数
const {
  generateId,
  delay,
  safeJsonParse,
  safeJsonStringify,
  isValidWebSocketUrl,
  buildWebSocketUrl,
  escapeJsonString,
  formatJson,
  deepClone,
  deepMerge,
  isObject,
  debounce,
  throttle,
  retry,
  calculateBackoff,
  validateJsonSchema,
  formatBytes,
  formatDuration,
  createError,
  LogLevel,
  Logger
} = require('./lib/utils');

module.exports = {
  // 主要类
  WebSocketMCP,
  
  // 管理器类
  ReconnectManager,
  MessageHandler,
  ToolManager,
  
  // 数据类和接口
  MCPConfig,
  MCPCredentials,
  ToolDefinition,
  ToolContentItem,
  ToolResponse,
  ToolParams,
  
  // 枚举
  ConnectionState,
  MCPEvent,
  LogLevel,
  
  // 工具函数
  generateId,
  delay,
  safeJsonParse,
  safeJsonStringify,
  isValidWebSocketUrl,
  buildWebSocketUrl,
  escapeJsonString,
  formatJson,
  deepClone,
  deepMerge,
  isObject,
  debounce,
  throttle,
  retry,
  calculateBackoff,
  validateJsonSchema,
  formatBytes,
  formatDuration,
  createError,
  Logger
};