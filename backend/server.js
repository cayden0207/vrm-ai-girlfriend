/**
 * AI女友聊天游戏后端服务器
 * 功能：用户管理、记忆存储、AI API代理
 */

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const { SupabaseUserManager } = require('./supabase');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// 初始化Supabase用户管理器
const supabaseUserManager = new SupabaseUserManager();

// API速率限制配置
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 默认15分钟
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // 限制每个IP最多100次请求
    message: '请求过于频繁，请稍后再试',
    standardHeaders: true, // 返回 `RateLimit-*` headers
    legacyHeaders: false, // 禁用 `X-RateLimit-*` headers
});

// 对聊天API应用更严格的限制
const chatLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1分钟
    max: 20, // 每分钟最多20次聊天请求
    message: '聊天请求过于频繁，请稍后再试',
});

// CORS配置 - 生产环境应限制域名
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? [process.env.FRONTEND_URL, /\.vercel\.app$/] // Vercel域名模式
        : true, // 开发环境允许所有来源
    credentials: true,
    optionsSuccessStatus: 200
};

// 中间件
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' })); // 限制请求大小
app.use(express.static(path.join(__dirname, '../')));

// 应用全局速率限制到API路由
app.use('/api/', limiter);

// 数据存储目录
const DATA_DIR = path.join(__dirname, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const MEMORIES_DIR = path.join(DATA_DIR, 'memories');

// AI配置（服务器端）
const AI_CONFIG = {
    provider: 'openai', // 可改为 'claude' 或其他
    apiKey: process.env.OPENAI_API_KEY || 'your-api-key-here',
    model: 'gpt-3.5-turbo',
    baseURL: 'https://api.openai.com/v1',
    temperature: 0.8,
    maxTokens: 150
};

// ElevenLabs TTS配置
const ELEVENLABS_CONFIG = {
    apiKey: process.env.ELEVENLABS_API_KEY || 'your-elevenlabs-key-here',
    baseURL: 'https://api.elevenlabs.io/v1'
};

// 初始化数据目录
async function initDirectories() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.mkdir(USERS_DIR, { recursive: true });
        await fs.mkdir(MEMORIES_DIR, { recursive: true });
        console.log('📁 数据目录初始化完成');
    } catch (error) {
        console.error('❌ 创建数据目录失败:', error);
    }
}

// 用户管理
class UserManager {
    // 创建新用户（支持钱包绑定）
    static async createUser(userInfo = {}) {
        // 如果提供了钱包地址，使用钱包地址生成用户ID
        let userId;
        if (userInfo.walletAddress) {
            userId = `wallet_${userInfo.walletAddress}`;
        } else {
            userId = uuidv4();
        }
        
        const user = {
            id: userId,
            nickname: userInfo.nickname || `用户${userId.slice(-8)}`,
            avatar: userInfo.avatar || '👤',
            walletAddress: userInfo.walletAddress || null,
            createdAt: new Date().toISOString(),
            lastActive: new Date().toISOString(),
            totalChats: 0,
            favoriteCharacters: [],
            preferences: {
                language: 'zh-CN',
                chatStyle: 'casual'
            },
            ...userInfo
        };
        
        await fs.writeFile(
            path.join(USERS_DIR, `${userId}.json`),
            JSON.stringify(user, null, 2)
        );
        
        const displayName = userInfo.walletAddress ? 
            `${user.nickname} (${formatAddress(userInfo.walletAddress)})` : 
            `${user.nickname} (${userId.slice(-8)})`;
        
        console.log(`👤 新用户创建: ${displayName}`);
        return user;
    }
    
    // 获取用户信息
    static async getUser(userId) {
        try {
            const userData = await fs.readFile(
                path.join(USERS_DIR, `${userId}.json`),
                'utf8'
            );
            return JSON.parse(userData);
        } catch (error) {
            return null;
        }
    }
    
    // 更新用户信息
    static async updateUser(userId, updates) {
        const user = await this.getUser(userId);
        if (!user) return null;
        
        const updatedUser = {
            ...user,
            ...updates,
            lastActive: new Date().toISOString()
        };
        
        await fs.writeFile(
            path.join(USERS_DIR, `${userId}.json`),
            JSON.stringify(updatedUser, null, 2)
        );
        
        return updatedUser;
    }
    
    // 增加聊天计数
    static async incrementChatCount(userId) {
        const user = await this.getUser(userId);
        if (user) {
            user.totalChats += 1;
            await this.updateUser(userId, { totalChats: user.totalChats });
        }
    }
}

// 增强记忆管理系统 - 为1000用户优化
class MemoryManager {
    // 获取用户与特定角色的完整记忆（确保跨角色记忆隔离）
    static async getUserMemory(userId, characterId) {
        try {
            // 验证角色ID有效性，防止跨角色访问
            if (!this.isValidCharacterId(characterId)) {
                throw new Error(`Invalid character ID: ${characterId}`);
            }
            
            console.log('🧠 获取用户记忆:', { userId, characterId });
            
            // 优先使用Supabase
            if (supabaseUserManager.isAvailable()) {
                console.log('📊 使用Supabase获取记忆');
                const walletAddress = userId.replace('wallet_', '');
                const memoryKey = `${walletAddress}_${characterId}_memory`;
                
                const { data, error } = await supabaseUserManager.supabase
                    .from('user_memories')
                    .select('memory_data')
                    .eq('user_id', walletAddress)
                    .eq('character_id', characterId)
                    .single();
                    
                if (data && data.memory_data) {
                    console.log('✅ Supabase记忆数据已加载');
                    const memory = data.memory_data;
                    return this.ensureMemoryStructure(memory, userId, characterId);
                }
            }
            
            // Fallback到文件系统（开发环境）
            try {
                const memoryData = await fs.readFile(
                    path.join(MEMORIES_DIR, `${userId}_${characterId}.json`),
                    'utf8'
                );
                const memory = JSON.parse(memoryData);
                
                // 双重验证：确保内存数据与请求的角色ID匹配
                if (memory.characterId !== characterId) {
                    console.warn(`Memory character mismatch: expected ${characterId}, got ${memory.characterId}`);
                    return this.createNewMemoryStructure(userId, characterId);
                }
                
                return this.ensureMemoryStructure(memory, userId, characterId);
            } catch (fsError) {
                console.log('📁 文件系统记忆不存在，创建新记忆');
            }
            
            // 创建新记忆
            return this.createNewMemoryStructure(userId, characterId);
        } catch (error) {
            console.error('❌ 获取记忆失败:', error);
            // 创建新的完整记忆结构
            return this.createNewMemoryStructure(userId, characterId);
        }
    }
    
