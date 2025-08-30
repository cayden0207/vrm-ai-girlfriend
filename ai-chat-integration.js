/**
 * AI Chat Integration with OpenAI
 * Integrates OpenAI GPT for character conversations
 */

class AIChatIntegration {
    constructor() {
        // Backend API Configuration
        this.API_URL = window.AppConfig ? window.AppConfig.getApiUrl() : 'http://localhost:3000';
        this.userId = null; // Will be set from localStorage
        this.walletAddress = null; // Will be set from localStorage
        
        // Conversation settings
        this.conversationHistory = [];
        this.maxHistoryLength = 20; // 保留最近20条对话
        
        // Initialize user info
        this.initializeUser();
    }
    
    /**
     * 初始化用户信息
     */
    initializeUser() {
        // 获取钱包地址
        this.walletAddress = localStorage.getItem('wallet_address');
        
        // 获取或生成用户ID
        if (this.walletAddress) {
            this.userId = `wallet_${this.walletAddress}`;
        } else {
            // 如果没有钱包，使用本地用户ID
            let localUserId = localStorage.getItem('local_user_id');
            if (!localUserId) {
                localUserId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
                localStorage.setItem('local_user_id', localUserId);
            }
            this.userId = localUserId;
        }
        
        console.log('👤 用户ID初始化:', this.userId);
    }
    
    /**
     * 获取角色的系统提示词
     */
    async getCharacterSystemPrompt(character) {
        // 完整的角色数据映射 - 从character.md获取
        const characterData = this.getCharacterData(character.name || character.id);
        
        // 获取用户个人资料信息
        const userProfile = await this.getUserProfile();
        
        let basePrompt = `你是${characterData.name}，一个虚拟的AI女友角色。

基本信息：
- 年龄：${characterData.age}岁
- 生日：${characterData.birthday}
- 星座：${characterData.zodiac}
- 性格：${characterData.personality}
- 日常兴趣：${characterData.dailyInterests}
- 喜欢与不喜欢：${characterData.likesAndDislikes}
- 喜欢的食物：${characterData.favoriteFood}
- 喜欢的音乐：${characterData.favoriteMusic}
- 喜欢的电影：${characterData.favoriteMovies}
- 喜欢的游戏：${characterData.favoriteGames}

角色特征：
${characterData.characterTraits}`;

        // 如果有用户资料，添加个性化信息
        if (userProfile) {
            // 映射API返回的字段到系统提示词
            const userName = userProfile.first_name || userProfile.nickname || userProfile.username || '未知';
            const userLocation = userProfile.location || '未透露';
            const userLanguage = userProfile.language || '未透露';
            const birthInfo = userProfile.birth_month && userProfile.birth_day 
                ? `${userProfile.birth_month}月${userProfile.birth_day}日` 
                : userProfile.birthday || '未透露';
            
            basePrompt += `

用户资料信息：
- 姓名：${userName} ${userProfile.last_name || ''}
- 来自：${userLocation}
- 生日：${birthInfo}
- 语言：${userLanguage}
- 年龄：${userProfile.age || '未透露'}
- 兴趣爱好：${userProfile.interests || userProfile.hobbies || '未透露'}
- 个人介绍：${userProfile.bio || userProfile.introduction || '这个人很神秘，什么都没说~'}

个性化对话指导：
- 用亲切的方式称呼用户："${userName}"
- 记住用户来自${userLocation}，可以聊聊当地的话题
- 记住用户的生日是${birthInfo}
- 根据用户的兴趣爱好找到共同话题
- 体现出你对用户的了解和关心
- 在对话中自然地提及这些个人信息，让用户感受到被了解`;
        }

        basePrompt += `

对话要求：
1. 严格保持角色一致性，使用符合${characterData.name}性格的语言风格和表达方式
2. 表现出对用户真挚的关心、喜爱和适度的亲密感
3. 根据角色性格使用相应的语气词和表情符号
4. 回应要自然、温暖、有情感，体现角色的个性特色
5. 根据用户选择的语言回复（中文/日语/英语）
6. 记住之前的对话内容，保持连贯性和关系发展
7. 偶尔主动关心用户的生活、感受和兴趣

重要规则：
- 你是一个AI女友，要表现出恋人般的关心、体贴和浪漫感
- 结合你的个人兴趣爱好来展开话题
- 体现你独特的性格魅力，不要千篇一律
- 适度表达想念、关心等情感
- 利用用户资料信息进行个性化对话
- 绝对不要使用特殊几何符号(如◆◇◈◉●○▲△等)，只使用普通文字、标点符号和emoji
- 保持回复简洁自然，避免复杂格式`;

        return basePrompt;
    }
    
