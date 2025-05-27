// frontend-react/src/components/NovelsList.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react'; // 新增 useRef
import { toast } from 'react-toastify';
// 引入 @tanstack/react-virtual
import { useVirtualizer } from '@tanstack/react-virtual';

import {
    getNovels,
    deleteNovel,
    Novel,
    PaginatedNovelsResponse, // 保留，但数据加载方式可能改变
    getAnalysisStatusInfo,
    NovelAnalysisStatusEnum
} from '../services/api';
import styles from './NovelsList.module.css';
import { ChevronLeft, ChevronRight, RefreshCw, Trash2, AlertTriangle, Info, CheckCircle, Loader, FileText } from 'lucide-react';

interface NovelsListProps {
    onNovelSelect: (novel: Novel) => void;
    onListUpdate?: () => void;
    listVersionTrigger: number;
}

// 列表项的平均高度估算 (需要根据实际渲染效果调整)
const ESTIMATED_ROW_HEIGHT = 130; // 假设每个列表项大约 130px 高

const NovelsList: React.FC<NovelsListProps> = ({ onNovelSelect, onListUpdate, listVersionTrigger }) => {
    const [allNovels, setAllNovels] = useState<Novel[]>([]); // 存储所有已加载的小说
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false); // 新增：加载更多状态
    const [error, setError] = useState<string | null>(null);
    
    // 用于虚拟化列表的父滚动元素引用
    const parentRef = useRef<HTMLUListElement>(null);

    // --- 分页/加载更多相关状态 ---
    // 我们将从传统分页改为“加载更多”模式，与虚拟化更好地配合
    const [currentPageToken, setCurrentPageToken] = useState<number>(0); // 表示当前已加载到的页（0-based）
    const [hasNextPage, setHasNextPage] = useState<boolean>(true); // 是否还有更多数据可加载
    const novelsPerPage = 20; // 每次加载更多时获取的数量 (可以适当增大)

    // 数据获取逻辑，修改为支持加载更多
    const fetchNovelsData = useCallback(async (pageToFetch: number, isRefresh: boolean = false, showRefreshToast: boolean = false) => {
        if (isRefresh) {
            setIsLoading(true); // 完整刷新时使用主加载状态
            setAllNovels([]);   // 清空现有数据
            setCurrentPageToken(0); // 重置页码
            setHasNextPage(true); // 假设刷新后有数据
            if (showRefreshToast) {
                toast.info("正在刷新小说列表...", { autoClose: 1200 });
            }
        } else {
            setIsLoadingMore(true); // 加载更多时使用独立加载状态
        }
        setError(null);

        try {
            // 调用API，skip参数基于 pageToFetch 和 novelsPerPage
            const response: PaginatedNovelsResponse = await getNovels(pageToFetch * novelsPerPage, novelsPerPage);
            
            setAllNovels(prevNovels => isRefresh ? (response.novels || []) : [...prevNovels, ...(response.novels || [])]);
            
            const totalFetched = (pageToFetch + 1) * novelsPerPage;
            setHasNextPage(totalFetched < response.total_count); // 更新是否还有下一页
            setCurrentPageToken(pageToFetch); // 更新当前已加载到的页

            if (isRefresh && showRefreshToast) {
                toast.success("小说列表已刷新。");
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : '获取小说列表时发生未知错误。';
            setError(errorMsg);
            toast.error(`加载小说列表失败: ${errorMsg}`);
            if (isRefresh) setAllNovels([]); // 刷新出错时清空
            setHasNextPage(false); // 出错时认为没有下一页了
        } finally {
            setIsLoading(false);
            setIsLoadingMore(false);
        }
    }, [novelsPerPage]);

    // 初始加载和版本触发器刷新
    useEffect(() => {
        fetchNovelsData(0, true); // 初始加载或触发器变化时，完整刷新第一页
    }, [fetchNovelsData, listVersionTrigger]);

    // 删除小说的逻辑，删除后需要重新计算列表
    const handleDeleteNovel = async (novelId: number, novelTitle?: string | null) => {
        const titleForConfirm = novelTitle || `ID 为 ${novelId} 的小说`;
        if (window.confirm(`您确定要删除小说 "${titleForConfirm}" 吗？此操作不可撤销...`)) { // 确认消息保持不变
            // 注意：这里不再使用 setIsLoading(true)，因为删除操作不应影响“加载更多”的UI状态
            // 可以考虑为单个列表项设置删除中的视觉反馈
            toast.info(`正在删除小说 "${titleForConfirm}"...`, { autoClose: 1500 });
            try {
                await deleteNovel(novelId);
                toast.success(`小说 "${titleForConfirm}" 已成功删除。`);
                // 删除成功后，从前端状态中移除该小说，并通知父组件
                setAllNovels(prev => prev.filter(n => n.id !== novelId));
                if (onListUpdate) onListUpdate();
                // 注意：如果删除的是当前虚拟列表中的项，virtualizer 会自动适应新的 count
                // 但如果删除了很多导致总数变化很大，可能需要重新评估 totalSize 或重新获取数据
                // 简单的做法是强制刷新列表，但会失去虚拟化的平滑感。
                // 更好的做法是确保 allNovels 的 count 正确，virtualizer 就能处理。
            } catch (err) {
                const errorMsg = err instanceof Error ? `删除失败: ${err.message}` : '删除小说时发生未知错误。';
                toast.error(errorMsg);
            }
        }
    };

    const handleSelectNovel = (novel: Novel) => {
        onNovelSelect(novel);
    };

    // @tanstack/react-virtual 的 Virtualizer
    const rowVirtualizer = useVirtualizer({
        count: allNovels.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ESTIMATED_ROW_HEIGHT, // 提供一个估算行高
        overscan: 5, // 预渲染视口外上下各5个项目
    });

    // 辅助渲染函数 (保持不变)
    const parseJsonStringForDisplay = (data: string | string[] | null | undefined, type: 'keywords' | 'characters'): string => { /* ... */ 
        if (!data) return `暂无${type === 'keywords' ? '关键词' : '角色信息'}`;
        let items: string[] = [];
        if (typeof data === 'string') { try { if (data.trim().startsWith('[') && data.trim().endsWith(']')) { const parsed = JSON.parse(data); items = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [data]; } else { items = data.split(',').map(s => s.trim()).filter(s => s); } } catch (e) { items = data.split(',').map(s => s.trim()).filter(s => s); } } else if (Array.isArray(data)) { items = data.filter((item): item is string => typeof item === 'string');}
        if (items.length === 0) return `暂无${type === 'keywords' ? '关键词' : '角色信息'}`;
        const prefix = type === 'keywords' ? '关键词' : '主要角色';
        const displayItems = items.slice(0, 3).join('、');
        return `${prefix}: ${displayItems}${items.length > 3 ? ' 等' : ''}`;
    };
    const renderStatusWithIcon = (statusValue: NovelAnalysisStatusEnum | string | undefined) => { /* ... */ 
        const statusInfo = getAnalysisStatusInfo(statusValue); let IconComponent: React.ElementType = Info; let iconGeneratedClassName = styles.iconMuted;
        switch (statusInfo.classNameKey) {
            case NovelAnalysisStatusEnum.PENDING: case NovelAnalysisStatusEnum.IN_PROGRESS: IconComponent = Loader; iconGeneratedClassName = styles.iconSpin; break;
            case NovelAnalysisStatusEnum.VECTORIZED: IconComponent = CheckCircle; iconGeneratedClassName = styles.vectorized; break;
            case NovelAnalysisStatusEnum.COMPLETED: IconComponent = Info; iconGeneratedClassName = styles.completed; break;
            case NovelAnalysisStatusEnum.FAILED: case NovelAnalysisStatusEnum.COMPLETED_WITH_ERRORS: IconComponent = AlertTriangle; iconGeneratedClassName = statusInfo.classNameKey === NovelAnalysisStatusEnum.FAILED ? styles.failed : styles.completedwitherrors; break;
            default: IconComponent = Info; iconGeneratedClassName = styles.unknown;
        }
        return (<span className={`${styles.statusText} ${styles[(statusInfo.classNameKey as string).toLowerCase().replace(/_/g, '')]}`}><IconComponent size={14} className={`${styles.statusIcon} ${iconGeneratedClassName}`} /> {statusInfo.text}</span>);
    };

    // 初始加载状态
    if (isLoading && allNovels.length === 0) {
        return <div className={`loading-message ${styles.centeredMessage}`}><Loader size={24} className={styles.iconSpin} /> 正在加载小说列表...</div>;
    }

    // 初始加载错误状态
    if (error && allNovels.length === 0) {
        return ( <div className={`error-message ${styles.centeredMessage}`}> <AlertTriangle size={24} /> 错误: {error} <button className="btn btn-sm btn-primary" onClick={() => fetchNovelsData(0, true, true)} style={{marginLeft: '10px'}}> <RefreshCw size={16} /> 重试 </button> </div> );
    }
    
    return (
        <div className={`${styles.novelsListContainer} section`}>
            <div className={styles.listHeader}>
                <h2><FileText size={24} style={{marginRight: 'var(--spacing-sm)'}}/> 已上传的小说 ({allNovels.length}{hasNextPage ? '+' : ''})</h2> {/* 显示已加载总数 */}
                <button onClick={() => fetchNovelsData(0, true, true)} disabled={isLoading || isLoadingMore} className="btn btn-sm btn-secondary" title="刷新小说列表">
                    <RefreshCw size={15} className={(isLoading || isLoadingMore) ? styles.iconSpin : ''}/> 刷新
                </button>
            </div>

            {(isLoadingMore && allNovels.length > 0) && ( <div className={`${styles.inlineLoading} status-message`}> <Loader size={14} className={styles.iconSpin} /> 正在加载更多小说... </div> )}
            {(error && !isLoading && allNovels.length > 0) && ( <div className={`${styles.inlineError} error-message`}> <AlertTriangle size={14}/> 获取更多列表失败: {error} </div> )}

            {allNovels.length === 0 && !isLoading && !error && ( <p className={`no-data-message ${styles.centeredMessage}`}> <Info size={20} style={{marginRight: 'var(--spacing-sm)'}}/> 系统中还没有上传任何小说。 </p> )}

            {allNovels.length > 0 && (
                // 父滚动容器
                <ul ref={parentRef} className={styles.listVirtualScrollContainer} /* 应用虚拟滚动容器样式 */ >
                    {/* 内部绝对定位的容器，其高度由virtualizer计算 */}
                    <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                        {rowVirtualizer.getVirtualItems().map(virtualRow => {
                            const novel = allNovels[virtualRow.index];
                            if (!novel) return null; // 安全检查

                            return (
                                <li
                                    key={novel.id}
                                    ref={rowVirtualizer.measureElement} // 传递给 virtualizer 用于测量
                                    data-index={virtualRow.index} // 虚拟化库可能需要
                                    className={styles.listItemVirtual} // 新的虚拟列表项样式
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        height: `${virtualRow.size}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                    onClick={() => handleSelectNovel(novel)}
                                    title={`点击查看小说 "${novel.title || '未知标题'}"`}
                                    role="button" tabIndex={0}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectNovel(novel); }}}
                                >
                                    {/* 列表项内部结构保持不变 */}
                                    <div className={styles.novelInfo}>
                                        <span className={styles.novelTitle}>
                                            {novel.title || novel.file_path.split(/[/\\]/).pop() || '未知标题'}
                                        </span>
                                        <span className={styles.novelMeta}>
                                            文件名: {novel.file_path.split(/[/\\]/).pop()} ({novel.chapters?.length || 0} 章)
                                            {novel.author && ` - 作者: ${novel.author}`}
                                        </span>
                                        {novel.summary && ( <span className={styles.novelSummarySnippet} title={`摘要预览: ${novel.summary}`}> 摘要: {novel.summary.substring(0, 120)}... </span> )}
                                        <span className={styles.novelKeywordsSnippet}> {parseJsonStringForDisplay(novel.keywords, 'keywords')} </span>
                                        <span className={styles.novelStatusSnippet}> 分析状态: {renderStatusWithIcon(novel.analysis_status)} </span>
                                    </div>
                                    <button
                                        className={`btn btn-xs btn-outline-danger ${styles.deleteButton}`}
                                        onClick={(e) => { e.stopPropagation(); handleDeleteNovel(novel.id, novel.title); }}
                                        disabled={isLoading || isLoadingMore} // 任何加载操作都禁用删除
                                        title={`删除小说 "${novel.title || '此小说'}"`}
                                        aria-label={`删除小说 ${novel.title || '此小说'}`}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </li>
                            );
                        })}
                    </div>
                </ul>
            )}

            {/* 加载更多按钮 */}
            {hasNextPage && !isLoading && !isLoadingMore && allNovels.length > 0 && (
                <div className={styles.loadMoreContainer}>
                    <button
                        onClick={() => fetchNovelsData(currentPageToken + 1, false)}
                        className={`btn btn-secondary ${styles.loadMoreButton}`}
                        disabled={isLoadingMore}
                    >
                        {isLoadingMore ? <Loader size={16} className={styles.iconSpin}/> : <ChevronDown size={16}/>}
                        {isLoadingMore ? '加载中...' : '加载更多小说'}
                    </button>
                </div>
            )}
            {!hasNextPage && allNovels.length > 0 && (
                <p className={styles.allLoadedMessage}>已加载全部小说。</p>
            )}
        </div>
    );
};

export default NovelsList;