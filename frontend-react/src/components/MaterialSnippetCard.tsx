// frontend-react/src/components/MaterialSnippetCard.tsx
import React, { useState, KeyboardEvent, useCallback, FormEvent } from 'react'; // 引入 FormEvent
import { MaterialSnippet } from '../contexts/WorkbenchContext'; // 假设 MaterialSnippet 类型在此定义
import styles from './MaterialSnippetCard.module.css';
import {
    Trash2, Eye, Edit3, Tags, Copy, Check, X as IconX, GripVertical,
    ChevronsUpDown, MessageSquare
} from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

interface MaterialSnippetCardProps {
    snippet: MaterialSnippet; // 素材片段数据
    onCopyToEditor: (content: string) => void; // 复制内容到编辑器回调
    onQuoteToEditor?: (snippet: MaterialSnippet) => void; // 将内容作为引用块插入编辑器回调
    onDeleteSnippet: (id: string) => void; // 删除素材回调
    onViewFullContent: (snippet: MaterialSnippet) => void; // 查看完整内容回调
    
    isEditingTags: boolean; // 当前是否正在编辑此片段的标签
    onEditTags: () => void; // 开始编辑标签的回调
    tempTags: string; // 编辑时临时存储的标签字符串
    onTempTagsChange: (value: string) => void; // 临时标签变化回调
    onSubmitTags: () => void; // 提交标签更改回调
    onCancelEditTags: () => void; // 取消编辑标签回调
}