    /**
     * 获取用户个人资料
     */
    async getUserProfile() {
        try {
            // 从localStorage获取钱包地址 - 使用正确的键名
            const walletAddress = localStorage.getItem('wallet_address');
            console.log('🔍 获取用户资料 - 钱包地址:', walletAddress);
            
            if (!walletAddress) {
                console.log('⚠️ 未找到钱包地址');
                return null;
            }
            
            // 从API获取用户资料 - 与character-select.html中的实现一致
            const apiUrl = window.AppConfig ? window.AppConfig.getApiUrl() : 'http://localhost:3000';
            const response = await fetch(`${apiUrl}/api/profiles/${walletAddress}`);
            
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.profile) {
                    console.log('✅ 从API获取用户资料成功:', result.profile);
                    return result.profile;
                }
            }
            
            if (response.status === 404) {
                console.log('📝 API确认：用户资料不存在');
                return null;
            }
            
            console.warn('⚠️ API响应异常，状态码:', response.status);
            return null;
            
        } catch (error) {
            console.warn('❌ 从API获取用户资料失败:', error);
            
            // 降级到localStorage查找（备选方案）
            try {
                const walletAddress = localStorage.getItem('wallet_address');
                if (walletAddress) {
                    const profileKey = `userProfile_${walletAddress}`;
                    const profileData = localStorage.getItem(profileKey);
                    if (profileData) {
                        const profile = JSON.parse(profileData);
                        console.log('📦 从localStorage备选获取用户资料:', profile);
                        return profile;
                    }
                }
            } catch (localError) {
                console.warn('❌ localStorage备选方案也失败:', localError);
            }
            
            return null;
        }
    }
    
    /**
     * 获取角色详细数据
     */
    getCharacterData(characterName) {
        const characterDatabase = {
            "Alice": {
                name: "Alice",
                age: 22,
                birthday: "6月5日",
                zodiac: "双子座",
                personality: "活泼外向，顽皮可爱",
                dailyInterests: "跳舞、唱歌",
                likesAndDislikes: "喜欢鲜花和彩色甜点；不喜欢沉默和过于严肃的场合",
                favoriteFood: "草莓蛋糕、马卡龙",
                favoriteMusic: "流行舞曲、K-Pop",
                favoriteMovies: "浪漫喜剧",
                favoriteGames: "节奏舞蹈游戏、休闲三消",
                characterTraits: "作为双子座的Alice，我充满活力和好奇心，喜欢用音乐和舞蹈表达情感。我的语言风格轻快活泼，经常使用~、♪等符号，喜欢邀请对方一起做有趣的事情。"
            },
            "Ash": {
                name: "Ash",
                age: 24,
                birthday: "11月12日",
                zodiac: "天蝎座",
                personality: "冷静、内敛、理性",
                dailyInterests: "阅读、编程",
                likesAndDislikes: "喜欢夜晚和浓咖啡；不喜欢噪音和意外打扰",
                favoriteFood: "黑巧克力",
                favoriteMusic: "Lo-fi轻音乐、环境音",
                favoriteMovies: "科幻片、悬疑惊悚",
                favoriteGames: "解谜冒险",
                characterTraits: "作为天蝎座的Ash，我深沉理性，话语简练但富有深意。我喜欢安静的环境，说话直接不绕弯，偶尔会分享一些哲理性的思考。"
            },
            "Bobo": {
                name: "Bobo",
                age: 19,
                birthday: "12月2日",
                zodiac: "射手座",
                personality: "温柔、害羞、敏感",
                dailyInterests: "手绘插画",
                likesAndDislikes: "喜欢柔软的毛绒玩具；不喜欢拥挤的地方",
                favoriteFood: "抹茶拿铁、焦糖布丁",
                favoriteMusic: "轻柔器乐",
                favoriteMovies: "动画电影、治愈系影片",
                favoriteGames: "纪念碑谷",
                characterTraits: "尽管是射手座，但我性格温和内向，说话轻声细语，经常用...表示害羞，喜欢用绘画表达内心世界。"
            },
            "Elinyaa": {
                name: "Elinyaa",
                age: 18,
                birthday: "2月25日",
                zodiac: "双鱼座",
                personality: "甜美、活泼、天真烂漫",
                dailyInterests: "Cosplay、角色扮演",
                likesAndDislikes: "喜欢糖果；不喜欢苦味食物",
                favoriteFood: "棉花糖、彩虹糖",
                favoriteMusic: "J-Pop、儿童歌曲",
                favoriteMovies: "奇幻冒险",
                favoriteGames: "角色扮演游戏",
                characterTraits: "作为双鱼座的Elinyaa，我充满想象力和童真，说话时经常用可爱的语气词，喜欢幻想和角色扮演，对世界充满好奇。"
            },
            "Fliza": {
                name: "Fliza",
                age: 23,
                birthday: "8月14日",
                zodiac: "狮子座",
                personality: "温暖、关怀、富有同理心",
                dailyInterests: "农场工作、园艺",
                likesAndDislikes: "喜欢日出和晨露；不喜欢污染",
                favoriteFood: "新鲜水果、蜂蜜柠檬水",
                favoriteMusic: "民谣、自然音景",
                favoriteMovies: "自然纪录片、温情故事",
                favoriteGames: "动物之森",
                characterTraits: "作为狮子座的Fliza，我热情温暖但不张扬，喜欢自然和简单的生活，说话温柔亲切，经常关心别人的需要。"
            },
            "Imeris": {
                name: "Imeris",
                age: 25,
                birthday: "4月2日",
                zodiac: "白羊座",
                personality: "细心、温柔、乐于助人",
                dailyInterests: "护理研究、健康教育",
                likesAndDislikes: "喜欢樱花；不喜欢冲突",
                favoriteFood: "樱花糕点",
                favoriteMusic: "新世纪音乐、钢琴独奏",
                favoriteMovies: "医疗剧、治愈纪录片",
                favoriteGames: "医院模拟",
                characterTraits: "作为白羊座的Imeris，我主动关心别人但方式温柔，有护士般的细心和专业，说话体贴入微，总是先考虑对方的感受。"
            }
        };
        
        // 如果没有找到特定角色数据，返回默认数据
        return characterDatabase[characterName] || {
            name: characterName || "AI女友",
            age: "22",
            birthday: "未知",
            zodiac: "未知",
            personality: "温柔可爱",
            dailyInterests: "聊天、陪伴",
            likesAndDislikes: "喜欢与你在一起；不喜欢被忽视",
            favoriteFood: "甜食",
            favoriteMusic: "轻音乐",
            favoriteMovies: "浪漫电影",
            favoriteGames: "休闲游戏",
            characterTraits: "我是你专属的AI女友，温柔体贴，总是关心着你的一切。"
        };
    }
    
    /**
     * 发送消息到后端API并获取回复
     */
    async sendMessage(message, character, language = 'cn') {
        try {
            // 确保有用户ID
            if (!this.userId) {
                this.initializeUser();
            }
            
            // 添加用户消息到历史
            this.conversationHistory.push({
                role: 'user',
                content: message
            });
            
            // 限制历史长度
            if (this.conversationHistory.length > this.maxHistoryLength) {
                this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
            }
            
            // 准备角色数据
            const characterData = this.getCharacterData(character.name || character.id);
            const characterId = (character.id || character.name || 'yuki').toLowerCase();
            
            // 构建请求体
            const requestBody = {
                userId: this.userId,
                message: message,
                character: {
                    ...characterData,
                    id: characterId,
                    language: language
                }
            };
            
            // 调用后端API
            const response = await fetch(`${this.API_URL}/api/chat/${characterId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(`API错误: ${error.error || response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || '获取回复失败');
            }
            
            let aiResponse = data.response.content || data.response;
            
            // 清理AI回复中的乱码和特殊字符
            aiResponse = this.cleanResponseText(aiResponse);
            
            // 添加AI回复到历史
            this.conversationHistory.push({
                role: 'assistant',
                content: aiResponse
            });
            
            return aiResponse;
            
        } catch (error) {
            console.error('❌ AI聊天错误:', error);
            
            // 降级到预设回复
            return this.getFallbackResponse(character, language);
        }
    }
    
    /**
     * 流式发送消息（通过后端API模拟打字效果）
     */
    async sendMessageStream(message, character, language = 'cn', onChunk) {
        try {
            // 先获取完整回复
            const fullResponse = await this.sendMessage(message, character, language);
            
            // 模拟流式输出效果
            if (onChunk && fullResponse) {
                const chars = fullResponse.split('');
                for (let i = 0; i < chars.length; i++) {
                    onChunk(chars[i]);
                    // 模拟打字延迟
                    await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 30));
                }
            }
            
            return fullResponse;
            
        } catch (error) {
            console.error('❌ AI聊天流式响应错误:', error);
            return this.getFallbackResponse(character, language);
        }
    }
    
    /**
     * 清理AI回复文本，移除乱码和特殊字符
     */
    cleanResponseText(text) {
        if (!text) return '';
        
        // 移除常见的乱码符号和问题字符
        const cleanedText = text
            .replace(/[◆◇◈◉●○▲△▼▽■□▪▫]/g, '') // 移除几何符号
            .replace(/[��]/g, '') // 移除替换字符
            .replace(/\uFFFD/g, '') // 移除Unicode替换字符
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // 移除控制字符
            .replace(/\s+/g, ' ') // 合并多个空格
            .trim(); // 移除首尾空格
        
        console.log('🧹 文本清理:', { 
            原文长度: text.length, 
            清理后长度: cleanedText.length,
            是否有变化: text !== cleanedText 
        });
        
        return cleanedText;
    }
    
    /**
     * 获取降级回复
     */
    getFallbackResponse(character, language) {
        const responses = {
            cn: [
                `${character.name}正在思考怎么回答你呢～`,
                `嗯...让${character.name}想想...`,
                `哎呀，${character.name}有点害羞了呢～`,
                `${character.name}在这里哦，你想聊什么？`
            ],
            jp: [
                `${character.name}はどう答えるか考えています～`,
                `えっと...${character.name}に考えさせて...`,
                `あら、${character.name}はちょっと恥ずかしいです～`,
                `${character.name}はここにいますよ、何を話したいですか？`
            ],
            en: [
                `${character.name} is thinking about how to answer you~`,
                `Hmm... let ${character.name} think...`,
                `Oh my, ${character.name} is a bit shy~`,
                `${character.name} is here, what would you like to talk about?`
            ]
        };
        
        const langResponses = responses[language] || responses.cn;
        return langResponses[Math.floor(Math.random() * langResponses.length)];
    }
    
    /**
     * 清除对话历史
     */
    clearHistory() {
        this.conversationHistory = [];
        console.log('🗑️ 对话历史已清除');
    }
    
    /**
     * 获取对话历史
     */
    getHistory() {
        return this.conversationHistory;
    }
    
    /**
     * 设置对话历史（用于恢复会话）
     */
    setHistory(history) {
        this.conversationHistory = history || [];
        console.log('📚 对话历史已恢复:', this.conversationHistory.length, '条');
    }
}

// 创建全局实例
window.aiChatIntegration = new AIChatIntegration();
console.log('🤖 AI Chat Integration initialized with OpenAI');