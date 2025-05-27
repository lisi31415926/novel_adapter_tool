// frontend-react/src/components/SimilaritySearchResultsDisplay.tsx
import React from 'react';
import { Link as RouterLink } from 'react-router-dom'; // 使用 RouterLink 别名，避免与普通HTML <a> 混淆
import { SimilaritySearchResultItem } from '../services/api'; // API服务中定义的类型
import styles from './SimilaritySearchResultsDisplay.module.css'; // CSS Modules 样式
import { ExternalLink, SearchSlash, AlertTriangle, Loader, Info } from 'lucide-react'; // 引入图标

interface SimilaritySearchResultsDisplayProps {
    results: SimilaritySearchResultItem[]; // 搜索结果数组
    isLoading: boolean;                   // 指示是否正在加载搜索结果
    error: string | null;                 // 搜索过程中的错误信息
    queryText: string | null;             // 用户输入的上一次有效执行的搜索查询文本，用于高亮和提示
    novelId: number | string | undefined; // 当前操作的小说的ID，用于构建跳转到章节的链接
}

// 辅助组件：用于高亮显示文本中的关键词
interface HighlightKeywordsProps {
    text: string;           // 待高亮的完整文本
    keywords: string | null; // 用户输入的查询字符串（可能包含多个空格分隔的关键词）
}

const HighlightKeywords: React.FC<HighlightKeywordsProps> = ({ text, keywords }) => {
    // 如果没有提供关键词、文本内容为空，或关键词字符串去除首尾空格后为空，则直接返回原始文本
    if (!keywords || !text || !keywords.trim()) {
        return <>{text}</>; // 使用 React Fragment 包裹纯文本
    }

    // 将关键词字符串按一个或多个空白字符分割成关键词数组
    // 对每个关键词进行trim处理，并过滤掉空字符串，确保都是有效关键词
    const keywordArray = keywords.split(/\s+/).map(kw => kw.trim()).filter(Boolean);

    // 如果处理后没有有效的关键词（例如，输入的是纯空格），也返回原始文本
    if (keywordArray.length === 0) {
        return <>{text}</>;
    }

    // 为正则表达式构建准备：对关键词中的所有正则表达式特殊字符进行转义
    // 这样可以防止如 "*", "+", "?", "(", ")" 等字符被错误地解释为正则元字符
    const escapedKeywords = keywordArray.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    // 创建一个正则表达式来匹配任何一个转义后的关键词
    // 'g' 表示全局匹配（查找所有匹配项），'i' 表示忽略大小写
    const regex = new RegExp(`(${escapedKeywords.join('|')})`, 'gi');

    // 使用正则表达式的 split 方法来分割文本
    // 正则表达式中的捕获组 (由括号包围的部分，即单个关键词) 也会作为分隔符包含在结果数组中
    // 例如，text="abcKEYxyz", keywords="KEY" => parts=["abc", "KEY", "xyz"]
    const parts = text.split(regex);

    return (
        <>
            {parts.map((part, index) =>
                // 检查当前部分是否是关键词之一 (通过与原始关键词数组比较，忽略大小写)
                // 注意：由于 split(regex) 的行为，匹配项本身就是 part，而不是 regex.test(part)
                keywordArray.some(kw => part.toLowerCase() === kw.toLowerCase()) ? (
                    // 如果是关键词，用 <mark> 标签包裹并应用高亮样式
                    <mark key={`highlight-${index}-${part.substring(0,5)}`} className={styles.highlight}>{part}</mark>
                ) : (
                    // 非关键词部分直接渲染
                    // 使用 React.Fragment 是因为数组中的每个子元素都需要一个唯一的 key
                    <React.Fragment key={`textpart-${index}-${part.substring(0,5)}`}>{part}</React.Fragment>
                )
            )}
        </>
    );
};


