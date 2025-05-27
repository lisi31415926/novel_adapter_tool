// frontend-react/src/App.tsx
import React, { useState, Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link as RouterLink, useLocation, Outlet } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import './styles/global.css'; // 全局样式
import styles from './App.module.css'; // App 组件特定样式

import { WorkbenchProvider } from './contexts/WorkbenchContext'; // 工作台上下文

// Ant Design 全局配置（通常在 main.tsx 中配置，如果在此处，则取消注释）
// import { ConfigProvider as AntConfigProvider } from 'antd';
// import 'antd/dist/reset.css';

// Lucide React 图标库
import {
    Menu as MenuIcon,
    X as CloseIcon,
    BookOpen,
    Settings,
    ListChecks,
    Edit3,
    Lightbulb,
    LayoutDashboard,
    Github,
    Users as UsersIcon, // 在侧边栏中未使用，但保留以防万一
    Zap as EventIcon, // 在侧边栏中未使用，但保留以防万一
    ShieldAlert as ConflictIcon, // 在侧边栏中未使用
    Link as RelationshipLinkIcon, // 在侧边栏中未使用
    GitFork, // 在侧边栏中未使用
    Loader,
    AlertTriangle,
    Database as DatabaseIcon,
} from 'lucide-react';

// --- 页面组件的动态导入 (Lazy Loading) ---
const NovelsPage = lazy(() => import('./pages/NovelsPage'));
const NovelDetailPage = lazy(() => import('./pages/NovelDetailPage'));
const RuleChainsPage = lazy(() => import('./pages/RuleChainsPage'));
const RuleChainEditorPage = lazy(() => import('./pages/RuleChainEditorPage'));
const ChapterProcessorPage = lazy(() => import('./pages/ChapterProcessorPage'));
const AdaptationWorkbenchPage = lazy(() => import('./pages/AdaptationWorkbenchPage'));
const AdaptationPlannerPage = lazy(() => import('./pages/AdaptationPlannerPage'));
const ConfigurationPage = lazy(() => import('./pages/ConfigurationPage'));

// 列表页面
const CharacterListPage = lazy(() => import('./pages/CharacterListPage'));
const EventListPage = lazy(() => import('./pages/EventListPage'));
const ConflictListPage = lazy(() => import('./pages/ConflictListPage'));
const CharacterRelationshipListPage = lazy(() => import('./pages/CharacterRelationshipListPage'));

// 剧情规划相关页面
const PlotVersionListPage = lazy(() => import('./pages/PlotVersionListPage'));
const PlotVersionEditorPage = lazy(() => import('./pages/PlotVersionEditorPage'));

// 规则模板库相关页面
const RuleTemplatesPage = lazy(() => import('./pages/RuleTemplatesPage'));
const RuleTemplateEditorPage = lazy(() => import('./pages/RuleTemplateEditorPage'));


// --- 布局组件 ---
// 应用头部组件
const AppHeader: React.FC<{ onToggleSidebar: () => void; isSidebarOpen: boolean }> = ({ onToggleSidebar, isSidebarOpen }) => (
  <header className={styles.appHeader}>
    <button
      onClick={onToggleSidebar}
      className={styles.sidebarToggleButton}
      aria-label={isSidebarOpen ? "关闭侧边导航栏" : "打开侧边导航栏"}
      title={isSidebarOpen ? "关闭侧边导航栏" : "打开侧边导航栏"}
    >
      {isSidebarOpen ? <CloseIcon size={24} /> : <MenuIcon size={24} />}
    </button>
    <RouterLink to="/" className={styles.logoArea} title="返回应用首页">
      <LayoutDashboard size={28} className={styles.appLogoIcon}/>
      <span className={styles.appName}>AI小说改编工具</span>
    </RouterLink>
    <div className={styles.headerRightActions}>
        <a href="https://github.com/Chechenghao/AI-Novel-Adapter" target="_blank" rel="noopener noreferrer" className={styles.githubLink} title="查看项目GitHub仓库 (AI Novel Adapter Tool)">
            <Github size={22}/>
        </a>
    </div>
  </header>
);

