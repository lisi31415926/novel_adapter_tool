// frontend-react/src/components/ChainExecutionResultDisplay.tsx
import React, { useState, useMemo } from 'react'; // React 和 useState, useMemo Hook
import { toast } from 'react-toastify'; 

import {
    RuleChainExecuteResponse, 
    StepExecutionResult,      
    PostProcessingRuleEnum,   
    GenerationConstraints,    
    OutputFormatConstraintEnum, // 引入 OutputFormatConstraintEnum
    StepExecutionStatusEnum as BackendStepExecutionStatusEnum, 
    getPredefinedTasks,       
} from '../services/api';

import styles from './ChainExecutionResultDisplay.module.css'; 
import {
    Copy, AlertCircle, CheckCircle, ChevronDown, ChevronUp,
    Info, Loader, ThumbsUp, ThumbsDown, Send, ListChecks, Settings 
} from 'lucide-react';
import { useWorkbench } from '../contexts/WorkbenchContext'; 

// --- 辅助函数 (与 LLMResultDisplay 中的逻辑保持一致或复用) ---
const predefinedTasksDisplayOptionsFromAPI = getPredefinedTasks();
const getTaskDisplayLabelFromStepResult = (taskType: string): string => {
    if (taskType === "CHAIN_EXECUTION_FAILURE") return "规则链执行失败"; 
    const taskOption = predefinedTasksDisplayOptionsFromAPI.find(opt => opt.value === taskType);
    return taskOption ? taskOption.label : `未知任务 (${taskType})`; 
};

const formatPostProcessingRulesForDisplay = (rules?: PostProcessingRuleEnum[] | null): string => {
    if (!rules || rules.length === 0) return "无"; 
    return rules.map(ruleValue => {
        const ruleKey = Object.keys(PostProcessingRuleEnum).find(k => (PostProcessingRuleEnum as any)[k] === ruleValue);
        return ruleKey ? ruleKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : ruleValue;
    }).join('; '); 
};

const renderSingleStepConstraintDisplay = (
    constraintKey: keyof GenerationConstraints,
    constraintValue: any,
    isSatisfied?: boolean
): React.ReactNode => {
    if (constraintValue === null || constraintValue === undefined || (Array.isArray(constraintValue) && constraintValue.length === 0)) {
        return null;
    }
    let displayLabel = constraintKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    switch (constraintKey) { 
        case 'max_length': displayLabel = '最大长度 (Token)'; break;
        case 'min_length': displayLabel = '最小长度 (Token)'; break;
        case 'include_keywords': displayLabel = '要求包含关键词'; break;
        case 'exclude_keywords': displayLabel = '要求排除关键词'; break;
        case 'enforce_sentiment': displayLabel = '要求情感倾向'; break;
        case 'style_hints': displayLabel = '要求风格提示'; break;
        case 'output_format': displayLabel = '要求输出格式'; break;
        case 'output_format_details': displayLabel = '输出格式详情'; break;
        default: break;
    }
    let displayFormattedValue = Array.isArray(constraintValue) ? constraintValue.join('; ') : String(constraintValue);
    if (constraintKey === 'output_format_details' && typeof constraintValue === 'object') { 
        try { displayFormattedValue = JSON.stringify(constraintValue, null, 2); } catch (e) { /* no-op */ } 
    }
    let statusIcon: React.ReactNode = <Info size={14} className={styles.stepConstraintUnknownIcon} title="未校验/不适用"/>;
    let statusText = '(未校验)';
    let itemClass = `${styles.stepConstraintItem} ${styles.unknown}`;
    if (isSatisfied === true) { statusIcon = <ThumbsUp size={14} className={styles.stepConstraintSatisfiedIcon} title="已满足"/>; statusText = '(已满足)'; itemClass = `${styles.stepConstraintItem} ${styles.satisfied}`; }
    else if (isSatisfied === false) { statusIcon = <ThumbsDown size={14} className={styles.stepConstraintNotSatisfiedIcon} title="未满足"/>; statusText = '(未满足)'; itemClass = `${styles.stepConstraintItem} ${styles.notSatisfied}`; }
    return (
        <li key={constraintKey} className={itemClass}>
            <span className={styles.stepConstraintLabel}>{displayLabel}:</span>
            <span className={styles.stepConstraintValue}>{displayFormattedValue || '-'}</span>
            <span className={styles.stepConstraintStatus}>{statusIcon} {statusText}</span>
        </li>
    );
};

