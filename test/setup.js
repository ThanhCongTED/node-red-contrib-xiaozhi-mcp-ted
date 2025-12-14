// Jest测试环境设置
const helper = require('node-red-node-test-helper');

// 测试前设置
beforeEach(() => {
  helper.startServer();
});

// 测试后清理
afterEach(() => {
  helper.unload();
  helper.stopServer();
});

// 全局测试超时设置
jest.setTimeout(30000);

// 模拟WebSocket
global.WebSocket = class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 100);
  }
  
  send(data) {
    // 模拟发送
  }
  
  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }
};