    // 创建新的记忆结构（带角色隔离验证）
    static createNewMemoryStructure(userId, characterId) {
        // 验证角色ID
        if (!this.isValidCharacterId(characterId)) {
            throw new Error(`Cannot create memory for invalid character ID: ${characterId}`);
        }
        
        return {
            userId,
            characterId,
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            memoryVersion: '2.0', // 用于标识支持角色隔离的版本
            
            // 🎯 用户画像（AI总结生成）
            userProfile: {
                name: null,
                nickname: null,
                age: null,
                personality: null,
                background: null,
                currentMood: 'neutral',
                secrets: [],
                goals: [],
                fears: [],
                lastProfileUpdate: null
            },
            
            // 💕 关系状态
            relationship: {
                level: 1,
                trust: 10,
                intimacy: 5,
                affection: 10,
                specialMoments: [],
                nicknames: [],
                relationshipMilestones: {
                    firstMeeting: new Date().toISOString(),
                    firstSecret: null,
                    deepConversation: null,
                    firstCompliment: null,
                    firstArgument: null
                },
                communicationStyle: 'formal' // formal -> casual -> intimate
            },
            
            // 📚 完整对话历史（1000用户可以保存更多）
            fullChatHistory: [],
            
            // 🏷️ 话题记忆索引
            topicMemories: {
                work: [],
                family: [],
                hobbies: [],
                relationships: [],
                dreams: [],
                problems: [],
                preferences: [],
                dislikes: []
            },
            
            // ⏰ 时间和行为模式
            temporalContext: {
                lastChatTime: null,
                chatFrequency: 0,
                preferredChatTimes: [],
                longestConversation: 0,
                averageResponseTime: 0,
                timeZone: 'Asia/Shanghai',
                dailyInteractions: {}
            },
            
            // 📈 统计数据
            statistics: {
                totalMessages: 0,
                totalCharacters: 0,
                averageMessageLength: 0,
                emotionalTone: {
                    positive: 0,
                    negative: 0,
                    neutral: 0
                },
                topicsDiscussed: {},
                memoryImportance: {}
            },
            
            // 🎭 角色特定记忆
            characterSpecific: {
                sharedExperiences: [],
                insideJokes: [],
                conflictHistory: [],
                gifts: [],
                promises: [],
                futureePlans: []
            }
        };
    }
    
    // 验证角色ID有效性
    static isValidCharacterId(characterId) {
        const validCharacters = [
            'alice', 'ash', 'bobo', 'elinyaa', 'fliza', 'imeris', 'kyoko', 'lena',
            'lilium', 'maple', 'miru', 'miumiu', 'neco', 'nekona', 'notia', 'ququ',
            'rainy', 'rindo', 'sikirei', 'vivi', 'wolf', 'wolferia', 'yawl', 'yuu-yii', 'zwei'
        ];
        return validCharacters.includes(characterId.toLowerCase());
    }
    