// --- 新增/复用：智能渲染结构化内容的辅助函数 (与 LLMResultDisplay.tsx 中的版本类似或应共享) ---
// 为保持此文件修改的独立性，此处重新定义。在实际项目中，应提取为共享工具函数。
const renderStructuredContentForChain = (
    text: string | null | undefined, 
    formatHint?: OutputFormatConstraintEnum | string | null, // formatHint 可以是枚举值或字符串
    taskHint?: string | null 
): React.ReactNode => {
    if (!text) {
        return <pre className={styles.stepSnippetPre}>(无内容片段)</pre>;
    }
    const trimmedText = text.trim();
    if (!trimmedText) {
        return <pre className={styles.stepSnippetPre}>(内容片段为空白)</pre>;
    }

    const actualFormatHint = typeof formatHint === 'string' && formatHint in OutputFormatConstraintEnum 
        ? formatHint as OutputFormatConstraintEnum 
        : null;

    // 1. Markdown 表格渲染
    if (actualFormatHint === OutputFormatConstraintEnum.MARKDOWN_TABLE || (trimmedText.includes('|') && trimmedText.includes('---'))) {
        const lines = trimmedText.split('\n').map(line => line.trim()).filter(line => line.startsWith('|') && line.endsWith('|'));
        if (lines.length > 1 && lines[1].match(/^(\|\s*-+\s*)+\|$/)) {
            try {
                const headerLine = lines[0];
                const headers = headerLine.substring(1, headerLine.length - 1).split('|').map(h => h.trim());
                const dataRows = lines.slice(2);
                return (
                    <div className={styles.tableContainerOutput}> {/* 使用新的或共享的表格容器类 */}
                        <table className={styles.markdownTableOutput}> {/* 使用新的或共享的表格类 */}
                            <thead>
                                <tr>{headers.map((header, index) => <th key={`h-${index}`}>{header}</th>)}</tr>
                            </thead>
                            <tbody>
                                {dataRows.map((rowLine, rowIndex) => {
                                    const cells = rowLine.substring(1, rowLine.length - 1).split('|').map(c => c.trim());
                                    const paddedCells = [...cells, ...Array(Math.max(0, headers.length - cells.length)).fill('')];
                                    return (
                                        <tr key={`r-${rowIndex}`}>
                                            {paddedCells.slice(0, headers.length).map((cell, cellIndex) => <td key={`c-${rowIndex}-${cellIndex}`}>{cell}</td>)}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                );
            } catch (e) { console.warn("Markdown table parsing in Chain Result failed, fallback.", e); }
        }
    }

    // 2. XML 结构基础代码块显示
    if (actualFormatHint === OutputFormatConstraintEnum.XML_STRUCTURE || (trimmedText.startsWith('<') && trimmedText.endsWith('>'))) {
        return <pre className={`${styles.codeBlockOutput} ${styles.xmlCodeOutput}`}><code lang="xml">{trimmedText}</code></pre>;
    }

    // 3. Markdown 列表渲染
    const isBulletLine = (line: string) => /^(\s*[\*\-\+]\s+)/.test(line);
    const isNumberedLine = (line: string) => /^(\s*\d+\.\s+)/.test(line);
    const allLines = trimmedText.split('\n');
    const firstNonEmptyLine = allLines.find(l => l.trim());

    if (actualFormatHint === OutputFormatConstraintEnum.BULLET_LIST || 
        actualFormatHint === OutputFormatConstraintEnum.NUMBERED_LIST ||
        (firstNonEmptyLine && (isBulletLine(firstNonEmptyLine.trim()) || isNumberedLine(firstNonEmptyLine.trim()))) ||
        taskHint === PredefinedTaskEnum.EXTRACT_ROLES || taskHint === PredefinedTaskEnum.EXTRACT_DIALOGUE || taskHint === PredefinedTaskEnum.IDENTIFY_EVENTS
        ) {
        let listTypeToRender: 'ul' | 'ol' | null = null;
        if (actualFormatHint === OutputFormatConstraintEnum.BULLET_LIST || (!actualFormatHint && firstNonEmptyLine && isBulletLine(firstNonEmptyLine.trim()))) listTypeToRender = 'ul';
        if (actualFormatHint === OutputFormatConstraintEnum.NUMBERED_LIST || (!actualFormatHint && firstNonEmptyLine && isNumberedLine(firstNonEmptyLine.trim()))) listTypeToRender = 'ol';
        
        if (listTypeToRender) {
            const items = allLines.map(line => {
                let content = line.trim();
                if (isBulletLine(content)) content = content.replace(/^(\s*[\*\-\+]\s+)/, '');
                else if (isNumberedLine(content)) content = content.replace(/^(\s*\d+\.\s+)/, '');
                return content.trim();
            }).filter(Boolean);

            if (items.length > 0) {
                const ListTag = listTypeToRender;
                return (
                    <ListTag className={listTypeToRender === 'ul' ? styles.bulletListOutput : styles.numberedListOutput}>
                        {items.map((item, index) => <li key={`li-${index}`}>{item}</li>)}
                    </ListTag>
                );
            }
        }
    }
    
    // 4. 默认回退
    return <pre className={styles.stepSnippetPre}>{trimmedText}</pre>;
};


interface ChainExecutionResultDisplayProps {
    executionResult: RuleChainExecuteResponse | null; 
    isLoading?: boolean; 
    novelIdContext?: number | string;
    chapterIndexContext?: number;
}

const ChainExecutionResultDisplay: React.FC<ChainExecutionResultDisplayProps> = ({
    executionResult,
    isLoading,
    novelIdContext,     
    chapterIndexContext 
}) => {
    const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
    const { addMaterialSnippet } = useWorkbench(); 

    if (isLoading) {
        return (
            <div className={`${styles.chainExecutionResultArea} ${styles.loadingState}`}>
                <Loader size={24} className={styles.spinningIcon} />
                <span>规则链执行结果加载中...</span>
            </div>
        );
    }

    if (!executionResult) {
        return null;
    }

    const handleCopyToClipboard = async (textToCopy: string | undefined | null, typeLabel: string) => {
        if (textToCopy && textToCopy.trim()) {
            try { await navigator.clipboard.writeText(textToCopy); toast.success(`${typeLabel}已成功复制到剪贴板！`);}
            catch (err) { console.error(`无法复制${typeLabel}: `, err); toast.error(`复制${typeLabel}失败。请尝试手动复制。`);}
        } else { toast.info(`没有可复制的${typeLabel}内容。`); }
    };

    const handleSendToWorkbench = ( content: string, type: 'chain_final_output' | 'chain_step_output', sourceDescription: string, metadata?: Record<string, any>) => {
        if (content && content.trim()) {
            const finalMetadata = { ...metadata };
            if (novelIdContext !== undefined) finalMetadata.novelId = novelIdContext;
            if (chapterIndexContext !== undefined) finalMetadata.chapterIndex = chapterIndexContext;
            addMaterialSnippet({ type: type, sourceDescription: sourceDescription, content: content, metadata: finalMetadata });
        } else { toast.warn("没有有效的输出内容可以发送到工作台。"); }
    };

    const getOverallStatus = (): { statusClass: string; message: string; icon: React.ElementType } => {
        if (!executionResult.steps_results || executionResult.steps_results.length === 0) {
            if (executionResult.final_output_text?.toLowerCase().includes("错误") || executionResult.final_output_text?.toLowerCase().includes("fail") || executionResult.steps_results.some(step => step.task_type === "CHAIN_EXECUTION_FAILURE")) {
                 return { statusClass: styles.statusFailure, message: "规则链执行失败或未产生有效结果。", icon: AlertCircle };
            }
            return { statusClass: styles.statusUnknown, message: "没有执行任何步骤或结果未知。", icon: Info };
        }
        const actualExecutedSteps = executionResult.steps_results.filter(step => step.task_type !== "CHAIN_EXECUTION_FAILURE");
        const successfulSteps = actualExecutedSteps.filter(step => step.status === BackendStepExecutionStatusEnum.SUCCESS).length;
        if (actualExecutedSteps.length === 0 && executionResult.steps_results.length > 0 && executionResult.steps_results[0].task_type === "CHAIN_EXECUTION_FAILURE") {
            return { statusClass: styles.statusFailure, message: "规则链执行因顶层错误而中止。", icon: AlertCircle };
        }
        if (successfulSteps === actualExecutedSteps.length && actualExecutedSteps.length > 0) {
            return { statusClass: styles.statusSuccess, message: `所有 ${actualExecutedSteps.length} 个步骤均成功执行。`, icon: CheckCircle };
        }
        if (successfulSteps === 0 && actualExecutedSteps.length > 0) {
            return { statusClass: styles.statusFailure, message: `所有 ${actualExecutedSteps.length} 个步骤均执行失败。`, icon: AlertCircle };
        }
        return { statusClass: styles.statusPartialSuccess, message: `部分步骤成功 (${successfulSteps}/${actualExecutedSteps.length})，部分步骤执行失败。`, icon: AlertTriangle };
    };

    const overallStatusInfo = getOverallStatus(); 
    const OverallStatusIconComponent = overallStatusInfo.icon; 

    const toggleStepExpansion = (stepOrder: number) => {
        setExpandedSteps(prev => ({ ...prev, [stepOrder]: !prev[stepOrder] }));
    };

    const chainNameForSource = executionResult.executed_chain_name || (executionResult.executed_chain_id ? `规则链 (ID: ${executionResult.executed_chain_id})` : '动态执行的规则链');

    // 使用 useMemo 缓存渲染后的最终输出内容
    const renderedFinalOutput = useMemo(() => {
        if (executionResult.final_output_text && executionResult.final_output_text.trim() && 
            overallStatusInfo.statusClass !== styles.statusFailure && 
            !executionResult.steps_results.some(s => s.task_type === "CHAIN_EXECUTION_FAILURE")
        ) {
            // 尝试从最后一个成功步骤的约束中获取格式提示
            let formatHintFinal: OutputFormatConstraintEnum | string | null | undefined = null;
            const lastSuccessfulStep = [...executionResult.steps_results].reverse().find(s => s.status === BackendStepExecutionStatusEnum.SUCCESS);
            if (lastSuccessfulStep && lastSuccessfulStep.parameters_used?.generation_constraints) {
                formatHintFinal = lastSuccessfulStep.parameters_used.generation_constraints.output_format;
            }
            return renderStructuredContentForChain(executionResult.final_output_text, formatHintFinal);
        } else if (overallStatusInfo.statusClass === styles.statusFailure || executionResult.steps_results.some(s => s.task_type === "CHAIN_EXECUTION_FAILURE")) {
            return <pre className={styles.outputTextPre}>规则链执行失败或因错误中止，未产生有效的最终输出。</pre>;
        } else {
            return <pre className={styles.outputTextPre}>规则链未产生最终输出或输出为空。</pre>;
        }
    }, [executionResult, overallStatusInfo.statusClass]);

    return (
        <div className={styles.chainExecutionResultArea}> 
            <h3> 
                <ListChecks size={24} style={{marginRight: 'var(--spacing-sm)'}} aria-hidden="true"/>
                规则链执行结果:
                {executionResult.executed_chain_name && ` “${executionResult.executed_chain_name}”`}
                {executionResult.total_execution_time != null && ( 
                    <span className={styles.executionTime}> (总耗时: {executionResult.total_execution_time.toFixed(2)} 秒)</span>
                )}
            </h3>

            <div className={`${styles.overallStatusContainer} ${overallStatusInfo.statusClass}`}>
                <OverallStatusIconComponent size={20} className={overallStatusInfo.icon === Loader ? styles.spinningIcon : ''} aria-hidden="true" />
                <strong>总体状态:</strong> {overallStatusInfo.message}
            </div>

            <div className={styles.finalOutputSection}>
                <div className={styles.outputHeader}> 
                    <h4>最终输出文本:</h4>
                    <div className={styles.outputActions}> 
                        {executionResult.final_output_text && executionResult.final_output_text.trim() && (
                            <button
                                onClick={() => handleCopyToClipboard(executionResult.final_output_text, "规则链最终输出文本")}
                                title="复制规则链执行的最终输出文本到剪贴板"
                                className={`${styles.copyButtonSmall} btn btn-xs btn-outline-secondary`}
                            >
                                <Copy size={12} aria-hidden="true"/> 复制
                            </button>
                        )}
                        {executionResult.final_output_text && executionResult.final_output_text.trim() &&
                         !executionResult.steps_results.some(s => s.task_type === "CHAIN_EXECUTION_FAILURE") && 
                         overallStatusInfo.statusClass !== styles.statusFailure && 
                         (
                            <button
                                onClick={() => handleSendToWorkbench(
                                    executionResult.final_output_text, 'chain_final_output', 
                                    `规则链 "${chainNameForSource}" 的最终输出`, 
                                    { chainId: executionResult.executed_chain_id, chainName: executionResult.executed_chain_name, totalSteps: executionResult.steps_results.length }
                                )}
                                title="将规则链的最终输出文本发送到改编工作台的素材区"
                                className={`${styles.sendToWorkbenchButton} btn btn-xs btn-outline-primary`}
                            >
                                <Send size={12} aria-hidden="true" /> 发送到工作台
                            </button>
                        )}
                    </div>
                </div>
                {/* 使用缓存的渲染结果 */}
                {renderedFinalOutput}
            </div>

            <h4 className={styles.stepsDetailHeader}>
                各步骤执行详情 ({executionResult.steps_results?.length || 0} 个步骤):
            </h4>
            {(executionResult.steps_results && executionResult.steps_results.length > 0) ? (
                <ul className={styles.stepResultList}> 
                    {executionResult.steps_results.map((stepResult) => {
                        const appliedConstraints = stepResult.parameters_used?.generation_constraints as GenerationConstraints | undefined;
                        const satisfiedConstraints = stepResult.constraints_satisfied; 
                        const canSendStepToWorkbench = stepResult.status === BackendStepExecutionStatusEnum.SUCCESS &&
                                                      stepResult.output_text_snippet &&
                                                      stepResult.output_text_snippet.trim() &&
                                                      !stepResult.output_text_snippet.toLowerCase().startsWith("(无输出") &&
                                                      !stepResult.output_text_snippet.toLowerCase().startsWith("错误:");
                        
                        // 使用useMemo缓存单个步骤的渲染内容
                        const renderedStepOutputSnippet = useMemo(() => {
                            return renderStructuredContentForChain(
                                stepResult.output_text_snippet,
                                (stepResult.parameters_used?.generation_constraints as GenerationConstraints | undefined)?.output_format,
                                stepResult.task_type
                            );
                        }, [stepResult.output_text_snippet, stepResult.parameters_used, stepResult.task_type]);


                        return (
                            <li key={stepResult.step_order} className={`${styles.stepResultItem} ${styles[stepResult.status.toLowerCase()]}`}>
                                <div
                                    className={styles.stepHeader}
                                    onClick={() => toggleStepExpansion(stepResult.step_order)} 
                                    role="button" tabIndex={0}  
                                    onKeyDown={(e: React.KeyboardEvent) => {if (e.key === 'Enter' || e.key === ' ') toggleStepExpansion(stepResult.step_order);}}
                                    aria-expanded={!!expandedSteps[stepResult.step_order]} 
                                    aria-controls={`step-details-${stepResult.step_order}`} 
                                >
                                    <span className={styles.stepTitle}> 
                                        步骤 {stepResult.step_order + 1}: {getTaskDisplayLabelFromStepResult(stepResult.task_type)}
                                    </span>
                                    <div className={styles.stepStatusControls}> 
                                        <span className={`${styles.stepStatusBadge} ${styles[stepResult.status.toLowerCase()]}`}>
                                            {stepResult.status === BackendStepExecutionStatusEnum.SUCCESS ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                                            {stepResult.status === BackendStepExecutionStatusEnum.SUCCESS ? "成功" : (stepResult.status === BackendStepExecutionStatusEnum.FAILURE ? "失败" : stepResult.status)}
                                        </span>
                                        {canSendStepToWorkbench && expandedSteps[stepResult.step_order] && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation(); 
                                                    handleSendToWorkbench(
                                                        stepResult.output_text_snippet, 'chain_step_output', 
                                                        `规则链 "${chainNameForSource}" - 步骤 ${stepResult.step_order + 1} (${getTaskDisplayLabelFromStepResult(stepResult.task_type)}) 输出片段`,
                                                        { chainId: executionResult.executed_chain_id, chainName: executionResult.executed_chain_name, stepOrder: stepResult.step_order, taskType: stepResult.task_type, modelUsed: stepResult.model_used, parametersUsed: stepResult.parameters_used, inputSnippet: stepResult.input_text_snippet }
                                                    );
                                                }}
                                                title="将此步骤的输出文本片段发送到改编工作台的素材区"
                                                className={`${styles.sendStepToWorkbenchButton} btn btn-xs btn-outline-primary`}
                                                aria-label={`发送步骤 ${stepResult.step_order + 1} 输出片段到工作台`}
                                            >
                                                <Send size={12} aria-hidden="true"/> 发送此片段
                                            </button>
                                        )}
                                        <button className={styles.expandButton} aria-label={expandedSteps[stepResult.step_order] ? "折叠此步骤详情" : "展开此步骤详情"}>
                                            {expandedSteps[stepResult.step_order] ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                        </button>
                                    </div>
                                </div>

                                {expandedSteps[stepResult.step_order] && (
                                    <div className={styles.stepDetailsContent} id={`step-details-${stepResult.step_order}`} role="region">
                                        {stepResult.custom_instruction_used && ( <div className={styles.stepDetailItem}><strong>自定义指令:</strong> <pre className={styles.codeBlockSmall}>{stepResult.custom_instruction_used}</pre></div> )}
                                        {stepResult.parameters_used && Object.keys(stepResult.parameters_used).filter(k => k !== 'generation_constraints').length > 0 && (
                                            <div className={styles.stepDetailItem}>
                                                <strong><Settings size={12} style={{marginRight: 'var(--spacing-xs)'}}/> 使用参数 (不含约束):</strong>
                                                <pre className={styles.codeBlockJson}>
                                                    {JSON.stringify( Object.fromEntries(Object.entries(stepResult.parameters_used).filter(([key]) => key !== 'generation_constraints')), null, 2 )}
                                                </pre>
                                            </div>
                                        )}
                                        {appliedConstraints && Object.keys(appliedConstraints).length > 0 && (
                                            <div className={`${styles.stepDetailItem} ${styles.stepConstraintsBlock}`}>
                                                <strong><Info size={12} style={{marginRight: 'var(--spacing-xs)'}}/> 应用的生成约束:</strong>
                                                <ul className={styles.stepConstraintsList}>
                                                    {(Object.keys(appliedConstraints) as Array<keyof GenerationConstraints>)
                                                        .map(key => renderSingleStepConstraintDisplay(key, appliedConstraints[key], satisfiedConstraints ? satisfiedConstraints[key] : undefined))
                                                        .filter(Boolean) 
                                                    }
                                                </ul>
                                            </div>
                                        )}
                                        {stepResult.post_processing_rules_applied && stepResult.post_processing_rules_applied.length > 0 && (
                                            <div className={styles.stepDetailItem}><strong>后处理规则:</strong> {formatPostProcessingRulesForDisplay(stepResult.post_processing_rules_applied)}</div>
                                        )}
                                        <div className={styles.stepDetailItem}><strong>输入文本片段:</strong><pre className={styles.stepSnippetPre}>{stepResult.input_text_snippet || "(无输入片段)"}</pre></div>
                                        {/* 使用缓存的单步渲染结果 */}
                                        <div className={styles.stepDetailItem}><strong>输出文本片段:</strong>{renderedStepOutputSnippet}</div>
                                        {stepResult.error && ( <div className={`${styles.stepDetailItem} ${styles.errorMessageText}`}><strong>错误详情:</strong> {stepResult.error}</div> )}
                                        {stepResult.model_used && ( <div className={styles.stepDetailItem}><strong>使用模型:</strong> {stepResult.model_used}</div> )}
                                    </div>
                                )}
                            </li>
                        )
                    })}
                </ul>
            ) : ( 
                <p className="no-data-message">没有步骤执行结果可显示。</p>
            )}
        </div>
    );
};

export default ChainExecutionResultDisplay;