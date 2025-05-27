// frontend-react/vite.config.ts
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path'; // 导入 path 模块用于路径别名

// Vite 配置文件
export default defineConfig(({ mode }) => {
  // 加载当前环境的环境变量 (例如 .env.development, .env.production)
  // 这使得可以在配置文件中使用 process.env.VITE_... 形式的环境变量
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
    ],
    server: {
      proxy: {
        '/api': {
          // 使用环境变量配置代理目标，如果未设置，则回退到默认值
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:8000',
          changeOrigin: true,
          secure: false, // 对于HTTP目标通常无需更改，若后端为HTTPS且自签名证书则设为false
          // --- Bug Fix (来自 bug.txt 的高优先级问题 【前端】Vite 代理配置错误) ---
          // 修正代理配置，移除前端请求路径中的 /api 前缀，使其正确匹配后端API路径。
          // 例如，前端请求 /api/novels 将被代理到 http://localhost:8000/novels
          rewrite: (path) => path.replace(/^\/api/, ''), //
          // --- End Bug Fix ---
        },
      },
      // port: env.VITE_FRONTEND_PORT ? parseInt(env.VITE_FRONTEND_PORT, 10) : 5173, // 可选：通过环境变量配置端口
      // open: env.VITE_OPEN_BROWSER === 'true', // 可选：通过环境变量控制是否自动打开浏览器
    },
    build: {
      outDir: 'dist',
      // 生产环境的 sourcemap 配置：
      // 'hidden' - 生成map文件但不链接到bundle，用于错误上报服务。
      // false - 不生成map文件，减小包体积，但调试困难。
      // true - 生成并链接map文件，方便调试，但会暴露源码结构。
      sourcemap: mode === 'production' ? 'hidden' : true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            // 简单的 vendor chunking 策略
            if (id.includes('node_modules')) {
              // 将一些较大的、不常变动的库分割到单独的 vendor chunk
              const KEEPMATCH = ["react", "react-dom", "react-router-dom", "axios", "recharts", "lucide-react", "react-quill", "vis-network"];
              const matchedLib = KEEPMATCH.find(libName => id.includes(`node_modules/${libName}`));
              if (matchedLib) {
                return `vendor-${matchedLib.replace(/[^a-zA-Z0-9]/g, '_')}`; // 创建如 vendor-react, vendor-axios 的块
              }
              // 其他 node_modules 内容可以聚合成一个或几个更大的 vendor 块
              return 'vendor-others';
            }
          }
        }
      }
    },
    resolve: {
      alias: {
        // 配置路径别名，简化模块导入
        // 例如：将 '@' 指向项目的 'src' 目录
        '@': path.resolve(__dirname, './src'),
      },
    },
    // 定义全局常量，可在代码中通过 import.meta.env.VITE_... 访问
    // 如果有其他需要在客户端代码中使用的构建时常量，可以在此定义
    // define: {
    //   'import.meta.env.APP_VERSION': JSON.stringify(process.env.npm_package_version),
    // }
  };
});