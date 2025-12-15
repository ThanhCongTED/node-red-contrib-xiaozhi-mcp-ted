# Hướng dẫn kiểm tra mở rộng Node-RED xiaozhi-mcp

## 🎯 Mục tiêu kiểm tra

Hướng dẫn kiểm tra này sẽ giúp bạn xác minh toàn diện chức năng, hiệu suất và độ ổn định của phần mở rộng xiaozhi-mcp. Kiểm tra được chia thành bốn giai đoạn:

1. **Kiểm tra đơn vị** - Xác minh chức năng thư viện cốt lõi
2. **Kiểm tra nút** - Xác minh chức năng nút Node-RED  
3. **Kiểm tra tích hợp** - Xác minh chức năng end-to-end
4. **Kiểm tra môi trường sản xuất** - Xác minh triển khai thực tế

## 📋 Chuẩn bị trước khi kiểm tra

### Yêu cầu môi trường

- Node.js >= 14.0.0
- Node-RED >= 2.0.0
- Kết nối mạng (để kết nối với máy chủ MCP Xiaozhi)

### Cài đặt phụ thuộc

```bash
# Vào thư mục dự án
cd node-red-contrib-xiaozhi-mcp

# Cài đặt phụ thuộc
npm install

# Kiểm tra môi trường
node --version
npm --version


## 🧪 Giai đoạn 1: Kiểm tra đơn vị

### 1.1 Kiểm tra chất lượng mã

```bash
# Kiểm tra phong cách mã
npm run lint

# Tự động sửa lỗi định dạng
npm run lint:fix

# Định dạng mã
npm run format
```



### 1.2 Kiểm tra thư viện cốt lõi

```bash
# Chạy kiểm tra đơn vị
npm test

# Chạy kiểm tra và xem độ phủ
npm run test:coverage

# Giám sát kiểm tra liên tục
npm run test:watch
```

**Kết quả mong đợi:**
- ✅ Tất cả các trường hợp kiểm tra đều thông qua
- ✅ Độ phủ mã > 80%
- ✅ Không có rò rỉ bộ nhớ

### 1.3 Xác minh chức năng chính

Kiểm tra các điểm chức năng cốt lõi:

**Kiểm tra kết nối WebSocket:**
```javascript
// Xác minh cấu hình kết nối
✅ Tạo đối tượng cấu hình
✅ Xác minh định dạng endpoint
✅ Quản lý chứng chỉ
✅ Hệ thống sự kiện

// Xác minh quản lý kết nối
✅ Thiết lập kết nối
✅ Giám sát trạng thái kết nối
✅ Cơ chế tự động kết nối lại
✅ Giữ nhịp tim
```

**Kiểm tra quản lý công cụ:**
```javascript
// Xác minh thao tác công cụ
✅ Đăng ký công cụ
✅ Hủy đăng ký công cụ
✅ Xác thực tham số
✅ Thực thi công cụ
✅ Xử lý lỗi
```

**Kiểm tra xử lý tin nhắn:**
```javascript
// Xác minh hệ thống tin nhắn
✅ Xác minh tin nhắn JSON-RPC
✅ Tạo ID tin nhắn
✅ Xử lý Ping/Pong
✅ Xử lý tin nhắn lỗi
```

## 🔧 Giai đoạn 2: Kiểm tra nút Node-RED

### 2.1 Kiểm tra tải nút

```bash
# Chạy trong thư mục node-red-contrib-xiaozhi-mcp
npm run test:nodes
```

Xác minh tất cả các nút được tải đúng cách:

✅ Nút cấu hình xiaozhi-config
✅ Nút đăng ký công cụ xiaozhi-tool-register
✅ Nút gọi công cụ xiaozhi-tool-call
✅ Nút giám sát trạng thái xiaozhi-status
✅ Nút xử lý tin nhắn xiaozhi-message
### 2.2 Kiểm tra cấu hình nút

**Nút xiaozhi-config:**
```javascript
Điểm kiểm tra:
✅ Xác minh cấu hình bắt buộc
✅ Định dạng endpoint WebSocket
✅ Xác thực chứng chỉ kết nối
✅ Hiển thị trạng thái chính xác
```

**Nút đăng ký công cụ:**
```javascript
Điểm kiểm tra:
✅ Xác minh tên công cụ
✅ Xác thực JSON Schema
✅ Xử lý hàm gọi lại
✅ Thu thập thông tin thống kê
```

### 2.3 Kiểm tra truyền thông giữa các nút

Xác minh truyền thông điệp giữa các nút:

```javascript
Quy trình: Nút đăng ký → Hàm xử lý → Phản hồi trả về
✅ Định dạng tin nhắn chính xác
✅ ID cuộc gọi khớp
✅ Xử lý thời gian chờ
✅ Truyền lỗi
```

## 🌐 Kiểm tra tích hợp

### 3.1 安装到Node-RED

```bash
# 方法1：本地安装（开发环境）
cd ~/.node-red
npm install /path/to/node-red-contrib-xiaozhi-mcp

