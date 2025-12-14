/**
 * 工具函数库
 * 提供常用的辅助函数和工具方法
 */

/**
 * 生成唯一ID
 * @returns {string} 唯一标识符
 */
function generateId() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

/**
 * 延迟执行
 * @param {number} ms 延迟毫秒数
 * @returns {Promise} Promise对象
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 安全的JSON解析
 * @param {string} jsonStr JSON字符串
 * @param {*} defaultValue 默认值
 * @returns {*} 解析结果或默认值
 */
function safeJsonParse(jsonStr, defaultValue = null) {
  try {
    return JSON.parse(jsonStr);
  } catch (error) {
    return defaultValue;
  }
}

/**
 * 安全的JSON序列化
 * @param {*} obj 要序列化的对象
 * @param {string} defaultValue 默认值
 * @returns {string} JSON字符串
 */
function safeJsonStringify(obj, defaultValue = '{}') {
  try {
    return JSON.stringify(obj);
  } catch (error) {
    return defaultValue;
  }
}

/**
 * 验证WebSocket URL格式
 * @param {string} url WebSocket URL
 * @returns {boolean} 是否为有效的WebSocket URL
 */
function isValidWebSocketUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('ws://') || url.startsWith('wss://');
}

/**
 * 构建WebSocket连接URL
 * @param {string} baseUrl 基础URL
 * @param {object} params 查询参数
 * @returns {string} 完整的连接URL
 */
function buildWebSocketUrl(baseUrl, params = {}) {
  if (!isValidWebSocketUrl(baseUrl)) {
    throw new Error('Invalid WebSocket URL format');
  }

  const url = new URL(baseUrl);
  
  // 添加查询参数
  Object.keys(params).forEach(key => {
    if (params[key] !== undefined && params[key] !== null) {
      url.searchParams.set(key, String(params[key]));
    }
  });

  return url.toString();
}

/**
 * 转义JSON字符串中的特殊字符
 * @param {string} str 输入字符串
 * @returns {string} 转义后的字符串
 */
function escapeJsonString(str) {
  if (typeof str !== 'string') return str;
  
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, '\\\'')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\b/g, '\\b')
    .replace(/\f/g, '\\f');
}

/**
 * 格式化JSON字符串（美化输出）
 * @param {string|object} json JSON字符串或对象
 * @param {number} indent 缩进空格数
 * @returns {string} 格式化后的JSON字符串
 */
function formatJson(json, indent = 2) {
  try {
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    return JSON.stringify(obj, null, indent);
  } catch (error) {
    return typeof json === 'string' ? json : JSON.stringify(json);
  }
}

/**
 * 深度克隆对象
 * @param {*} obj 要克隆的对象
 * @returns {*} 克隆后的对象
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  if (typeof obj === 'object') {
    const cloned = {};
    Object.keys(obj).forEach(key => {
      cloned[key] = deepClone(obj[key]);
    });
    return cloned;
  }
  return obj;
}

/**
 * 合并对象（深度合并）
 * @param {object} target 目标对象
 * @param {...object} sources 源对象
 * @returns {object} 合并后的对象
 */
function deepMerge(target, ...sources) {
  if (!sources.length) return target;
  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        deepMerge(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }

  return deepMerge(target, ...sources);
}

/**
 * 检查是否为对象
 * @param {*} item 要检查的项
 * @returns {boolean} 是否为对象
 */
function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

/**
 * 防抖函数
 * @param {Function} func 要防抖的函数
 * @param {number} wait 等待时间
 * @param {boolean} immediate 是否立即执行
 * @returns {Function} 防抖后的函数
 */
function debounce(func, wait, immediate = false) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      timeout = null;
      if (!immediate) func.apply(this, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(this, args);
  };
}

/**
 * 节流函数
 * @param {Function} func 要节流的函数
 * @param {number} limit 限制时间
 * @returns {Function} 节流后的函数
 */
function throttle(func, limit) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * 重试函数
 * @param {Function} fn 要重试的函数
 * @param {number} maxRetries 最大重试次数
 * @param {number} delay 重试延迟
 * @returns {Promise} Promise对象
 */
async function retry(fn, maxRetries = 3, retryDelay = 1000) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries) {
        throw new Error(`Failed after ${maxRetries + 1} attempts: ${error.message}`);
      }
      await delay(retryDelay * Math.pow(2, i)); // 指数退避
    }
  }
}

/**
 * 计算指数退避延迟
 * @param {number} attempt 尝试次数
 * @param {number} baseDelay 基础延迟
 * @param {number} maxDelay 最大延迟
 * @returns {number} 计算后的延迟时间
 */
function calculateBackoff(attempt, baseDelay = 1000, maxDelay = 30000) {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 0.1 * exponentialDelay; // 添加抖动
  return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * 验证JSON Schema（简单版本）
 * @param {object} schema JSON Schema
 * @param {*} data 要验证的数据
 * @returns {object} 验证结果
 */
function validateJsonSchema(schema, data) {
  const errors = [];

  // 简单的类型检查
  if (schema.type) {
    const actualType = Array.isArray(data) ? 'array' : typeof data;
    if (actualType !== schema.type) {
      errors.push(`Expected type ${schema.type}, got ${actualType}`);
    }
  }

  // 必填字段检查
  if (schema.required && Array.isArray(schema.required)) {
    schema.required.forEach(field => {
      if (!(field in data)) {
        errors.push(`Missing required field: ${field}`);
      }
    });
  }

  // 属性检查
  if (schema.properties && typeof data === 'object') {
    Object.keys(schema.properties).forEach(prop => {
      if (prop in data) {
        const propSchema = schema.properties[prop];
        const propResult = validateJsonSchema(propSchema, data[prop]);
        errors.push(...propResult.errors.map(err => `${prop}.${err}`));
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 格式化字节大小
 * @param {number} bytes 字节数
 * @param {number} decimals 小数位数
 * @returns {string} 格式化后的大小
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * 格式化时间持续
 * @param {number} ms 毫秒数
 * @returns {string} 格式化后的时间
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * 创建错误对象
 * @param {string} message 错误消息
 * @param {string} code 错误代码
 * @param {*} details 错误详情
 * @returns {Error} 错误对象
 */
function createError(message, code = 'UNKNOWN_ERROR', details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  error.timestamp = new Date();
  return error;
}

/**
 * 日志级别
 */
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

/**
 * 简单的日志记录器
 */
class Logger {
  constructor(name, level = LogLevel.INFO) {
    this.name = name;
    this.level = level;
  }

  _log(level, levelName, ...args) {
    if (level >= this.level) {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${this.name}] [${levelName}]`;
      console.log(prefix, ...args);
    }
  }

  debug(...args) {
    this._log(LogLevel.DEBUG, 'DEBUG', ...args);
  }

  info(...args) {
    this._log(LogLevel.INFO, 'INFO', ...args);
  }

  warn(...args) {
    this._log(LogLevel.WARN, 'WARN', ...args);
  }

  error(...args) {
    this._log(LogLevel.ERROR, 'ERROR', ...args);
  }
}

module.exports = {
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
};