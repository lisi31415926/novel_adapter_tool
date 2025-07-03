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

---

## 5. UI 设计系统与开发规范

本章节旨在提供UI/UX设计的一致性原则和标准化的开发工作流程，确保所有开发者遵循相同的规范，提升开发效率和最终产品质量。

### 5.1. UI 设计理念 (`@components/*`)

`packages/ui-components` 不仅仅是一个组件库，它是整个前端应用的 **设计系统**，是确保视觉和交互一致性的基石。

- **单一视觉真实源 (Single Source of Visual Truth)**: 所有通用UI元素（按钮、表单、弹窗、布局等）都必须源自 `ui-components` 包。严禁在微应用中创建与通用组件功能重复的"一次性"组件。

- **主题化与样式**:
  - 项目的所有基础样式变量（如主色、辅助色、字体、间距单位）统一定义在 `packages/ui-components/src/styles/theme.css` 中。
  - 所有组件的样式必须优先使用这些预定义的CSS变量，以保证全局主题的统一性，方便未来进行一键换肤。

- **组件开发指南**:
  - **组合优于继承**: 优先通过组合基础组件来构建更复杂的复合组件。
  - **可访问性 (A11y)**: 开发新组件时，必须考虑可访问性，正确使用ARIA属性和语义化HTML标签。
  - **接口定义**: 组件的`props`必须拥有清晰、完整的TypeScript类型定义，并提供必要的注释。

- **如何使用共享组件**:
  - 始终通过 `@components/*` 别名导入。
  - **示例**: `import { Button, TextInput } from '@components/forms';`

### 5.2. 核心开发工作流程

为保证架构的完整性和一致性，所有开发者必须遵循以下标准化流程。

#### A. 如何添加一个新的微应用 (以 `newManager` 为例)

1.  **创建目录**: 在 `apps/` 目录下创建新应用的文件夹 `newManager`。
2.  **注册应用**: 打开 `frontend-react/micro-frontends.config.js`，在 `microApps` 对象中添加 `newManager` 的配置。明确其 `name`, `exposes` 和 `remotes`。
3.  **定义路由**: 在同一个配置文件的 `getMicroAppByPath` 函数内部，向 `pathMapping` 对象添加新的路由映射，例如 `'/new-manager': 'newManager'`。
4.  **更新配置**: 在 `frontend-react` 目录下执行 `pnpm install` 和 `pnpm run update-vite-configs` (假设脚本名称为此，请根据 `package.json` 确认)。此脚本将根据中央配置自动生成或更新微应用的 `vite.config.ts`。
5.  **开发实现**: 在 `apps/newManager/src` 中开发你的应用组件，并确保主入口组件已在 `exposes` 中正确暴露。

#### B. 如何向 `ui-components` 贡献一个新组件

1.  **创建文件**: 在 `packages/ui-components/src/` 合适的分类目录下（如 `forms`, `data-display`）创建组件文件。
2.  **编写组件**: 编写组件代码，并使用 `theme.css` 中的CSS变量进行样式设置。
3.  **导出组件**: 从分类目录的 `index.ts` 和 `packages/ui-components/src/index.ts` 中导出新组件，使其可以被外部引用。
4.  **编写文档 (强烈建议)**: 在 `packages/ui-components/docs/` 目录下为新组件添加说明文档和使用示例。

#### C. 如何添加或修改一条路由

1.  **定位路由表**: 打开 `frontend-react/micro-frontends.config.js`。
2.  **修改映射**: 在文件底部的 `getMicroAppByPath` 函数中，找到 `pathMapping` 常量。
3.  **更新路径**: 添加新的路径到应用的映射，或修改现有映射。例如，增加 `'/settings/profile': 'configManager'`。路由的变更会由 `shell` 应用自动处理。

### 5.3. 架构最佳实践

- **配置驱动开发**: **任何** 涉及应用边界、共享依赖或路由的变更，都**必须**首先修改 `micro-frontends.config.js`。这是所有操作的起点。
- **严禁手动修改 `vite.config.ts`**: 重复强调，此文件是自动生成的，任何手动修改都会在下次脚本执行时被覆盖，并可能导致整个系统行为不一致。
- **统一状态管理**: 优先使用 `@novel-adapter-tool/state-manager` 提供的Hooks (`useShell`, `useUI` 等)。避免在应用中直接引入 `valtio` 或 `zustand`，以保持状态管理策略的统一和可控。
- **拥抱路径别名**: 在所有应用和包中，坚持使用 `@/*`, `@components/*`, `@api-client/*` 等路径别名进行导入，这能极大增强代码的可读性和可维护性。
- **明确的依赖边界**: 微应用之间严禁直接相互导入模块。它们之间的通信应通过 `shell` 暴露的共享模块（如 `eventBus`）或全局状态来进行，或者通过路由进行解耦。