# 方法2：链接安装（开发环境）
cd /path/to/node-red-contrib-xiaozhi-mcp
npm link
cd ~/.node-red
npm link node-red-contrib-xiaozhi-mcp

# 重启Node-RED
node-red
```

### 3.2 导入示例流程

1. 打开Node-RED界面 (http://localhost:1880)
2. 导入示例流程：
   - 菜单 → 导入 → 选择文件
   - 导入 `examples/basic-example.json`
3. 验证节点显示正确

### 3.3 配置连接

**步骤1：配置小智连接**
```
1. 双击 "小智连接配置" 节点
2. 填写配置信息：
   - 端点: wss://api.xiaozhi.me/mcp
   - 服务器名称: NodeRED-Test
   - 访问令牌: [您的令牌]
3. 点击"测试连接"验证
4. 部署流程
```

**期望结果：**
- ✅ 连接状态显示为"已连接"
- ✅ 配置节点为绿色圆点状态

### 3.4 功能测试

**测试1：工具注册**
```
1. 检查LED控制工具节点状态
2. 应显示"已注册 (0次调用)"
3. 检查温度传感器工具状态
4. 应显示"已注册 (0次调用)"
```

**测试2：状态监控**
```
1. 观察状态监控输出
2. 应显示MCP连接状态
3. 应显示已注册工具信息
4. 检查更新频率正常
```

**测试3：工具调用**
```
1. 点击"测试工具调用"注入节点
2. 观察调用结果输出
3. 检查LED工具调用计数增加
4. 验证响应数据格式正确
```

**测试4：消息通信**
```
1. 点击"发送Ping"注入节点
2. 观察Ping响应输出
3. 验证往返时间合理
4. 检查消息格式符合JSON-RPC规范
```

## 🚀 第四阶段：生产环境测试

### 4.1 长时间稳定性测试

**设置自动化测试：**
```javascript
// 创建自动测试流程
1. 设置定时器节点 (每分钟)
2. 循环调用工具
3. 监控错误率
4. 记录性能指标

测试时间: 24小时
验证指标:
✅ 连接稳定性 > 99%
✅ 工具调用成功率 > 95%
✅ 平均响应时间 < 1秒
✅ 内存使用稳定
```

### 4.2 并发压力测试

```javascript
// 并发测试设置
并发工具调用: 10个/秒
持续时间: 1小时
监控指标:
✅ 响应时间不超过5秒
✅ 无调用丢失
✅ 错误率 < 1%
✅ 内存和CPU使用正常
```

### 4.3 网络异常测试

```javascript
测试场景:
1. 网络断开恢复
2. 服务器临时不可用
3. 长时间网络延迟
4. 连接超时

验证重连机制:
✅ 自动重连成功
✅ 工具重新注册
✅ 消息不丢失
✅ 状态正确更新
```

### 4.4 异常场景测试

**配置错误测试：**
```javascript
1. 错误的端点地址
   ✅ 显示连接错误
   ✅ 提供有用的错误信息

2. 无效的访问令牌
   ✅ 显示认证错误
   ✅ 不会无限重试

3. 无效的工具配置
   ✅ 显示配置错误
   ✅ 其他工具不受影响
```

**资源限制测试：**
```javascript
1. 低内存环境
   ✅ 优雅降级
   ✅ 不会崩溃

2. 网络带宽限制
   ✅ 自动调整频率
   ✅ 优先保证核心功能
