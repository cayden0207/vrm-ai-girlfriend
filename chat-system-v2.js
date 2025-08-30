/**
 * AI女友聊天系统 V2.0
 * 面向公众用户，集成后端API，去除配置界面
 */

class AIGirlfriendChatSystemV2 {
    constructor() {
        this.apiBaseURL = this.getAPIBaseURL();
        this.currentUser = null;
        this.currentCharacter = null;
        this.chatHistory = [];
        this.isLoading = false;
        
        this.initializeSystem();
    }
    
    /**
     * 获取API基础URL
     */
    getAPIBaseURL() {
        // 开发环境
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'http://localhost:3000/api';
        }
        // 生产环境，使用相对路径
        return '/api';
    }
    
    /**
     * 初始化系统
     */
    async initializeSystem() {
        console.log('🤖 初始化AI聊天系统V2...');
        
        try {
            // 检查API连接
            await this.checkAPIHealth();
            
            // 初始化或恢复用户会话
            await this.initializeUser();
            
            // 设置事件监听器
            this.setupEventListeners();
            
            console.log('✅ AI聊天系统初始化完成');
        } catch (error) {
            console.error('❌ 系统初始化失败:', error);
            this.showError('系统初始化失败，请刷新页面重试');
        }
    }
    
    /**
     * 检查API健康状态
     */
    async checkAPIHealth() {
        try {
            const response = await fetch(`${this.apiBaseURL}/health`);
            if (!response.ok) throw new Error('API连接失败');
            
            const data = await response.json();
            console.log('📡 API连接正常:', data);
            return true;
        } catch (error) {
            console.warn('⚠️ API连接失败，使用离线模式');
            return false;
        }
    }
    
    /**
     * 初始化用户（检查localStorage或等待钱包连接）
     */
    async initializeUser() {
        // 检查localStorage中是否有钱包信息
        const walletAddress = localStorage.getItem('walletAddress');
        const userId = localStorage.getItem('userId');
        const selectedCharacterData = localStorage.getItem('selectedCharacter');
        
        if (walletAddress && userId) {
            console.log('🔄 恢复钱包会话:', walletAddress.slice(0, 8) + '...');
            
            try {
                // 验证钱包会话
                const response = await fetch(`${this.apiBaseURL}/user/auth`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        walletAddress: walletAddress
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        this.currentUser = data.user;
                        this.walletAddress = walletAddress;
                        this.waitingForWallet = false;
                        
                        // 同步钱包管理器状态
                        if (window.solanaWallet) {
                            window.solanaWallet.walletAddress = walletAddress;
                            window.solanaWallet.isConnected = true;
                            window.solanaWallet.updateWalletUI();
                        }
                        
                        console.log('✅ 钱包会话恢复成功');
                        
                        // 如果有选择的角色，自动初始化聊天
                        if (selectedCharacterData) {
                            try {
                                const characterData = JSON.parse(selectedCharacterData);
                                this.currentCharacter = {
                                    id: characterData.id,
                                    name: characterData.name,
                                    personality: characterData.personality,
                                    description: characterData.description
                                };
                                
                                console.log('🎯 角色已恢复:', this.currentCharacter.name);
                                
                                // 初始化聊天界面
                                await this.initializeCharacterChat();
                                
                                // 清除localStorage中的角色信息
                                localStorage.removeItem('selectedCharacter');
                                
                                return;
                            } catch (error) {
                                console.error('角色数据解析失败:', error);
                            }
                        }
                        
                        return;
                    }
                }
                
                // 如果验证失败，清除localStorage
                localStorage.removeItem('walletAddress');
                localStorage.removeItem('userId');
                
            } catch (error) {
                console.error('钱包会话恢复失败:', error);
            }
        }
        
        // 只有在没有localStorage数据时才显示钱包要求
        const hasStoredWallet = localStorage.getItem('walletAddress');
        if (!hasStoredWallet && !this.waitingForWallet) {
            this.showWalletRequired();
        }
    }
    
    /**
     * 显示钱包连接要求
     */
    showWalletRequired() {
        this.waitingForWallet = true;
        console.log('⏳ 等待用户连接Solana钱包...');
        
        // 只有当确实需要时才显示登录遮罩
        const loginOverlay = document.getElementById('wallet-login-overlay');
        if (loginOverlay && loginOverlay.style.display !== 'none') {
            setTimeout(() => {
                if (!this.currentUser && !localStorage.getItem('walletAddress')) {
                    loginOverlay.style.display = 'flex';
                }
            }, 500); // 延迟显示，给localStorage恢复留时间
        }
        
        // 监听钱包连接事件
        window.addEventListener('walletConnected', (event) => {
            this.onWalletConnected(event.detail.address);
        });
    }
    
    /**
     * 钱包连接成功回调
     */
    async onWalletConnected(walletAddress) {
        console.log('🔗 钱包已连接:', walletAddress);
        
        try {
            // 使用钱包地址认证/注册用户
            const response = await fetch(`${this.apiBaseURL}/user/auth`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    walletAddress: walletAddress
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            if (data.success) {
                this.currentUser = data.user;
                this.walletAddress = walletAddress;
                this.waitingForWallet = false;
                
                console.log('👤 钱包用户认证成功:', data.user.nickname);
                console.log('🔑 用户ID:', data.user.id);
                
                // 检查用户是否需要完善资料
                await this.checkUserProfileStatus(walletAddress);
                
                // 显示成功消息
                this.showSuccess('✅ 钱包连接成功！您的AI女友们正在准备中...');
                
                // 如果已有选中的角色，立即初始化聊天
                if (this.currentCharacter) {
                    await this.initializeCharacterChat();
                }
            } else {
                throw new Error(data.error || '认证失败');
            }
        } catch (error) {
            console.error('❌ 钱包用户认证失败:', error);
            this.showError(`钱包认证失败: ${error.message}`);
        }
    }
    
    /**
     * 检查用户资料状态，首次用户显示资料面板
     */
    async checkUserProfileStatus(walletAddress) {
        try {
            console.log('📋 检查用户资料状态:', walletAddress);
            
            // 调用后端API检查用户资料
            const response = await fetch(`${this.apiBaseURL}/profiles/${walletAddress}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            if (response.status === 404) {
                // 用户资料不存在，显示首次注册资料面板
                console.log('🆕 首次用户 - 需要完善资料');
                this.showFirstTimeUserProfilePanel(walletAddress);
                return false;
            }
            
            if (!response.ok) {
                console.warn('⚠️ 获取用户资料失败，使用默认流程');
                return true; // 默认允许继续
            }
            
            const data = await response.json();
            if (data.success && data.profile) {
                console.log('✅ 用户资料存在，继续正常流程');
                return true;
            } else {
                console.log('📝 用户资料为空，显示资料收集面板');
                this.showFirstTimeUserProfilePanel(walletAddress);
                return false;
            }
            
        } catch (error) {
            console.error('❌ 检查用户资料失败:', error);
            // 出错时不阻塞流程
            return true;
        }
    }
    
    /**
     * 显示首次用户资料收集面板
     */
    showFirstTimeUserProfilePanel(walletAddress) {
        console.log('📱 显示首次用户资料面板');
        
        // 检查是否存在资料面板管理器（来自character-select页面）
        if (typeof window !== 'undefined' && window.profileManager) {
            console.log('✅ 使用现有的profileManager');
            window.profileManager.showProfilePanel();
        } else {
            // 创建简单的提示，引导用户到角色选择页面完善资料
            this.showProfileReminderModal(walletAddress);
        }
    }
    
    /**
     * 显示资料完善提醒弹窗
     */
    showProfileReminderModal(walletAddress) {
        // 创建提醒弹窗
        const modal = document.createElement('div');
        modal.id = 'profile-reminder-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            backdrop-filter: blur(10px);
        `;
        
        const panel = document.createElement('div');
        panel.style.cssText = `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 20px;
            padding: 40px;
            max-width: 500px;
            text-align: center;
            color: white;
            box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            position: relative;
        `;
        
        panel.innerHTML = `
            <div style="font-size: 60px; margin-bottom: 20px;">👋</div>
            <h2 style="margin: 0 0 15px 0; font-size: 28px;">欢迎来到AI女友世界！</h2>
            <p style="margin: 0 0 25px 0; font-size: 16px; line-height: 1.6; opacity: 0.9;">
                为了给您提供更个性化的聊天体验，我们需要了解您的一些基本信息。
            </p>
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 12px; margin: 20px 0;">
                <p style="margin: 0; font-size: 14px;">
                    📝 完善个人资料<br>
                    🎭 解锁个性化对话<br>
                    💕 获得更好的AI女友体验
                </p>
            </div>
            <button id="setup-profile-btn" style="
                background: rgba(255,255,255,0.2);
                border: 2px solid rgba(255,255,255,0.3);
                color: white;
                padding: 12px 30px;
                border-radius: 25px;
                font-size: 16px;
                cursor: pointer;
                margin-right: 15px;
                transition: all 0.3s ease;
            " onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                现在完善资料
            </button>
            <button id="skip-profile-btn" style="
                background: transparent;
                border: 1px solid rgba(255,255,255,0.5);
                color: rgba(255,255,255,0.7);
                padding: 12px 30px;
                border-radius: 25px;
                font-size: 16px;
                cursor: pointer;
                transition: all 0.3s ease;
            " onmouseover="this.style.borderColor='rgba(255,255,255,0.8)'; this.style.color='rgba(255,255,255,0.9)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.5)'; this.style.color='rgba(255,255,255,0.7)'">
                稍后再说
            </button>
        `;
        
        modal.appendChild(panel);
        document.body.appendChild(modal);
        
        // 绑定事件
        document.getElementById('setup-profile-btn').addEventListener('click', () => {
            document.body.removeChild(modal);
            // 跳转到角色选择页面
            if (window.location.pathname.includes('chat.html')) {
                window.location.href = 'character-select.html';
            } else {
                this.showSuccess('💡 请前往角色选择页面完善您的个人资料');
            }
        });
        
        document.getElementById('skip-profile-btn').addEventListener('click', () => {
            document.body.removeChild(modal);
            this.showInfo('💫 您可以随时在角色选择页面完善个人资料，获得更好的聊天体验');
        });
        
        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                this.showInfo('💫 您可以随时在角色选择页面完善个人资料');
            }
        });
        
        console.log('✅ 用户资料提醒弹窗已显示');
    }
    
    /**
     * 生成钱包用户昵称
     */
    generateWalletNickname(walletAddress) {
        const prefixes = ['Web3', 'Crypto', 'Solana', 'DeFi'];
        const suffixes = ['达人', '探索者', '收藏家', '玩家'];
        
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
        const shortAddr = walletAddress.slice(-4);
        
        return `${prefix}${suffix}_${shortAddr}`;
    }
    
    /**
     * 生成随机昵称
     */
    generateNickname() {
        const adjectives = ['可爱的', '温柔的', '活泼的', '聪明的', '神秘的'];
        const nouns = ['小天使', '小精灵', '小公主', '小仙女', '小甜心'];
        
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        
        return adj + noun;
    }
    
    /**
     * 设置角色
     */
    async setCharacter(character) {
        this.currentCharacter = character;
        this.chatHistory = [];
        
        console.log(`💕 设置当前角色: ${character.name}`);
        
        // 如果用户已连接钱包，立即初始化聊天
        if (this.currentUser && !this.waitingForWallet) {
            await this.initializeCharacterChat();
        }
    }
    
    /**
     * 初始化角色聊天
     */
    async initializeCharacterChat() {
        if (!this.currentUser || !this.currentCharacter) return;
        
        // 从服务器加载该角色的聊天历史
        await this.loadChatHistory();
        
        // 更新UI
        this.updateChatTitle();
        
        // 检查是否是首次与该角色聊天
        const stats = await this.getUserStats();
        if (!stats || stats.totalInteractions === 0) {
            // 首次聊天，显示欢迎消息
            setTimeout(() => {
                const welcomeMessage = this.getWelcomeMessage();
                this.updateChatUI({
                    id: Date.now(),
                    sender: 'ai',
                    content: welcomeMessage,
                    timestamp: new Date().toISOString(),
                    emotion: 'happy'
                });
            }, 3500);
        }
        
        console.log(`💬 ${this.currentCharacter.name}的聊天已初始化`);
    }
    
    /**
     * 获取欢迎消息
     */
    getWelcomeMessage() {
        const character = this.currentCharacter;
        const timeContext = new Date().getHours();
        let greeting = '你好';
        
        if (timeContext < 12) greeting = '早上好';
        else if (timeContext < 18) greeting = '下午好';
        else greeting = '晚上好';
        
        const welcomeMessages = {
            'Alice': `${greeting}！我是Alice～很高兴在Web3世界遇见你！你的钱包地址好特别呢～`,
            'Fliza': `${greeting}！我是Fliza，欢迎来到我的空间！我看你是个Solana玩家？`,
            'Ash': `${greeting}...我是Ash。看起来你对区块链很感兴趣呢。`,
            'Elinyaa': `${greeting}！我是Elinyaa～在元宇宙中遇见你真是太好了！`,
            'default': `${greeting}！我是${character.name}，很高兴认识来自Web3世界的你～`
        };
        
        return welcomeMessages[character.name] || welcomeMessages.default;
    }
    
    /**
     * 加载聊天历史
     */
    async loadChatHistory() {
        if (!this.currentUser || !this.currentCharacter) return;
        
        try {
            const response = await fetch(
                `${this.apiBaseURL}/memory/${this.currentUser.id}/${this.currentCharacter.id}`
            );
            
            const data = await response.json();
            if (data.success && data.memory.chatHistory) {
                this.chatHistory = data.memory.chatHistory;
                
                // 显示最近的几条消息
                this.displayChatHistory();
            }
        } catch (error) {
            console.warn('⚠️ 加载聊天历史失败:', error);
        }
    }
    
    /**
     * 显示聊天历史
     */
    displayChatHistory() {
        const messagesContainer = document.getElementById('chat-messages') || document.getElementById('chat-window-messages');
        if (!messagesContainer) return;
        
        // 清空现有消息
        messagesContainer.innerHTML = '';
        
        // 显示最近10条消息
        const recentMessages = this.chatHistory.slice(-10);
        recentMessages.forEach(message => {
            this.updateChatUI(message, false); // false表示不滚动
        });
        
        // 最后滚动到底部
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    /**
     * 发送消息
     */
    async sendMessage(message) {
        if (!message.trim() || this.isLoading) return;
        if (!this.currentUser || !this.currentCharacter) {
            this.showError('系统尚未初始化完成，请稍候再试');
            return;
        }
        
        // 添加用户消息
        const userMessage = {
            id: Date.now(),
            sender: 'user',
            content: message,
            timestamp: new Date().toISOString()
        };
        
        this.chatHistory.push(userMessage);
        this.updateChatUI(userMessage);
        
        // 显示打字指示器
        this.showTypingIndicator();
        this.isLoading = true;
        
        try {
            // 🚨 强制使用后端API进行测试
            if (false && window.aiChatIntegration) {
                // 创建一个空的AI消息占位符
                const aiMessage = {
                    id: Date.now() + 1,
                    sender: 'ai',
                    content: '',
                    timestamp: new Date().toISOString(),
                    emotion: 'happy'
                };
                
                // 添加占位符消息到聊天记录和UI
                this.chatHistory.push(aiMessage);
                this.hideTypingIndicator();
                this.updateChatUI(aiMessage);
                
                // 使用流式响应
                console.log('🔍 当前角色对象:', this.currentCharacter);
                console.log('🔍 角色ID:', this.currentCharacter.id);
                const fullResponse = await window.aiChatIntegration.sendMessageStream(
                    message, 
                    this.currentCharacter.id, 
                    'cn', // 默认使用中文
                    (chunk) => {
                        // 逐步更新消息内容
                        aiMessage.content += chunk;
                        this.updateStreamingMessage(aiMessage);
                    }
                );
                
                // 🐛 修复：只有当fullResponse有效且不同时才覆盖
                if (fullResponse && fullResponse.trim() !== aiMessage.content.trim()) {
                    console.log('🔄 更新最终消息:', { 
                        stream: aiMessage.content.substring(0, 50),
                        full: fullResponse.substring(0, 50) 
                    });
                    aiMessage.content = fullResponse;
                    this.updateStreamingMessage(aiMessage);
                }
                this.isLoading = false;
                
            } else {
                // fallback到后端API
                const response = await fetch(`${this.apiBaseURL}/chat/${this.currentCharacter.id}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        userId: this.currentUser.id,
                        message: message,
                        character: this.currentCharacter
                    })
                });
                
                const data = await response.json();
                
                if (data.success && data.response) {
                    // 添加AI回复
                    const aiMessage = {
                        id: Date.now() + 1,
                        sender: 'ai',
                        content: data.response.content,
                        timestamp: new Date().toISOString(),
                        emotion: data.response.emotion,
                        expression: data.response.expression
                    };
                    
                    this.chatHistory.push(aiMessage);
                    
                    // 延迟显示回复，模拟真实对话
                    setTimeout(() => {
                        this.hideTypingIndicator();
                        this.updateChatUI(aiMessage);
                        
                        // 触发VRM表情
                        if (aiMessage.expression) {
                            this.triggerCharacterExpression(aiMessage.expression);
                        }
                        
                        this.isLoading = false;
                    }, 3000 + Math.random() * 1500); // 3-4.5秒随机延迟
                    
                } else {
                    throw new Error(data.error || 'AI回复失败');
                }
            }
            
        } catch (error) {
            console.error('❌ 发送消息失败:', error);
            this.hideTypingIndicator();
            this.isLoading = false;
            
            // 显示错误回复
            const errorMessage = {
                id: Date.now() + 1,
                sender: 'ai',
                content: '抱歉，我现在有点累，可以稍后再聊吗？ 😅',
                timestamp: new Date().toISOString(),
                emotion: 'apologetic'
            };
            
            this.updateChatUI(errorMessage);
        }
    }
    
    /**
     * 更新流式消息内容
     */
    updateStreamingMessage(message) {
        // 在现代chat.html界面中更新
        if (window.updateStreamingMessageUI) {
            window.updateStreamingMessageUI(message.id, message.content);
            return;
        }
        
        // 在传统界面中更新
        const messageElement = document.querySelector(`[data-message-id="${message.id}"]`);
        if (messageElement) {
            const contentElement = messageElement.querySelector('.bubble-content') || 
                                 messageElement.querySelector('.message-text');
            if (contentElement) {
                contentElement.textContent = message.content;
            }
        }
    }
    
    /**
     * 更新聊天UI
     */
    updateChatUI(message, shouldScroll = true) {
        const messagesContainer = document.getElementById('chat-messages') || document.getElementById('chat-window-messages');
        if (!messagesContainer) {
            // 如果没有找到消息容器，尝试通过事件通知新界面
            this.notifyChatInterface(message);
            return;
        }
        
        // 检查是否是chat.html界面
        if (messagesContainer.id === 'chat-messages') {
            // 使用chat.html的消息格式
            if (window.addMessageToUI) {
                window.addMessageToUI(message.sender, message.content, message.emotion, message.id);
                return;
            }
        }
        
        // 检查是否是index.html界面
        if (messagesContainer.id === 'chat-window-messages') {
            // 使用index.html的消息格式
            if (window.addMessage) {
                const isUser = message.sender === 'user';
                window.addMessage(message.content, isUser, message.id);
                return;
            }
        }
        
        // 原有界面的消息格式
        const messageDiv = document.createElement('div');
        messageDiv.className = `message-bubble ${message.sender}`;
        
        const timeStr = new Date(message.timestamp).toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const senderName = message.sender === 'user' 
            ? (this.currentUser?.nickname || '你')
            : (this.currentCharacter?.name || 'AI');
        
        messageDiv.innerHTML = `
            <div class="bubble-content">${message.content}</div>
        `;
        
        messagesContainer.appendChild(messageDiv);
        
        if (shouldScroll) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        // 添加动画效果
        messageDiv.style.opacity = '0';
        messageDiv.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            messageDiv.style.opacity = '1';
            messageDiv.style.transform = 'translateY(0)';
            messageDiv.style.transition = 'all 0.3s ease';
        }, 50);
    }
    
    /**
     * 通知聊天界面（用于新界面）
     */
    notifyChatInterface(message) {
        // 发送自定义事件通知新界面
        const event = new CustomEvent('chatResponse', {
            detail: {
                sender: message.sender,
                content: message.content,
                emotion: message.emotion,
                timestamp: message.timestamp
            }
        });
        window.dispatchEvent(event);
    }
    
    /**
     * 显示打字指示器
     */
    showTypingIndicator() {
        const messagesContainer = document.getElementById('chat-window-messages');
        if (!messagesContainer) return;
        
        // 移除现有的打字指示器
        const existing = document.getElementById('typing-indicator');
        if (existing) existing.remove();
        
        const typingDiv = document.createElement('div');
        typingDiv.className = 'typing-indicator';
        typingDiv.id = 'typing-indicator';
        typingDiv.innerHTML = `
            <div class="message-bubble ai">
                <div class="bubble-content">
                    <div class="typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>
            </div>
        `;
        
        messagesContainer.appendChild(typingDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    /**
     * 隐藏打字指示器
     */
    hideTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
    
    /**
     * 触发角色表情
     */
    triggerCharacterExpression(expression) {
        if (window.triggerVRMExpression) {
            window.triggerVRMExpression(expression);
        }
        console.log(`😊 触发表情: ${expression}`);
    }
    
    /**
     * 更新聊天标题
     */
    updateChatTitle() {
        const chatTitle = document.querySelector('.chat-window-title');
        if (chatTitle && this.currentCharacter) {
            chatTitle.textContent = `💕 与${this.currentCharacter.name}聊天`;
        }
    }
    
    /**
     * 获取情感表情符号
     */
    getEmotionEmoji(emotion) {
        const emojiMap = {
            happy: '😊',
            excited: '🤩',
            sad: '😢',
            angry: '😠',
            surprised: '😲',
            shy: '😳',
            thoughtful: '🤔',
            neutral: '😐',
            apologetic: '😅',
            curious: '🤨'
        };
        return emojiMap[emotion] || '😊';
    }
    
    /**
     * 显示错误消息
     */
    showError(message) {
        this.showMessage(`⚠️ ${message}`, 'error');
    }
    
    /**
     * 显示成功消息
     */
    showSuccess(message) {
        this.showMessage(message, 'success');
    }
    
    /**
     * 显示信息消息
     */
    showInfo(message) {
        this.showMessage(`💡 ${message}`, 'info');
    }
    
    /**
     * 显示消息
     */
    showMessage(message, type = 'info') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `system-message ${type}`;
        messageDiv.textContent = message;
        
        const colors = {
            success: 'rgba(76, 175, 80, 0.9)',
            error: 'rgba(220, 53, 69, 0.9)',
            info: 'rgba(33, 150, 243, 0.9)'
        };
        
        messageDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${colors[type]};
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            z-index: 10000;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            animation: slideInMessage 0.3s ease;
            max-width: 300px;
            word-wrap: break-word;
        `;
        
        // 添加滑入动画
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideInMessage {
                from {
                    opacity: 0;
                    transform: translateX(100px);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(messageDiv);
        
        setTimeout(() => {
            messageDiv.remove();
            if (style.parentNode) {
                style.parentNode.removeChild(style);
            }
        }, type === 'success' ? 6000 : 5000);
    }
    
    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 监听页面关闭事件
        window.addEventListener('beforeunload', () => {
            // 可以在这里执行清理工作
        });
        
        // 监听网络状态变化
        window.addEventListener('online', () => {
            console.log('🌐 网络已连接');
        });
        
        window.addEventListener('offline', () => {
            console.log('📵 网络已断开');
            this.showError('网络连接已断开，请检查网络设置');
        });
    }
    
    /**
     * 获取用户统计信息
     */
    async getUserStats() {
        if (!this.currentUser || !this.currentCharacter) return null;
        
        try {
            const response = await fetch(
                `${this.apiBaseURL}/memory/${this.currentUser.id}/${this.currentCharacter.id}`
            );
            
            const data = await response.json();
            if (data.success) {
                return {
                    nickname: this.currentUser.nickname,
                    relationshipLevel: data.memory.relationshipLevel || 1,
                    totalInteractions: data.memory.totalInteractions || 0,
                    lastInteraction: data.memory.lastInteraction
                };
            }
        } catch (error) {
            console.warn('获取用户统计失败:', error);
        }
        
        return null;
    }
    
    /**
     * 清除聊天历史（仅本地）
     */
    clearLocalChatHistory() {
        this.chatHistory = [];
        const messagesContainer = document.getElementById('chat-window-messages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '';
        }
    }
}

// 全局实例
window.AIGirlfriendChatSystemV2 = AIGirlfriendChatSystemV2;

// 创建全局实例
window.chatSystemV2 = new AIGirlfriendChatSystemV2();

console.log('💬 AI女友聊天系统V2已加载');