    // 确保记忆结构完整（兼容旧数据并验证角色隔离）
    static ensureMemoryStructure(memory, userId, characterId) {
        // 验证角色ID匹配
        if (memory.characterId && memory.characterId !== characterId) {
            console.error(`Character ID mismatch in memory: ${memory.characterId} vs ${characterId}`);
            return this.createNewMemoryStructure(userId, characterId);
        }
        
        const newStructure = this.createNewMemoryStructure(userId, characterId);
        
        // 深度合并现有数据
        function deepMerge(target, source) {
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    target[key] = target[key] || {};
                    deepMerge(target[key], source[key]);
                } else if (source[key] !== undefined && source[key] !== null) {
                    target[key] = source[key];
                }
            }
            return target;
        }
        
        const mergedMemory = deepMerge(newStructure, memory);
        
        // 强制确保角色ID正确
        mergedMemory.characterId = characterId;
        mergedMemory.userId = userId;
        
        return mergedMemory;
    }
    
    // 保存用户记忆（强制角色隔离验证）
    static async saveUserMemory(userId, characterId, memoryData) {
        // 验证角色ID有效性
        if (!this.isValidCharacterId(characterId)) {
            throw new Error(`Cannot save memory for invalid character ID: ${characterId}`);
        }
        
        // 强制验证内存数据的角色ID匹配
        if (memoryData.characterId && memoryData.characterId !== characterId) {
            throw new Error(`Memory character ID mismatch: ${memoryData.characterId} vs ${characterId}`);
        }
        
        const memory = {
            ...memoryData,
            userId,
            characterId, // 强制设置正确的角色ID
            lastUpdated: new Date().toISOString(),
            memoryVersion: '2.0'
        };
        
        // 转换Map为Object用于JSON序列化
        if (memory.keyMemories instanceof Map) {
            memory.keyMemories = Object.fromEntries(memory.keyMemories);
        }
        
        const filePath = path.join(MEMORIES_DIR, `${userId}_${characterId}.json`);
        
        // 保存前再次验证文件路径不包含路径遍历攻击
        if (filePath.includes('..') || !filePath.startsWith(MEMORIES_DIR)) {
            throw new Error(`Invalid memory file path: ${filePath}`);
        }
        
        // 优先使用Supabase
        if (supabaseUserManager.isAvailable()) {
            console.log('📊 使用Supabase保存记忆');
            const walletAddress = userId.replace('wallet_', '');
            
            const { error } = await supabaseUserManager.supabase
                .from('user_memories')
                .upsert({
                    user_id: walletAddress,
                    character_id: characterId,
                    memory_data: memory,
                    updated_at: new Date().toISOString()
                });
                
            if (!error) {
                console.log(`💾 Supabase记忆保存成功: ${userId} - ${characterId}`);
                return;
            } else {
                console.error('❌ Supabase保存失败:', error);
            }
        }
        
        // Fallback到文件系统（开发环境）
        try {
            await fs.writeFile(filePath, JSON.stringify(memory, null, 2));
            console.log(`💾 文件系统记忆保存成功: ${userId} - ${characterId}`);
        } catch (fsError) {
            console.log('⚠️ 文件系统不可用（Vercel环境），记忆仅在当前会话有效');
        }
    }
    
    // 添加聊天记录（增强版）
    static async addChatMessage(userId, characterId, message) {
        const memory = await this.getUserMemory(userId, characterId);
        
        // 添加到完整聊天历史（1000用户规模可以保存更多）
        memory.fullChatHistory.push({
            ...message,
            messageLength: message.content.length,
            wordsCount: message.content.split(/\s+/).length
        });
        
        // 保持最近200条聊天记录（比原来多）
        if (memory.fullChatHistory.length > 200) {
            memory.fullChatHistory = memory.fullChatHistory.slice(-200);
        }
        
        // 更新统计数据
        memory.statistics.totalMessages += 1;
        memory.statistics.totalCharacters += message.content.length;
        memory.statistics.averageMessageLength = 
            memory.statistics.totalCharacters / memory.statistics.totalMessages;
        
        // 更新时间上下文
        const now = new Date();
        memory.temporalContext.lastChatTime = now.toISOString();
        memory.temporalContext.chatFrequency += 1;
        
        const hour = now.getHours();
        const timeSlot = `${Math.floor(hour / 4) * 4}-${Math.floor(hour / 4) * 4 + 4}`;
        memory.temporalContext.preferredChatTimes.push(timeSlot);
        
        // 统计每日互动
        const dateKey = now.toISOString().split('T')[0];
        memory.temporalContext.dailyInteractions[dateKey] = 
            (memory.temporalContext.dailyInteractions[dateKey] || 0) + 1;
        
        // 更新关系状态
        this.updateRelationshipMetrics(memory, message);
        
        await this.saveUserMemory(userId, characterId, memory);
        return memory;
    }
    
    // 更新关系指标
    static updateRelationshipMetrics(memory, message) {
        // 基于消息长度和情感更新关系
        const messageLength = message.content.length;
        const isLongMessage = messageLength > 50;
        
        // 关系等级基于互动次数和质量
        const baseLevel = Math.min(100, Math.floor(memory.statistics.totalMessages / 5) + 1);
        memory.relationship.level = baseLevel;
        
        // 信任度基于持续互动和消息深度
        if (isLongMessage) {
            memory.relationship.trust = Math.min(100, memory.relationship.trust + 0.5);
        }
        memory.relationship.trust = Math.min(100, memory.relationship.trust + 0.1);
        
        // 亲密度基于个人信息分享
        if (this.containsPersonalInfo(message.content)) {
            memory.relationship.intimacy = Math.min(100, memory.relationship.intimacy + 1);
        }
        
        // 情感值基于积极互动
        if (message.emotion === 'happy' || message.emotion === 'excited') {
            memory.relationship.affection = Math.min(100, memory.relationship.affection + 0.3);
        }
        
        // 更新沟通风格
        if (memory.relationship.intimacy > 30 && memory.relationship.communicationStyle === 'formal') {
            memory.relationship.communicationStyle = 'casual';
        } else if (memory.relationship.intimacy > 70 && memory.relationship.communicationStyle === 'casual') {
            memory.relationship.communicationStyle = 'intimate';
        }
    }
    
    // 检测个人信息分享
    static containsPersonalInfo(message) {
        const personalKeywords = [
            '我的名字', '我叫', '我是', '我的工作', '我的家', '我的父母',
            '我喜欢', '我讨厌', '我的梦想', '我的秘密', '我害怕',
            '我希望', '我想要', '我觉得', '我认为'
        ];
        
        return personalKeywords.some(keyword => 
            message.toLowerCase().includes(keyword)
        );
    }
    
    // 智能提取和保存重要信息（增强版）
    static async extractKeyInfo(userId, characterId, message, isUser) {
        if (!isUser) return; // 只从用户消息中提取信息
        
        const memory = await this.getUserMemory(userId, characterId);
        
        // 1. 基础信息提取（模式匹配）
        await this.extractBasicInfo(memory, message);
        
        // 2. 话题分类
        await this.categorizeTopics(memory, message);
        
        // 3. 情感分析和重要性评估
        await this.analyzeEmotionalImportance(memory, message);
        
        // 4. 特殊事件检测
        await this.detectSpecialEvents(memory, message);
        
        await this.saveUserMemory(userId, characterId, memory);
    }
    
    // 提取基础信息
    static async extractBasicInfo(memory, message) {
        const patterns = [
            // 姓名
            { 
                pattern: /我(叫|是|名字是)(.+?)(?=[，。！？\s]|$)/gi, 
                field: 'name',
                category: 'userProfile' 
            },
            // 年龄
            { 
                pattern: /我(今年|已经)?(\d+)(岁|周岁)/gi, 
                field: 'age',
                category: 'userProfile' 
            },
            // 工作
            { 
                pattern: /我(是|在|做)(.+?)(工作|上班|职业)/gi, 
                field: 'work',
                category: 'userProfile' 
            },
            // 居住地
            { 
                pattern: /我(住在|在|来自)(.+?)(市|省|国|地区)/gi, 
                field: 'location',
                category: 'userProfile' 
            },
            // 喜好
            { 
                pattern: /我(喜欢|爱|热爱)(.+?)(?=[，。！？\s]|$)/gi, 
                field: 'preferences',
                category: 'topicMemories' 
            },
            // 不喜欢
            { 
                pattern: /我(讨厌|不喜欢|恨)(.+?)(?=[，。！？\s]|$)/gi, 
                field: 'dislikes',
                category: 'topicMemories' 
            },
            // 梦想/目标
            { 
                pattern: /我(希望|想要|梦想|目标是)(.+?)(?=[，。！？\s]|$)/gi, 
                field: 'goals',
                category: 'userProfile' 
            },
            // 恐惧/担心
            { 
                pattern: /我(害怕|担心|怕)(.+?)(?=[，。！？\s]|$)/gi, 
                field: 'fears',
                category: 'userProfile' 
            },
        ];
        
        patterns.forEach(({ pattern, field, category }) => {
            let matches;
            while ((matches = pattern.exec(message)) !== null) {
                const value = matches[2]?.trim();
                if (value) {
                    if (category === 'userProfile') {
                        if (field === 'preferences' || field === 'goals' || field === 'fears') {
                            if (!memory.userProfile[field]) memory.userProfile[field] = [];
                            if (!memory.userProfile[field].includes(value)) {
                                memory.userProfile[field].push(value);
                            }
                        } else {
                            memory.userProfile[field] = value;
                        }
                    } else if (category === 'topicMemories') {
                        if (!memory.topicMemories[field]) memory.topicMemories[field] = [];
                        if (!memory.topicMemories[field].includes(value)) {
                            memory.topicMemories[field].push(value);
                        }
                    }
                }
            }
        });
        
        // 更新最后更新时间
        memory.userProfile.lastProfileUpdate = new Date().toISOString();
    }
    
    // 话题分类
    static async categorizeTopics(memory, message) {
        const topicKeywords = {
            work: ['工作', '上班', '老板', '同事', '公司', '职业', '事业', '项目', '会议'],
            family: ['父母', '妈妈', '爸爸', '家人', '兄弟', '姐妹', '家', '家庭'],
            hobbies: ['游戏', '电影', '音乐', '书', '运动', '旅行', '摄影', '画画'],
            relationships: ['朋友', '恋人', '男朋友', '女朋友', '暗恋', '喜欢', '爱情'],
            problems: ['问题', '困难', '烦恼', '压力', '焦虑', '抑郁', '难过', '痛苦'],
            dreams: ['梦想', '希望', '愿望', '目标', '理想', '未来', '计划']
        };
        
        Object.entries(topicKeywords).forEach(([topic, keywords]) => {
            keywords.forEach(keyword => {
                if (message.includes(keyword)) {
                    if (!memory.topicMemories[topic]) memory.topicMemories[topic] = [];
                    
                    // 提取包含关键词的句子作为记忆
                    const sentences = message.split(/[。！？.!?]/);
                    sentences.forEach(sentence => {
                        if (sentence.includes(keyword) && sentence.length > 5) {
                            const cleanSentence = sentence.trim();
                            if (!memory.topicMemories[topic].includes(cleanSentence)) {
                                memory.topicMemories[topic].push(cleanSentence);
                            }
                        }
                    });
                }
            });
        });
    }
    
    // 分析情感重要性
    static async analyzeEmotionalImportance(memory, message) {
        // 情感强度关键词
        const emotionalIntensity = {
            high: ['非常', '特别', '极其', '超级', '真的', '特别', '完全', '绝对'],
            medium: ['很', '比较', '还是', '有点', '稍微'],
            low: ['一般', '普通', '还行', '马马虎虎']
        };
        
        // 重要事件关键词
        const importantEvents = [
            '第一次', '最后一次', '永远不会忘记', '印象深刻', '改变了我',
            '重要的', '特殊的', '难忘的', '珍贵的', '意义重大'
        ];
        
        let importance = 1; // 默认重要性
        
        // 检测情感强度
        Object.entries(emotionalIntensity).forEach(([level, keywords]) => {
            keywords.forEach(keyword => {
                if (message.includes(keyword)) {
                    switch(level) {
                        case 'high': importance += 2; break;
                        case 'medium': importance += 1; break;
                        case 'low': importance -= 0.5; break;
                    }
                }
            });
        });
        
        // 检测重要事件
        importantEvents.forEach(eventKeyword => {
            if (message.includes(eventKeyword)) {
                importance += 3;
                
                // 添加到特殊时刻
                memory.relationship.specialMoments.push({
                    content: message,
                    timestamp: new Date().toISOString(),
                    importance: importance,
                    type: 'important_sharing'
                });
            }
        });
        
        // 存储重要性评分
        const messageId = Date.now().toString();
        memory.statistics.memoryImportance[messageId] = Math.min(10, Math.max(1, importance));
    }
    
    // 检测特殊事件
    static async detectSpecialEvents(memory, message) {
        const specialEventPatterns = [
            {
                pattern: /(秘密|私密|不能告诉|只有你)/i,
                type: 'secret_sharing',
                milestone: 'firstSecret'
            },
            {
                pattern: /(你真|你很|你好)(.+?)(好|棒|厉害|可爱|温柔)/i,
                type: 'compliment',
                milestone: 'firstCompliment'
            },
            {
                pattern: /(我们|咱们)(.+?)(一起|共同|以后)/i,
                type: 'future_planning',
                milestone: 'futurePlanning'
            },
            {
                pattern: /(谢谢|感谢|感激)(.+?)(陪伴|聊天|帮助|支持)/i,
                type: 'gratitude',
                milestone: 'appreciation'
            }
        ];
        
        specialEventPatterns.forEach(({ pattern, type, milestone }) => {
            if (pattern.test(message)) {
                // 记录里程碑
                if (!memory.relationship.relationshipMilestones[milestone]) {
                    memory.relationship.relationshipMilestones[milestone] = new Date().toISOString();
                }
                
                // 添加到角色特定记忆
                if (type === 'secret_sharing') {
                    memory.characterSpecific.sharedExperiences.push({
                        type: 'secret',
                        content: message,
                        timestamp: new Date().toISOString()
                    });
                }
                
                // 提升关系指标
                memory.relationship.intimacy = Math.min(100, memory.relationship.intimacy + 2);
                memory.relationship.trust = Math.min(100, memory.relationship.trust + 1);
            }
        });
    }
}

