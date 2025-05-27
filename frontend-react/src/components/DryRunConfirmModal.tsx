// frontend-react/src/components/DryRunConfirmModal.tsx
import React, { useState, useEffect, useMemo, ChangeEvent, FormEvent } from 'react';
import { toast } from 'react-toastify';
import Select, { SingleValue, StylesConfig, GroupBase, components, OptionProps as ReactSelectOptionProps } from 'react-select';

import {
    ApplicationConfig,
    UserDefinedLLMConfig, // 用户自定义LLM配置类型
    RuleChainExecuteResponse,
    // 可能需要的其他类型
} from '../services/api'; // 假设这些类型在api.ts中定义

import pageViewStyles from '../pages/PageStyles.module.css';
// 样式可以复用 RuleChainEditor 的或创建新的，这里假设复用部分 RuleChainEditor 的样式
import componentStyles from './RuleChainEditor.module.css';
import { Loader, Play, X as CloseIcon, ChevronDown, Info, Cpu, AlertTriangle } from 'lucide-react';

// React Select 组件选项的通用接口
export interface ReactSelectOption {
    value: string | number;
    label: string;
    title?: string;
    isDisabled?: boolean;
}

// HelpTooltip 组件
const HelpTooltipStandalone: React.FC<{ text: string }> = ({ text }) => (
    <span className={componentStyles.helpIconWrapperInternal} title={text} style={{ marginLeft: '4px', verticalAlign: 'middle', cursor: 'help' }}>
        <Info size={13} className={componentStyles.helpIconInternal} style={{ opacity: 0.7 }} />
    </span>
);


interface DryRunConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (initialContext: string, dryRunModelOverrideId: string | null) => void;
    novelId: number | null;
    initialContextValue: string; // 使用新 prop 名以区分内部状态
    onInitialContextChange: (context: string) => void; // 新增回调，允许父组件控制初始上下文
    isProcessing: boolean; // 是否正在执行测试
    result: RuleChainExecuteResponse | null; // 测试执行的结果 (从后端返回的 RuleChainExecuteResponse)
    error: string | null; // 测试执行的错误

    // 新增：接收完整的用户定义模型列表和应用配置
    availableLLMModels: UserDefinedLLMConfig[];
    appConfig: ApplicationConfig | null;
    currentGlobalModelId?: string | null; // 当前规则链自身设置的全局模型ID (user_given_id)
}

