/**
 * 重连管理器
 * 负责处理WebSocket连接的自动重连逻辑
 */

const { calculateBackoff, delay, Logger } = require('./utils');
const { ConnectionState } = require('./interfaces');

class ReconnectManager {
  constructor(mcpClient) {
    this.mcpClient = mcpClient;
    this.config = mcpClient.config;
    this.logger = new Logger('ReconnectManager');
    
    // 重连状态
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.maxAttempts = this.config.maxReconnectAttempts;
    this.baseDelay = this.config.reconnectDelay;
    this.maxDelay = this.config.maxBackoff;
    
    // 定时器
    this.reconnectTimer = null;
    this.giveUpTimer = null;
    
    // 重连统计
    this.stats = {
      totalAttempts: 0,
      successfulReconnects: 0,
      failedAttempts: 0,
      lastAttemptTime: null,
      lastSuccessTime: null
    };
  }

  /**
   * 安排重连
   * @param {boolean} immediate 是否立即重连
   */
  scheduleReconnect(immediate = false) {
    if (!this.config.autoReconnect) {
      this.logger.debug('Auto reconnect is disabled');
      return;
    }

    if (this.isReconnecting) {
      this.logger.debug('Reconnect already in progress');
      return;
    }

    if (this.reconnectAttempts >= this.maxAttempts) {
      this.logger.warn(`Max reconnect attempts (${this.maxAttempts}) reached`);
      this._giveUp();
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    this.stats.totalAttempts++;
    this.stats.lastAttemptTime = new Date();

    const delay = immediate ? 0 : this._calculateDelay();
    
    this.logger.info(`Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this._attemptReconnect();
    }, delay);
  }

  /**
   * 尝试重连
   */
  async _attemptReconnect() {
    if (!this.isReconnecting) return;

    this.logger.info(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxAttempts})`);
    
    try {
      this.mcpClient.emit('status-change', {
        state: ConnectionState.RECONNECTING,
        attempt: this.reconnectAttempts,
        maxAttempts: this.maxAttempts
      });

      await this.mcpClient.connect();
      
      // 重连成功
      this._onReconnectSuccess();
      
    } catch (error) {
      this.logger.error(`Reconnect attempt ${this.reconnectAttempts} failed:`, error.message);
      this.stats.failedAttempts++;
      
      this.mcpClient.emit('reconnect-failed', {
        attempt: this.reconnectAttempts,
        error: error.message,
        nextAttemptIn: this._calculateDelay()
      });

      // 继续尝试重连
      this.isReconnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * 重连成功处理
   */
  _onReconnectSuccess() {
    this.logger.info(`Reconnect successful after ${this.reconnectAttempts} attempts`);
    
    this.stats.successfulReconnects++;
    this.stats.lastSuccessTime = new Date();
    
    this.mcpClient.emit('reconnected', {
      attempts: this.reconnectAttempts,
      totalTime: this._getTotalReconnectTime()
    });

    this.reset();
  }

  /**
   * 放弃重连
   */
  _giveUp() {
    this.logger.error(`Giving up reconnection after ${this.reconnectAttempts} attempts`);
    
    this.mcpClient.emit('reconnect-give-up', {
      totalAttempts: this.reconnectAttempts,
      totalTime: this._getTotalReconnectTime()
    });

    this.reset();
  }

  /**
   * 计算重连延迟
   * @returns {number} 延迟时间（毫秒）
   */
  _calculateDelay() {
    return calculateBackoff(this.reconnectAttempts - 1, this.baseDelay, this.maxDelay);
  }

  /**
   * 获取总重连时间
   * @returns {number} 重连总时间（毫秒）
   */
  _getTotalReconnectTime() {
    if (!this.stats.lastAttemptTime) return 0;
    const startTime = this.stats.lastAttemptTime.getTime() - 
                     (this.reconnectAttempts - 1) * this.baseDelay;
    return Date.now() - startTime;
  }

  /**
   * 重置重连状态
   */
  reset() {
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    
    // 清理定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.giveUpTimer) {
      clearTimeout(this.giveUpTimer);
      this.giveUpTimer = null;
    }
  }

  /**
   * 取消重连
   */
  cancel() {
    if (this.isReconnecting) {
      this.logger.info('Cancelling reconnection attempts');
      this.reset();
    }
  }

  /**
   * 强制立即重连
   */
  forceReconnect() {
    this.cancel();
    this.scheduleReconnect(true);
  }

  /**
   * 设置重连参数
   * @param {object} options 重连选项
   */
  updateConfig(options = {}) {
    if (options.maxAttempts !== undefined) {
      this.maxAttempts = options.maxAttempts;
    }
    if (options.baseDelay !== undefined) {
      this.baseDelay = options.baseDelay;
    }
    if (options.maxDelay !== undefined) {
      this.maxDelay = options.maxDelay;
    }
    
    this.logger.debug('Reconnect config updated:', {
      maxAttempts: this.maxAttempts,
      baseDelay: this.baseDelay,
      maxDelay: this.maxDelay
    });
  }

  /**
   * 获取重连状态
   * @returns {object} 重连状态信息
   */
  getStatus() {
    return {
      isReconnecting: this.isReconnecting,
      currentAttempt: this.reconnectAttempts,
      maxAttempts: this.maxAttempts,
      nextAttemptIn: this.reconnectTimer ? this._calculateDelay() : null,
      stats: { ...this.stats }
    };
  }

  /**
   * 获取重连统计信息
   * @returns {object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      currentAttempt: this.reconnectAttempts,
      maxAttempts: this.maxAttempts,
      isActive: this.isReconnecting
    };
  }

  /**
   * 清空统计信息
   */
  resetStats() {
    this.stats = {
      totalAttempts: 0,
      successfulReconnects: 0,
      failedAttempts: 0,
      lastAttemptTime: null,
      lastSuccessTime: null
    };
    this.logger.debug('Reconnect stats reset');
  }

  /**
   * 销毁重连管理器
   */
  destroy() {
    this.cancel();
    this.logger.debug('ReconnectManager destroyed');
  }
}

module.exports = ReconnectManager;