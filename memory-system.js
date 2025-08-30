/**
 * AI女友记忆管理系统
 * 基于Supabase + OpenAI的企业级记忆解决方案
 */

// Supabase客户端配置
const SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE'; // 替换为你的Supabase项目URL
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE'; // 替换为你的Supabase匿名密钥
const OPENAI_API_KEY = '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'; // OpenAI API密钥

// 内存管理类
class MemorySystem {
    constructor() {
        this.supabase = null;
        this.openai = null;
        this.initialized = false;
    }

    // 初始化服务（需要先安装依赖）
    async initialize() {
        try {
            // 动态导入Supabase客户端（需要先运行: npm install @supabase/supabase-js）
            const { createClient } = await import('@supabase/supabase-js');
            this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

            // 动态导入OpenAI客户端（需要先运行: npm install openai）
            const { OpenAI } = await import('openai');
            this.openai = new OpenAI({ 
                apiKey: OPENAI_API_KEY,
                dangerouslyAllowBrowser: true // 仅用于开发，生产环境应通过后端调用
            });

            this.initialized = true;
            console.log('✅ 记忆系统初始化完成');
            return true;
        } catch (error) {
            console.error('❌ 记忆系统初始化失败:', error);
            console.log('💡 请先安装依赖: npm install @supabase/supabase-js openai');
            return false;
        }
    }

    // 检查初始化状态
    checkInitialization() {
        if (!this.initialized) {
            console.warn('⚠️ 记忆系统未初始化，使用本地存储模式');
            return false;
        }
        return true;
    }

    // 1. 保存用户基础资料
    async saveUserProfile(userId, profileData) {
        if (!this.checkInitialization()) {
            return this.saveUserProfileLocal(userId, profileData);
        }

        try {
            // 插入或更新用户基础信息
            const { data: user, error: userError } = await this.supabase
                .from('users')
                .upsert({
                    id: userId,
                    username: profileData.username,
                    first_name: profileData.firstName,
                    last_name: profileData.lastName,
                    location: profileData.location,
                    language: profileData.language,
                    birth_month: parseInt(profileData.birthMonth),
                    birth_day: parseInt(profileData.birthDay),
                    updated_at: new Date().toISOString()
                });

            if (userError) throw userError;

            // 将记忆数据转换为长期记忆
            const memoryItems = [
                { category: 'preference', key: 'favorite_food', value: profileData.memory.favoriteFood, confidence: 0.9 },
                { category: 'preference', key: 'favorite_color', value: profileData.memory.favoriteColor, confidence: 0.9 },
                { category: 'preference', key: 'hobbies', value: profileData.memory.hobbies, confidence: 0.9 },
                { category: 'fact', key: 'anniversaries', value: profileData.memory.anniversaries, confidence: 0.9 },
                { category: 'fact', key: 'location', value: profileData.location, confidence: 0.9 },
                { category: 'fact', key: 'language', value: profileData.language, confidence: 0.9 },
                { category: 'fact', key: 'birthday', value: `${profileData.birthMonth}/${profileData.birthDay}`, confidence: 1.0 }
            ].filter(item => item.value && item.value.trim());

            // 为每个角色创建这些基础记忆
            const { data: npcs } = await this.supabase.from('npcs').select('id');
            
            for (const npc of npcs || []) {
                for (const memory of memoryItems) {
                    await this.upsertLongTermMemory(userId, npc.id, memory.category, memory.key, memory.value, memory.confidence);
                }
            }

            console.log('💾 用户资料已保存到记忆系统');
            return user;
        } catch (error) {
            console.error('❌ 保存用户资料失败:', error);
            // 降级到本地存储
            return this.saveUserProfileLocal(userId, profileData);
        }
    }