// 应用侧边栏导航组件
const AppSidebar: React.FC<{ isOpen: boolean; closeSidebar?: () => void }> = ({ isOpen, closeSidebar }) => {
  const location = useLocation(); // 用于高亮当前活动链接

  // 导航项定义 (与 大纲.txt 中的规划保持一致)
  const navItems = [
    { path: "/novels", label: "小说管理", icon: <BookOpen size={18} /> },
    { path: "/rule-chains", label: "规则链管理", icon: <ListChecks size={18} /> },
    { path: "/rule-templates", label: "规则模板库", icon: <DatabaseIcon size={18} /> }, // 新增
    { path: "/workbench", label: "改编工作台", icon: <Edit3 size={18} /> },
    { path: "/planner", label: "智能规划器", icon: <Lightbulb size={18} /> },
    { path: "/config", label: "应用配置", icon: <Settings size={18} /> },
  ];

  return (
    <aside className={`${styles.appSidebar} ${isOpen ? styles.open : styles.closed}`}>
      <nav>
        <ul>
          {navItems.map(item => (
            <li key={item.path}>
              <RouterLink
                to={item.path}
                className={`${styles.navLink} ${
                  // 改进活动链接的判断逻辑
                  (location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(item.path + "/")))
                    ? styles.activeLink
                    : ""
                }`}
                onClick={closeSidebar} // 在小屏幕上，点击链接后关闭侧边栏
                title={`导航到 ${item.label} 页面`}
              >
                {item.icon}
                <span>{item.label}</span>
              </RouterLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
};

// 主应用布局组件 (包含头部、侧边栏和主内容区)
const AppMainLayout: React.FC = () => {
  // 侧边栏的打开/关闭状态，并尝试从 localStorage 读取初始状态
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    const savedState = localStorage.getItem('sidebarOpenState');
    if (savedState !== null) {
      try {
        const parsedState = JSON.parse(savedState);
        if (typeof parsedState === 'boolean') return parsedState;
      } catch (e) {
        console.warn("解析侧边栏状态 (sidebarOpenState) 从 localStorage 失败:", e);
        localStorage.removeItem('sidebarOpenState'); // 清理无效状态
      }
    }
    return window.innerWidth >= 768; // 默认在较大屏幕上展开
  });

  // 当侧边栏状态变化时，保存到 localStorage
  useEffect(() => {
    localStorage.setItem('sidebarOpenState', JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  // 在小屏幕设备上，当导航发生时自动关闭侧边栏
  const closeSidebarOnNavigate = () => {
    if (window.innerWidth < 768 && isSidebarOpen) {
      setIsSidebarOpen(false);
    }
  };

  return (
    <div className={`${styles.appLayout} ${isSidebarOpen ? styles.sidebarOpenLayout : styles.sidebarClosedLayout}`}>
      <AppHeader onToggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />
      <AppSidebar isOpen={isSidebarOpen} closeSidebar={closeSidebarOnNavigate} />
      <main className={styles.mainContent}>
        <Suspense fallback={<PageSuspenseFallback message="加载页面内容..." />}>
          <Outlet /> {/* 子路由的组件将在此渲染 */}
        </Suspense>
      </main>
    </div>
  );
};

// 页面懒加载时的通用回退 UI
const PageSuspenseFallback: React.FC<{ message?: string }> = ({ message = "页面加载中，请稍候..." }) => (
    <div className={styles.pageLoadingFallback}>
        <Loader size={32} className={styles.spinningIcon}/> {/* 应用旋转样式 */}
        <span>{message}</span>
    </div>
);

// 404 页面组件
const NotFoundPage: React.FC = () => (
  <div className={styles.notFoundPage}>
    <AlertTriangle size={48} color="var(--color-warning)" style={{ marginBottom: 'var(--spacing-md)' }} />
    <h2>404 - 页面未找到</h2>
    <p>抱歉，您访问的页面不存在或已被移动。</p>
    <RouterLink to="/" className="btn btn-primary">返回首页</RouterLink> {/* 使用全局按钮样式 */}
  </div>
);

// 应用主组件
function App() {
  return (
    // 使用 WorkbenchProvider 包裹整个应用，提供全局状态
    <WorkbenchProvider>
      <Router>
        {/* Toast 消息容器，用于全局消息提示 */}
        <ToastContainer
          position="top-right"
          autoClose={4000} // 自动关闭延迟
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="colored" // 使用彩色主题
        />
        {/* 定义应用路由 */}
        <Routes>
          <Route path="/" element={<AppMainLayout />}> {/* 所有路由都使用 AppMainLayout 布局 */}
            {/* 根路径重定向到小说管理页 */}
            <Route index element={<Navigate to="/novels" replace />} />

            {/* 小说相关路由 (与 大纲.txt 保持一致) */}
            <Route path="novels" element={<NovelsPage />} />
            <Route path="novels/:novelId" element={<NovelDetailPage />} />
            {/* 列表页路由 */}
            <Route path="novels/:novelId/characters" element={<CharacterListPage />} />
            <Route path="novels/:novelId/events" element={<EventListPage />} />
            <Route path="novels/:novelId/conflicts" element={<ConflictListPage />} />
            <Route path="novels/:novelId/relationships" element={<CharacterRelationshipListPage />} />
            {/* 章节处理器路由 (路径参数是 novelId 和 chapterId) */}
            <Route path="novels/:novelId/processor/:chapterId" element={<ChapterProcessorPage />} />
            
            {/* 规则链相关路由 */}
            <Route path="rule-chains" element={<RuleChainsPage />} />
            <Route path="rule-chains/edit/:chainId" element={<RuleChainEditorPage />} /> {/* 支持 "new" 或数字ID */}
            
            {/* 规则模板库相关路由 */}
            <Route path="rule-templates" element={<RuleTemplatesPage />} />
            <Route path="rule-templates/new" element={<RuleTemplateEditorPage />} />
            <Route path="rule-templates/edit/:templateId" element={<RuleTemplateEditorPage />} />
            
            {/* 剧情版本与分支相关路由 */}
            <Route path="novels/:novelId/branches/:branchId/versions" element={<PlotVersionListPage />} />
            <Route path="novels/:novelId/branches/:branchId/versions/edit/:versionId" element={<PlotVersionEditorPage />} />
            <Route path="novels/:novelId/branches/:branchId/versions/new" element={<PlotVersionEditorPage />} />

            {/* 其他功能性页面路由 */}
            <Route path="workbench" element={<AdaptationWorkbenchPage />} />
            <Route path="planner" element={<AdaptationPlannerPage />} />
            <Route path="config" element={<ConfigurationPage />} />
            
            {/* 404 未找到页面 (通配符路由) */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Router>
    </WorkbenchProvider>
  );
}

export default App;