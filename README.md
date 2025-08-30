# VRM + Mixamo 动画示例

这是一个使用 Three.js 和 @pixiv/three-vrm 将 Mixamo FBX 动画应用到 VRM 模型的完整示例。

## 🌟 功能特性

- ✅ 加载和显示 VRM 模型
- ✅ 加载 Mixamo FBX 动画文件
- ✅ 自动骨骼重定向（Mixamo → VRM）
- ✅ 动画平滑切换和交叉淡化
- ✅ 实时动画速度控制
- ✅ 现代化 UI 界面
- ✅ 完整的错误处理和状态显示

## 📁 项目结构

```
VRM/
├── index.html                 # 主页面文件
├── vrm-animation-retarget.js  # 动画重定向工具（可选）
├── Fliza VRM.vrm             # 你的 VRM 模型文件
├── mixamo animation/          # Mixamo 动画文件夹
│   ├── Crying.fbx
│   ├── Happy.fbx
│   ├── Neutral Idle.fbx
│   ├── Thinking.fbx
│   └── ...（其他动画文件）
└── README.md                 # 说明文档
```

## 🚀 快速开始

### 1. 准备文件

确保你的项目目录包含：
- `Fliza VRM.vrm` - 你的 VRM 模型文件
- `mixamo animation/` 文件夹，包含 Mixamo FBX 动画文件

### 2. 启动本地服务器

由于浏览器安全限制，你需要通过 HTTP 服务器运行项目。

**方法一：使用 Python**
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

**方法二：使用 Node.js**
```bash
npx http-server -p 8000
```

**方法三：使用 VS Code Live Server 扩展**

### 3. 打开浏览器

访问 `http://localhost:8000` 即可看到示例运行。

## 🎮 使用说明

### 控制面板

- **动画按钮**：点击加载并播放不同的动画
- **动画速度**：调整动画播放速度（0-2倍速）
- **交叉淡化时间**：设置动画切换的过渡时间

### 视角控制

- **鼠标拖动**：旋转视角
- **鼠标滚轮**：缩放视角
- **右键拖动**：平移视角

## 🔧 技术实现

### 核心技术栈

- **Three.js**: 3D 图形库
- **@pixiv/three-vrm**: VRM 模型支持
- **FBXLoader**: FBX 动画加载
- **OrbitControls**: 摄像机控制

### 骨骼映射

项目包含完整的 Mixamo 到 VRM 骨骼名称映射：

```javascript
const MIXAMO_TO_VRM_BONE_MAP = {
    'Hips': 'hips',
    'Spine': 'spine',
    'Spine1': 'chest',
    'Spine2': 'upperChest',
    'Neck': 'neck',
    'Head': 'head',
    // ... 更多骨骼映射
};
```

### 动画重定向流程

1. 加载 FBX 文件并提取动画数据
2. 遍历原始动画轨道
3. 通过骨骼映射表找到对应的 VRM 骨骼
4. 创建新的动画轨道指向 VRM 骨骼
5. 生成重定向后的 AnimationClip

## 📝 添加新动画

### 1. 添加 FBX 文件

将新的 Mixamo FBX 文件放入 `mixamo animation/` 文件夹。

### 2. 更新配置

在 `index.html` 中的 `animations` 对象添加新动画：

```javascript
const animations = {
    'crying': './mixamo animation/Crying.fbx',
    'happy': './mixamo animation/Happy.fbx',
    'neutral': './mixamo animation/Neutral Idle.fbx',
    'thinking': './mixamo animation/Thinking.fbx',
    'newAnimation': './mixamo animation/NewAnimation.fbx'  // 添加这行
};
```

### 3. 添加按钮

在 HTML 中添加新的按钮：

```html
<button id="newAnimBtn" onclick="loadNewAnimation()">🆕 播放新动画</button>
```

### 4. 添加控制函数

```javascript
window.loadNewAnimation = () => loadAnimation('newAnimation', 'newAnimBtn');
```

## 🔨 自定义和扩展

### 调整动画参数

可以修改以下参数来优化动画效果：

```javascript
// 在 retargetMixamoToVRM 函数中
const options = {
    scaleToVRM: true,           // 是否缩放到 VRM 尺寸
    adjustRotations: true,      // 是否调整旋转
    adjustPositions: true,      // 是否调整位置
    preserveHipsHeight: true    // 是否保持髋部高度
};
```

### 骨骼映射调整

如果动画效果不理想，可以调整骨骼映射表或添加坐标系转换：

```javascript
// 四元数旋转调整示例
function adjustQuaternionForVRM(quaternionArray, boneName) {
    // 根据具体需求调整旋转
    // 例如：[x, y, z, w] = [-x, y, -z, w];
}
```

## 🐛 常见问题

### 1. 模型不显示

- 检查 VRM 文件路径是否正确
- 确保通过 HTTP 服务器运行项目
- 查看浏览器控制台的错误信息

### 2. 动画加载失败

- 确认 FBX 文件路径正确
- 检查 FBX 文件是否包含动画数据
- 验证文件没有损坏

### 3. 动画效果异常

- 调整骨骼映射表
- 检查 Mixamo 动画的骨骼命名
- 尝试不同的坐标系转换

### 4. 性能问题

- 减少阴影质量：`renderer.shadowMap.setSize(1024)`
- 禁用不必要的后处理效果
- 优化模型的面数和纹理大小

## 📚 学习资源

- [Three.js 官方文档](https://threejs.org/docs/)
- [VRM 规范](https://vrm.dev/)
- [@pixiv/three-vrm 文档](https://pixiv.github.io/three-vrm/)
- [Mixamo 动画库](https://www.mixamo.com/)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目！

## 📄 许可证

MIT License

---

**提示**：这个示例专门用于学习 VRM 和 Mixamo 动画的集成。在生产环境中使用时，请确保遵循相关的许可证要求。 