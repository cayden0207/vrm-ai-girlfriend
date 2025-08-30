/**
 * Supabase客户端配置
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Supabase配置
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️  Supabase配置缺失，将使用文件系统存储');
    console.log('请在.env文件中配置SUPABASE_URL和SUPABASE_ANON_KEY');
}

// 创建Supabase客户端
const supabase = supabaseUrl && supabaseKey 
    ? createClient(supabaseUrl, supabaseKey)
    : null;

// 用户资料管理类
class SupabaseUserManager {
    constructor() {
        this.supabase = supabase;
    }

    // 检查Supabase连接
    isAvailable() {
        return this.supabase !== null;
    }

    // 创建用户资料表（如果不存在）
    async createUserProfilesTable() {
        if (!this.supabase) {
            console.log('📁 使用文件系统存储，跳过数据库表创建');
            return false;
        }

        try {
            // 注意：在生产环境中，应该通过Supabase Dashboard或迁移脚本创建表
            console.log('📋 数据库表应通过Supabase Dashboard创建');
            console.log(`
SQL脚本：
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    wallet_address TEXT UNIQUE NOT NULL,
    nickname VARCHAR(50),
    age INTEGER,
    gender VARCHAR(10),
    birthday DATE,
    location VARCHAR(100),
    occupation VARCHAR(100),
    interests TEXT,
    bio TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_profiles_updated_at 
    BEFORE UPDATE ON user_profiles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
            `);
            return true;
        } catch (error) {
            console.error('❌ 创建表失败:', error);
            return false;
        }
    }

    // 创建用户资料
    async createUserProfile(profileData) {
        if (!this.supabase) {
            return null;
        }

        // 映射到现有的users表结构
        const mappedData = {
            id: `wallet_${profileData.wallet_address}`,
            username: profileData.nickname,
            first_name: profileData.nickname,
            last_name: '',
            location: profileData.location,
            language: profileData.language || 'zh-CN',
            birth_month: profileData.birthday ? parseInt(profileData.birthday.split('-')[1]) : null,
            birth_day: profileData.birthday ? parseInt(profileData.birthday.split('-')[2]) : null
        };

        try {
            const { data, error } = await this.supabase
                .from('users')
                .insert([mappedData])
                .select()
                .single();

            if (error) {
                console.error('❌ 创建用户资料失败:', error);
                return null;
            }

            console.log('✅ 用户资料已创建:', data.wallet_address);
            return data;
        } catch (error) {
            console.error('❌ 创建用户资料异常:', error);
            return null;
        }
    }

    // 获取用户资料
    async getUserProfile(walletAddress) {
        if (!this.supabase) {
            return null;
        }

        try {
            const { data, error } = await this.supabase
                .from('users')
                .select('*')
                .eq('id', `wallet_${walletAddress}`)
                .single();

            if (error) {
                if (error.code === 'PGRST116') {
                    // 记录不存在
                    return null;
                }
                console.error('❌ 获取用户资料失败:', error);
                return null;
            }

            return data;
        } catch (error) {
            console.error('❌ 获取用户资料异常:', error);
            return null;
        }
    }

    // 更新用户资料
    async updateUserProfile(walletAddress, updateData) {
        if (!this.supabase) {
            return null;
        }

        // 映射到现有的users表结构
        const mappedData = {
            username: updateData.nickname,
            first_name: updateData.nickname,
            location: updateData.location,
            language: updateData.language || 'zh-CN',
            birth_month: updateData.birthday ? parseInt(updateData.birthday.split('-')[1]) : null,
            birth_day: updateData.birthday ? parseInt(updateData.birthday.split('-')[2]) : null
        };

        // 清除undefined值
        Object.keys(mappedData).forEach(key => {
            if (mappedData[key] === undefined || mappedData[key] === null) {
                delete mappedData[key];
            }
        });

        try {
            const { data, error } = await this.supabase
                .from('users')
                .update(mappedData)
                .eq('id', `wallet_${walletAddress}`)
                .select()
                .single();

            if (error) {
                console.error('❌ 更新用户资料失败:', error);
                return null;
            }

            console.log('✅ 用户资料已更新:', data.wallet_address);
            return data;
        } catch (error) {
            console.error('❌ 更新用户资料异常:', error);
            return null;
        }
    }

    // 删除用户资料
    async deleteUserProfile(walletAddress) {
        if (!this.supabase) {
            return false;
        }

        try {
            const { error } = await this.supabase
                .from('users')
                .delete()
                .eq('id', `wallet_${walletAddress}`);

            if (error) {
                console.error('❌ 删除用户资料失败:', error);
                return false;
            }

            console.log('🗑️ 用户资料已删除:', walletAddress);
            return true;
        } catch (error) {
            console.error('❌ 删除用户资料异常:', error);
            return false;
        }
    }

    // 获取所有用户资料（管理功能）
    async getAllUserProfiles(limit = 100) {
        if (!this.supabase) {
            return [];
        }

        try {
            const { data, error } = await this.supabase
                .from('users')
                .select('*')
                .like('id', 'wallet_%')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) {
                console.error('❌ 获取所有用户资料失败:', error);
                return [];
            }

            return data;
        } catch (error) {
            console.error('❌ 获取所有用户资料异常:', error);
            return [];
        }
    }

    // 统计用户数量
    async getUserCount() {
        if (!this.supabase) {
            return 0;
        }

        try {
            const { count, error } = await this.supabase
                .from('users')
                .select('*', { count: 'exact', head: true })
                .like('id', 'wallet_%');

            if (error) {
                console.error('❌ 获取用户数量失败:', error);
                return 0;
            }

            return count;
        } catch (error) {
            console.error('❌ 获取用户数量异常:', error);
            return 0;
        }
    }
}

module.exports = {
    supabase,
    SupabaseUserManager
};