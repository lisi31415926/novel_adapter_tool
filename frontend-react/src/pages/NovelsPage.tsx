// frontend-react/src/pages/NovelsPage.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { Alert } from 'antd';

// 从 api.ts 导入类型和函数
import { getNovels, Novel, PaginatedResponse } from '../services/api';

// 导入子组件
import NovelsList from '../components/NovelsList';
import NovelUploader from '../components/NovelUploader';

// 导入页面通用样式
import pageStyles from './PageStyles.module.css';

const NovelsPage: React.FC = () => {
    // 状态管理
    const [novels, setNovels] = useState<Novel[]>([]); // 小说列表
    const [isLoading, setIsLoading] = useState<boolean>(true); // 加载状态
    const [error, setError] = useState<string | null>(null); // 错误信息

    // 分页状态管理
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [pageSize, setPageSize] = useState<number>(10);
    const [totalCount, setTotalCount] = useState<number>(0);

    // --- 数据获取 ---
    // 使用 useCallback 包装以避免不必要的重渲染
    const fetchNovels = useCallback(async (page: number, size: number) => {
        setIsLoading(true);
        setError(null);
        try {
            const response: PaginatedResponse<Novel> = await getNovels(page, size);
            setNovels(response.items);
            setTotalCount(response.total_count);
            setCurrentPage(response.page);
            setPageSize(response.page_size);
        } catch (err: any) {
            const errorMessage = err.message || '获取小说列表失败。';
            setError(errorMessage);
            toast.error(errorMessage);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // 初次加载时获取数据
    useEffect(() => {
        fetchNovels(currentPage, pageSize);
    }, [fetchNovels, currentPage, pageSize]);

    // --- 事件处理函数 ---
    // 切换分页时的处理
    const handlePageChange = (page: number, size?: number) => {
        const newPageSize = size || pageSize;
        setCurrentPage(page);
        setPageSize(newPageSize);
        // useEffect 会因为 currentPage 或 pageSize 变化而自动重新获取数据
    };

    // 上传成功后的回调
    const handleUploadSuccess = () => {
        toast.success('新小说上传并分析成功！正在刷新列表...');
        // 刷新列表，通常是返回第一页
        if (currentPage === 1) {
            fetchNovels(1, pageSize);
        } else {
            setCurrentPage(1); // 这会触发 useEffect 重新获取数据
        }
    };

    // 删除成功后的回调
    const handleDeleteSuccess = () => {
        toast.info('小说已删除。正在刷新列表...');
        // 如果当前页在删除后变为空，并且不是第一页，则返回前一页
        if (novels.length === 1 && currentPage > 1) {
            setCurrentPage(currentPage - 1);
        } else {
            fetchNovels(currentPage, pageSize); // 否则刷新当前页
        }
    };
    
    // 重新分析后的回调 (仅刷新列表)
    const handleAnalysisStarted = () => {
        toast.info('后台分析任务已启动，列表将稍后更新。');
        // 短暂延迟后刷新，让后端有时间更新状态
        setTimeout(() => {
            fetchNovels(currentPage, pageSize);
        }, 2000);
    };

    return (
        <div className={pageStyles.page}>
            {/* 页面头部 */}
            <div className={pageStyles.pageHeader}>
                <h1 className={pageStyles.pageTitle}>小说管理</h1>
            </div>

            {/* 上传组件 */}
            <div className={pageStyles.section}>
                <h2 className={pageStyles.sectionTitle}>上传新小说</h2>
                <NovelUploader onUploadSuccess={handleUploadSuccess} />
            </div>

            {/* 错误提示 */}
            {error && (
                <Alert
                    message="数据加载错误"
                    description={error}
                    type="error"
                    showIcon
                    closable
                    onClose={() => setError(null)}
                    style={{ marginBottom: '1rem' }}
                />
            )}

            {/* 小说列表组件 */}
            <div className={pageStyles.section}>
                <h2 className={pageStyles.sectionTitle}>已上传的小说</h2>
                <NovelsList
                    novels={novels}
                    isLoading={isLoading}
                    onDeleteSuccess={handleDeleteSuccess}
                    onAnalysisStarted={handleAnalysisStarted}
                    pagination={{
                        current: currentPage,
                        pageSize: pageSize,
                        total: totalCount,
                        onChange: handlePageChange,
                    }}
                />
            </div>
        </div>
    );
};

export default NovelsPage;