// AI聊天代理
class AIProxy {
    static async generateResponse(userId, characterId, message, context = {}) {
        try {
            console.log('🤖 开始生成AI回复:', { userId, characterId, message });
            
            // 🚨 临时绕过记忆系统，直接生成回复
            const simplePrompt = `你是${context.character?.name || 'Alice'}，一个活泼可爱的AI女友。

用户说: ${message}

请以${context.character?.name || 'Alice'}的身份回复，要求：
1. 回复要自然友好，20-50字
2. 可以使用emoji
3. 体现活泼可爱的性格

直接回复，不需要JSON格式。`;

            console.log('📝 使用简化提示词:', simplePrompt);
            
            // 直接调用OpenAI，返回简单格式
            const aiContent = await this.callSimpleOpenAI(simplePrompt);
            
            const response = {
                content: aiContent,
                emotion: 'happy'
            };
            
            console.log('✅ AI回复生成成功:', response);
            return response;
            
        } catch (error) {
            console.error('❌ AI回复生成失败:', error.message);
            console.error('❌ 错误详情:', error.stack);
            console.error('❌ API配置:', {
                hasApiKey: !!AI_CONFIG.apiKey,
                keyLength: AI_CONFIG.apiKey ? AI_CONFIG.apiKey.length : 0,
                model: AI_CONFIG.model,
                baseURL: AI_CONFIG.baseURL
            });
            return {
                content: '抱歉，我现在有点累，可以稍后再聊吗？',
                emotion: 'apologetic'
            };
        }
    }
    
    // 构建增强AI提示词（利用丰富的记忆数据）
    static buildPrompt(message, context, memory) {
        const character = context.character || {};
        const recentChats = memory.fullChatHistory.slice(-8); // 最近4轮对话
        
        // 构建用户画像描述
        const userProfileDesc = this.buildUserProfileDescription(memory.userProfile);
        
        // 构建关系状态描述
        const relationshipDesc = this.buildRelationshipDescription(memory.relationship);
        
        // 选择相关话题记忆
        const relevantMemories = this.selectRelevantMemories(message, memory.topicMemories);
        
        // 构建时间上下文
        const timeContext = this.buildTimeContext(memory.temporalContext);
        
        let prompt = `你是${character.name}，${character.personality || '一个温柔可爱的AI女友'}。

【用户档案】
${userProfileDesc}

【你们的关系】
${relationshipDesc}

【相关记忆】
${relevantMemories}

【聊天背景】
${timeContext}

【最近对话】
${recentChats.map(chat => `${chat.sender === 'user' ? '用户' : character.name}: ${chat.content}`).join('\\n')}

【特殊提醒】
- 你们已经是${this.getRelationshipStage(memory.relationship)}的关系
- 根据关系亲密度使用合适的称呼和语气
- 如果用户分享了重要信息，要表现出记住和在乎
- 沟通风格：${memory.relationship.communicationStyle}

当前时间: ${new Date().toLocaleString('zh-CN')}

用户刚刚说: ${message}

请以${character.name}的身份自然回复，要求：
1. 体现对用户的了解程度
2. 根据关系等级调整亲密度和称呼
3. 如果用户提到了之前聊过的话题，要体现出记忆
4. 回复要符合${character.name}的性格特点
5. 长度控制在30-80字之间
6. 可以适当使用emoji表情

回复JSON格式：
{
  "content": "回复内容",
  "emotion": "情感类型(happy/sad/excited/shy/neutral/caring/playful等)",
  "expression": "表情动作(smile/blush/wink/thinking/nod/surprised等)"
}`;

        return prompt;
    }
    
