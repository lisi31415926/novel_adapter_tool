# 前端架构设计文档 (V3 - 最终版)

“开发者禁止手动修改任何vite.config.ts文件。所有微前端的配置变更都必须通过修改micro-frontends.config.js并执行相应脚本来完成。”

本文档是针对 `frontend-react` 项目的**最终版**架构分析，旨在提供一份可供AI和开发者直接使用的、极其详尽的开发指导蓝图。

## 核心思想：由配置驱动的自动化架构

本项目的基石是一个位于 `frontend-react/micro-frontends.config.js` 的中央配置文件。**此文件是整个架构的"真理之源" (Single Source of Truth)**。

个别微应用中的 `vite.config.ts` 文件并非手动维护，而是由位于 `frontend-react/scripts/` 目录下的**自动化工具**根据这个中央配置文件进行管理和驱动。这种模式确保了整个微前端生态系统的高度一致性和可维护性。

---

## 1. 中央配置文件: `micro-frontends.config.js`

这是理解一切的钥匙。它定义了微前端的方方面面。

### a. 共享依赖 (`sharedDependencies`)

该对象通过读取根目录 `package.json` 动态生成，确保所有微应用共享完全相同版本的核心库（如 React, antd, Valtio），避免了版本冲突和重复打包。

```javascript
// File: frontend-react/micro-frontends.config.js

const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
const { dependencies } = packageJson;

const sharedDependencies = {
  react: { singleton: true, requiredVersion: dependencies.react },
  "react-dom": { singleton: true, requiredVersion: dependencies["react-dom"] },
  // ... and other shared libraries
};
```

### b. 微应用定义 (`microApps`)

此对象是所有应用的注册表，清晰地定义了每个应用的角色、接口和依赖。

- **`shell` (Host)**: 作为Host，它不消费任何`remotes`，但通过`exposes`向外提供系统级的共享功能。
- **业务应用 (Remotes)**: 每个业务应用都从 `shell` 消费共享模块，并通过`exposes`暴露自己的核心业务组件。

```javascript
// File: frontend-react/micro-frontends.config.js

const microApps = {
  shell: {
    name: "shell",
    exposes: {
      "./sharedHooks": "./src/hooks/useSharedState.ts",
      "./eventBus": "./src/utils/eventBus.ts",
      "./Layout": "./src/components/Layout/index.tsx",
    },
    remotes: {}, // Is a Host
    shared: sharedDependencies,
  },
  chapterEditor: {
    name: "chapterEditor",
    exposes: {
      "./ChapterEditor": "./src/pages/ChapterProcessorPage.tsx",
    },
    remotes: {
      // Is a Remote
      shell: "shell@http://localhost:3000/remoteEntry.js",
    },
    shared: sharedDependencies,
  },
  // ... all other apps
};
```

### c. 路由映射 (`pathMapping`)

文件末尾的 `getMicroAppByPath` 函数内部包含一个 `pathMapping` 对象，这是整个应用的**主路由表**。它将URL路径精确地映射到应负责处理该路径的微应用。

```javascript
// File: frontend-react/micro-frontends.config.js

export function getMicroAppByPath(path) {
  const pathMapping = {
    "/": "shell",
    "/novels": "novelManager",
    "/novels/editor": "chapterEditor",
    "/characters": "characterManager",
    "/settings": "configManager",
    // ... all other routes
  };
  // ...
}
```

---

## 2. 应用与包的角色定位

### 微应用 (`apps/`)

| 应用名称 (`name`)   | 启动端口 | 核心职责                       | 暴露的关键模块 (`exposes`)                         |
| ------------------- | -------- | ------------------------------ | -------------------------------------------------- |
| `shell`             | 3000     | 系统基座、布局、共享模块提供方 | `Layout`, `sharedHooks`, `eventBus`                |
| `novelManager`      | -        | 小说列表管理、创建、元数据编辑 | `NovelManager`, `NovelEditor`, `ChapterList`       |
| `chapterEditor`     | 5001     | 章节内容的富文本编辑与处理     | `ChapterEditor`, `TextEditor`                      |
| `characterManager`  | -        | 角色管理、关系图谱             | `CharacterManager`, `RelationshipMap`              |
| `ruleEngine`        | -        | 改编规则的创建、编辑和可视化   | `RuleEngine`, `RuleEditor`                         |
| `eventManager`      | -        | 故事线、事件、时间轴管理       | `EventManager`, `EventTimeline`                    |
| `adaptationPlanner` | -        | 整体改编规划、工作台           | `AdaptationPlannerPage`, `AdaptationWorkbenchPage` |
| `configManager`     | -        | 全局应用配置、LLM模型配置      | `ConfigurationPage`, `ApplicationSettings`         |

### 共享包 (`packages/`)

