# @novel-adapter-tool/ui-components 贡献指南

我们欢迎所有形式的贡献，以帮助我们构建一个强大、一致且易于使用的共享组件库。本文档旨在为所有开发者提供明确的指导、代码规范和最佳实践。

## 1. 核心设计理念

`@novel-adapter-tool/ui-components` 是我们所有前端应用的"单一真理来源"。它的目标是：

- **简约至上 (Minimalism First)**: 采用简约设计美学，减少视觉噪音，突出内容本身。使用留白、层次和对比来创造焦点，而非过度装饰。
- **内容优先 (Content-First)**: 设计应围绕内容而非装饰展开，确保用户能高效获取和处理信息。
- **一致性 (Consistency)**: 在所有平台和设备上保持视觉语言和交互模式的一致性，降低用户的认知负担。
- **无缝体验 (Seamless Experience)**: 用户在不同设备间切换时，应感受到连贯而非割裂的体验。
- **包容性设计 (Inclusive Design)**: 确保界面对所有用户都友好，包括视力障碍、色盲和运动障碍人士（遵循 WCAG AA 标准）。

## 2. 如何贡献

我们采用标准的 GitHub Fork & Pull Request 工作流。

1.  **Fork** 本仓库。
2.  在你自己的 Fork 中**创建一个新分支** (`git checkout -b feature/my-new-component`)。
3.  进行你的修改和开发。
4.  **提交**你的改动 (`git commit -am 'feat: Add new Avatar component'`)，请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。
5.  **Push** 到你的分支 (`git push origin feature/my-new-component`)。
6.  创建一个**Pull Request** 到主仓库的 `main` 分支。

## 3. 组件开发指南

### 3.1. 文件结构

每个新组件都应遵循以下目录结构。以一个名为 `Avatar` 的新组件为例：

```
src/
└── core/ (或 forms/, navigation/, etc.)
    └── Avatar/
        ├── Avatar.tsx
        ├── Avatar.module.css
        ├── index.ts
```

- **`Avatar.tsx`**: 组件的 React 实现。
- **`Avatar.module.css`**: 组件的样式。**必须**使用 CSS Modules。
- **`index.ts`**: 一个导出文件，内容为 `export * from './Avatar';`。

### 3.2. 样式方案：CSS Modules + CSS 变量

- **CSS Modules**: 所有组件**必须**使用 CSS Modules (`.module.css`) 进行样式隔离，以避免全局样式冲突。
- **CSS 变量**: **必须**使用在 `src/styles/theme.css` 中定义的 CSS 变量（例如 `var(--primary-color)`, `var(--font-size-md)`）来定义颜色、字体、间距等。这确保了与我们的设计系统保持一致，并自动支持主题切换（如暗色模式）。
- **禁止**: **严禁**在组件的 CSS 中硬编码颜色值（如 `#fff` 或 `red`）或使用全局选择器。

### 3.3. API 设计

- **Props**: 组件的 Props 接口应该清晰、类型化，并提供有意义的默认值。
- **可组合性**: 设计组件时应考虑其可组合性。优先利用 `children` prop 传递内容，并避免不必要的 `div` 包装器。
- **可访问性 (a11y)**: 确保组件是可访问的。使用语义化的 HTML，并为交互元素添加适当的 ARIA 属性。所有图片、图标都必须有替代文本。

### 3.4. 导出组件

在创建完新组件后，不要忘记在 `src/index.ts` 中导出它，使其对整个应用可用。

---

## 4. UI/UX 设计风格指南

所有新组件开发和旧组件重构都应严格遵循以下设计指南。

### 4.1. 响应式设计框架

- **移动优先 (Mobile-First)**: 设计时先考虑移动端布局，再逐步扩展到更大屏幕。
- **断点策略 (Breakpoint Strategy)**: 使用在 `theme.css` 中定义的标准断点。

  ```css
  :root {
    --breakpoint-xs: 0;
    --breakpoint-sm: 576px;
    --breakpoint-md: 768px;
    --breakpoint-lg: 992px;
    --breakpoint-xl: 1200px;
    --breakpoint-xxl: 1400px;
  }
  ```

