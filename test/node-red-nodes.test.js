/**
 * Node-RED节点测试
 * 使用node-red-node-test-helper进行节点测试
 */

const helper = require('node-red-node-test-helper');

// 导入节点
const xiaozhiConfigNode = require('../nodes/xiaozhi-config/xiaozhi-config.js');
const xiaozhiToolRegisterNode = require('../nodes/xiaozhi-tool-register/xiaozhi-tool-register.js');
const xiaozhiToolCallNode = require('../nodes/xiaozhi-tool-call/xiaozhi-tool-call.js');
const xiaozhiStatusNode = require('../nodes/xiaozhi-status/xiaozhi-status.js');
const xiaozhiMessageNode = require('../nodes/xiaozhi-message/xiaozhi-message.js');

describe('xiaozhi-config Node Tests', () => {
  beforeEach((done) => {
    helper.startServer(done);
  });

  afterEach((done) => {
    helper.unload();
    helper.stopServer(done);
  });

  test('should load xiaozhi-config node', (done) => {
    const flow = [
      {
        id: 'config1',
        type: 'xiaozhi-config',
        name: 'Test Config',
        endpoint: 'ws://localhost:8080/mcp',
        serverName: 'Test Server'
      }
    ];

    helper.load(xiaozhiConfigNode, flow, () => {
      const configNode = helper.getNode('config1');
      expect(configNode).toBeDefined();
      expect(configNode.name).toBe('Test Config');
      expect(configNode.endpoint).toBe('ws://localhost:8080/mcp');
      done();
    });
  });

  test('should validate required configuration', (done) => {
    const flow = [
      {
        id: 'config1',
        type: 'xiaozhi-config',
        name: 'Test Config'
        // 缺少必需的endpoint
      }
    ];

    helper.load(xiaozhiConfigNode, flow, () => {
      const configNode = helper.getNode('config1');
      expect(configNode).toBeDefined();
      // 检查状态是否为错误
      setTimeout(() => {
        const status = configNode.status;
        expect(status.fill).toBe('red');
        done();
      }, 100);
    });
  });
});

describe('xiaozhi-tool-register Node Tests', () => {
  beforeEach((done) => {
    helper.startServer(done);
  });

  afterEach((done) => {
    helper.unload();
    helper.stopServer(done);
  });

  test('should load tool register node', (done) => {
    const flow = [
      {
        id: 'config1',
        type: 'xiaozhi-config',
        name: 'Test Config',
        endpoint: 'ws://localhost:8080/mcp'
      },
      {
        id: 'register1',
        type: 'xiaozhi-tool-register',
        name: 'Test Register',
        xiaozhi: 'config1',
        toolName: 'test_tool',
        toolDescription: 'Test tool description',
        inputSchema: '{"type": "object", "properties": {}}',
        wires: []
      }
    ];

    helper.load([xiaozhiConfigNode, xiaozhiToolRegisterNode], flow, () => {
      const registerNode = helper.getNode('register1');
      expect(registerNode).toBeDefined();
      expect(registerNode.toolName).toBe('test_tool');
      expect(registerNode.toolDescription).toBe('Test tool description');
      done();
    });
  });

  test('should handle tool call input', (done) => {
    const flow = [
      {
        id: 'config1',
        type: 'xiaozhi-config',
        name: 'Test Config',
        endpoint: 'ws://localhost:8080/mcp'
      },
      {
        id: 'register1',
        type: 'xiaozhi-tool-register',
        name: 'Test Register',
        xiaozhi: 'config1',
        toolName: 'test_tool',
        toolDescription: 'Test tool',
        inputSchema: '{"type": "object"}',
        outputToFlow: true,
        wires: [['helper1']]
      },
      {
        id: 'helper1',
        type: 'helper'
      }
    ];

    helper.load([xiaozhiConfigNode, xiaozhiToolRegisterNode], flow, () => {
      const registerNode = helper.getNode('register1');
      const helperNode = helper.getNode('helper1');

      helperNode.on('input', (msg) => {
        expect(msg.payload).toBeDefined();
        expect(msg.payload.toolName).toBe('test_tool');
        expect(msg._mcpCallId).toBeDefined();
        done();
      });

      // 模拟工具调用响应
      const responseMsg = {
        payload: { result: 'success' },
        _mcpCallId: 'test-call-id'
      };

      registerNode.receive(responseMsg);
    });
  });
});