    // 本地存储降级方案
    saveUserProfileLocal(userId, profileData) {
        const profileKey = `user_profile_${userId}`;
        const profile = {
            ...profileData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        localStorage.setItem(profileKey, JSON.stringify(profile));
        console.log('💾 用户资料已保存到本地存储（降级模式）');
        return profile;
    }

    // 2. 从消息中抽取记忆
    async extractMemoriesFromMessage(userMessage, aiResponse = '') {
        if (!this.checkInitialization()) {
            return { longTerm: [], episodic: [] };
        }

        try {
            const extractionPrompt = `你是"记忆抽取器"。从用户消息和AI回复中提取应该长期记住的信息。
只在出现以下情况时才提取长期记忆：
- 明确的个人偏好（喜欢/讨厌某种食物、颜色、活动等）
- 重要的事实信息（生日、工作、家庭情况、宠物等）
- 人际关系变化（称呼偏好、亲密度变化等）
- 明确的目标或承诺（计划、约定、目标等）
- 重要的情感状态或性格特征

输出JSON格式：
{
  "longTerm": [
    {"category":"preference|fact|relationship|goal","key":"可选键名","value":"具体内容","confidence":0.6-0.95}
  ],
  "episodic": [
    "简洁的事件描述，1-2句话"
  ]
}

用户消息: ${userMessage}
AI回复: ${aiResponse}`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: extractionPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.3,
                max_tokens: 500
            });

            const extracted = JSON.parse(response.choices[0].message.content || '{"longTerm":[],"episodic":[]}');
            return extracted;
        } catch (error) {
            console.error('❌ 记忆抽取失败:', error);
            return { longTerm: [], episodic: [] };
        }
    }

    // 3. 保存长期记忆
    async upsertLongTermMemory(userId, npcId, category, key, value, confidence = 0.8) {
        if (!this.checkInitialization()) return null;

        try {
            const { data, error } = await this.supabase.rpc('upsert_long_term_memory', {
                p_user_id: userId,
                p_npc_id: npcId,
                p_category: category,
                p_key: key,
                p_value: value,
                p_confidence: confidence
            });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('❌ 保存长期记忆失败:', error);
            return null;
        }
    }

    // 4. 保存情节记忆（带向量化）
    async saveEpisodicMemories(userId, npcId, episodics) {
        if (!this.checkInitialization() || !episodics?.length) return;

        try {
            // 批量生成向量
            const embeddingResponse = await this.openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: episodics
            });

            const memories = episodics.map((text, index) => ({
                user_id: userId,
                npc_id: npcId,
                text: text,
                embedding: embeddingResponse.data[index].embedding
            }));

            const { error } = await this.supabase
                .from('episodic_memories')
                .insert(memories);

            if (error) throw error;
            console.log(`💭 已保存${memories.length}条情节记忆`);
        } catch (error) {
            console.error('❌ 保存情节记忆失败:', error);
        }
    }

    // 5. 保存消息到数据库
    async saveMessage(userId, npcId, role, content, emotion = null) {
        if (!this.checkInitialization()) return null;

        try {
            const { data, error } = await this.supabase
                .from('messages')
                .insert({
                    user_id: userId,
                    npc_id: npcId,
                    role: role,
                    content: content,
                    emotion: emotion
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('❌ 保存消息失败:', error);
            return null;
        }
    }

    // 6. 检索记忆上下文
    async retrieveMemoryContext(userId, npcId, currentMessage) {
        if (!this.checkInitialization()) {
            return this.retrieveMemoryContextLocal(userId, npcId);
        }

        try {
            // 生成查询向量
            const embeddingResponse = await this.openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: currentMessage
            });
            const queryEmbedding = embeddingResponse.data[0].embedding;

            // 并行检索所有类型的记忆
            const [episodicResult, longTermResult, summaryResult] = await Promise.all([
                // 检索相似的情节记忆
                this.supabase.rpc('match_episodic_memories', {
                    p_user_id: userId,
                    p_npc_id: npcId,
                    p_query_embedding: queryEmbedding,
                    p_match_count: 6
                }),
                // 检索长期记忆
                this.supabase
                    .from('long_term_memories')
                    .select('*')
                    .eq('user_id', userId)
                    .eq('npc_id', npcId)
                    .order('last_seen_at', { ascending: false })
                    .limit(15),
                // 检索对话摘要
                this.supabase
                    .from('rolling_summaries')
                    .select('*')
                    .eq('user_id', userId)
                    .eq('npc_id', npcId)
                    .maybeSingle()
            ]);

            return {
                episodic: episodicResult.data || [],
                longTerm: longTermResult.data || [],
                summary: summaryResult.data?.summary || ''
            };
        } catch (error) {
            console.error('❌ 检索记忆上下文失败:', error);
            return this.retrieveMemoryContextLocal(userId, npcId);
        }
    }

    // 本地记忆检索降级方案
    retrieveMemoryContextLocal(userId, npcId) {
        const profileKey = `user_profile_${userId}`;
        const profile = localStorage.getItem(profileKey);
        
        if (profile) {
            const data = JSON.parse(profile);
            return {
                episodic: [],
                longTerm: [
                    { category: 'preference', key: 'favorite_food', value: data.memory?.favoriteFood || '' },
                    { category: 'preference', key: 'favorite_color', value: data.memory?.favoriteColor || '' },
                    { category: 'preference', key: 'hobbies', value: data.memory?.hobbies || '' },
                    { category: 'fact', key: 'location', value: data.location || '' },
                    { category: 'fact', key: 'birthday', value: `${data.birthMonth}/${data.birthDay}` || '' }
                ].filter(item => item.value),
                summary: `用户${data.firstName}的基本信息已记录。`
            };
        }
        return { episodic: [], longTerm: [], summary: '' };
    }

    // 7. 更新滚动摘要
    async updateRollingSummary(userId, npcId, newMessages) {
        if (!this.checkInitialization() || !newMessages?.length) return;

        try {
            const conversationText = newMessages
                .map(msg => `${msg.role}: ${msg.content}`)
                .join('\n');

            const summaryPrompt = `请将以下对话总结为简洁的要点，保留重要信息和情感色彩：
${conversationText}

要求：
- 3-5个要点，每个要点1行
- 保留重要的事实信息
- 记录情感变化和关系发展
- 使用第三人称描述`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'system', content: summaryPrompt }],
                temperature: 0.3,
                max_tokens: 300
            });

            const newSummary = response.choices[0].message.content;

            // 更新摘要
            const { error } = await this.supabase
                .from('rolling_summaries')
                .upsert({
                    user_id: userId,
                    npc_id: npcId,
                    summary: newSummary,
                    message_count: newMessages.length,
                    updated_at: new Date().toISOString()
                });

            if (error) throw error;
            console.log('📝 对话摘要已更新');
        } catch (error) {
            console.error('❌ 更新摘要失败:', error);
        }
    }

    // 8. 完整的记忆处理流程
    async processConversationMemories(userId, npcId, userMessage, aiResponse) {
        try {
            // 1. 保存消息
            await Promise.all([
                this.saveMessage(userId, npcId, 'user', userMessage),
                this.saveMessage(userId, npcId, 'assistant', aiResponse)
            ]);

            // 2. 抽取记忆
            const memories = await this.extractMemoriesFromMessage(userMessage, aiResponse);

            // 3. 保存长期记忆
            if (memories.longTerm?.length) {
                for (const memory of memories.longTerm) {
                    await this.upsertLongTermMemory(
                        userId, npcId, 
                        memory.category, 
                        memory.key, 
                        memory.value, 
                        memory.confidence
                    );
                }
                console.log(`💾 已保存${memories.longTerm.length}条长期记忆`);
            }

            // 4. 保存情节记忆
            if (memories.episodic?.length) {
                await this.saveEpisodicMemories(userId, npcId, memories.episodic);
            }

            // 5. 定期更新摘要（每10条消息）
            const messageCount = await this.getMessageCount(userId, npcId);
            if (messageCount % 10 === 0) {
                const recentMessages = await this.getRecentMessages(userId, npcId, 10);
                await this.updateRollingSummary(userId, npcId, recentMessages);
            }

        } catch (error) {
            console.error('❌ 处理对话记忆失败:', error);
        }
    }

    // 辅助函数：获取消息数量
    async getMessageCount(userId, npcId) {
        if (!this.checkInitialization()) return 0;
        
        const { count, error } = await this.supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('npc_id', npcId);

        return error ? 0 : (count || 0);
    }

    // 辅助函数：获取最近消息
    async getRecentMessages(userId, npcId, limit = 10) {
        if (!this.checkInitialization()) return [];

        const { data, error } = await this.supabase
            .from('messages')
            .select('*')
            .eq('user_id', userId)
            .eq('npc_id', npcId)
            .order('created_at', { ascending: false })
            .limit(limit);

        return error ? [] : (data || []).reverse();
    }

    // 9. 构建AI对话上下文
    buildContextForAI(memoryContext, npcPersona) {
        let context = `[角色设定]\n${npcPersona}\n\n`;

        // 添加对话摘要
        if (memoryContext.summary) {
            context += `[对话历史摘要]\n${memoryContext.summary}\n\n`;
        }

        // 添加长期记忆
        if (memoryContext.longTerm?.length) {
            context += `[用户资料记忆]\n`;
            const memoryByCategory = memoryContext.longTerm.reduce((acc, memory) => {
                if (!acc[memory.category]) acc[memory.category] = [];
                acc[memory.category].push(`${memory.key || '信息'}: ${memory.value}`);
                return acc;
            }, {});

            Object.entries(memoryByCategory).forEach(([category, items]) => {
                const categoryName = {
                    'preference': '偏好',
                    'fact': '事实',
                    'relationship': '关系',
                    'goal': '目标'
                }[category] || category;
                context += `- ${categoryName}: ${items.join(', ')}\n`;
            });
            context += '\n';
        }

        // 添加相关情节记忆
        if (memoryContext.episodic?.length) {
            context += `[相关回忆]\n`;
            memoryContext.episodic
                .filter(memory => memory.similarity > 0.7)
                .slice(0, 4)
                .forEach(memory => {
                    context += `- ${memory.text}\n`;
                });
            context += '\n';
        }

        return context;
    }
}

// 全局实例
const memorySystem = new MemorySystem();

// 导出到全局作用域
window.memorySystem = memorySystem;

console.log('🧠 记忆管理系统模块已加载');
console.log('💡 使用说明:');
console.log('1. 先配置SUPABASE_URL、SUPABASE_ANON_KEY、OPENAI_API_KEY');
console.log('2. 运行 npm install @supabase/supabase-js openai');
console.log('3. 调用 await memorySystem.initialize() 初始化');