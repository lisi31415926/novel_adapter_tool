// frontend-react/src/components/FullContentModal.tsx
import React, { useEffect, MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'; // 明确导入 React 的事件类型
import { toast } from 'react-toastify';
import { MaterialSnippet } from '../contexts/WorkbenchContext'; // 假设 MaterialSnippet 类型在此定义
import styles from './FullContentModal.module.css';
import { Copy, X as CloseIcon } from 'lucide-react';

interface FullContentModalProps {
  snippet: MaterialSnippet | null; // 当前要显示的素材片段对象，如果为null则不显示模态框
  onClose: () => void;             // 关闭模态框时调用的回调函数
}

const FullContentModal: React.FC<FullContentModalProps> = ({ snippet, onClose }) => {

  // Effect 1: 处理背景页面滚动
  useEffect(() => {
    if (snippet) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [snippet]);

  // Effect 2: 处理 Escape 键关闭模态框
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => { // globalThis.KeyboardEvent 以避免与React事件类型混淆
      if (event.key === 'Escape' && snippet) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [snippet, onClose]);

  if (!snippet) {
    return null;
  }

  // 处理“复制全部内容”按钮的点击事件
  const handleCopyToClipboard = async () => {
    if (snippet.content && snippet.content.trim()) {
      try {
        await navigator.clipboard.writeText(snippet.content);
        toast.success("素材完整内容已成功复制到剪贴板!");
      } catch (err) {
        console.error("复制素材完整内容失败: ", err);
        toast.error("复制失败。您的浏览器可能不支持此操作或未授予权限。请尝试手动选择并复制文本。");
      }
    } else {
      toast.info("当前素材片段没有有效的内容可供复制。");
    }
  };

  // 处理模态框遮罩层点击事件
  const handleOverlayClick = (e: ReactMouseEvent<HTMLDivElement>) => { // 明确事件类型
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // 准备来源描述，过长则截断
  const sourceDescriptionDisplay = snippet.sourceDescription.length > 60
    ? `${snippet.sourceDescription.substring(0, 57)}...`
    : snippet.sourceDescription;

  return (
    <div
        className={styles.modalOverlay}
        // data-visible 属性似乎没有在 CSS 中直接使用来控制 opacity 和 visibility，
        // 如果 snippet 为 null，组件直接返回 null，所以这个属性可能不是必需的，除非 CSS 有特殊用途。
        // 如果要保留，可以这样写：
        data-visible={!!snippet} 
        onClick={handleOverlayClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modalTitle"
        aria-describedby="modalFullContentDescription"
    >
      <div className={styles.modalContent} role="document">
        <div className={styles.modalHeader}>
          <h4 id="modalTitle" className={styles.modalTitleText} title={`完整素材内容的来源: ${snippet.sourceDescription}`}>
            完整素材内容
            <span className={styles.modalSourceDescription}>
                (来源: {sourceDescriptionDisplay})
            </span>
          </h4>
          <button
            onClick={onClose}
            className={styles.modalCloseButton}
            aria-label="关闭模态框"
            title="关闭此模态框 (或按 Esc 键)"
          >
            <CloseIcon size={24} aria-hidden="true"/>
          </button>
        </div>
        <div className={styles.modalBody}>
          <textarea
            id="modalFullContentDescription"
            value={snippet.content}
            readOnly
            className={styles.modalTextarea}
            aria-label="素材的完整文本内容"
            // autoFocus // autoFocus 属性可以根据需要保留或移除
          />
        </div>
        <div className={styles.modalFooter}>
          <button
            onClick={handleCopyToClipboard}
            className="btn btn-sm btn-primary" // 假设这是全局样式
            title="将上方显示的完整内容复制到剪贴板"
            disabled={!snippet.content || !snippet.content.trim()}
          >
            <Copy size={14} style={{ marginRight: 'var(--spacing-xs)' }} aria-hidden="true"/> 复制全部内容
          </button>
          <button
            onClick={onClose}
            className="btn btn-sm btn-secondary" // 假设这是全局样式
            title="关闭此模态框"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};

export default FullContentModal;