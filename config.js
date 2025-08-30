/**
 * 应用配置文件
 * 生产环境部署时只需修改此文件
 */

const AppConfig = {
    // API服务器配置
    API: {
        // 开发环境
        development: {
            baseURL: 'http://localhost:3000',
            timeout: 10000
        },
        // 生产环境 - 使用相对路径，Vercel会自动处理
        production: {
            baseURL: '', // 空字符串表示使用相对路径
            timeout: 15000
        }
    },
    
    // 当前环境 - 自动检测
    environment: (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) ? 'development' : 'production',
    
    // 获取API基础URL
    getApiUrl() {
        const baseURL = this.API[this.environment].baseURL;
        // 生产环境返回空字符串表示使用相对路径
        return baseURL;
    },
    
    // 注意：Supabase访问已迁移到后端，前端不再需要直接访问
    // supabase配置已移除以提高安全性
    
    // 功能开关
    features: {
        enableLocalStorage: false,  // 生产环境应设为false
        enableDebugLogs: (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')), // 自动检测
        requireWalletSignature: false, // TODO: 生产环境应设为true
    },
    
    // 错误消息
    messages: {
        networkError: '网络连接失败，请检查网络后刷新页面',
        saveError: '保存失败，请重试',
        deleteError: '删除失败，请重试',
        loadError: '加载失败，请刷新页面'
    }
};

// 导出配置
window.AppConfig = AppConfig;

console.log(`📋 应用配置已加载 - 环境: ${AppConfig.environment}`);