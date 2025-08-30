# 部署指南 - Vercel部署说明

## 🚀 快速开始

### 1. 准备工作

确保你有以下账号和密钥：
- Vercel账号
- OpenAI API密钥（必需）
- Supabase项目（可选）

### 2. 环境变量配置

在Vercel Dashboard中设置以下环境变量：

```bash
# 必需
OPENAI_API_KEY=sk-xxxxx  # 你的OpenAI API密钥

# 语音功能（可选）
ELEVENLABS_API_KEY=sk_xxxxx  # ElevenLabs TTS API密钥

# 数据库（可选但推荐）
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJxxx

# API限制（可选）
RATE_LIMIT_WINDOW_MS=900000  # 15分钟窗口
RATE_LIMIT_MAX_REQUESTS=100  # 每个IP最多100次请求
```

### 3. 部署步骤

1. Fork或克隆此仓库
2. 在Vercel中导入项目
3. 设置环境变量（Settings > Environment Variables）
4. 部署

### 4. 重要安全提示

✅ **已完成的安全改进：**
- ✅ 移除了前端硬编码的API密钥
- ✅ 前端现在通过后端API代理所有OpenAI请求
- ✅ 添加了API速率限制保护
- ✅ 使用环境变量管理敏感信息

⚠️ **注意事项：**
- 永远不要在前端代码中暴露API密钥
- 定期轮换你的API密钥
- 监控API使用情况避免超额
- 考虑为不同环境使用不同的密钥

### 5. API调用流程

```
用户 → 前端 → 后端API (/api/chat) → OpenAI API
         ↑                    ↓
         ←──── 响应 ←────────
```

### 6. 费用控制建议

- 使用 `gpt-3.5-turbo` 而不是 `gpt-4` 以降低成本
- 实施用户认证和配额管理
- 监控每个用户的使用量
- 考虑添加付费订阅功能

### 7. 故障排查

如果遇到问题：
1. 检查Vercel函数日志
2. 确认环境变量设置正确
3. 验证API密钥有效性
4. 检查速率限制是否触发

## 📝 配置文件说明

- `vercel.json` - Vercel部署配置
- `backend/.env.example` - 环境变量示例
- `backend/server.js` - 后端API服务器

## 🔒 安全最佳实践

1. **API密钥管理**
   - 使用Vercel的环境变量功能
   - 不同环境使用不同密钥
   - 定期轮换密钥

2. **速率限制**
   - 已实施基于IP的速率限制
   - 聊天API有更严格的限制

3. **用户认证**
   - 已支持钱包地址认证
   - 建议添加更多认证方式

## 📊 监控建议

- 使用Vercel Analytics监控性能
- 设置OpenAI使用量警报
- 追踪API错误率
- 监控用户活跃度

## 🆘 需要帮助？

如有问题，请检查：
- Vercel文档：https://vercel.com/docs
- OpenAI文档：https://platform.openai.com/docs
- 项目Issues页面