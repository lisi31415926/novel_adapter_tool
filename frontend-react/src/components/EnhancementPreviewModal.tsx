// frontend-react/src/components/EnhancementPreviewModal.tsx
import React from 'react';
import { diffChars, Change } from 'diff';
import pageViewStyles from '../pages/PageStyles.module.css';
import componentStyles from './EnhancementPreviewModal.module.css';
import { X as CloseIcon, CheckCircle, Loader, Info } from 'lucide-react';

interface EnhancementPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    originalText: string;
    enhancedText: string;
    onConfirmApply: () => void;
    isApplying: boolean;
}

const EnhancementPreviewModal: React.FC<EnhancementPreviewModalProps> = ({
    isOpen,
    onClose,
    originalText,
    enhancedText,
    onConfirmApply,
    isApplying,
}) => {
    if (!isOpen) return null;

    const differences = diffChars(originalText || "", enhancedText || "");

    const renderDiff = () => {
        if (!differences || differences.length === 0) {
            return <p className={componentStyles.noChangesDetected}><Info size={16}/> 未检测到有效差异或增强文本为空。</p>;
        }
        return differences.map((part, index) => {
            const styleKey = part.added ? 'addedText' : part.removed ? 'removedText' : 'commonText';
            // Replace newlines with <br /> for HTML display, and handle spaces for <pre> like behavior
            const valueWithBreaks = part.value.split('\n').map((line, i, arr) => (
                <React.Fragment key={i}>
                    {line.replace(/ /g, '\u00a0')} 
                    {i < arr.length - 1 && <br />}
                </React.Fragment>
            ));
            return (
                <span key={index} className={componentStyles[styleKey]}>
                    {valueWithBreaks}
                </span>
            );
        });
    };

    return (
        <div className={pageViewStyles.modalOverlay} data-visible={isOpen}>
            <div className={`${pageViewStyles.modalContent} ${componentStyles.previewModalSizing}`}>
                <div className={pageViewStyles.modalHeader}>
                    <h4 className={componentStyles.modalTitleWithIcon}>
                        <CheckCircle size={18} /> 预览增强结果
                    </h4>
                    <button onClick={onClose} className={pageViewStyles.modalCloseButton} title="关闭预览" disabled={isApplying}>
                        <CloseIcon size={22} />
                    </button>
                </div>
                <div className={`${pageViewStyles.modalBody} ${componentStyles.previewModalBody}`}>
                    <p className={componentStyles.previewHelpText}>
                        请查看下方原始文本与AI增强后文本的差异对比。绿色高亮部分为新增内容，红色删除线部分为移除内容。
                    </p>
                    <div className={componentStyles.diffContainer}>
                        <div className={componentStyles.diffContent}>
                            {renderDiff()}
                        </div>
                    </div>
                     <p className={componentStyles.legend}>
                        <span className={componentStyles.legendItem}><span className={`${componentStyles.colorBox} ${componentStyles.addedTextLegend}`}></span> 新增内容</span>
                        <span className={componentStyles.legendItem}><span className={`${componentStyles.colorBox} ${componentStyles.removedTextLegend}`}></span> 移除内容</span>
                        <span className={componentStyles.legendItem}><span className={`${componentStyles.colorBox} ${componentStyles.commonTextLegend}`}></span> 保留内容</span>
                    </p>
                </div>
                <div className={pageViewStyles.modalFooter}>
                    <button 
                        type="button" 
                        onClick={onClose} 
                        className="btn btn-sm btn-secondary" 
                        disabled={isApplying}
                    >
                        取消
                    </button>
                    <button 
                        type="button" 
                        onClick={onConfirmApply} 
                        className="btn btn-sm btn-primary" 
                        disabled={isApplying || (!differences || differences.length === 0)}
                        title={(!differences || differences.length === 0) ? "无差异或内容可应用" : "确认并将增强结果应用到编辑器"}
                    >
                        {isApplying ? <Loader size={16} className="spinning-icon" /> : <CheckCircle size={16} />}
                        {isApplying ? '应用中...' : '确认并应用'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EnhancementPreviewModal;