    // 构建用户画像描述
    static buildUserProfileDescription(userProfile) {
        const parts = [];
        
        if (userProfile.name) {
            parts.push(`用户名叫${userProfile.name}`);
        }
        
        if (userProfile.age) {
            parts.push(`${userProfile.age}岁`);
        }
        
        if (userProfile.work) {
            parts.push(`职业是${userProfile.work}`);
        }
        
        if (userProfile.personality) {
            parts.push(`性格：${userProfile.personality}`);
        }
        
        if (userProfile.preferences && userProfile.preferences.length > 0) {
            parts.push(`喜欢：${userProfile.preferences.slice(-3).join('、')}`);
        }
        
        if (userProfile.goals && userProfile.goals.length > 0) {
            parts.push(`目标：${userProfile.goals.slice(-2).join('、')}`);
        }
        
        if (userProfile.currentMood !== 'neutral') {
            parts.push(`当前心情：${userProfile.currentMood}`);
        }
        
        return parts.length > 0 ? parts.join('，') : '用户信息较少，需要更多了解';
    }
    
    // 构建关系状态描述
    static buildRelationshipDescription(relationship) {
        const parts = [];
        
        parts.push(`关系等级：${relationship.level}/100`);
        parts.push(`信任度：${Math.round(relationship.trust)}/100`);
        parts.push(`亲密度：${Math.round(relationship.intimacy)}/100`);
        
        if (relationship.nicknames.length > 0) {
            parts.push(`你们的昵称：${relationship.nicknames.join('、')}`);
        }
        
        if (relationship.specialMoments.length > 0) {
            const recentMoment = relationship.specialMoments[relationship.specialMoments.length - 1];
            parts.push(`最近的特殊时刻：${recentMoment.content.slice(0, 30)}...`);
        }
        
        const milestones = Object.entries(relationship.relationshipMilestones)
            .filter(([key, value]) => value !== null)
            .map(([key, value]) => key);
        
        if (milestones.length > 0) {
            parts.push(`重要里程碑：${milestones.join('、')}`);
        }
        
        return parts.join('\\n');
    }
    
    // 选择相关记忆
    static selectRelevantMemories(currentMessage, topicMemories) {
        const relevantMemories = [];
        
        // 检查当前消息涉及的话题
        Object.entries(topicMemories).forEach(([topic, memories]) => {
            if (memories.length > 0) {
                // 简单的关键词匹配
                const topicKeywords = {
                    work: ['工作', '上班', '公司'],
                    family: ['家', '父母', '家人'],
                    hobbies: ['喜欢', '游戏', '音乐'],
                    relationships: ['朋友', '恋人'],
                    problems: ['问题', '困难', '压力'],
                    dreams: ['希望', '梦想', '未来']
                };
                
                if (topicKeywords[topic]) {
                    const isRelevant = topicKeywords[topic].some(keyword => 
                        currentMessage.includes(keyword)
                    );
                    
                    if (isRelevant) {
                        relevantMemories.push(`${topic}相关：${memories.slice(-2).join('；')}`);
                    }
                }
            }
        });
        
        return relevantMemories.length > 0 ? 
            relevantMemories.join('\\n') : 
            '暂无特别相关的历史记忆';
    }
    
    // 构建时间上下文
    static buildTimeContext(temporalContext) {
        const parts = [];
        
        if (temporalContext.lastChatTime) {
            const lastChat = new Date(temporalContext.lastChatTime);
            const now = new Date();
            const hoursSince = Math.floor((now - lastChat) / (1000 * 60 * 60));
            
            if (hoursSince < 1) {
                parts.push('刚刚还在聊天');
            } else if (hoursSince < 24) {
                parts.push(`${hoursSince}小时前聊过`);
            } else {
                parts.push('已经很久没聊了');
            }
        }
        
        parts.push(`聊天频率：${temporalContext.chatFrequency}次`);
        
        return parts.join('，');
    }
    
    // 获取关系阶段描述
    static getRelationshipStage(relationship) {
        if (relationship.intimacy < 20) return '初识朋友';
        if (relationship.intimacy < 40) return '普通朋友';
        if (relationship.intimacy < 60) return '好朋友';
        if (relationship.intimacy < 80) return '亲密朋友';
        return '非常亲密的朋友';
    }
    
    // 调用AI API
    static async callAIAPI(prompt) {
        if (AI_CONFIG.provider === 'openai') {
            return await this.callOpenAI(prompt);
        } else if (AI_CONFIG.provider === 'claude') {
            return await this.callClaude(prompt);
        } else {
            // 本地fallback
            return this.generateLocalResponse(prompt);
        }
    }
    