### 4.2. 现代化排版系统

- **字体**: 使用在 `theme.css` 中定义的主字体。
- **响应式字号**: 使用 `clamp()` 实现响应式缩放的字号变量。

  ```css
  :root {
    --font-size-xs: clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem);
    --font-size-sm: clamp(0.875rem, 0.8rem + 0.375vw, 1rem);
    --font-size-md: clamp(1rem, 0.9rem + 0.5vw, 1.125rem);
    --font-size-lg: clamp(1.125rem, 1rem + 0.625vw, 1.25rem);
    --font-size-xl: clamp(1.25rem, 1.125rem + 0.75vw, 1.5rem);
  }
  ```

- **行高与字重**: 使用预定义的行高和字重变量。

### 4.3. 现代色彩系统

- **语义化颜色**: 使用 `primary`, `secondary`, `success`, `error`, `warning`, `info` 等语义化颜色变量。
- **中性色板**: 使用 `--gray-50` 到 `--gray-900` 的中性色板来定义文本、背景和边框颜色。
- **暗色模式 (Dark Mode)**: 所有组件必须通过使用 `--background`, `--text-primary` 等主题变量来自动支持暗色模式。

### 4.4. 现代组件设计

- **卡片 (Card)**: 轻微的阴影和圆角，悬停时有细微的提升效果。
- **按钮 (Button)**: 主按钮、次按钮和文本按钮有明确区分。所有按钮状态（默认、悬停、聚焦、按下、禁用）清晰。移动端触摸目标不小于 48px。
- **表单控件 (Form Controls)**: 简洁的输入框，聚焦时有明确视觉反馈。错误状态显示清晰的提示。

### 4.5. 现代交互与动效

- **微交互**: 为关键操作添加精细的动画反馈。
- **统一动效**: 使用在 `theme.css` 中定义的 `transition-duration` 和 `transition-timing-function` 变量。

**示例：使用一个按钮和卡片**

```tsx
import { Button, Card } from "@novel-adapter-tool/ui-components";

const MyComponent = () => (
  <Card title="My Card">
    <p>This is some content inside the card.</p>
    <Button variant="primary">Click Me</Button>
  </Card>
);
```

请务必从主入口导入，而不是直接指向组件的源文件，这能确保我们可以在不破坏消费者代码的情况下重构内部结构。

---

## 5. 错误处理和边界状态

高质量的组件不仅在"理想状态"下工作良好，在边缘情况下也必须稳健。

### 1. **Props 验证**:

- 对所有传入的 `props` 进行严格的类型定义。
- 在适当的情况下，对 `props` 进行运行时验证，并在开发模式下向控制台发出警告。例如，如果一个组件需要 `onClick` 回调但未提供，则应发出警告。

### 2. **空状态 (Empty State)**:

- 对于渲染数据列表的组件（如 `Table`, `List`），必须设计一个清晰的"空状态"或"无数据"视图。
- 这个视图应该向用户解释为什么没有数据，并可能提供一个操作指引（例如，"点击'添加'按钮来创建第一项"）。

### 3. **加载状态 (Loading State)**:

- 当组件需要异步获取数据时，必须显示一个加载指示器（如 `Spinner` 或 `Skeleton` 骨架屏）。
- 这可以防止布局抖动 (layout shift)，并向用户提供明确的反馈，告知系统正在处理中。

### 4. **错误状态 (Error State)**:

- 如果发生错误（例如，API 请求失败），组件不应崩溃。
- 必须向用户显示一个友好的错误消息，解释发生了什么，并提供一个重试操作（例如，"加载失败，请重试"按钮）。

---

## 6. 代码风格

- **Prettier**: 项目配置了 Prettier，请在提交前确保你的代码已经格式化。
- **命名约定**:
  - 组件: `PascalCase` (e.g., `DataGrid`)
  - CSS 类: `camelCase` (e.g., `cardTitle`)
  - 文件: `PascalCase` (e.g., `DataGrid.tsx`)

---

感谢你的贡献！