| 包名称 (`name`) | 核心职责                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `state-manager` | **状态管理核心**: 封装 `Valtio`, `Zustand`, `React Query`，通过自定义Hooks（如 `useShell`, `useUI`）为上层提供统一、便捷的状态访问接口。 |
| `ui-components` | **UI组件库**: 提供全局统一的、风格化的React组件，如 `Table`, `Button`, `Modal` 等。                                                      |
| `api-client`    | **API客户端**: 封装 `axios` 或 `fetch`，提供类型安全的数据请求方法，与 `React Query` 深度集成。                                          |
| `types`         | **类型定义**: 存放整个项目共享的TypeScript类型，特别是API返回的数据结构。                                                                |

---

## 3. 状态管理策略

项目采用了分层、清晰的状态管理方案：

1.  **远程状态 (Server State)**: 使用 **`@tanstack/react-query`** 来处理所有与后端API交互的状态，包括数据缓存、自动刷新、请求重试等。
2.  **全局客户端状态 (Global Client State)**: 使用 **`Valtio`** 或 **`Zustand`** (根据`README`和配置) 来管理跨应用共享的、与UI相关的状态，例如当前主题、用户信息等。
3.  **状态封装**: **`@novel-adapter-tool/state-manager`** 包将以上库进行封装，对外提供简洁的Hooks，隔离了底层实现，方便未来替换或升级。

---

## 4. 依赖与导入指南

为保证项目结构清晰、代码可维护性高，我们制定了统一的依赖与模块导入规范。

### 4.1. TypeScript 路径别名核心配置 (`tsconfig.base.json`)

整个 `frontend-react` 工作区的 TypeScript 路径别名（Path Alias）由位于 `packages/tsconfig.base.json` 的文件统一管理。这个文件是路径解析的"真理之源"，确保了所有微应用和共享包都遵循相同的解析规则。

**核心配置如下:**

```json
// File: frontend-react/packages/tsconfig.base.json
{
  "compilerOptions": {
    // ...
    "baseUrl": "./",
    "paths": {
      "@/*": ["src/*"],
      "@api-client/*": ["api-client/src/*"],
      "@components/*": ["ui-components/src/*"]
    }
    // ...
  }
}
```

**别名解析:**

- `@/*`: 在**各自的应用或包内部**，`@/` 会被解析为其 `src` 目录。例如，在 `apps/shell` 中，`@/components/Layout` 会指向 `apps/shell/src/components/Layout`。
- `@api-client/*`: 提供了对 `api-client` 包内部模块的直接访问。例如 `import { apiClient } from '@api-client/core';`。
- `@components/*`: 提供了对 `ui-components` 包内部模块的直接访问。例如 `import { Button } from '@components/forms';`。

所有微应用和包的 `tsconfig.json` 文件都应**继承**这个基础配置，以确保路径别名全局生效。

```json
// Example: apps/shell/tsconfig.json
{
  "extends": "../../packages/tsconfig.base.json",
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### 4.2. 导入场景示例

**场景1：在微应用中使用共享UI组件**

- **目标**: 在 `chapter-editor` 中使用一个通用按钮。
- **代码**: `import { Button } from '@components/forms/Button';` (具体路径取决于 `ui-components` 的导出结构)
- **原理**: `pnpm` 工作区（Workspaces）将 `packages/ui-components` 链接到 `node_modules`，同时 `tsconfig.base.json` 中的 `@components/*` 别名提供了类型提示和编译时路径解析。

**场景2：在微应用中使用全局状态**

- **目标**: 在 `character-manager` 中获取通知功能。
- **代码**: `import { useUI } from '@novel-adapter-tool/state-manager'; const { addNotification } = useUI();`
- **原理**: 通过`pnpm`工作区链接。`state-manager`内部的hooks通过`shell`应用经由模块联邦共享给所有微应用。

**场景3：应用内部的文件导入**

- **目标**: 在`shell`应用中从`pages`目录导入`HomePage`。
- **代码**: `import HomePage from '@/pages/HomePage';`
- **原理**: 每个微应用的 `tsconfig.json` 继承了 `tsconfig.base.json`，其中的 `@/*` 别名将 `@` 指向了当前应用的 `src` 目录，从而简化内部导入。

**场景4：跨应用页面跳转（路由）**

- **目标**: 从小说的列表页（`novelManager`）跳转到章节编辑页（`chapterEditor`）。
- **代码**: `import { Link } from 'react-router-dom'; <Link to="/novels/editor/some-id">Edit Chapter</Link>`
- **原理**: 开发者无需关心模块联邦的动态导入。`shell` 应用作为路由中枢，会根据 `micro-frontends.config.js` 中的 `pathMapping`，在URL改变时自动加载并显示对应的微应用。