describe('xiaozhi-tool-call Node Tests', () => {
  beforeEach((done) => {
    helper.startServer(done);
  });

  afterEach((done) => {
    helper.unload();
    helper.stopServer(done);
  });

  test('should load tool call node', (done) => {
    const flow = [
      {
        id: 'config1',
        type: 'xiaozhi-config',
        endpoint: 'ws://localhost:8080/mcp'
      },
      {
        id: 'call1',
        type: 'xiaozhi-tool-call',
        name: 'Test Call',
        xiaozhi: 'config1',
        targetTool: 'remote_tool',
        toolArguments: '{"param": "value"}',
        wires: []
      }
    ];

    helper.load([xiaozhiConfigNode, xiaozhiToolCallNode], flow, () => {
      const callNode = helper.getNode('call1');
      expect(callNode).toBeDefined();
      expect(callNode.targetTool).toBe('remote_tool');
      done();
    });
  });

  test('should handle input message for tool call', (done) => {
    const flow = [
      {
        id: 'config1',
        type: 'xiaozhi-config',
        endpoint: 'ws://localhost:8080/mcp'
      },
      {
        id: 'call1',
        type: 'xiaozhi-tool-call',
        xiaozhi: 'config1',
        targetTool: 'test_tool',
        argumentsSource: 'msg',
        wires: [['helper1']]
      },
      {
        id: 'helper1',
        type: 'helper'
      }
    ];

    helper.load([xiaozhiConfigNode, xiaozhiToolCallNode], flow, () => {
      const callNode = helper.getNode('call1');
      const helperNode = helper.getNode('helper1');

      helperNode.on('input', (msg) => {
        expect(msg._toolCall).toBeDefined();
        expect(msg._toolCall.toolName).toBe('test_tool');
        done();
      });

      // 发送输入消息
      const inputMsg = {
        payload: { param: 'test_value' }
      };

      callNode.receive(inputMsg);
    });
  });
});

describe('xiaozhi-status Node Tests', () => {
  beforeEach((done) => {
    helper.startServer(done);
  });

  afterEach((done) => {
    helper.unload();
    helper.stopServer(done);
  });

  test('should load status node', (done) => {
    const flow = [
      {
        id: 'config1',
        type: 'xiaozhi-config',
        endpoint: 'ws://localhost:8080/mcp'
      },
      {
        id: 'status1',
        type: 'xiaozhi-status',
        xiaozhi: 'config1',
        monitorMode: 'manual',
        wires: []
      }
    ];

    helper.load([xiaozhiConfigNode, xiaozhiStatusNode], flow, () => {
      const statusNode = helper.getNode('status1');
      expect(statusNode).toBeDefined();
      expect(statusNode.monitorMode).toBe('manual');
      done();
    });
  });

  test('should handle status check command', (done) => {
    const flow = [
      {
        id: 'config1',
        type: 'xiaozhi-config',
        endpoint: 'ws://localhost:8080/mcp'
      },
      {
        id: 'status1',
        type: 'xiaozhi-status',
        xiaozhi: 'config1',
        monitorMode: 'manual',
        wires: [['helper1']]
      },
      {
        id: 'helper1',
        type: 'helper'
      }
    ];

    helper.load([xiaozhiConfigNode, xiaozhiStatusNode], flow, () => {
      const statusNode = helper.getNode('status1');
      const helperNode = helper.getNode('helper1');

      helperNode.on('input', (msg) => {
        expect(msg.payload).toBeDefined();
        expect(msg.payload.timestamp).toBeDefined();
        expect(msg.payload.mcp).toBeDefined();
        done();
      });

      // 发送状态检查命令
      const inputMsg = {
        payload: 'check'
      };

      statusNode.receive(inputMsg);
    });
  });
});