    // 简化的OpenAI API调用 - 直接返回文本
    static async callSimpleOpenAI(prompt) {
        console.log('🔄 调用OpenAI API (简化版)...');
        console.log('🔑 API Key状态:', AI_CONFIG.apiKey ? `有效 (${AI_CONFIG.apiKey.length}字符)` : '缺失');
        
        const response = await fetch(`${AI_CONFIG.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: AI_CONFIG.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: AI_CONFIG.temperature,
                max_tokens: 100
            })
        });
        
        console.log('📡 API响应状态:', response.status);
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('❌ OpenAI API错误:', errorData);
            throw new Error(`OpenAI API错误: ${response.status} - ${errorData.error?.message || '未知错误'}`);
        }
        
        const data = await response.json();
        console.log('📦 API响应数据:', JSON.stringify(data, null, 2));
        
        if (data.choices && data.choices[0]) {
            const content = data.choices[0].message.content.trim();
            console.log('✅ OpenAI回复:', content);
            return content;
        }
        
        throw new Error('OpenAI API响应格式错误');
    }

    // OpenAI API调用 (保留原版本)
    static async callOpenAI(prompt) {
        console.log('🔄 调用OpenAI API...');
        console.log('🔑 API Key长度:', AI_CONFIG.apiKey ? AI_CONFIG.apiKey.length : 'undefined');
        
        // 简化的提示词进行测试
        const simplePrompt = `你是Alice，一个活泼可爱的AI女友。用户对你说：${prompt.includes('用户说:') ? prompt.split('用户说:')[1] : prompt}
        
请用JSON格式回复：{"content": "你的简短回复", "emotion": "happy"}`;
        
        const response = await fetch(`${AI_CONFIG.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: AI_CONFIG.model,
                messages: [{ role: 'user', content: simplePrompt }],
                temperature: AI_CONFIG.temperature,
                max_tokens: AI_CONFIG.maxTokens
            })
        });
        
        console.log('📡 API响应状态:', response.status);
        
        const data = await response.json();
        console.log('📦 API响应数据:', JSON.stringify(data, null, 2));
        
        if (!response.ok) {
            throw new Error(`OpenAI API错误: ${response.status} - ${data.error?.message || '未知错误'}`);
        }
        
        if (data.choices && data.choices[0]) {
            const content = data.choices[0].message.content;
            console.log('🎯 OpenAI原始回复:', content);
            
            try {
                const result = JSON.parse(content);
                console.log('✅ JSON解析成功:', result);
                return result;
            } catch (e) {
                // 如果不是JSON格式，返回原始内容
                return {
                    content: data.choices[0].message.content,
                    emotion: 'neutral',
                    expression: 'smile'
                };
            }
        }
        
        throw new Error('OpenAI API 响应格式错误');
    }
    
    // Claude API调用（示例）
    static async callClaude(prompt) {
        // Claude API调用逻辑
        // 这里需要根据Claude的实际API格式实现
        throw new Error('Claude API 集成待实现');
    }
    
    // 本地回复生成
    static generateLocalResponse(prompt) {
        const responses = [
            { content: '谢谢你和我聊天～', emotion: 'happy', expression: 'smile' },
            { content: '我很开心能认识你！', emotion: 'excited', expression: 'wink' },
            { content: '你说得很有趣呢～', emotion: 'curious', expression: 'thinking' },
            { content: '嗯嗯，我明白了！', emotion: 'understanding', expression: 'nod' }
        ];
        
        return responses[Math.floor(Math.random() * responses.length)];
    }
}

// 工具函数

// 验证Solana钱包地址格式
function isValidSolanaAddress(address) {
    // Solana地址是base58编码，长度通常为32-44字符
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(address);
}

// 格式化钱包地址显示
function formatAddress(address) {
    if (!address) return '';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

// API路由

// ======================
// 用户资料管理API（Supabase集成）
// ======================

// 创建用户资料
app.post('/api/profiles', async (req, res) => {
    try {
        const { walletAddress, ...profileData } = req.body;
        
        if (!walletAddress) {
            return res.status(400).json({
                success: false,
                message: '钱包地址是必需的'
            });
        }

        // 首先检查用户是否已存在
        let existingProfile = null;
        if (supabaseUserManager.isAvailable()) {
            existingProfile = await supabaseUserManager.getUserProfile(walletAddress);
        } else {
            // 文件系统回退
            try {
                const userFile = path.join(USERS_DIR, `wallet_${walletAddress}.json`);
                const userData = await fs.readFile(userFile, 'utf8');
                existingProfile = JSON.parse(userData);
            } catch (error) {
                // 用户不存在，这是正常的
            }
        }

        if (existingProfile) {
            return res.status(409).json({
                success: false,
                message: '用户资料已存在',
                profile: existingProfile
            });
        }

        // 准备资料数据
        const fullProfileData = {
            wallet_address: walletAddress,
            nickname: profileData.nickname,
            age: profileData.age ? parseInt(profileData.age) : null,
            gender: profileData.gender,
            birthday: profileData.birthday || null,
            location: profileData.location,
            occupation: profileData.occupation,
            interests: profileData.interests,
            bio: profileData.bio
        };

        let savedProfile = null;

        // 保存到Supabase（优先）
        if (supabaseUserManager.isAvailable()) {
            savedProfile = await supabaseUserManager.createUserProfile(fullProfileData);
            
            if (!savedProfile) {
                return res.status(500).json({
                    success: false,
                    message: 'Supabase保存失败'
                });
            }
        } else {
            // 文件系统回退
            console.log('📁 Supabase不可用，使用文件系统存储');
            const userId = `wallet_${walletAddress}`;
            const userFile = path.join(USERS_DIR, `${userId}.json`);
            const fileData = {
                ...fullProfileData,
                id: userId,  // 使用wallet_前缀的ID，保持与UserManager一致
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                createdAt: new Date().toISOString(),  // UserManager兼容字段
                lastActive: new Date().toISOString(),  // UserManager兼容字段
                totalChats: 0,  // UserManager兼容字段
                favoriteCharacters: []  // UserManager兼容字段
            };
            
            await fs.writeFile(userFile, JSON.stringify(fileData, null, 2));
            savedProfile = fileData;
        }

        console.log('✅ 用户资料已创建:', formatAddress(walletAddress));

        res.json({
            success: true,
            message: '用户资料创建成功',
            profile: savedProfile
        });

    } catch (error) {
        console.error('❌ 创建用户资料失败:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message
        });
    }
});

// 获取用户资料
app.get('/api/profiles/:walletAddress', async (req, res) => {
    try {
        const { walletAddress } = req.params;

        if (!walletAddress) {
            return res.status(400).json({
                success: false,
                message: '钱包地址是必需的'
            });
        }

        let profile = null;

        // 从Supabase获取（优先）
        if (supabaseUserManager.isAvailable()) {
            profile = await supabaseUserManager.getUserProfile(walletAddress);
        } else {
            // 文件系统回退
            try {
                const userFile = path.join(USERS_DIR, `wallet_${walletAddress}.json`);
                const userData = await fs.readFile(userFile, 'utf8');
                profile = JSON.parse(userData);
            } catch (error) {
                // 用户不存在
            }
        }

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: '用户资料不存在'
            });
        }

        res.json({
            success: true,
            profile: profile
        });

    } catch (error) {
        console.error('❌ 获取用户资料失败:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message
        });
    }
});