```

## 📊 测试报告模板

### 基础功能测试结果

| 测试项目 | 状态 | 备注 |
|---------|------|------|
| 代码质量检查 | ✅/❌ | ESLint, Prettier |
| 单元测试通过率 | ✅/❌ | __/__ 个测试通过 |
| 代码覆盖率 | ✅/❌ | __%覆盖率 |
| 节点加载测试 | ✅/❌ | 5个节点全部加载 |
| 配置验证 | ✅/❌ | 配置验证功能 |
| 连接测试 | ✅/❌ | MCP服务器连接 |
| 工具注册 | ✅/❌ | 工具注册功能 |
| 工具调用 | ✅/❌ | 工具调用功能 |
| 状态监控 | ✅/❌ | 实时状态监控 |
| 消息通信 | ✅/❌ | JSON-RPC消息 |

### 性能测试结果

| 性能指标 | 目标值 | 实际值 | 状态 |
|---------|--------|--------|------|
| 连接建立时间 | < 3秒 | __秒 | ✅/❌ |
| 工具注册时间 | < 1秒 | __秒 | ✅/❌ |
| 工具调用响应时间 | < 1秒 | __秒 | ✅/❌ |
| 并发处理能力 | 10次/秒 | __次/秒 | ✅/❌ |
| 内存使用 | < 100MB | __MB | ✅/❌ |
| 长时间稳定性 | 24小时 | __小时 | ✅/❌ |

### 稳定性测试结果

| 稳定性指标 | 目标值 | 实际值 | 状态 |
|-----------|--------|--------|------|
| 连接成功率 | > 99% | __%  | ✅/❌ |
| 工具调用成功率 | > 95% | __%  | ✅/❌ |
| 自动重连成功率 | > 90% | __%  | ✅/❌ |
| 错误恢复时间 | < 30秒 | __秒 | ✅/❌ |

## 🐛 常见问题排查

### 连接问题

**问题：无法连接到MCP服务器**
```
排查步骤：
1. 检查网络连接
2. 验证端点地址格式
3. 确认访问令牌有效
4. 检查防火墙设置
5. 查看Node-RED日志
```

**问题：连接频繁断开**
```
排查步骤：
1. 检查网络稳定性
2. 调整心跳间隔
3. 检查服务器状态
4. 验证重连配置
```

### 工具问题

**问题：工具注册失败**
```
排查步骤：
1. 检查工具名称唯一性
2. 验证JSON Schema格式
3. 确认MCP连接正常
4. 检查配置节点状态
```

**问题：工具调用超时**
```
排查步骤：
1. 增加超时时间
2. 检查处理逻辑复杂度
3. 验证参数格式
4. 检查网络延迟
```

### 性能问题

**问题：响应时间过长**
```
优化方案：
1. 优化工具处理逻辑
2. 增加并发处理能力
3. 减少不必要的数据传输
4. 使用异步处理
```

**问题：内存使用过高**
```
优化方案：
1. 清理消息历史记录
2. 减少状态缓存
3. 优化对象创建
4. 及时释放资源
```

## 🎯 测试完成检查清单

### 开发阶段
- [ ] 代码质量检查通过
- [ ] 单元测试全部通过
- [ ] 代码覆盖率 > 80%
- [ ] 所有节点正确加载
- [ ] 基础功能验证通过

### 集成阶段  
- [ ] Node-RED安装成功
- [ ] 示例流程导入成功
- [ ] MCP连接配置正确
- [ ] 工具注册功能正常
- [ ] 工具调用功能正常
- [ ] 状态监控功能正常
- [ ] 消息通信功能正常

### 生产阶段
- [ ] 长时间稳定性测试通过
- [ ] 并发压力测试通过
- [ ] 网络异常恢复测试通过
- [ ] 异常场景处理正确
- [ ] 性能指标达到要求
- [ ] 文档完整准确

## 📝 下一步建议

测试完成后，根据结果进行相应的改进：

1. **如果基础测试未通过**：
   - 修复发现的bug
   - 改进错误处理
   - 重新运行测试

2. **如果性能测试未达标**：
   - 优化关键路径
   - 改进算法效率
   - 考虑架构调整

3. **如果稳定性测试有问题**：
   - 加强异常处理
   - 改进重连机制
   - 增加容错能力

4. **准备发布**：
   - 更新版本号
   - 完善文档
   - 准备发布说明

---

通过遵循这个测试指南，您可以确保xiaozhi-mcp扩展的质量和可靠性，为用户提供稳定的IoT设备接入解决方案。