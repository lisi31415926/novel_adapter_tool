// frontend-react/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App'; //
import './styles/global.css'; //

// --- Ant Design 全局配置 ---
import { ConfigProvider, theme as antdTheme } from 'antd'; // 从 antd 导入 ConfigProvider 和 theme 对象
import 'antd/dist/reset.css'; // 引入 Ant Design v5+ 的重置样式

// --- 全局错误边界组件 (与您提供的版本一致) ---
interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackUI?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error: error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("全局错误边界捕获到错误:", error, errorInfo); //
    this.setState({ errorInfo: errorInfo });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallbackUI) {
        return this.props.fallbackUI;
      }
      return (
        <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'sans-serif', color: '#333' }}>
          <h1>应用遇到错误</h1>
          <p>抱歉，应用发生了一个无法恢复的错误。请尝试刷新页面，或联系技术支持。</p>
          {process.env.NODE_ENV === 'development' && (
            <details style={{ whiteSpace: 'pre-wrap', marginTop: '20px', textAlign: 'left', background: '#f0f0f0', padding: '10px', borderRadius: '4px' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>错误详情 (开发模式)</summary>
              <p><strong>错误信息:</strong> {this.state.error && this.state.error.toString()}</p>
              {this.state.errorInfo && <p><strong>组件栈:</strong><br/>{this.state.errorInfo.componentStack}</p>}
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
// --- 结束全局错误边界组件 ---


const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("未能找到ID为 'root' 的根DOM元素。请确保您的 public/index.html 文件中包含一个 <div id=\"root\"></div> 标签。"); //
}

const root = ReactDOM.createRoot(rootElement);

// --- 定义 Ant Design 自定义主题 (可选) ---
// 您可以在这里根据项目的品牌和视觉风格进行更细致的配置
// 参考 Ant Design 文档：https://ant.design/docs/react/customize-theme-cn
const customAntDTheme = {
  // 使用 Ant Design 内置的算法来生成主题的派生颜色，以确保一致性
  algorithm: antdTheme.defaultAlgorithm, // 或者 antdTheme.darkAlgorithm, antdTheme.compactAlgorithm
  token: {
    // 主题色 (例如，匹配您 global.css 中的 --color-primary)
    colorPrimary: 'var(--color-primary)', // 直接使用 CSS 变量
    // colorSuccess: '#28a745', // 成功色
    // colorWarning: '#ffc107', // 警告色
    // colorError: '#dc3545',   // 错误色
    // colorInfo: '#0dcaf0',    // 信息色

    // 字体相关
    // fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif", // 与 global.css 保持一致
    // fontSize: 14, // AntD 默认基础字号

    // 圆角
    borderRadius: 6, // AntD 默认圆角大小 (6px)
    // borderRadiusSM: 4,
    // borderRadiusLG: 8,

    // 布局相关
    // controlHeight: 32, // 控件高度 (Input, Button, Select 等)
    // controlHeightSM: 24,
    // controlHeightLG: 40,
  },
  components: {
    // 可以针对特定组件进行样式微调
    Button: {
      //   colorPrimary: '#007bff', // 如果希望按钮主色与其他主色不同
      //   controlHeight: 36, // 微调按钮高度
    },
    // Menu: {
    //   darkItemBg: '#001529', // 示例：自定义暗色菜单背景
    // },
    // Tabs: {
    //   cardBg: '#f9f9f9', // 卡片式标签页的背景色
    // },
  },
};

// --- 渲染应用 ---
root.render(
  <React.StrictMode>
    <ErrorBoundary
        fallbackUI={ //
            <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'sans-serif', color: '#dc3545', background:'#f8d7da', border: '1px solid #f5c6cb', borderRadius: '8px', margin: '50px auto', maxWidth: '600px' }}>
                <h2>糟糕！应用出错了 :(</h2>
                <p>我们遇到了一个问题，导致应用无法正常工作。请尝试刷新页面。如果问题仍然存在，请联系我们。</p>
                <button onClick={() => window.location.reload()} style={{padding: '10px 20px', fontSize: '1em', cursor: 'pointer', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px'}}>刷新页面</button>
            </div>
        }
    >
      {/* 使用 ConfigProvider 包裹 App 组件以应用全局 Ant Design 主题 */}
      <ConfigProvider theme={customAntDTheme}>
        <App />
      </ConfigProvider>
    </ErrorBoundary>
  </React.StrictMode>
);