// 更新用户资料
app.put('/api/profiles/:walletAddress', async (req, res) => {
    try {
        const { walletAddress } = req.params;
        const updateData = req.body;

        if (!walletAddress) {
            return res.status(400).json({
                success: false,
                message: '钱包地址是必需的'
            });
        }

        // 准备更新数据
        const updateProfileData = {
            nickname: updateData.nickname,
            age: updateData.age ? parseInt(updateData.age) : null,
            gender: updateData.gender,
            birthday: updateData.birthday || null,
            location: updateData.location,
            occupation: updateData.occupation,
            interests: updateData.interests,
            bio: updateData.bio
        };

        // 清除undefined值
        Object.keys(updateProfileData).forEach(key => {
            if (updateProfileData[key] === undefined) {
                delete updateProfileData[key];
            }
        });

        let updatedProfile = null;

        // 更新到Supabase（优先）
        if (supabaseUserManager.isAvailable()) {
            updatedProfile = await supabaseUserManager.updateUserProfile(walletAddress, updateProfileData);
            
            if (!updatedProfile) {
                return res.status(404).json({
                    success: false,
                    message: '用户资料不存在或更新失败'
                });
            }
        } else {
            // 文件系统回退
            const userFile = path.join(USERS_DIR, `wallet_${walletAddress}.json`);
            try {
                const userData = await fs.readFile(userFile, 'utf8');
                const existingData = JSON.parse(userData);
                
                const updatedData = {
                    ...existingData,
                    ...updateProfileData,
                    updated_at: new Date().toISOString()
                };
                
                await fs.writeFile(userFile, JSON.stringify(updatedData, null, 2));
                updatedProfile = updatedData;
            } catch (error) {
                return res.status(404).json({
                    success: false,
                    message: '用户资料不存在'
                });
            }
        }

        console.log('✅ 用户资料已更新:', formatAddress(walletAddress));

        res.json({
            success: true,
            message: '用户资料更新成功',
            profile: updatedProfile
        });

    } catch (error) {
        console.error('❌ 更新用户资料失败:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message
        });
    }
});

// 删除用户资料
app.delete('/api/profiles/:walletAddress', async (req, res) => {
    try {
        const { walletAddress } = req.params;

        if (!walletAddress) {
            return res.status(400).json({
                success: false,
                message: '钱包地址是必需的'
            });
        }

        let deleted = false;

        // 从Supabase删除（优先）
        if (supabaseUserManager.isAvailable()) {
            deleted = await supabaseUserManager.deleteUserProfile(walletAddress);
        } else {
            // 文件系统回退
            try {
                const userFile = path.join(USERS_DIR, `wallet_${walletAddress}.json`);
                await fs.unlink(userFile);
                deleted = true;
            } catch (error) {
                deleted = false;
            }
        }

        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: '用户资料不存在或删除失败'
            });
        }

        console.log('🗑️ 用户资料已删除:', formatAddress(walletAddress));

        res.json({
            success: true,
            message: '用户资料删除成功'
        });

    } catch (error) {
        console.error('❌ 删除用户资料失败:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message
        });
    }
});

// 获取所有用户资料（管理功能）
app.get('/api/profiles', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        let profiles = [];

        // 从Supabase获取（优先）
        if (supabaseUserManager.isAvailable()) {
            profiles = await supabaseUserManager.getAllUserProfiles(limit);
        } else {
            // 文件系统回退
            try {
                const files = await fs.readdir(USERS_DIR);
                const userFiles = files.filter(file => file.startsWith('wallet_') && file.endsWith('.json'));
                
                for (const file of userFiles.slice(0, limit)) {
                    try {
                        const userData = await fs.readFile(path.join(USERS_DIR, file), 'utf8');
                        profiles.push(JSON.parse(userData));
                    } catch (error) {
                        console.warn(`⚠️ 读取用户文件失败: ${file}`);
                    }
                }
            } catch (error) {
                console.error('❌ 读取用户目录失败:', error);
            }
        }

        res.json({
            success: true,
            count: profiles.length,
            profiles: profiles
        });

    } catch (error) {
        console.error('❌ 获取所有用户资料失败:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message
        });
    }
});

// ======================
// 原有API路由
// ======================

// Solana钱包认证/绑定
app.post('/api/user/auth', async (req, res) => {
    try {
        const { walletAddress } = req.body;
        
        if (!walletAddress) {
            return res.status(400).json({ 
                success: false, 
                error: '钱包地址不能为空' 
            });
        }
        
        // 验证Solana钱包地址格式
        if (!isValidSolanaAddress(walletAddress)) {
            return res.status(400).json({ 
                success: false, 
                error: '无效的Solana钱包地址' 
            });
        }
        
        // 使用钱包地址作为用户ID
        const userId = `wallet_${walletAddress}`;
        
        let user;
        // 尝试获取现有用户
        user = await UserManager.getUser(userId);
        
        if (user) {
            // 更新最后活跃时间
            await UserManager.updateUser(userId, {
                lastActive: new Date().toISOString(),
                walletAddress
            });
            console.log(`🔐 用户重新连接: ${formatAddress(walletAddress)}`);
        } else {
            // 创建新用户
            user = await UserManager.createUser({
                walletAddress,
                nickname: `用户${walletAddress.slice(-8)}`,
                avatar: '🦊'
            });
            console.log(`🎉 新用户注册: ${formatAddress(walletAddress)}`);
        }
        
        res.json({ success: true, user, walletAddress });
        
    } catch (error) {
        console.error('钱包认证失败:', error);
        res.status(500).json({ 
            success: false, 
            error: '钱包认证失败' 
        });
    }
});

