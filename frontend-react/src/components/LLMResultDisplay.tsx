// frontend-react/src/components/LLMResultDisplay.tsx
import React, { useMemo } from 'react';
import { toast } from 'react-toastify';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { dracula } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
    RuleChainExecuteResponse,
    TextProcessResponse,
    RAGGenerateResponse,
    PredefinedTaskEnum,
    PostProcessingRuleEnum,
    GenerationConstraintsSchema as GenerationConstraints,
    OutputFormatConstraintEnum,
    RuleChainDryRunResponse, // 添加 DryRunResponse 类型
    ApplicationConfig, // 用于辅助函数
    // StreamChunkData, // 如果需要在这里直接处理块，则导入
} from '../services/api';
import styles from './LLMResultDisplay.module.css';
import {
    Copy, CheckCircle, Info, AlertTriangle, ThumbsUp, ThumbsDown, Send, Loader, Settings, List, Replace as ReplaceIcon,
    DollarSign, EyeSlash, HelpCircle, // 为 DryRun 和成本预估添加的图标
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useWorkbench } from '../contexts/WorkbenchContext'; // 仍然使用 context 获取流式状态和默认结果
import ChainExecutionResultDisplay from './ChainExecutionResultDisplay';

// --- 辅助函数区 (与你之前提供的版本一致，略作调整和类型补充) ---

