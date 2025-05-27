// frontend-react/src/components/ChapterList.tsx
import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { toast } from 'react-toastify';
import { List, Tag, Typography, Tooltip, Spin, Empty } from 'antd'; // 导入 Ant Design 组件
import { useVirtualizer } from '@tanstack/react-virtual';

import {
    Chapter as ChapterInfo,
    getSentimentThresholdSettings, // API 获取情感阈值
    SentimentThresholds,         // 类型
} from '../services/api';
import styles from './ChapterList.module.css';
import pageViewStyles from '../pages/PageStyles.module.css';
import {
    BookOutlined, // 替换 FileText
    SmileOutlined, // 替换 Smile
    FrownOutlined, // 替换 Frown
    MehOutlined,   // 替换 Meh
    InfoCircleOutlined, // 替换 Info
    LoadingOutlined, // 用于加载状态
    ExclamationCircleOutlined // 用于错误或未知状态
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

// 列表项的估算高度，用于虚拟滚动
const ESTIMATED_CHAPTER_ROW_HEIGHT = 75; // 根据 AntD List.Item 调整估算高度

// 情感阈值的默认值
const DEFAULT_SENTIMENT_THRESHOLDS: SentimentThresholds = {
    positive_min_score: 0.65,
    negative_max_score: 0.35,
};

interface ChapterListProps {
    novelId: string | undefined;
    novelTitle?: string;
    chapters: ChapterInfo[] | undefined | null;
    isLoading: boolean;
    error: string | null;
    onChapterSelect?: (chapter: ChapterInfo, novelId: string) => void;
    plotVersionId?: number | null; // 用于区分章节上下文
}

const ChapterList: React.FC<ChapterListProps> = ({
    novelId,
    novelTitle, // novelTitle 在此组件中目前未直接使用，但保留以备将来显示列表标题等
    chapters,
    isLoading,
    error,
    onChapterSelect,
    plotVersionId, // 用于判断章节序号的显示
}) => {
    const parentRef = useRef<HTMLDivElement>(null); // 改为 div，因为 AntD List 会渲染自己的 ul

    const [sentimentThresholds, setSentimentThresholds] = useState<SentimentThresholds>(DEFAULT_SENTIMENT_THRESHOLDS);
    const [isLoadingThresholds, setIsLoadingThresholds] = useState<boolean>(true);

    useEffect(() => {
        const fetchThresholds = async () => {
            setIsLoadingThresholds(true);
            try {
                const thresholdsData = await getSentimentThresholdSettings();
                if (thresholdsData && typeof thresholdsData.positive_min_score === 'number' && typeof thresholdsData.negative_max_score === 'number') {
                    setSentimentThresholds(thresholdsData);
                } else {
                    toast.warn("未能加载有效的情感阈值配置，将使用默认值。", { autoClose: 7000, toastId: "chlist-senti-warn" });
                    setSentimentThresholds(DEFAULT_SENTIMENT_THRESHOLDS);
                }
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : "获取情感阈值配置失败";
                console.error("获取情感阈值配置失败:", err);
                toast.error(`加载情感阈值配置失败: ${errorMsg}。将使用默认值。`, { autoClose: 7000, toastId: "chlist-senti-err" });
                setSentimentThresholds(DEFAULT_SENTIMENT_THRESHOLDS);
            } finally {
                setIsLoadingThresholds(false);
            }
        };
        fetchThresholds();
    }, []);

    const getSentimentDisplay = useCallback((scoreValue: number | null | undefined): { label: string; color: string; scoreFormatted: string | null; icon?: React.ReactNode } => {
        if (scoreValue === null || typeof scoreValue === 'undefined' || isNaN(scoreValue)) {
            return { label: "情感未知", color: "default", scoreFormatted: null, icon: <InfoCircleOutlined /> };
        }
        const numericScore = scoreValue;
        const scoreFormatted = numericScore.toFixed(3);

        if (numericScore >= sentimentThresholds.positive_min_score) {
            return { label: "积极", color: "success", scoreFormatted, icon: <SmileOutlined /> };
        }
        if (numericScore <= sentimentThresholds.negative_max_score) {
            return { label: "消极", color: "error", scoreFormatted, icon: <FrownOutlined /> };
        }
        return { label: "中性", color: "processing", scoreFormatted, icon: <MehOutlined /> };
    }, [sentimentThresholds]);

    const formatThemeAnalysisForDisplay = (themeAnalysis: ChapterInfo['theme_analysis']): string => {
        if (!themeAnalysis) return '未分析';
        if (Array.isArray(themeAnalysis)) {
            return themeAnalysis.join('; ').substring(0, 100) + (themeAnalysis.join('; ').length > 100 ? '...' : '');
        }
        if (typeof themeAnalysis === 'object' && themeAnalysis !== null) {
            const keys = Object.keys(themeAnalysis);
            return keys.join('; ').substring(0, 100) + (keys.join('; ').length > 100 ? '...' : '');
        }
        return String(themeAnalysis).substring(0, 100) + (String(themeAnalysis).length > 100 ? '...' : '');
    };

    const sortedChapters = useMemo(() => {
        if (!chapters) return [];
        return [...chapters].sort((a, b) => {
            const orderA = plotVersionId != null ? a.version_order : a.chapter_index;
            const orderB = plotVersionId != null ? b.version_order : b.chapter_index;
            return (orderA ?? Infinity) - (orderB ?? Infinity);
        });
    }, [chapters, plotVersionId]);

    // AntD List 的虚拟滚动通常通过其 virtual prop 实现，
    // 如果要用 @tanstack/react-virtual，需要自定义渲染逻辑，可能更复杂。
    // 这里我们先使用 AntD List 的标准渲染，如果性能需要再考虑集成外部虚拟滚动。
    // 对于 @tanstack/react-virtual 的集成，通常是渲染一个固定高度的 List.Item shell，内部再填充内容。

    // 移除 useVirtualizer，直接使用 AntD List，如有性能问题再考虑 List 的 virtual prop 或外部库

    if ((isLoading && sortedChapters.length === 0) || isLoadingThresholds) {
        return (
            <div className={`${styles.chapterListContainerAntd} ${pageStyles.section}`}>
                <div className={styles.listLoadingStateAntd}>
                    <Spin tip="加载章节列表数据..." />
                </div>
            </div>
        );
    }

    if (error && sortedChapters.length === 0) {
        return (
            <div className={`${styles.chapterListContainerAntd} ${pageStyles.section}`}>
                <Alert
                    message="加载错误"
                    description={`加载章节列表时发生错误: ${error}`}
                    type="error"
                    showIcon
                    className={styles.listErrorStateAntd}
                />
            </div>
        );
    }

    if (sortedChapters.length === 0) {
        return (
            <div className={`${styles.chapterListContainerAntd} ${pageStyles.section}`}>
                <Empty description={<Text type="secondary">此小说或版本下暂无章节数据。</Text>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
        );
    }

    return (
        <div className={`${styles.chapterListContainerAntd} ${pageStyles.section}`}>
            {/* <h2>章节列表... (父组件 NovelDetailPage 已有标题)</h2> */}
            <List
                itemLayout="vertical" // 改为 vertical 以更好地展示多行信息
                dataSource={sortedChapters}
                className={styles.antdChapterList}
                size="small" // 列表项更紧凑
                renderItem={(chapter, index) => {
                    const sentimentInfo = getSentimentDisplay(chapter.sentiment_analysis?.overall_sentiment_score);
                    const chapterLinkPath = novelId && chapter.id ? `/novels/${novelId}/processor/${chapter.id}` : '#';
                    const displayIndex = plotVersionId != null && chapter.version_order != null
                        ? chapter.version_order + 1
                        : chapter.chapter_index + 1;
                    const indexLabel = plotVersionId != null && chapter.version_order != null
                        ? "版本内序号"
                        : "原著序号";
                    const themeDisplayText = formatThemeAnalysisForDisplay(chapter.theme_analysis);

                    return (
                        <List.Item
                            key={chapter.id || `chapter-${index}`}
                            className={styles.antdListItem}
                            actions={ onChapterSelect && novelId ? [ // 仅在有回调时显示操作
                                <Button type="link" size="small" onClick={() => onChapterSelect(chapter, novelId)}>
                                    在工作台处理
                                </Button>
                            ] : []}
                        >
                            <List.Item.Meta
                                avatar={<BookOutlined style={{ fontSize: '1.2em', color: 'var(--ant-primary-color)' }} />}
                                title={
                                    <Space align="baseline" wrap={false} style={{width: '100%'}}>
                                        <Text strong className={styles.chapterTitleTextAntd}>
                                            <RouterLink to={chapterLinkPath} title={`查看或编辑章节 "${chapter.title || `${indexLabel} ${displayIndex}`}"`}>
                                                {indexLabel} {displayIndex}: {chapter.title || "无标题章节"}
                                            </RouterLink>
                                        </Text>
                                        {sentimentInfo.scoreFormatted && sentimentInfo.label !== "情感未知" && (
                                            <Tooltip title={`AI情感分析: ${sentimentInfo.label} (得分: ${sentimentInfo.scoreFormatted}, 阈值 Pos >= ${sentimentThresholds.positive_min_score.toFixed(2)}, Neg <= ${sentimentThresholds.negative_max_score.toFixed(2)})`}>
                                                <Tag icon={sentimentInfo.icon} color={sentimentInfo.color} className={styles.sentimentTagAntd}>
                                                    {sentimentInfo.label}
                                                </Tag>
                                            </Tooltip>
                                        )}
                                    </Space>
                                }
                                description={
                                    chapter.theme_analysis && themeDisplayText !== "未分析" ? (
                                        <Tooltip title={`AI分析的主题: ${themeDisplayText}`}>
                                            <Text type="secondary" ellipsis className={styles.themeTextAntd}>
                                                <FileTextOutlined style={{ marginRight: 4 }} />
                                                主题: {themeDisplayText}
                                            </Text>
                                        </Tooltip>
                                    ) : null
                                }
                            />
                            {/* 可选：如果章节内容很短，可以在这里预览一小段 */}
                            {/* {chapter.content && chapter.content.length < 200 && (
                                <Paragraph ellipsis={{rows: 2}} type="secondary" style={{fontSize:'0.85em', marginTop: 4}}>
                                    {chapter.content}
                                </Paragraph>
                            )} */}
                        </List.Item>
                    );
                }}
                pagination={{ // AntD List 的分页配置
                    pageSize: 15, // 每页显示数量
                    size: 'small',
                    showSizeChanger: false, // 简化，不显示切换器
                    align: 'center',
                    hideOnSinglePage: true,
                }}
            />
        </div>
    );
};

export default ChapterList;