// 发送聊天消息（带角色隔离验证和速率限制）
app.post('/api/chat/:characterId', chatLimiter, async (req, res) => {
    console.log('📥 收到聊天请求:', { 
        characterId: req.params.characterId, 
        userId: req.body.userId,
        hasMessage: !!req.body.message 
    });
    
    try {
        const { characterId } = req.params;
        const { userId, message, character } = req.body;
        
        if (!userId || !message) {
            console.error('❌ 缺少必要参数:', { userId, hasMessage: !!message });
            return res.status(400).json({ 
                success: false, 
                error: '缺少必要参数' 
            });
        }
        
        // 验证角色ID有效性（角色隔离第一道防线）
        if (!MemoryManager.isValidCharacterId(characterId)) {
            console.error('❌ 无效的角色ID:', characterId);
            return res.status(400).json({ 
                success: false, 
                error: '无效的角色ID' 
            });
        }
        
        // 优先使用Supabase，回退到文件系统或内存
        let user = null;
        console.log('🔍 查找用户:', userId);
        
        // 尝试从Supabase获取用户
        if (supabaseUserManager.isAvailable()) {
            console.log('📊 使用Supabase查找用户');
            const walletAddress = userId.replace('wallet_', '');
            user = await supabaseUserManager.getUserProfile(walletAddress);
            
            if (!user) {
                console.log('👤 Supabase中用户不存在，创建新用户');
                // 在Supabase中创建用户
                const profileData = {
                    walletAddress,
                    nickname: `用户${walletAddress.slice(-8)}`,
                    avatar: '🦊',
                    createdAt: new Date().toISOString()
                };
                user = await supabaseUserManager.createUserProfile(profileData);
                console.log('✅ Supabase用户创建成功');
            }
        } else if (!process.env.VERCEL) {
            // 本地环境使用文件系统
            console.log('📁 使用文件系统查找用户');
            user = await UserManager.getUser(userId);
            if (!user) {
                console.log('👤 文件系统中用户不存在，创建新用户');
                const walletAddress = userId.replace('wallet_', '');
                user = await UserManager.createUser({
                    walletAddress,
                    nickname: `用户${walletAddress.slice(-8)}`,
                    avatar: '🦊'
                });
                console.log('✅ 文件系统用户创建成功');
            }
        } else {
            // Vercel环境且Supabase不可用，使用内存用户
            console.log('⚠️ Vercel环境且Supabase不可用，使用临时用户');
            user = {
                id: userId,
                nickname: `用户${userId.slice(-8)}`,
                avatar: '🦊',
                walletAddress: userId.replace('wallet_', '')
            };
        }
        
        // 生成AI回复（内部已包含角色隔离验证）
        const response = await AIProxy.generateResponse(
            userId, 
            characterId, 
            message, 
            { character }
        );
        
        res.json({ success: true, response });
        
    } catch (error) {
        console.error('聊天API错误:', error);
        
        // 如果是角色隔离相关错误，返回特定错误信息
        if (error.message.includes('Invalid character ID') || 
            error.message.includes('character mismatch')) {
            return res.status(400).json({ 
                success: false, 
                error: '角色访问被拒绝' 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            error: '服务器内部错误' 
        });
    }
});

// 获取用户记忆（带角色隔离验证）
app.get('/api/memory/:userId/:characterId', async (req, res) => {
    try {
        const { userId, characterId } = req.params;
        
        // 验证角色ID有效性（角色隔离验证）
        if (!MemoryManager.isValidCharacterId(characterId)) {
            return res.status(400).json({ 
                success: false, 
                error: '无效的角色ID' 
            });
        }
        
        const memory = await MemoryManager.getUserMemory(userId, characterId);
        res.json({ success: true, memory });
        
    } catch (error) {
        console.error('获取记忆API错误:', error);
        
        // 如果是角色隔离相关错误，返回特定错误信息
        if (error.message.includes('Invalid character ID') || 
            error.message.includes('character mismatch')) {
            return res.status(400).json({ 
                success: false, 
                error: '角色访问被拒绝' 
            });
        }
        
        res.status(500).json({ success: false, error: error.message });
    }
});

// 获取用户信息
app.get('/api/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await UserManager.getUser(userId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: '用户不存在' 
            });
        }
        
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// 测试端点 - 检查环境变量和配置
app.get('/api/test-config', (req, res) => {
    res.json({
        status: 'ok',
        env: {
            hasOpenAI: !!process.env.OPENAI_API_KEY,
            hasElevenLabs: !!process.env.ELEVENLABS_API_KEY,
            hasSupabase: !!process.env.SUPABASE_URL,
            nodeEnv: process.env.NODE_ENV,
            isVercel: !!process.env.VERCEL
        },
        directories: {
            dataDir: DATA_DIR,
            usersDir: USERS_DIR,
            memoriesDir: MEMORIES_DIR
        },
        aiConfig: {
            provider: AI_CONFIG.provider,
            hasKey: !!AI_CONFIG.apiKey
        }
    });
});

// ======================
// ElevenLabs TTS API
// ======================

// TTS速率限制
const ttsLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1分钟
    max: 10, // 每分钟最多10次TTS请求
    message: 'TTS请求过于频繁，请稍后再试',
});

// 文本转语音API
app.post('/api/tts/generate', ttsLimiter, async (req, res) => {
    try {
        const { text, voiceId, language } = req.body;
        
        if (!text || !voiceId) {
            return res.status(400).json({ 
                success: false, 
                error: '缺少必要参数' 
            });
        }
        
        // 检查ElevenLabs API密钥
        if (!ELEVENLABS_CONFIG.apiKey || ELEVENLABS_CONFIG.apiKey === 'your-elevenlabs-key-here') {
            console.error('❌ ElevenLabs API密钥未配置');
            return res.status(500).json({ 
                success: false, 
                error: 'TTS服务未配置' 
            });
        }
        
        // 调用ElevenLabs API
        const url = `${ELEVENLABS_CONFIG.baseURL}/text-to-speech/${voiceId}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': ELEVENLABS_CONFIG.apiKey
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.8,
                    style: 0.2,
                    use_speaker_boost: true
                }
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ ElevenLabs API错误: ${response.status} - ${errorText}`);
            return res.status(response.status).json({ 
                success: false, 
                error: 'TTS生成失败' 
            });
        }
        
        // 获取音频数据
        const audioBuffer = await response.arrayBuffer();
        
        // 设置响应头并发送音频
        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioBuffer.byteLength
        });
        
        res.send(Buffer.from(audioBuffer));
        
    } catch (error) {
        console.error('TTS API错误:', error);
        res.status(500).json({ 
            success: false, 
            error: '服务器内部错误' 
        });
    }
});

// 获取可用语音列表
app.get('/api/tts/voices', async (req, res) => {
    try {
        // 返回预定义的语音列表（避免暴露API密钥）
        const voices = {
            jp: [
                { id: 'iP95p4xoKVk53GoZ742B', name: 'Yuki (日语)' },
                { id: 'pqHfZKP75CvOlQylNhV4', name: 'Sakura (日语)' }
            ],
            en: [
                { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (英语)' },
                { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Emily (英语)' }
            ],
            cn: [
                { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte (中文)' },
                { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily (中文)' }
            ]
        };
        
        res.json({ success: true, voices });
        
    } catch (error) {
        console.error('获取语音列表错误:', error);
        res.status(500).json({ 
            success: false, 
            error: '获取语音列表失败' 
        });
    }
});

// 启动服务器
async function startServer() {
    await initDirectories();
    
    // 检查Supabase配置
    if (supabaseUserManager.isAvailable()) {
        console.log('✅ Supabase用户管理器已启用');
        await supabaseUserManager.createUserProfilesTable();
    } else {
        console.log('⚠️  Supabase配置缺失，使用文件系统存储');
        console.log('💡 要启用Supabase，请配置.env文件');
    }
    
    app.listen(PORT, () => {
        console.log(`🚀 AI女友聊天服务器启动成功`);
        console.log(`📡 服务器地址: http://localhost:${PORT}`);
        console.log(`🤖 AI提供商: ${AI_CONFIG.provider}`);
        console.log(`📁 数据目录: ${DATA_DIR}`);
        console.log(`💾 用户资料存储: ${supabaseUserManager.isAvailable() ? 'Supabase + 文件系统回退' : '仅文件系统'}`);
    });
}

startServer().catch(console.error);

module.exports = app;