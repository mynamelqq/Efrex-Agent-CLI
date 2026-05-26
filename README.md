# ChatUI-CLI

![ChatUI-CLI Logo](public/efrex%20code.png)

一个由 **YaQi Li (Efrewew)** 开发的终端 AI 编码助手。

## 📝 项目简介

ChatUI-CLI 是一个基于终端的 AI 编码助手，使用 **React + Ink** 构建，提供类似 REPL 的交互界面。它支持与多个大语言模型（Anthropic Claude、OpenAI GPT、Google Gemini、Grok 等）进行交互，并具备工具调用能力，可以帮助开发者完成代码编写、文件操作、命令执行等任务。

## ✨ 核心特性

- 🤖 **多模型支持**：集成 Anthropic、OpenAI、Gemini、Grok 等多个 LLM 提供商
- 🛠️ **工具调用**：内置文件读写、命令执行、网络搜索、代码编辑等工具
- 🎨 **终端 UI**：基于 Ink 的现代终端界面，支持流式输出
- 📦 **上下文管理**：自动压缩对话历史，管理上下文窗口
- 🔒 **权限控制**：工具调用权限管理，保障操作安全
- 💰 **使用统计**：追踪模型使用量、成本估算和余额查询

## 🚀 快速开始

### 前置要求

- [Bun](https://bun.sh/) 运行时
- Node.js 18+ (可选，用于某些工具)

### 安装

```bash
# 克隆项目
git clone <your-repo-url>
cd ChatUI-Cli

# 安装依赖
bun install
```

### 开发模式

```bash
# 启动开发服务器（支持热重载）
bun run dev
# 或
bun --hot ./index.tsx
```

### 生产构建

```bash
# 构建项目
bun run build

# 运行构建后的版本
bun run start
```

## 🧪 测试

```bash
# 运行所有测试
bun test

# 运行特定测试脚本
bun run test/test-glob.ts
```

## 📁 项目结构

```
ChatUI-Cli/
├── src/                    # 主源代码
│   ├── components/         # React 组件
│   ├── tools/              # 工具实现（Bash、文件操作、搜索等）
│   ├── services/           # API 和服务层
│   │   ├── api/           # 模型 API 通信
│   │   ├── tools/         # 工具编排
│   │   ├── compact/       # 消息压缩
│   │   └── providerUsage/ # 使用统计
│   ├── state/             # 状态管理
│   └── utils/             # 工具函数
├── packages/              # 工作区包
│   └── @ant/             # 内部包（ink、model-provider）
├── public/                # 静态资源
├── fixtures/              # 测试夹具
├── dist/                  # 构建输出
└── index.tsx              # 入口文件
```

## 🛠️ 技术栈

- **运行时**: Bun
- **语言**: TypeScript (严格模式)
- **UI 框架**: React 19 + Ink 7
- **AI SDK**: Anthropic SDK, OpenAI SDK
- **代码格式化**: Prettier (tab-width: 4, single quotes)
- **构建工具**: tsup, bun build
- **测试框架**: Bun Test

## 📖 可用命令

在应用内可以使用以下命令：

- `/model` - 切换模型
- `/help` - 显示帮助信息
- `/clear` - 清除对话历史
- 其他命令请在使用中探索

## 🔧 开发指南

### 代码风格

- 使用 TypeScript，启用 `strict` 模式
- 组件使用 `PascalCase`，函数和变量使用 `camelCase`
- 测试文件命名为 `*.test.ts`，放在 `__tests__/` 目录
- 使用 Prettier 格式化代码（tabs, 4 空格缩进）

### 提交规范

提交信息使用简短的命令式主题，通常包含受影响子系统，例如：
- `feat(tools): 添加新工具支持`
- `fix(ui): 修复输入框显示问题`
- `refactor(services): 重构 API 通信层`

## 📊 核心组件

| 组件 | 描述 |
|------|------|
| `QueryApp.tsx` | 主应用组件，处理输入循环、消息渲染、工具执行 |
| `queryEngine.ts` | AI 查询编排，处理流式响应和工具调用 |
| `Tool.ts` | 工具类型定义和验证（基于 Zod） |
| `AppState.tsx` | 状态管理，使用自定义 store 实现 |

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

[待添加]

## 👤 作者

**YaQi Li (Efrewew)**

---

*最后更新: 2026-05-26*