const SimilaritySearchResultsDisplay: React.FC<SimilaritySearchResultsDisplayProps> = ({
    results,
    isLoading,
    error,
    queryText, // 用户上一次执行的搜索查询
    novelId,   // 当前小说的ID，用于构建跳转到章节的链接
}) => {

    // 状态一：正在加载搜索结果
    if (isLoading) {
        return (
            <div className={`loading-message ${styles.loadingState}`}> {/* 使用全局加载消息样式和模块特定样式 */}
                <Loader size={18} className="spinning-icon" style={{ marginRight: 'var(--spacing-sm)'}}/>
                正在搜索相似内容，请稍候...
            </div>
        );
    }

    // 状态二：搜索过程中发生错误
    if (error) {
        return (
            <div className={`error-message ${styles.errorState}`}> {/* 使用全局错误消息样式和模块特定样式 */}
                <AlertTriangle size={18} style={{ marginRight: 'var(--spacing-sm)'}}/>
                相似内容搜索时出错: {error}
            </div>
        );
    }

    // 状态三：已执行搜索 (queryText 不为 null) 且没有找到结果
    if (queryText !== null && results.length === 0) {
        return (
            <div className={`no-data-message ${styles.noResultsState}`}> {/* 使用全局无数据消息样式和模块特定样式 */}
                <SearchSlash size={20} style={{marginRight: 'var(--spacing-sm)'}}/>
                未能找到与 “<strong>{queryText}</strong>” 相关的相似内容。请尝试其他关键词或调整搜索范围。
            </div>
        );
    }

    // 状态四：尚未执行任何搜索 (queryText 为 null)，或结果为空 (此情况已被上面捕获)
    // 如果不希望在首次加载或清空查询后显示任何内容，可以返回 null
    if (queryText === null || results.length === 0) {
        // 返回一个占位符或提示，告知用户如何开始搜索
        // 或者，如果父组件控制了何时显示此组件，这里可以直接返回null
        return (
            <div className={`${styles.initialPrompt} info-message`}> {/* 使用全局信息提示样式 */}
                 <Info size={18} style={{marginRight: 'var(--spacing-sm)'}}/>
                请输入关键词或句子，在上方搜索框中开始相似性搜索。
            </div>
        );
    }

    // 状态五：成功获取到搜索结果并展示列表
    return (
        <div className={styles.resultsContainer}> {/* 结果列表的根容器 */}
            <h4> {/* 结果标题，包含用户查询和结果数量 */}
                与 “<strong>{queryText}</strong>” 相关的结果 ({results.length} 条):
            </h4>
            <ul className={styles.resultsList}> {/* 无序列表，用于展示每个结果项 */}
                {results.map((item) => {
                    // 从元数据中安全地提取章节索引，用于构建跳转链接
                    // 后端 vector_store_service.py 中为块存储的元数据包含 chapter_index (0-based)
                    const chapterIndexFromMeta = item.metadata?.chapter_index;
                    const chunkIndexFromMeta = item.metadata?.chunk_index;

                    // 检查是否可以生成有效的跳转到章节的链接
                    const canLinkToChapter = novelId !== undefined &&
                                           chapterIndexFromMeta !== undefined &&
                                           typeof chapterIndexFromMeta === 'number' &&
                                           chapterIndexFromMeta >= 0;

                    // 构建跳转链接的路径 (如果可链接)
                    const chapterLinkPath = canLinkToChapter ? `/novels/${novelId}/chapters/${chapterIndexFromMeta}` : '#';

                    // 优先使用后端在元数据中预设的 'source' 字段 (来自 vector_store_service.py)
                    // 如果没有，则尝试基于元数据构建一个更友好的来源描述
                    let displaySource = item.source || '未知来源';
                    if (item.source === "未知来源" || !item.source) { // 如果后端未提供或提供的是默认"未知来源"
                        const novelTitleHint = item.metadata?.novel_title_hint || (novelId ? `小说ID ${novelId}` : '当前小说');
                        const chapterTitleHint = item.metadata?.chapter_title_hint || (typeof chapterIndexFromMeta === 'number' ? `章节 ${chapterIndexFromMeta + 1}` : '未知章节');
                        const chunkDisplay = typeof chunkIndexFromMeta === 'number' ? `片段 ${chunkIndexFromMeta + 1}` : '片段 N/A';
                        displaySource = `${novelTitleHint} - ${chapterTitleHint} - ${chunkDisplay}`;
                    }


                    return (
                        <li key={item.id} className={styles.resultItem}> {/* 单个结果项 */}
                            <div className={styles.resultMetadata}> {/* 元数据区域：来源、跳转链接、距离 */}
                                <span className={styles.source} title={`来源详情: ${displaySource}`}>
                                    {/* 优先显示后端提供的 item.source，如果它已足够友好 */}
                                    {/* 如果 item.source 不够具体或不存在，则使用上面构建的 displaySource */}
                                    {item.source && item.source !== "未知来源" ? item.source : displaySource.substring(0,50) + (displaySource.length > 50 ? '...' : '')}
                                </span>
                                {/* 如果可以跳转到章节，则显示跳转链接 */}
                                {canLinkToChapter && (
                                    <RouterLink // 使用 RouterLink 进行客户端导航
                                        to={chapterLinkPath}
                                        className={styles.jumpLink}
                                        title={`点击跳转到小说ID ${novelId} 的章节 ${typeof chapterIndexFromMeta === 'number' ? chapterIndexFromMeta + 1 : ''} 进行处理`}
                                        aria-label={`跳转到章节 ${typeof chapterIndexFromMeta === 'number' ? chapterIndexFromMeta + 1 : ''}`}
                                    >
                                        处理此章节 <ExternalLink size={12} style={{ marginLeft: '3px' }} aria-hidden="true"/>
                                    </RouterLink>
                                )}
                                <span className={styles.distance} title={`与查询的相似度距离 (越小越相似): ${item.distance.toFixed(4)}`}>
                                    (相关度距离: {item.distance.toFixed(4)})
                                </span>
                            </div>
                            <p className={styles.resultText} title="相似文本块内容预览">
                                {/* 使用 HighlightKeywords 辅助组件高亮显示结果文本中的关键词 */}
                                <HighlightKeywords text={item.text} keywords={queryText} />
                            </p>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

export default SimilaritySearchResultsDisplay;