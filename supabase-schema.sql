-- AI女友记忆管理系统 - Supabase数据库架构
-- 适配Solana钱包地址作为用户ID

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 用户表（使用钱包地址作为主键）
CREATE TABLE users (
  id TEXT PRIMARY KEY, -- Solana钱包地址
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  location TEXT,
  language TEXT,
  birth_month INTEGER,
  birth_day INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- AI女友角色表
CREATE TABLE npcs (
  id TEXT PRIMARY KEY, -- 角色ID，如'alice', 'fliza'等
  name TEXT NOT NULL,
  vrm_file TEXT, -- VRM文件路径
  persona TEXT, -- 角色人设卡
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 长期语义记忆表
CREATE TABLE long_term_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  category TEXT NOT NULL, -- 'preference' | 'fact' | 'relationship' | 'goal' | 'trigger'
  key TEXT, -- 可选键，如 "favorite_food"
  value TEXT NOT NULL, -- 记忆内容
  confidence REAL DEFAULT 0.8, -- 置信度 0~1
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, npc_id, category, key)
);

-- 短期情节记忆表（向量检索）
CREATE TABLE episodic_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  text TEXT NOT NULL, -- 清洗后的事件描述
  embedding VECTOR(1536), -- OpenAI text-embedding-3-small的维度
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 聊天消息表
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  emotion TEXT, -- 情感标记
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 滚动对话摘要表
CREATE TABLE rolling_summaries (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  summary TEXT NOT NULL, -- 历史对话的压缩摘要
  message_count INTEGER DEFAULT 0, -- 已摘要的消息数量
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, npc_id)
);

-- 创建索引以优化查询性能
CREATE INDEX idx_long_term_memories_user_npc ON long_term_memories(user_id, npc_id);
CREATE INDEX idx_long_term_memories_category ON long_term_memories(category);
CREATE INDEX idx_long_term_memories_last_seen ON long_term_memories(last_seen_at DESC);

CREATE INDEX idx_episodic_memories_user_npc ON episodic_memories(user_id, npc_id);
CREATE INDEX idx_episodic_memories_created_at ON episodic_memories(created_at DESC);
-- 向量相似度索引
CREATE INDEX ON episodic_memories USING ivfflat (embedding vector_cosine_ops);

CREATE INDEX idx_messages_user_npc ON messages(user_id, npc_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);

-- 相似度检索函数
CREATE OR REPLACE FUNCTION match_episodic_memories(
  p_user_id TEXT,
  p_npc_id TEXT,
  p_query_embedding vector(1536),
  p_match_count int DEFAULT 8,
  p_similarity_threshold float DEFAULT 0.3
)
RETURNS TABLE(
  id uuid, 
  text text, 
  created_at timestamptz, 
  similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id, 
    e.text, 
    e.created_at,
    1 - (e.embedding <=> p_query_embedding) AS similarity
  FROM episodic_memories e
  WHERE e.user_id = p_user_id 
    AND e.npc_id = p_npc_id
    AND 1 - (e.embedding <=> p_query_embedding) > p_similarity_threshold
  ORDER BY e.embedding <=> p_query_embedding
  LIMIT p_match_count;
END; $$;

-- 长期记忆更新插入函数
CREATE OR REPLACE FUNCTION upsert_long_term_memory(
  p_user_id TEXT, 
  p_npc_id TEXT, 
  p_category TEXT, 
  p_key TEXT, 
  p_value TEXT, 
  p_confidence REAL DEFAULT 0.8
) 
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  memory_id UUID;
BEGIN
  INSERT INTO long_term_memories (user_id, npc_id, category, key, value, confidence, last_seen_at)
  VALUES (p_user_id, p_npc_id, p_category, p_key, p_value, p_confidence, now())
  ON CONFLICT (user_id, npc_id, category, key)
  DO UPDATE SET 
    value = EXCLUDED.value,
    confidence = LEAST(1.0, (long_term_memories.confidence * 0.7 + EXCLUDED.confidence * 0.3)),
    last_seen_at = now()
  RETURNING id INTO memory_id;
  
  RETURN memory_id;
END; $$;

-- 记忆衰减函数（定期清理任务使用）
CREATE OR REPLACE FUNCTION decay_memories()
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- 降低90天未访问记忆的置信度
  UPDATE long_term_memories 
  SET confidence = confidence * 0.9
  WHERE last_seen_at < now() - interval '90 days'
    AND confidence > 0.1;
  
  -- 删除置信度过低的记忆
  DELETE FROM long_term_memories 
  WHERE confidence < 0.1;
  
  -- 删除超过1年的低相似度情节记忆
  DELETE FROM episodic_memories 
  WHERE created_at < now() - interval '365 days';
END; $$;

-- 插入默认角色数据
INSERT INTO npcs (id, name, vrm_file, persona) VALUES 
('alice', 'Alice', 'Main VRM/RearAlice_1.0.vrm', '温柔可爱的邻家女孩，总是关心着用户的感受，喜欢日常聊天和分享生活'),
('fliza', 'Fliza', 'Main VRM/Fliza VRM.vrm', '温柔体贴的大姐姐类型，成熟优雅，善解人意'),
('ash', 'Ash', 'Main VRM/Ash1.0.vrm', '酷酷的中性风女孩，有着独特的个人魅力，直率真诚'),
('elinyaa', 'Elinyaa', 'Main VRM/Elinyaa.vrm', '神秘优雅的精灵少女，有着不可思议的魅力，喜欢诗歌和艺术'),
('imeris', 'Imeris', 'Main VRM/IMERIS.vrm', '高贵优雅的贵族少女，举止端庄，知识渊博'),
('maple', 'Maple', 'Main VRM/Maple_1.0.vrm', '温暖如秋日阳光的女孩，总是给人安全感，喜欢烹饪和园艺'),
('nekona', 'Nekona', 'Main VRM/NEKONA.01.vrm', '可爱的猫娘，有着猫咪般的慵懒与活泼，喜欢撒娇'),
('rainy', 'Rainy', 'Main VRM/Rainy_1.00.vrm', '活泼开朗的邻家女孩，总是充满活力，喜欢运动和音乐'),
('vivi', 'Vivi', 'Main VRM/Vivi_model.vrm', '充满好奇心的探险家，总是对世界充满热情，喜欢学习新事物'),
('wolferia', 'Wolferia', 'Main VRM/Wolferia.vrm', '高傲的狼族公主，有着王者的气质，但内心渴望被理解');

-- 启用行级安全策略（RLS）
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE long_term_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodic_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE rolling_summaries ENABLE ROW LEVEL SECURITY;

-- 创建安全策略（用户只能访问自己的数据）
CREATE POLICY "Users can only view their own data" ON users
  FOR ALL USING (auth.uid()::text = id);

CREATE POLICY "Users can only access their own memories" ON long_term_memories
  FOR ALL USING (auth.uid()::text = user_id);

CREATE POLICY "Users can only access their own episodic memories" ON episodic_memories
  FOR ALL USING (auth.uid()::text = user_id);

CREATE POLICY "Users can only access their own messages" ON messages
  FOR ALL USING (auth.uid()::text = user_id);

CREATE POLICY "Users can only access their own summaries" ON rolling_summaries
  FOR ALL USING (auth.uid()::text = user_id);

-- NPCs表公开可读
CREATE POLICY "NPCs are publicly readable" ON npcs
  FOR SELECT USING (true);