describe('xiaozhi-message Node Tests', () => {
  beforeEach((done) => {
    helper.startServer(done);
  });

  afterEach((done) => {
    helper.unload();
    helper.stopServer(done);
  });

  test('should load message node', (done) => {
    const flow = [
      {
        id: 'config1',
        type: 'xiaozhi-config',
        endpoint: 'ws://localhost:8080/mcp'
      },
      {
        id: 'message1',
        type: 'xiaozhi-message',
        xiaozhi: 'config1',
        messageMode: 'send',
        messageType: 'notification',
        method: 'ping',
        wires: []
      }
    ];

    helper.load([xiaozhiConfigNode, xiaozhiMessageNode], flow, () => {
      const messageNode = helper.getNode('message1');
      expect(messageNode).toBeDefined();
      expect(messageNode.messageMode).toBe('send');
      expect(messageNode.method).toBe('ping');
      done();
    });
  });

  test('should handle message sending', (done) => {
    const flow = [
      {
        id: 'config1',
        type: 'xiaozhi-config',
        endpoint: 'ws://localhost:8080/mcp'
      },
      {
        id: 'message1',
        type: 'xiaozhi-message',
        xiaozhi: 'config1',
        messageMode: 'send',
        messageType: 'notification',
        method: 'test_method',
        params: '{"test": "value"}',
        wires: [['helper1']]
      },
      {
        id: 'helper1',
        type: 'helper'
      }
    ];

    helper.load([xiaozhiConfigNode, xiaozhiMessageNode], flow, () => {
      const messageNode = helper.getNode('message1');
      const helperNode = helper.getNode('helper1');

      helperNode.on('input', (msg) => {
        expect(msg.payload).toBeDefined();
        expect(msg.payload.status).toBe('sent');
        expect(msg._messageSent).toBeDefined();
        done();
      });

      // 发送输入消息触发发送
      const inputMsg = {
        payload: {}
      };

      messageNode.receive(inputMsg);
    });
  });
});

describe('Integration Tests', () => {
  beforeEach((done) => {
    helper.startServer(done);
  });

  afterEach((done) => {
    helper.unload();
    helper.stopServer(done);
  });

  test('should handle complete tool registration and call flow', (done) => {
    const flow = [
      {
        id: 'config1',
        type: 'xiaozhi-config',
        endpoint: 'ws://localhost:8080/mcp'
      },
      {
        id: 'register1',
        type: 'xiaozhi-tool-register',
        xiaozhi: 'config1',
        toolName: 'echo_tool',
        toolDescription: 'Echo tool',
        inputSchema: '{"type": "object", "properties": {"message": {"type": "string"}}}',
        outputToFlow: true,
        wires: [['process1']]
      },
      {
        id: 'process1',
        type: 'function',
        func: 'msg.payload = {result: "Echo: " + msg.payload.arguments.message}; return msg;',
        wires: [['register1']]
      },
      {
        id: 'call1',
        type: 'xiaozhi-tool-call',
        xiaozhi: 'config1',
        targetTool: 'echo_tool',
        toolArguments: '{"message": "Hello World"}',
        wires: [['helper1']]
      },
      {
        id: 'helper1',
        type: 'helper'
      }
    ];

    helper.load([xiaozhiConfigNode, xiaozhiToolRegisterNode, xiaozhiToolCallNode], flow, () => {
      const helperNode = helper.getNode('helper1');
      const callNode = helper.getNode('call1');

      let responseReceived = false;

      helperNode.on('input', (msg) => {
        if (!responseReceived) {
          expect(msg.payload).toBeDefined();
          expect(msg._toolCall).toBeDefined();
          responseReceived = true;
          done();
        }
      });

      // 触发工具调用
      setTimeout(() => {
        const inputMsg = { payload: {} };
        callNode.receive(inputMsg);
      }, 100);
    });
  });
});