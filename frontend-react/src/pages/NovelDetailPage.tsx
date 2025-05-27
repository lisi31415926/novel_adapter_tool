// frontend-react/src/pages/NovelDetailPage.tsx
import React, { useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { useParams, Link as RouterLink, useNavigate, Outlet, useLocation } from 'react-router-dom'; // Outlet 和 useLocation 可能用于子路由
import { toast } from 'react-toastify';
import { Layout, Tabs, Spin, Alert, Button, Breadcrumb, Typography, Space } from 'antd';
import {
    HomeOutlined,
    BookOutlined,
    RedoOutlined as AntRedoOutlined,
    ReadOutlined, // 用于概览
    UnorderedListOutlined, // 用于章节
    UserOutlined, // 用于角色
    CalendarOutlined, // 用于事件
    ThunderboltOutlined, // 用于冲突
    TeamOutlined, // 用于关系
    BranchesOutlined, // 用于剧情分支
    InfoCircleOutlined, // 用于无数据提示
} from '@ant-design/icons';

// API 和类型导入
import {
    getNovelById,
    getNovelAnalysisStatusSummary, // 重命名以更清晰
    Novel,
    NovelAnalysisStatusEnum,
    // 其他可能需要的类型，如 Chapter, Character 等，通常由子组件自行处理
} from '../services/api';

// 样式导入
import pageStyles from './PageStyles.module.css';
import styles from './NovelDetailPage.module.css';

// 子组件的动态导入 (Lazy Loading)
// 这些组件现在是作为 TabPane 的内容，并且很多是独立的页面组件
const NovelOverview = lazy(() => import('../components/NovelOverview'));
const ChapterList = lazy(() => import('../components/ChapterList'));
const CharacterListPage = lazy(() => import('./CharacterListPage'));
const EventListPage = lazy(() => import('./EventListPage'));
const ConflictListPage = lazy(() => import('./ConflictListPage'));
const CharacterRelationshipListPage = lazy(() => import('./CharacterRelationshipListPage'));
const PlotBranchManager = lazy(() => import('../components/PlotBranchManager'));

const { Content } = Layout;
const { Title } = Typography;
const { TabPane } = Tabs; // 如果直接使用 TabPane 而不是 items prop

const NovelDetailPage: React.FC = () => {
    const { novelId } = useParams<{ novelId: string }>(); // 从路由参数获取 novelId
    const navigate = useNavigate(); // 用于编程式导航
    const location = useLocation(); // 用于获取当前路径，以确定默认激活的标签页

    const numericNovelId = Number(novelId); // 将 novelId 转换为数字

    // 状态管理
    const [novel, setNovel] = useState<Novel | null>(null); // 当前小说数据
    const [isLoading, setIsLoading] = useState<boolean>(true); // 页面主要加载状态
    const [error, setError] = useState<string | null>(null); // 页面错误信息
    const [activeTabKey, setActiveTabKey] = useState<string>('overview'); // 当前激活的标签页键

    // 获取小说数据的回调函数
    const fetchNovelData = useCallback(async (showLoadingSpinner: boolean = true, showToast: boolean = false) => {
        if (!numericNovelId) {
            setError('无效的小说ID。');
            if (showLoadingSpinner) setIsLoading(false);
            return;
        }
        if (showLoadingSpinner) setIsLoading(true);
        if (showToast) toast.info("正在刷新小说数据...", { autoClose: 1000 });

        try {
            const data = await getNovelById(numericNovelId);
            setNovel(data);
            setError(null); // 清除之前的错误
            if (showToast) toast.success("小说数据已刷新！");
        } catch (err: any) {
            const errorMessage = err.message || `获取小说详情 (ID: ${numericNovelId}) 失败。`;
            setError(errorMessage);
            if (showToast) toast.error(errorMessage);
            console.error("获取小说数据失败:", err);
        } finally {
            if (showLoadingSpinner) setIsLoading(false);
        }
    }, [numericNovelId]); // 依赖于 numericNovelId

    // 组件挂载时获取小说数据
    useEffect(() => {
        fetchNovelData();
    }, [fetchNovelData]);

    // 轮询小说分析状态 (与您之前版本逻辑类似，但使用 AntD message/toast)
    useEffect(() => {
        if (!novel || !numericNovelId) return;

        const analysisInProgress = novel.analysis_status === NovelAnalysisStatusEnum.IN_PROGRESS ||
                                 novel.vectorization_status === NovelAnalysisStatusEnum.IN_PROGRESS;

        if (!analysisInProgress) return; // 如果没有正在进行的分析，则不轮询

        const intervalId = setInterval(async () => {
            try {
                const statusInfo = await getNovelAnalysisStatusSummary(numericNovelId);
                setNovel(prevNovel => {
                    if (!prevNovel) return null;
                    // 检查状态是否有实际变化
                    const hasStatusChanged = prevNovel.analysis_status !== statusInfo.analysis_status ||
                                           prevNovel.vectorization_status !== statusInfo.vectorization_status;
                    const hasErrorsChanged = JSON.stringify(prevNovel.analysis_errors || []) !== JSON.stringify(statusInfo.analysis_errors || []) ||
                                           JSON.stringify(prevNovel.vectorization_errors || []) !== JSON.stringify(statusInfo.vectorization_errors || []);

                    if (hasStatusChanged || hasErrorsChanged) {
                        toast.info(`小说 "${prevNovel.title}" 的后台分析状态已更新。`, { autoClose: 4000, toastId: `novel-status-update-${numericNovelId}` });
                        return {
                            ...prevNovel,
                            analysis_status: statusInfo.analysis_status ?? prevNovel.analysis_status,
                            vectorization_status: statusInfo.vectorization_status ?? prevNovel.vectorization_status,
                            analysis_errors: statusInfo.analysis_errors ?? prevNovel.analysis_errors,
                            vectorization_errors: statusInfo.vectorization_errors ?? prevNovel.vectorization_errors,
                        };
                    }
                    return prevNovel; // 如果状态未变，返回旧状态以避免不必要的重渲染
                });

                // 检查所有相关后台任务是否已完成（不再是 PENDING 或 IN_PROGRESS）
                const isAllAnalysisDone = statusInfo.analysis_status !== NovelAnalysisStatusEnum.IN_PROGRESS &&
                                        statusInfo.analysis_status !== NovelAnalysisStatusEnum.PENDING;
                const isAllVectorizationDone = statusInfo.vectorization_status !== NovelAnalysisStatusEnum.IN_PROGRESS &&
                                             statusInfo.vectorization_status !== NovelAnalysisStatusEnum.PENDING;

                if (isAllAnalysisDone && isAllVectorizationDone) {
                    clearInterval(intervalId);
                    toast.success(`小说 "${novel.title}" 的所有后台任务已处理完成！`, { autoClose: 5000 });
                    fetchNovelData(false); // 静默刷新一次数据以获取最新完整信息
                }
            } catch (pollError) {
                console.error('轮询获取小说分析状态失败:', pollError);
                // 可以选择在这里也 clearInterval，或者让它继续尝试
                // clearInterval(intervalId);
                // toast.warn("轮询小说状态时发生错误，将暂停自动更新。");
            }
        }, 7000); // 轮询间隔7秒

        return () => clearInterval(intervalId); // 组件卸载时清除定时器
    }, [novel, numericNovelId, fetchNovelData]); // 依赖项

    // 根据当前路由的子路径确定默认激活的标签页
    useEffect(() => {
        const pathSegments = location.pathname.split('/');
        // 路径类似 /novels/:novelId/:subPage
        const subPageSegment = pathSegments.length > 3 ? pathSegments[3] : 'overview';
        if (['overview', 'chapters', 'characters', 'events', 'conflicts', 'relationships', 'plotting'].includes(subPageSegment)) {
            setActiveTabKey(subPageSegment);
        } else {
            setActiveTabKey('overview'); // 默认或回退
        }
    }, [location.pathname]);


    // 标签页切换处理函数
    const handleTabChange = (key: string) => {
        setActiveTabKey(key);
        // 更新URL以反映当前标签页 (可选，如果希望标签页是可链接的)
        // navigate(`/novels/${numericNovelId}/${key}`, { replace: true });
        // 注意：如果子组件已经是独立页面路由，则此处的导航可能不需要，
        // App.tsx中的路由会处理子路径的渲染。
        // 标签页的切换仅用于在此父页面中控制显示哪个子组件。
    };

    // 为 AntD Tabs 定义 items 数组
    const tabItems = useMemo(() => {
        if (!novel || !numericNovelId) return [];

        // 定义每个标签页的通用加载回退UI
        const tabSuspenseFallback = (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
                <Spin tip="加载模块内容..." />
            </div>
        );

        return [
            {
                key: 'overview',
                label: <Space><ReadOutlined />概览与设置</Space>,
                children: (
                    <Suspense fallback={tabSuspenseFallback}>
                        <NovelOverview novel={novel} onNovelUpdate={() => fetchNovelData(false, true)} />
                    </Suspense>
                )
            },
            {
                key: 'chapters',
                label: <Space><UnorderedListOutlined />章节列表</Space>,
                children: (
                    <Suspense fallback={tabSuspenseFallback}>
                        {/* ChapterList 需要 novelId 和 novelTitle */}
                        <ChapterList novelId={String(numericNovelId)} novelTitle={novel.title} chapters={novel.chapters} isLoading={isLoading} error={null} />
                    </Suspense>
                )
            },
            {
                key: 'characters',
                label: <Space><UserOutlined />人物列表</Space>,
                children: (
                    <Suspense fallback={tabSuspenseFallback}>
                        {/* CharacterListPage 作为独立页面，通过路由参数获取 novelId */}
                        <CharacterListPage />
                    </Suspense>
                )
            },
            {
                key: 'events',
                label: <Space><CalendarOutlined />事件列表</Space>,
                children: (
                    <Suspense fallback={tabSuspenseFallback}>
                        <EventListPage />
                    </Suspense>
                )
            },
            {
                key: 'conflicts',
                label: <Space><ThunderboltOutlined />冲突列表</Space>,
                children: (
                    <Suspense fallback={tabSuspenseFallback}>
                        <ConflictListPage />
                    </Suspense>
                )
            },
            {
                key: 'relationships',
                label: <Space><TeamOutlined />人物关系</Space>,
                children: (
                    <Suspense fallback={tabSuspenseFallback}>
                        <CharacterRelationshipListPage />
                    </Suspense>
                )
            },
            {
                key: 'plotting',
                label: <Space><BranchesOutlined />剧情规划</Space>,
                children: (
                    <Suspense fallback={tabSuspenseFallback}>
                        {/* PlotBranchManager 需要 novel 对象 */}
                        <PlotBranchManager novel={novel} novelId={numericNovelId} onMajorPlotChange={() => fetchNovelData(false, true)} />
                    </Suspense>
                )
            },
        ];
    }, [novel, numericNovelId, isLoading, fetchNovelData]); // 依赖项

    // --- 渲染逻辑 ---
    if (isLoading && !novel) { // 初始加载状态
        return <div className={pageStyles.pageLoadingContainer}><Spin size="large" tip="加载小说详情..." /></div>;
    }

    if (error && !novel) { // 加载错误状态
        return (
            <Layout className={pageStyles.pageLayout}>
                <Content className={pageStyles.pageContent}>
                    <Alert
                        message="加载错误"
                        description={error}
                        type="error"
                        showIcon
                        action={
                            <Button onClick={() => fetchNovelData(true, true)} icon={<AntRedoOutlined />}>
                                重试
                            </Button>
                        }
                    />
                </Content>
            </Layout>
        );
    }

    if (!novel) { // 未找到小说数据
        return (
            <Layout className={pageStyles.pageLayout}>
                <Content className={pageStyles.pageContent}>
                    <Alert
                        message="未找到小说"
                        description="无法加载指定的小说数据，请确认小说ID是否正确或小说已被删除。"
                        type="warning"
                        showIcon
                        action={
                            <Button onClick={() => navigate("/novels")}>
                                返回小说列表
                            </Button>
                        }
                    />
                </Content>
            </Layout>
        );
    }

    return (
        <Layout className={pageStyles.pageLayout}>
            {/* 面包屑导航 */}
            <Breadcrumb className={pageStyles.breadcrumb}>
                <Breadcrumb.Item><RouterLink to="/"><HomeOutlined /> 首页</RouterLink></Breadcrumb.Item>
                <Breadcrumb.Item><RouterLink to="/novels"><BookOutlined /> 小说管理</RouterLink></Breadcrumb.Item>
                <Breadcrumb.Item>{novel.title || `小说ID: ${novel.id}`}</Breadcrumb.Item>
            </Breadcrumb>

            {/* 页面标题和操作按钮 */}
            <div className={pageStyles.titleBar}>
                <Title level={2} className={pageStyles.pageTitle} style={{ display: 'flex', alignItems: 'center' }}>
                    <BookOutlined style={{ marginRight: '12px', color: 'var(--ant-primary-color)' }} />
                    {novel.title}
                </Title>
                <div className={styles.headerActions}> {/* 使用模块化样式 */}
                    <Button onClick={() => fetchNovelData(true, true)} icon={<AntRedoOutlined />} loading={isLoading && !!novel}>
                        刷新数据
                    </Button>
                    {/* 可以根据需要添加其他操作按钮，例如“开始完整分析” */}
                </div>
            </div>

            {/* 标签页内容区 */}
            <div className={styles.detailContentAntd}> {/* 应用模块化样式 */}
                <Tabs
                    activeKey={activeTabKey}
                    onChange={handleTabChange}
                    items={tabItems}
                    type="line" // 使用线条式标签页，更简洁
                    // tabPosition="top" // 默认是 top
                    // animated={true} // AntD Tabs 默认有动画
                    destroyInactiveTabPane={false} // 是否销毁未激活的标签页内容，设为 false 可以保留子组件状态
                />
            </div>
             {/* 如果希望标签页内容区域是独立路由，可以在此使用 <Outlet />
                但当前的设计是将子组件作为Tabs的children，更符合标签页的交互。
                如果使用子路由，App.tsx 中的路由配置需要调整，且标签页的切换需要通过导航实现。
             */}
        </Layout>
    );
};

export default NovelDetailPage;