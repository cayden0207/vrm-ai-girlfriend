-- Supabase用户记忆表
-- 在Supabase Dashboard的SQL Editor中运行这个脚本

CREATE TABLE IF NOT EXISTS user_memories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    memory_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- 确保每个用户-角色组合只有一条记录
    UNIQUE(user_id, character_id)
);

-- 创建索引提升查询性能
CREATE INDEX IF NOT EXISTS idx_user_memories_user_character 
ON user_memories(user_id, character_id);

-- 创建更新时间自动更新触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_memories_updated_at 
BEFORE UPDATE ON user_memories 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 插入示例注释
COMMENT ON TABLE user_memories IS 'AI女友应用的用户记忆数据存储';