const DryRunConfirmModal: React.FC<DryRunConfirmModalProps> = ({
    isOpen,
    onClose,
    onSubmit,
    novelId,
    initialContextValue, // 使用父组件传递的上下文值
    onInitialContextChange, // 使用父组件传递的更新函数
    isProcessing,
    result,
    error,
    availableLLMModels, // 从 props 接收
    appConfig,          // 从 props 接收
    currentGlobalModelId, // 从 props 接收
}) => {
    // 移除内部的 initialContext 状态，现在由父组件管理
    // const [internalInitialContext, setInternalInitialContext] = useState<string>(parentInitialContext);

    // 用于测试执行时覆盖模型的 model_id (user_given_id)
    const [dryRunModelOverrideId, setDryRunModelOverrideId] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            // setInternalInitialContext(parentInitialContext); // 不再需要，因为 initialContextValue 直接来自 props
            setDryRunModelOverrideId(null); // 每次打开模态框时重置覆盖模型
        }
    }, [isOpen]); // 移除 parentInitialContext 依赖

    const handleContextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
        onInitialContextChange(e.target.value); // 调用父组件的更新函数
    };

    // const currentContextValue = initialContextValue; // 直接使用 prop

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!initialContextValue.trim() && novelId === null) {
            toast.warn("请输入测试执行所需的初始上下文。");
            return;
        }
        onSubmit(initialContextValue, dryRunModelOverrideId);
    };

    // 获取启用的用户定义模型列表，用于测试执行的模型覆盖下拉框
    const enabledModelsForDryRunSelect = useMemo((): ReactSelectOption[] => {
        return (availableLLMModels || [])
            .filter(m => m.enabled && appConfig?.llm_providers[m.provider_tag]?.enabled)
            .map(m => ({
                value: m.user_given_id, // 值是 user_given_id
                label: `${m.user_given_name} (${m.provider_tag} / ${m.model_identifier_for_api.split('/').pop()?.substring(0,20)}${m.model_identifier_for_api.length > 20 ? '...' : ''})`, // 显示用户自定义名称和关键信息
                title: `配置ID: ${m.user_given_id}\n提供商: ${m.provider_tag}\nAPI模型: ${m.model_identifier_for_api}${m.max_context_tokens ? `\n上下文: ${m.max_context_tokens}` : ''}${m.notes ? `\n备注: ${m.notes}` : ''}`
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [availableLLMModels, appConfig]);

    const selectedDryRunModelOption = enabledModelsForDryRunSelect.find(opt => opt.value === dryRunModelOverrideId) || null;
    
    // 更新：更准确地显示默认占位符
    const defaultModelForDryRunPlaceholder = useMemo(() => {
        const chainGlobalModel = currentGlobalModelId ? enabledModelsForDryRunSelect.find(m => m.value === currentGlobalModelId) : null;
        if (chainGlobalModel) return `规则链全局模型: ${chainGlobalModel.label}`;
        
        const appDefaultModelId = appConfig?.llm_settings?.default_model_id;
        const appDefaultModel = appDefaultModelId ? enabledModelsForDryRunSelect.find(m => m.value === appDefaultModelId) : null;
        if (appDefaultModel) return `应用默认模型: ${appDefaultModel.label}`;
        
        return "应用默认模型 (未指定)"; // 如果都没有，则显示通用占位符
    }, [currentGlobalModelId, appConfig, enabledModelsForDryRunSelect]);

    // React Select 样式 (可以从 TaskSpecificParamsInput 共享或在此处定义)
    const selectStyles: StylesConfig<ReactSelectOption, false, GroupBase<ReactSelectOption>> = useMemo(() => ({
        control: (base, state) => ({ ...base, minHeight: '36px', height: 'auto', fontSize: 'var(--font-size-sm)', borderColor: state.isFocused ? 'var(--color-primary)' : 'var(--border-color-input)' }),
        menu: (base) => ({ ...base, zIndex: 1060, fontSize: 'var(--font-size-sm)' }), // 确保高于父模态框 (如果适用)
        menuPortal: base => ({ ...base, zIndex: 1060 }), // 与 menu zIndex 保持一致或更高
        option: (styles, { data, isDisabled, isFocused, isSelected }) => ({ ...styles, backgroundColor: isDisabled ? undefined : isSelected ? 'var(--color-primary)' : isFocused ? 'var(--hover-bg-color)' : undefined, color: isDisabled ? 'var(--color-muted)' : isSelected ? 'white' : 'var(--text-color-base)', cursor: isDisabled ? 'not-allowed' : 'default', whiteSpace: 'normal', wordBreak: 'break-word' }),
    }), []);
    const NoOptionsMessage = (props: any) => ( <components.NoOptionsMessage {...props}> <span style={{fontSize: '0.85em'}}>{props.selectProps.noOptionsMessage()}</span> </components.NoOptionsMessage> );
    const CustomOption = (props: ReactSelectOptionProps<ReactSelectOption, false, GroupBase<ReactSelectOption>>) => ( <components.Option {...props} title={props.data.title || props.label}/> );


    if (!isOpen) return null;

    return (
        <div className={pageViewStyles.modalOverlay} data-visible={isOpen}>
            <div className={`${pageViewStyles.modalContent} ${componentStyles.dryRunModalContentSizing || ''}`}> {/* 确保 dryRunModalContentSizing 定义了合适的宽度 */}
                <form onSubmit={handleSubmit}>
                    <div className={pageViewStyles.modalHeader}>
                        <h4><Play size={18}/> 测试执行规则链</h4>
                        <button type="button" onClick={onClose} className={pageViewStyles.modalCloseButton} title="关闭" disabled={isProcessing}>
                            <CloseIcon size={22} />
                        </button>
                    </div>

                    <div className={`${pageViewStyles.modalBody} ${componentStyles.dryRunModalBodyScroll || ''}`}> {/* 确保 dryRunModalBodyScroll 允许内容滚动 */}
                        {novelId !== null && novelId !== undefined && (
                            <p className={pageViewStyles.infoMessage} style={{fontSize: '0.9em', marginBottom: 'var(--spacing-md)'}}>
                                <Info size={14}/> 将基于小说 ID: <strong>{novelId}</strong> 的上下文进行测试 (如果规则链步骤需要)。
                            </p>
                        )}
                        <div className={pageViewStyles.formGroup}>
                            <label htmlFor="dryRunInitialContext">
                                初始上下文 (可选):
                                <HelpTooltipStandalone text="如果规则链的第一个步骤输入源设置为“原始文本”，则此处内容将作为初始输入。如果关联了小说，通常可留空，除非您想测试特定输入。" />
                            </label>
                            <textarea
                                id="dryRunInitialContext"
                                value={initialContextValue} // 使用来自 props 的值
                                onChange={handleContextChange} // 使用新的回调
                                rows={5}
                                className={pageViewStyles.textareaField}
                                placeholder={novelId ? "通常可留空，将使用小说上下文作为原始输入（如果首步骤需要）。" : "请输入用于测试的初始文本内容..."}
                                disabled={isProcessing}
                            />
                        </div>

                        {/* LLM 模型覆盖选择 */}
                        <div className={pageViewStyles.formGroup}>
                            <label htmlFor="dryRunModelOverrideId">
                                <Cpu size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }}/>
                                LLM模型覆盖 (可选):
                                <HelpTooltipStandalone text="选择一个模型以在本次测试中覆盖规则链的全局模型和所有步骤中定义的模型。留空则使用规则链自身的模型配置。" />
                            </label>
                            <div className={componentStyles.parameterModelSelector || ''}> {/* 复用模型选择器的样式类 */}
                                <Select
                                    inputId="dryRunModelOverrideId"
                                    value={selectedDryRunModelOption} // 使用已处理的 react-select 选项
                                    onChange={(selectedOption: SingleValue<ReactSelectOption>) => {
                                        setDryRunModelOverrideId(selectedOption ? String(selectedOption.value) : null);
                                    }}
                                    options={enabledModelsForDryRunSelect}
                                    isClearable
                                    isDisabled={isProcessing || !appConfig}
                                    placeholder={`使用规则链配置 (预设: ${defaultModelForDryRunPlaceholder})`}
                                    noOptionsMessage={() => appConfig ? "无可用LLM模型配置。" : "应用配置加载中..."}
                                    styles={selectStyles} // 应用 react-select 样式
                                    components={{ NoOptionsMessage, Option: CustomOption }}
                                    menuPortalTarget={document.body} // 确保下拉菜单在模态框之上
                                />
                            </div>
                        </div>


                        {isProcessing && (
                            <div className={componentStyles.dryRunLoading || styles.dryRunLoading}> {/* Fallback to local style if componentStyles is not defined */}
                                <Loader size={22} className="spinning-icon" />
                                <span>正在执行规则链，请稍候...</span>
                            </div>
                        )}

                        {error && (
                            <div className={`${pageViewStyles.errorMessage} ${componentStyles.dryRunResultDisplay || styles.dryRunResultDisplay} error-message`}>
                                <AlertTriangle size={16}/> 测试执行出错: {error}
                            </div>
                        )}

                        {/* 结果显示部分保持不变 */}
                        {result && (
                            <div className={componentStyles.dryRunResultDisplay || styles.dryRunResultDisplay}>
                                <h5>测试执行结果:</h5>
                                <div className={componentStyles.resultSection}>
                                    <strong>最终输出:</strong>
                                    <pre className={componentStyles.resultOutputText}>
                                        {result.final_output_text !== null && result.final_output_text !== undefined 
                                            ? (typeof result.final_output_text === 'object' ? JSON.stringify(result.final_output_text, null, 2) : String(result.final_output_text))
                                            : <span className={componentStyles.noOutputText}>(无最终输出)</span>}
                                    </pre>
                                </div>
                                <details className={componentStyles.resultDetails}>
                                    <summary className={componentStyles.resultDetailsSummary}>
                                        查看详细步骤输出和日志 ({result.steps_results?.length || 0} 个步骤)
                                        <ChevronDown size={16}/>
                                    </summary>
                                    <ul className={componentStyles.stepOutputsList}>
                                        {(result.steps_results || []).map((stepOut, index) => (
                                            <li key={index} className={componentStyles.stepOutputItem}>
                                                <p><strong>步骤 {stepOut.step_order + 1}:</strong> {stepOut.task_type || '(无描述)'}</p>
                                                <p className={componentStyles.outputVarName}>输出变量名: <code>{stepOut.output_variable_name || 'N/A'}</code></p>
                                                <div className={componentStyles.stepOutputContent}>
                                                    <strong>输出内容:</strong>
                                                    <pre>
                                                        {typeof stepOut.output_text_snippet === 'object' 
                                                            ? JSON.stringify(stepOut.output_text_snippet, null, 2) 
                                                            : String(stepOut.output_text_snippet ?? '(空)')}
                                                    </pre>
                                                </div>
                                                {stepOut.error && <p className={componentStyles.stepError}><AlertTriangle size={12}/> 错误: {stepOut.error}</p>}
                                                {stepOut.model_used && <p className={componentStyles.modelUsedInfo}>模型使用: {appConfig?.llm_settings.available_models.find(m=>m.user_given_id === stepOut.model_used)?.user_given_name || stepOut.model_used}</p>}
                                                {/* Token 信息通常在 DryRunResponse 中不直接提供，而是汇总在顶层。如果单个步骤有，可以取消注释 */}
                                                {/* {stepOut.prompt_tokens && <p className={componentStyles.tokenInfo}>Prompt Tokens: {stepOut.prompt_tokens}</p>} */}
                                                {/* {stepOut.completion_tokens && <p className={componentStyles.tokenInfo}>Completion Tokens: {stepOut.completion_tokens}</p>} */}
                                                {/* {stepOut.total_tokens && <p className={componentStyles.tokenInfo}>Total Tokens: {stepOut.total_tokens}</p>} */}
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                                {result.error && ( // 这里假设 RuleChainExecuteResponse 可能也有一个顶层的 error 字段
                                    <div className={`${pageViewStyles.errorMessage} ${componentStyles.resultSection}`}>
                                        <strong>执行期间错误:</strong> {result.error}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className={pageViewStyles.modalFooter}>
                        <button type="button" onClick={onClose} className="btn btn-sm btn-secondary" disabled={isProcessing}>
                            关闭
                        </button>
                        <button type="submit" className="btn btn-sm btn-primary" disabled={isProcessing || (!initialContextValue.trim() && novelId === null)}>
                            {isProcessing ? <Loader size={16} className="spinning-icon" /> : <Play size={16} />}
                            {isProcessing ? '执行中...' : '开始执行'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default DryRunConfirmModal;