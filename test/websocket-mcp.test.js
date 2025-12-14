/**
 * 基础连接测试
 * 测试WebSocketMCP核心连接功能
 */

const WebSocketMCP = require('../lib/websocket-mcp');
const { MCPConfig, MCPCredentials } = require('../lib/interfaces');

describe('WebSocketMCP Connection Tests', () => {
  let mcpClient;
  const mockConfig = new MCPConfig({
    endpoint: 'ws://localhost:8080/mcp',
    serverName: 'Test-Client',
    autoReconnect: true,
    heartbeatInterval: 5000
  });
  const mockCredentials = new MCPCredentials('test-token');

  beforeEach(() => {
    mcpClient = new WebSocketMCP(mockConfig, mockCredentials);
  });

  afterEach(() => {
    if (mcpClient) {
      mcpClient.destroy();
    }
  });

  test('should initialize with correct configuration', () => {
    expect(mcpClient).toBeDefined();
    expect(mcpClient.config).toEqual(mockConfig);
    expect(mcpClient.credentials).toEqual(mockCredentials);
  });

  test('should have correct initial state', () => {
    expect(mcpClient.isConnected()).toBe(false);
    expect(mcpClient.getConnectionState()).toBe('disconnected');
  });

  test('should emit events correctly', (done) => {
    let eventReceived = false;
    
    mcpClient.on('test-event', (data) => {
      expect(data).toEqual({ test: 'data' });
      eventReceived = true;
      done();
    });

    mcpClient.emit('test-event', { test: 'data' });
    
    setTimeout(() => {
      if (!eventReceived) {
        done(new Error('Event not received'));
      }
    }, 100);
  });

  test('should handle connection configuration changes', () => {
    const newConfig = new MCPConfig({
      endpoint: 'wss://test.example.com/mcp',
      heartbeatInterval: 10000
    });

    mcpClient.updateConfig(newConfig);
    expect(mcpClient.config.endpoint).toBe('wss://test.example.com/mcp');
    expect(mcpClient.config.heartbeatInterval).toBe(10000);
  });

  test('should validate endpoint format', () => {
    expect(() => {
      new MCPConfig({ endpoint: 'invalid-endpoint' });
    }).toThrow();

    expect(() => {
      new MCPConfig({ endpoint: 'http://test.com' });
    }).toThrow();

    expect(() => {
      new MCPConfig({ endpoint: 'ws://test.com/mcp' });
    }).not.toThrow();
  });
});

describe('Tool Management Tests', () => {
  let mcpClient;

  beforeEach(() => {
    const config = new MCPConfig({
      endpoint: 'ws://localhost:8080/mcp'
    });
    const credentials = new MCPCredentials('test-token');
    mcpClient = new WebSocketMCP(config, credentials);
  });

  afterEach(() => {
    if (mcpClient) {
      mcpClient.destroy();
    }
  });

  test('should register tools correctly', () => {
    const toolCallback = jest.fn();
    const result = mcpClient.registerTool(
      'test_tool',
      'Test tool description',
      { type: 'object', properties: {} },
      toolCallback
    );

    expect(result).toBe(true);
    expect(mcpClient.getRegisteredTools().has('test_tool')).toBe(true);
  });

  test('should validate tool parameters', () => {
    expect(() => {
      mcpClient.registerTool('', 'description', {}, () => {});
    }).toThrow('Tool name must be a non-empty string');

    expect(() => {
      mcpClient.registerTool('test', '', {}, () => {});
    }).toThrow('Tool description must be a non-empty string');

    expect(() => {
      mcpClient.registerTool('test', 'desc', {}, null);
    }).toThrow('Tool callback must be a function');
  });

  test('should unregister tools correctly', () => {
    const toolCallback = jest.fn();
    mcpClient.registerTool('test_tool', 'description', {}, toolCallback);
    
    expect(mcpClient.getRegisteredTools().has('test_tool')).toBe(true);
    
    const result = mcpClient.unregisterTool('test_tool');
    expect(result).toBe(true);
    expect(mcpClient.getRegisteredTools().has('test_tool')).toBe(false);
  });

  test('should handle tool execution', async () => {
    const mockResult = { success: true, data: 'test result' };
    const toolCallback = jest.fn().mockResolvedValue(mockResult);
    
    mcpClient.registerTool('test_tool', 'description', {}, toolCallback);
    
    // 模拟工具调用
    const result = await mcpClient.executeTool('test_tool', { param: 'value' });
    
    expect(toolCallback).toHaveBeenCalledWith({ param: 'value' });
    expect(result).toEqual(mockResult);
  });
});

describe('Message Handling Tests', () => {
  let mcpClient;

  beforeEach(() => {
    const config = new MCPConfig({
      endpoint: 'ws://localhost:8080/mcp'
    });
    const credentials = new MCPCredentials('test-token');
    mcpClient = new WebSocketMCP(config, credentials);
  });

  afterEach(() => {
    if (mcpClient) {
      mcpClient.destroy();
    }
  });

  test('should validate JSON-RPC messages', () => {
    const validMessage = {
      jsonrpc: '2.0',
      method: 'test',
      id: '123'
    };

    const invalidMessage = {
      method: 'test'
    };

    expect(mcpClient.messageHandler.validateMessage(validMessage)).toBe(true);
    expect(mcpClient.messageHandler.validateMessage(invalidMessage)).toBe(false);
  });

  test('should handle ping/pong messages', () => {
    const pingMessage = {
      jsonrpc: '2.0',
      method: 'ping',
      id: '123'
    };

    const response = mcpClient.messageHandler.handlePing(pingMessage);
    
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: '123',
      result: {}
    });
  });

  test('should generate unique message IDs', () => {
    const id1 = mcpClient.messageHandler.generateMessageId();
    const id2 = mcpClient.messageHandler.generateMessageId();
    
    expect(id1).not.toEqual(id2);
    expect(typeof id1).toBe('string');
    expect(typeof id2).toBe('string');
  });
});

describe('Error Handling Tests', () => {
  let mcpClient;

  beforeEach(() => {
    const config = new MCPConfig({
      endpoint: 'ws://localhost:8080/mcp'
    });
    const credentials = new MCPCredentials('test-token');
    mcpClient = new WebSocketMCP(config, credentials);
  });

  afterEach(() => {
    if (mcpClient) {
      mcpClient.destroy();
    }
  });

  test('should handle connection errors gracefully', (done) => {
    let errorReceived = false;

    mcpClient.on('error', (error) => {
      expect(error).toBeDefined();
      expect(error.message).toBeDefined();
      errorReceived = true;
      done();
    });

    // 模拟连接错误
    mcpClient.emit('error', new Error('Connection failed'));

    setTimeout(() => {
      if (!errorReceived) {
        done(new Error('Error event not received'));
      }
    }, 100);
  });

  test('should handle tool execution errors', async () => {
    const errorMessage = 'Tool execution failed';
    const toolCallback = jest.fn().mockRejectedValue(new Error(errorMessage));
    
    mcpClient.registerTool('failing_tool', 'description', {}, toolCallback);
    
    try {
      await mcpClient.executeTool('failing_tool', {});
      throw new Error('Expected error was not thrown');
    } catch (error) {
      expect(error.message).toBe(errorMessage);
    }
  });

  test('should handle invalid JSON messages', () => {
    const invalidJson = 'invalid json string';
    
    expect(() => {
      mcpClient.messageHandler.parseMessage(invalidJson);
    }).toThrow();
  });
});