---

## 6. 自动化API层

为了实现前后端的松耦合与高效协作，本项目采用**由API规范驱动的自动化架构**。前端的 `api-client` 并非手动编写，而是根据后端提供的 `OpenAPI` 规范自动生成，从根本上杜绝了接口不匹配、类型错误和繁琐的手动更新工作。

### 6.1. 核心理念：API规范即代码

- **真理之源**: 后端提供的 `openapi.json` (或等效的API规范文件) 是API的唯一“真理之源”。
- **自动化生成**: `api-client` 包中的所有请求方法、数据类型和React Query Hooks均由脚本自动生成。
- **类型安全**: 生成过程会创建完整的TypeScript类型，为所有API交互提供端到端的类型安全保障。

### 6.2. 关键文件与工具

- **API规范 (输入)**: 一个 `openapi.json` 文件，应由后端团队提供。
- **生成脚本 (工具)**: `frontend-react/scripts/ai-assistant/api-client-generator.js`。这是读取API规范并生成代码的核心工具。
- **生成代码 (输出)**: `frontend-react/packages/api-client/src/generated/`。所有自动生成的代码都位于此目录。**此目录下的任何文件都严禁手动修改**。
- **运行时 (消费端)**: `@novel-adapter-tool/api-client` 包，供所有微应用消费。

### 6.3. 开发工作流

#### A. 何时需要重新生成API客户端？

当后端API发生任何变更时（例如：新增/修改/删除接口、请求参数变更、返回数据结构变化），都**必须**重新生成API客户端。

#### B. 如何重新生成？

1.  **获取规范**: 从后端获取最新的 `openapi.json` 文件，并将其放置在 `frontend-react/api-spec/` 目录下。
2.  **执行脚本**: 在 `frontend-react` 目录下，运行代码生成脚本。命令示例如下（具体参数请参考脚本内部实现）：
    ```bash
    node ./scripts/ai-assistant/api-client-generator.js \
      --input ./api-spec/openapi.json \
      --output ./packages/api-client/src/generated
    ```
3.  **验证变更**: 检查 `git diff`，确认 `packages/api-client/src/generated/` 目录下的代码已根据API变更自动更新。

### 6.4. 如何在应用中使用API客户端

生成器最大的便利是它与 `@tanstack/react-query` 的深度集成，为每个API端点都创建了对应的自定义Hook。

- **命名约定**: Hook的命名通常与API操作直接相关，例如 `GET /novels/{id}` 对应 `useGetNovelById`，`POST /novels` 对应 `useCreateNovel`。

- **使用示例**: 在组件中获取一篇小说的信息。

  ```tsx
  // File: apps/novel-manager/src/components/NovelDetails.tsx

  import { useGetNovelById } from "@api-client/hooks"; // 假设Hook从这里导出
  import { Spin, Alert } from "@components/feedback";

  function NovelDetails({ novelId }: { novelId: string }) {
    const {
      data: novel,
      isLoading,
      isError,
      error,
    } = useGetNovelById(novelId, {
      // React Query options, e.g., enabling/disabling the query
      enabled: !!novelId,
    });

    if (isLoading) {
      return <Spin tip="正在加载小说详情..." />;
    }

    if (isError) {
      return <Alert type="error" message={`加载失败: ${error.message}`} />;
    }

    return (
      <div>
        <h1>{novel?.title}</h1>
        <p>{novel?.summary}</p>
      </div>
    );
  }
  ```

- **请求配置与错误处理**:
  - 通用的请求配置（如 `baseURL`、`timeout`、`headers` 中认证Token的附加）集中在 `packages/api-client/src/core/axios-instance.ts` 中完成。
  - 全局的错误处理逻辑（如处理401未授权、500服务器错误）则封装在 `packages/api-client/src/core/error-handler.ts` 中，对业务代码透明。