// 获取任务显示标签
const getTaskDisplayLabel = (taskId?: string | null, appConfig?: ApplicationConfig | null): string => {
    if (!taskId) return "未指定任务";
    // 实际项目中，predefinedTasksMeta 应该从 context/config 中获取
    // 尝试从 appConfig.llm_settings.task_model_preference (或其他地方) 获取任务的元数据或标签
    // 为简化，暂时直接处理taskId
    const taskOption = appConfig?.llm_settings?.task_model_preference && appConfig.llm_settings.task_model_preference[taskId]
        ? taskId // 如果有配置，但没有明确标签，至少显示ID
        : null;
    return taskOption || taskId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

// 获取后处理规则显示标签
const getPostProcessRuleDisplayLabel = (rules?: PostProcessingRuleEnum[] | null): string => {
    if (!rules || rules.length === 0) return "无";
    return rules.map(ruleValue => {
        const ruleKey = Object.keys(PostProcessingRuleEnum).find(k => (PostProcessingRuleEnum as any)[k] === ruleValue);
        return ruleKey ? ruleKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : String(ruleValue);
    }).join('; ');
};

// 渲染单个生成约束及其满足状态
const renderSingleConstraintDisplay = (
    constraintKey: keyof GenerationConstraints,
    constraintValue: any,
    isSatisfied?: boolean
): React.ReactNode => {
    if (constraintValue === null || constraintValue === undefined || (Array.isArray(constraintValue) && constraintValue.length === 0)) {
        return null;
    }
    let displayLabel = constraintKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    switch (constraintKey) {
        case 'max_length': displayLabel = '最大长度'; break;
        case 'min_length': displayLabel = '最小长度'; break;
        case 'include_keywords': displayLabel = '包含关键词'; break;
        case 'exclude_keywords': displayLabel = '排除关键词'; break;
        case 'enforce_sentiment': displayLabel = '强制情感'; break;
        case 'style_hints': displayLabel = '风格提示'; break;
        case 'output_format': displayLabel = '输出格式'; break;
        case 'output_format_details': displayLabel = '格式详情 (JSON)'; break;
        case 'scene_setting': displayLabel = '场景设定'; break;
        case 'character_focus': displayLabel = '角色聚焦'; break;
        case 'dialogue_style': displayLabel = '对话风格'; break;
        case 'target_narrative_pace': displayLabel = '叙事节奏'; break;
        case 'target_language_style': displayLabel = '语言风格'; break;
        case 'target_description_focus': displayLabel = '描写侧重'; break;
        case 'reference_style_text_snippet': displayLabel = '参考片段'; break;
    }

    let displayFormattedValue = Array.isArray(constraintValue)
        ? constraintValue.join('; ')
        : String(constraintValue);

    if (constraintKey === 'output_format_details' && typeof constraintValue === 'object') {
        try { displayFormattedValue = JSON.stringify(constraintValue, null, 2); }
        catch (e) { /* Fallback to string if stringify fails */ }
    } else if (typeof constraintValue === 'boolean') {
        displayFormattedValue = constraintValue ? "是" : "否";
    }

    let statusIcon: React.ReactNode = <Info size={14} className={styles.constraintUnknownIcon} title="此约束未进行自动校验或不适用"/>;
    let statusText = '(未校验)';
    let itemOverallClass = `${styles.constraintItem} ${styles.unknownStatus}`;
    if (isSatisfied === true) {
        statusIcon = <ThumbsUp size={14} className={styles.constraintSatisfiedIcon} title="约束已满足"/>;
        statusText = '(已满足)';
        itemOverallClass = `${styles.constraintItem} ${styles.satisfiedStatus}`;
    } else if (isSatisfied === false) {
        statusIcon = <ThumbsDown size={14} className={styles.constraintNotSatisfiedIcon} title="约束未满足"/>;
        statusText = '(未满足)';
        itemOverallClass = `${styles.constraintItem} ${styles.notSatisfiedStatus}`;
    }
    return (
        <li key={constraintKey} className={itemOverallClass}>
            <span className={styles.constraintLabel}>{displayLabel}:</span>
            <span className={styles.constraintValue}>{displayFormattedValue || '-'}</span>
            <span className={styles.constraintStatus}>{statusIcon} {statusText}</span>
        </li>
    );
};

// 渲染结构化内容 (如JSON, Markdown表格, XML, 列表等)
const renderStructuredContent = (
    text: string,
    formatHint?: OutputFormatConstraintEnum | null,
    taskHint?: string | null
): React.ReactNode => {
    const trimmedText = text ? text.trim() : "";
    if (!trimmedText) return <pre className={styles.processedTextPre}>LLM 未返回有效文本输出或输出为空。</pre>;

    const actualFormatHint = typeof formatHint === 'string' && formatHint in OutputFormatConstraintEnum
        ? formatHint as OutputFormatConstraintEnum
        : null;

    if (actualFormatHint === OutputFormatConstraintEnum.JSON_OBJECT || (!actualFormatHint && trimmedText.startsWith('{') && trimmedText.endsWith('}')) || (!actualFormatHint && trimmedText.startsWith('[') && trimmedText.endsWith(']'))) {
        try {
            const jsonObj = JSON.parse(trimmedText);
            return (
                <SyntaxHighlighter language="json" style={dracula} PreTag="pre" className={`${styles.codeBlock} ${styles.jsonCode}`}>
                    {JSON.stringify(jsonObj, null, 2)}
                </SyntaxHighlighter>
            );
        } catch (e) { /* 不是合法的 JSON，继续尝试其他格式 */ }
    }
    
    if (actualFormatHint === OutputFormatConstraintEnum.MARKDOWN_TABLE || (trimmedText.includes('|') && trimmedText.includes('---'))) {
        const lines = trimmedText.split('\n').map(line => line.trim()).filter(line => line.startsWith('|') && line.endsWith('|'));
        if (lines.length > 1 && lines[1].match(/^(\|\s*-+\s*)+\|$/)) {
            try { 
                const headerLine = lines[0];
                const headers = headerLine.substring(1, headerLine.length - 1).split('|').map(h => h.trim());
                const dataRows = lines.slice(2);
                return (
                    <div className={styles.tableContainer}>
                        <table className={styles.markdownTable}>
                            <thead><tr>{headers.map((header, index) => <th key={`th-${index}`}>{header}</th>)}</tr></thead>
                            <tbody>
                                {dataRows.map((rowLine, rowIndex) => {
                                    const cells = rowLine.substring(1, rowLine.length - 1).split('|').map(c => c.trim());
                                    const paddedCells = [...cells, ...Array(Math.max(0, headers.length - cells.length)).fill('')];
                                    return (<tr key={`tr-${rowIndex}`}>{paddedCells.slice(0, headers.length).map((cell, cellIndex) => <td key={`td-${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>);
                                })}
                            </tbody>
                        </table>
                    </div>
                );
            } catch (e) { console.warn("Markdown table parsing failed, falling back.", e); }
        }
    }

    if (actualFormatHint === OutputFormatConstraintEnum.XML_STRUCTURE || (trimmedText.startsWith('<') && trimmedText.endsWith('>'))) {
        return <SyntaxHighlighter language="xml" style={dracula} PreTag="pre" className={`${styles.codeBlock} ${styles.xmlCode}`}>{trimmedText}</SyntaxHighlighter>;
    }
    
    const isBulletLine = (line: string) => /^(\s*[\*\-\+]\s+)/.test(line);
    const isNumberedLine = (line: string) => /^(\s*\d+\.\s+)/.test(line);
    const linesForListCheck = trimmedText.split('\n');
    const firstNonEmptyLineTrimmed = linesForListCheck.find(l => l.trim())?.trim();

    if (actualFormatHint === OutputFormatConstraintEnum.BULLET_LIST ||
        actualFormatHint === OutputFormatConstraintEnum.NUMBERED_LIST ||
        (firstNonEmptyLineTrimmed && (isBulletLine(firstNonEmptyLineTrimmed) || isNumberedLine(firstNonEmptyLineTrimmed))) ||
        taskHint === PredefinedTaskEnum.EXTRACT_ROLES || // 特定任务也倾向于列表显示
        taskHint === PredefinedTaskEnum.EXTRACT_DIALOGUE ||
        taskHint === PredefinedTaskEnum.IDENTIFY_EVENTS) {
        let listType: 'ul' | 'ol' | null = null;
        if (actualFormatHint === OutputFormatConstraintEnum.BULLET_LIST || (!actualFormatHint && firstNonEmptyLineTrimmed && isBulletLine(firstNonEmptyLineTrimmed))) listType = 'ul';
        if (actualFormatHint === OutputFormatConstraintEnum.NUMBERED_LIST || (!actualFormatHint && firstNonEmptyLineTrimmed && isNumberedLine(firstNonEmptyLineTrimmed))) listType = 'ol';
        
        if (listType) {
            const items = linesForListCheck.map(line => {
                let content = line.trim();
                if (isBulletLine(content)) content = content.replace(/^(\s*[\*\-\+]\s+)/, '');
                else if (isNumberedLine(content)) content = content.replace(/^(\s*\d+\.\s+)/, '');
                return content.trim();
            }).filter(Boolean);

            if (items.length > 0) {
                const ListTag = listType;
                return (<ListTag className={listType === 'ul' ? styles.bulletList : styles.numberedList}>{items.map((item, index) => <li key={`listitem-${index}`}>{item}</li>)}</ListTag>);
            }
        }
    }
    
    // 默认使用 ReactMarkdown 进行渲染
    return (
        <ReactMarkdown className={styles.markdownContent} remarkPlugins={[remarkGfm]}>
            {trimmedText}
        </ReactMarkdown>
    );
};

// 组件 Props 定义
interface LLMResultDisplayProps {
    // 新增：可选的 result prop，用于直接传递结果对象
    resultToShow?: TextProcessResponse | RAGGenerateResponse | RuleChainExecuteResponse | RuleChainDryRunResponse | null;
    onApplyToEditor?: (textToApply: string) => void;
    onCopyToClipboard?: (textToCopy: string) => void;
    showApplyButton?: boolean;
    novelIdContext?: number | string; // 通常用于 "发送到工作台素材区" 等操作
    chapterIndexContext?: number;   // 同上
}

const LLMResultDisplay: React.FC<LLMResultDisplayProps> = ({
    resultToShow, // 接收一个可选的 result prop
    onApplyToEditor,
    onCopyToClipboard,
    showApplyButton = true,
    novelIdContext,
    chapterIndexContext
}) => {
    const {
        // 从 context 获取流式状态和默认的/context驱动的结果
        isLoading: isContextLoading,
        llmResult: llmResultFromContext,
        dryRunResult: dryRunResultFromContext,
        isStreaming,
        accumulatedStreamedOutput,
        // streamingLlmResultChunks, // 原始流数据块, 如果需要精细控制或调试可以取消注释
        streamError,
        addMaterialSnippet, // 用于 "发送到工作台素材区"
        appConfig,          // 用于辅助函数获取任务标签等
    } = useWorkbench();

    // 决定使用哪个结果源：优先 props 传入的，其次是 context 的 dryRun, 最后是 context 的 llmResult
    // 注意：流式输出 (accumulatedStreamedOutput) 是独立处理的，并且通常在流结束后会填充到 llmResultFromContext (如果设计如此)
    const finalResultToRender = resultToShow !== undefined ? resultToShow : (dryRunResultFromContext || llmResultFromContext);

    // --- 流式处理状态的优先显示 ---
    if (isStreaming && resultToShow === undefined) { // 仅当没有外部 resultToShow 且正在流式处理时，显示流式UI
        return (
            <div className={`${styles.resultsArea} ${styles.streamingContainer}`}>
                <h3 className={styles.areaTitle}><Loader size={20} className={styles.spinningIcon} /> 处理中 (流式传输)...</h3>
                {streamError && <div className={`${styles.alert} ${styles.alertError}`}>流式错误: {streamError}</div>}
                <div className={styles.resultBlock}>
                    <div className={styles.blockHeader}><strong>实时输出:</strong></div>
                    <pre className={styles.streamingOutputPre}>{accumulatedStreamedOutput || "等待数据..."}</pre>
                </div>
            </div>
        );
    }

    // --- 非流式加载状态 (仅当没有 resultToShow 时考虑 context 的加载状态) ---
    if (isContextLoading && !isStreaming && resultToShow === undefined) {
        return <div className={`${styles.resultsArea} ${styles.loadingState}`}><Loader size={24} className={styles.spinningIcon} /> <span>LLM 结果加载中...</span></div>;
    }

    // --- 流结束后可能存在的错误 (仅当没有 resultToShow 时考虑 context 的流错误) ---
    if (streamError && !isStreaming && resultToShow === undefined) {
        return (
            <div className={`${styles.resultsArea} ${styles.errorResultBorder}`}>
                <h3 className={styles.areaTitle}><AlertTriangle className={styles.statusIconError} size={20}/> 处理失败</h3>
                <div className={`${styles.alert} ${styles.alertError}`}>{streamError}</div>
            </div>
        );
    }
    
    // --- 处理 finalResultToRender (可能是来自 prop 或 context) ---
    if (!finalResultToRender) {
        // 如果流已结束，但最终没有累积输出，也没有其他结果，则显示无结果
        if (!isStreaming && resultToShow === undefined && accumulatedStreamedOutput && !streamError) {
             // 特殊情况：流结束了，有累积输出但可能未包装成 finalResultToRender
        } else if (!isStreaming) { // 只有在非流式状态下才真正显示“无结果”
            return <div className={`${styles.resultsArea} ${styles.noResultPlaceholder}`}><Info size={16}/> 暂无AI处理结果。</div>;
        }
        // 如果仍在流式处理但 finalResultToRender 为空，则由上面的 isStreaming 逻辑处理，这里不重复显示“无结果”
    }

    // --- 解析和准备显示的数据 (基于 finalResultToRender 或 accumulatedStreamedOutput) ---
    let mainTextOutput = "";
    let taskTypeFromBackend: string | undefined;
    let modelUsedDisplay: string | undefined;
    let postProcessRulesApplied: PostProcessingRuleEnum[] | undefined;
    let instructionUsed: string | undefined;
    let parametersUsed: Record<string, any> | undefined;
    let constraintsApplied: Partial<GenerationConstraints> | undefined;
    let constraintsSatisfied: Record<string, boolean> | undefined;
    let retrievedSnippetsToDisplay: string[] | null = null;
    let isErrorInResult = false;
    let isDryRunResponse = false;
    let ruleChainStepsToDisplay: RuleChainExecuteResponse['steps_results'] | null = null;
    let executedChainName: string | undefined;


    if (finalResultToRender) {
        if ('estimated_total_prompt_tokens' in finalResultToRender) { // RuleChainDryRunResponse
            isDryRunResponse = true;
            // DryRun 结果的显示逻辑会单独处理
        } else if ('processed_text' in finalResultToRender) { // TextProcessResponse
            mainTextOutput = finalResultToRender.processed_text;
            taskTypeFromBackend = finalResultToRender.task_used;
            modelUsedDisplay = finalResultToRender.model_used;
            postProcessRulesApplied = finalResultToRender.post_process_rule_applied;
            instructionUsed = finalResultToRender.instruction_used;
            parametersUsed = finalResultToRender.parameters_used;
            constraintsApplied = finalResultToRender.constraints_applied;
            constraintsSatisfied = finalResultToRender.constraints_satisfied;
        } else if ('generated_text' in finalResultToRender) { // RAGGenerateResponse
             mainTextOutput = finalResultToRender.generated_text;
             taskTypeFromBackend = PredefinedTaskEnum.RAG_GENERATION;
             modelUsedDisplay = finalResultToRender.model_used;
             instructionUsed = finalResultToRender.instruction;
             retrievedSnippetsToDisplay = finalResultToRender.retrieved_context_snippets;
             constraintsApplied = finalResultToRender.constraints_applied;
             constraintsSatisfied = finalResultToRender.constraints_satisfied;
        } else if ('final_output_text' in finalResultToRender) { // RuleChainExecuteResponse
            mainTextOutput = finalResultToRender.final_output_text;
            executedChainName = finalResultToRender.executed_chain_name || `规则链 #${finalResultToRender.executed_chain_id}`;
            taskTypeFromBackend = executedChainName;
            ruleChainStepsToDisplay = finalResultToRender.steps_results;
            // 规则链的 modelUsed, instructionUsed 等通常在步骤级别，或有全局设置
            // 为简化，此处主要显示最终输出和步骤。可以在 ChainExecutionResultDisplay 中显示步骤详情。
        }
    } else if (accumulatedStreamedOutput && !isStreaming && resultToShow === undefined) {
        // 如果没有 finalResultToRender，但有流结束后的累积输出 (且不是通过 prop 传入的)
        mainTextOutput = accumulatedStreamedOutput;
        taskTypeFromBackend = "流式规则链输出"; // 这是一个通用标签
        // 对于这种情况，其他元数据 (model, params etc.) 不易获取，除非流本身也传输了这些
    }
    
    if (mainTextOutput && (mainTextOutput.toLowerCase().startsWith("处理失败:") || mainTextOutput.toLowerCase().startsWith("错误:"))) {
        isErrorInResult = true;
    }
    const taskTypeDisplay = getTaskDisplayLabel(taskTypeFromBackend, appConfig);

    const resultStatusIconToUse = isErrorInResult
        ? <AlertTriangle className={styles.statusIconError} size={20} aria-label="处理失败"/>
        : <CheckCircle className={styles.statusIconSuccess} size={20} aria-label="处理成功"/>;
    
    // 渲染 DryRun 结果
    if (isDryRunResponse && finalResultToRender) {
        const dryRunData = finalResultToRender as RuleChainDryRunResponse;
        return (
            <div className={`${styles.resultsArea}`}>
                <h3 className={styles.areaTitle}><Settings size={20} /> 成本预估 (Dry Run)</h3>
                <SyntaxHighlighter language="json" style={dracula} PreTag="pre" className={styles.codeBlock}>
                    {JSON.stringify(dryRunData, null, 2)}
                </SyntaxHighlighter>
                {/* 你也可以在这里使用之前定义的 DryRunConfirmModalInternal 内部的渲染逻辑，如果需要更美观的展示 */}
            </div>
        );
    }

    // 如果在非流式状态下，没有任何有效文本输出或结构化结果，则显示“无结果”
    if (!isStreaming && !mainTextOutput && !isDryRunResponse) {
         return <div className={`${styles.resultsArea} ${styles.noResultPlaceholder}`}><Info size={16}/> 暂无AI处理结果。</div>;
    }

    // 渲染主内容
    const renderedMainContent = useMemo(() => {
        if (!mainTextOutput) return null;
        if (isErrorInResult) {
            return <pre className={`${styles.processedTextPre} ${styles.errorTextOutput}`}>{mainTextOutput}</pre>;
        }
        const outputFormatHint = constraintsApplied?.output_format;
        return renderStructuredContent(mainTextOutput, outputFormatHint, taskTypeFromBackend);
    }, [mainTextOutput, isErrorInResult, constraintsApplied?.output_format, taskTypeFromBackend]);

    // 发送到工作台素材区
    const handleSendToWorkbenchInternal = () => {
        if (mainTextOutput && !isErrorInResult && addMaterialSnippet) {
            const sourceDesc = `LLM输出 (${taskTypeDisplay})${modelUsedDisplay ? ` - 模型: ${modelUsedDisplay.split('/').pop()}` : ''}`;
            const metadataForWorkbench: Record<string, any> = {
                task_used: taskTypeFromBackend, model_used: modelUsedDisplay,
                parameters_used: parametersUsed, constraints_applied: constraintsApplied,
                instruction_used: instructionUsed,
            };
            if (retrievedSnippetsToDisplay) { metadataForWorkbench.retrieved_context_snippets_count = retrievedSnippetsToDisplay.length; }
            if (ruleChainStepsToDisplay) { metadataForWorkbench.executed_chain_name = executedChainName; }
            if (novelIdContext !== undefined) metadataForWorkbench.novelId = String(novelIdContext);
            if (chapterIndexContext !== undefined) metadataForWorkbench.chapterIndex = chapterIndexContext;

            addMaterialSnippet({
                type: retrievedSnippetsToDisplay ? 'rag_result' : (ruleChainStepsToDisplay ? 'rule_chain_output' : 'llm_output'),
                sourceDescription: sourceDesc, content: mainTextOutput, metadata: metadataForWorkbench
            });
            toast.success("结果已发送到工作台素材区！");
        } else {
            toast.warn("没有有效的LLM输出可以发送到工作台。");
        }
    };
    
    // --- 主渲染逻辑 (非加载、非流式、非错误、非DryRun) ---
    // 只有在有 mainTextOutput 或 ruleChainStepsToDisplay (对于空的最终输出但有步骤的链)时才渲染主要结果区域
    if (!mainTextOutput && !ruleChainStepsToDisplay && !isDryRunResponse) {
        // 如果流已结束，accumulatedStreamedOutput 为空或未定义 resultToShow，并且没有错误，则可能确实无结果
        if (!isStreaming && !streamError) {
             return <div className={`${styles.resultsArea} ${styles.noResultPlaceholder}`}><Info size={16}/> AI未返回有效输出。</div>;
        }
        return null; // 其他情况（如仍在流式传输但尚未输出）由上面的流式逻辑处理
    }

    return (
        <div className={`${styles.resultsArea} ${isErrorInResult ? styles.errorResultBorder : ''}`}>
            <h3 className={styles.areaTitle}>
                {resultStatusIconToUse}
                LLM 处理结果
                {isErrorInResult && <span className={styles.errorStatusText}>(处理出现问题)</span>}
            </h3>

            <div className={styles.resultGrid}>
                {taskTypeDisplay && <div className={styles.resultItem}><strong>执行的任务/链:</strong> <span className={styles.infoTag}>{taskTypeDisplay}</span></div>}
                {modelUsedDisplay && (<div className={styles.resultItem}><strong>使用模型:</strong> <span className={styles.infoTag}>{modelUsedDisplay}</span></div>)}
                {postProcessRulesApplied && postProcessRulesApplied.length > 0 && (
                     <div className={styles.resultItem}><strong>应用后处理:</strong> <span className={`${styles.infoTag} ${styles.postProcessRuleText}`}>{getPostProcessRuleDisplayLabel(postProcessRulesApplied)}</span></div>
                )}
            </div>

            {retrievedSnippetsToDisplay && retrievedSnippetsToDisplay.length > 0 && (
                <details className={styles.retrievedContextSection} open={retrievedSnippetsToDisplay.length <= 3}>
                    <summary className={styles.contextSummaryToggle}><List size={16} /> 查看/隐藏检索到的上下文 ({retrievedSnippetsToDisplay.length}条)</summary>
                    <div className={styles.snippetsContainer}>
                        {retrievedSnippetsToDisplay.map((snippet, index) => (
                            <div key={index} className={styles.snippetItem}>
                                <h6 className={styles.snippetHeader}>上下文片段 {index + 1}</h6>
                                <ReactMarkdown className={styles.markdownContent} remarkPlugins={[remarkGfm]}>{snippet || "空片段"}</ReactMarkdown>
                            </div>
                        ))}
                    </div>
                </details>
            )}
            {retrievedSnippetsToDisplay === null && finalResultToRender && 'retrieved_context_snippets' in finalResultToRender && (
                 <p className={styles.noContextMessage}><Info size={14}/> 未能检索到相关上下文信息，或上下文为空。</p>
            )}
            
            {instructionUsed && (
                <details className={styles.detailsSection}>
                    <summary>查看发送给LLM的完整指令/提示</summary>
                    <pre className={styles.instructionPre}>{instructionUsed}</pre>
                </details>
            )}
            
            {(mainTextOutput || (ruleChainStepsToDisplay && ruleChainStepsToDisplay.length > 0 && !mainTextOutput) ) && renderedMainContent && ( // 即使mainTextOutput为空，如果有步骤结果也显示框架
                 <div className={styles.resultBlock}>
                    <div className={styles.blockHeader}>
                        <strong>{retrievedSnippetsToDisplay ? "AI生成回答/内容:" : (ruleChainStepsToDisplay ? "规则链最终输出:" : "LLM 输出内容:")}</strong>
                        {mainTextOutput && !isErrorInResult && ( // 仅当有实际主文本输出时才显示操作按钮
                             <div className={styles.outputActions}>
                                {onCopyToClipboard && <button onClick={() => onCopyToClipboard(mainTextOutput)} title="复制LLM输出" className={`${styles.actionButton} ${styles.copyButtonSmall}`}><Copy size={12} /> 复制</button>}
                                {showApplyButton && onApplyToEditor && <button onClick={() => onApplyToEditor(mainTextOutput)} title="将LLM输出应用到编辑器" className={`${styles.actionButton} ${styles.applyButtonSmall}`}><ReplaceIcon size={12} /> 应用</button>}
                                {addMaterialSnippet && <button onClick={handleSendToWorkbenchInternal} title="发送到工作台素材区" className={`${styles.actionButton} ${styles.sendToWorkbenchButton}`}><Send size={12} /> 工作台</button>}
                            </div>
                        )}
                    </div>
                    {renderedMainContent} {/* renderedMainContent 内部会处理 mainTextOutput 为空的情况 */}
                </div>
            )}
            
            {ruleChainStepsToDisplay && ruleChainStepsToDisplay.length > 0 && (
                <ChainExecutionResultDisplay
                    stepsResults={ruleChainStepsToDisplay}
                    executedChainName={executedChainName}
                />
            )}

            {parametersUsed && Object.keys(parametersUsed).length > 0 && (
                <details className={styles.detailsSection}><summary><Settings size={14}/> 查看任务特定参数</summary><pre className={styles.paramsPre}>{JSON.stringify(parametersUsed, null, 2)}</pre></details>
            )}
            
            {constraintsApplied && Object.keys(constraintsApplied).length > 0 && (
                <details className={`${styles.detailsSection} ${styles.constraintsBlockFullWidth || ''}`}><summary><Info size={14}/> 查看应用的生成约束</summary>
                    <ul className={styles.constraintsList}>
                        {(Object.keys(constraintsApplied) as Array<keyof GenerationConstraints>)
                            .map(key => renderSingleConstraintDisplay(key, constraintsApplied[key], constraintsSatisfied ? constraintsSatisfied[key] : undefined )).filter(Boolean)}
                    </ul>
                </details>
            )}
        </div>
    );
};

export default LLMResultDisplay;