const MaterialSnippetCard: React.FC<MaterialSnippetCardProps> = ({
    snippet,
    onCopyToEditor,
    onQuoteToEditor,
    onDeleteSnippet,
    onViewFullContent,
    isEditingTags,
    onEditTags,
    tempTags,
    onTempTagsChange,
    onSubmitTags,
    onCancelEditTags
}) => {
    const [showFullContentPreview, setShowFullContentPreview] = useState<boolean>(false); // 控制完整内容预览的展开/折叠状态
    const MAX_PREVIEW_LENGTH = 100; // 内容预览的最大字符数

    // dnd-kit 的 useDraggable hook，用于使卡片可拖拽
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `material-${snippet.id}`, // 拖拽项的唯一ID
        data: { // 拖拽时传递的数据
            type: 'materialSnippet', // 标识拖拽类型
            snippet, // 传递素材片段对象
        },
    });

    // 根据拖拽状态计算应用的CSS transform样式
    const style = transform ? {
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 1000 : 'auto', // 拖拽时提高层级
        opacity: isDragging ? 0.85 : 1,     // 拖拽时半透明
    } : undefined;

    // 切换内容预览的展开/折叠状态
    const toggleContentPreview = useCallback(() => {
        setShowFullContentPreview(prev => !prev);
    }, []);
    
    // 处理标签输入框的键盘事件 (Enter提交, Escape取消)
    const handleTagInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // 阻止表单默认提交行为（如果input在form内）
            onSubmitTags();
        } else if (event.key === 'Escape') {
            onCancelEditTags();
        }
    };

    // 格式化时间戳，只显示小时和分钟
    const formattedTimestamp = useMemo(() => {
      // 确保 snippet.timestamp 是一个有效的 Date 对象或可以转换为 Date 的值
      const dateObject = snippet.timestamp instanceof Date ? snippet.timestamp : new Date(snippet.timestamp);
      if (isNaN(dateObject.getTime())) {
        return "时间无效"; // 如果日期无效，返回提示
      }
      return dateObject.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
      });
    }, [snippet.timestamp]);

    // 根据预览状态和内容长度决定显示的内容
    const displayContent = useMemo(() => {
        return showFullContentPreview || snippet.content.length <= MAX_PREVIEW_LENGTH
            ? snippet.content
            : `${snippet.content.substring(0, MAX_PREVIEW_LENGTH)}...`;
    }, [showFullContentPreview, snippet.content, MAX_PREVIEW_LENGTH]);

    // 处理“引用到编辑器”按钮的点击
    const handleQuoteClick = useCallback(() => {
        if (onQuoteToEditor) {
            onQuoteToEditor(snippet);
        }
    }, [onQuoteToEditor, snippet]);

    // 处理标签编辑表单的提交事件
    const handleTagFormSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); // 明确阻止表单的默认提交
        onSubmitTags();
    };

    // 处理内容预览区域的键盘事件 (Enter或Space展开/折叠)
    const handleContentPreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleContentPreview();
        }
    };

    return (
        <div
            ref={setNodeRef} // dnd-kit 需要的ref
            style={style}    // 应用拖拽的transform样式
            className={`${styles.snippetCard} ${isDragging ? styles.dragging : ''}`} // 基本样式和拖拽时样式
            aria-label={`素材片段: ${snippet.sourceDescription}, 类型: ${snippet.type}`}
        >
            {/* 卡片头部：包含拖拽手柄、来源描述和操作按钮 */}
            <div className={styles.cardHeader}>
                <div className={styles.sourceAndDrag}>
                    {/* 拖拽手柄 */}
                    <span
                        {...listeners} // dnd-kit 的事件监听器
                        {...attributes} // dnd-kit 的辅助属性
                        className={styles.dragHandleMaterial}
                        title="拖拽此素材"
                        aria-label="拖拽素材手柄"
                        role="button" // 明确为按钮角色
                        tabIndex={0} // 使其可聚焦
                    >
                        <GripVertical size={18} />
                    </span>
                    {/* 来源描述和类型 */}
                    <span className={styles.sourceDescription} title={snippet.sourceDescription}>
                        {snippet.sourceDescription.length > 30
                            ? `${snippet.sourceDescription.substring(0, 27)}...`
                            : snippet.sourceDescription
                        }
                        <span className={styles.snippetType}>({snippet.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())})</span>
                    </span>
                </div>
                {/* 卡片操作按钮组 */}
                <div className={styles.cardActions}>
                    <button onClick={() => onViewFullContent(snippet)} className={styles.actionButton} title="查看完整内容" disabled={isEditingTags}><Eye size={14} /></button>
                    <button onClick={() => onCopyToEditor(snippet.content)} className={styles.actionButton} title="复制内容到编辑区" disabled={isEditingTags}><Copy size={14} /></button>
                    {/* “作为引用插入”按钮，仅当提供了 onQuoteToEditor 回调时显示 */}
                    {onQuoteToEditor && (
                         <button onClick={handleQuoteClick} className={styles.actionButton} title="将内容作为引用块插入编辑区" disabled={isEditingTags}>
                             <MessageSquare size={14} />
                         </button>
                    )}
                    <button onClick={() => onDeleteSnippet(snippet.id)} className={`${styles.actionButton} ${styles.deleteButton}`} title="删除此素材" disabled={isEditingTags}><Trash2 size={14} /></button>
                </div>
            </div>

            {/* 内容预览区域 */}
            <div
                className={styles.contentPreview}
                onClick={toggleContentPreview} // 点击切换预览状态
                role="button" // 明确为按钮角色
                tabIndex={0}  // 使其可聚焦
                onKeyDown={handleContentPreviewKeyDown} // 允许键盘操作
                aria-expanded={showFullContentPreview} // ARIA属性，指示当前是否展开
                aria-label={showFullContentPreview ? "折叠内容预览" : "展开内容预览"}
            >
                {displayContent} {/* 显示处理后的内容 */}
                {/* 如果内容过长且未完全显示，则显示展开/折叠指示器 */}
                {snippet.content.length > MAX_PREVIEW_LENGTH && (
                     <span className={styles.togglePreviewIndicator} aria-hidden="true"> {/* aria-hidden，因为视觉信息已通过aria-expanded传达 */}
                        {showFullContentPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {/* 根据状态显示不同图标 */}
                     </span>
                )}
            </div>

            {/* 卡片脚部：包含标签编辑区和时间戳 */}
            <div className={styles.cardFooter}>
                {isEditingTags ? ( // 如果正在编辑标签
                    <form className={styles.tagsEditForm} onSubmit={handleTagFormSubmit}> {/* 明确表单提交处理 */}
                        <input
                            type="text"
                            value={tempTags}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => onTempTagsChange(e.target.value)} // 明确事件类型
                            onKeyDown={handleTagInputKeyDown}
                            className={styles.tagsInput}
                            placeholder="标签, 逗号分隔"
                            aria-label="编辑标签输入框"
                            autoFocus // 自动聚焦
                        />
                        <button type="submit" className={`${styles.tagActionButton} ${styles.tagSaveButton}`} title="保存标签"><Check size={14} /></button>
                        <button type="button" onClick={onCancelEditTags} className={`${styles.tagActionButton} ${styles.tagCancelButton}`} title="取消编辑"><IconX size={14} /></button>
                    </form>
                ) : ( // 如果不在编辑标签状态
                    <div className={styles.tagsDisplay}>
                        <Tags size={14} className={styles.tagsIcon} /> {/* 标签图标 */}
                        {snippet.tags && snippet.tags.length > 0 ? ( // 如果有标签
                            snippet.tags.map((tag, index) => ( // 遍历显示标签
                                <span key={index} className={styles.tagItem} title={tag}>{tag.length > 15 ? `${tag.substring(0,12)}...` : tag}</span>
                            ))
                        ) : ( // 如果没有标签
                            <span className={styles.noTagsText}>无标签</span>
                        )}
                        <button onClick={onEditTags} className={`${styles.actionButton} ${styles.editTagsButton}`} title="编辑标签"><Edit3 size={12} /></button>
                    </div>
                )}
                {/* 时间戳 */}
                <span className={styles.timestamp} title={`创建于: ${snippet.timestamp instanceof Date ? snippet.timestamp.toLocaleString() : new Date(snippet.timestamp).toLocaleString()}`}>
                    {formattedTimestamp}
                </span>
            </div>
        </div>
    );
};

export default MaterialSnippetCard;