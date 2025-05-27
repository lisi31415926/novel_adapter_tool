// frontend-react/src/components/TaskSpecificParamsInput.tsx
import React, { ChangeEvent, useEffect, useState, useCallback, useMemo, FormEvent } from 'react';
import { toast } from 'react-toastify';
// 移除 react-select 的直接导入，如果决定统一使用 AntD Select
// import Select, { SingleValue, MultiValue, StylesConfig, GroupBase, components, OptionProps as ReactSelectOptionProps } from 'react-select';
import { Form as AntForm, Input as AntInput, InputNumber as AntInputNumber, Switch as AntSwitch, Select as AntSelect, Tooltip as AntTooltip, Typography as AntTypography, Space as AntSpace, Alert as AntAlert, Modal as AntModal, List as AntList, Spin as AntSpin, Button as AntButton } from 'antd';

// 从 API 服务或常量导入必要的类型和函数
import {
    PredefinedTaskEnum,
    UserDefinedLLMConfig,
    // GenerationConstraintsSchema, // 如果需要在参数中直接编辑此复杂类型，则保留
    ApplicationConfig,
    getCharactersByNovelId, Character as ApiCharacter,
    getEventsByNovelId, Event as ApiEvent,
    getChaptersByNovelId, Chapter as ApiChapter, // 类型名修正为 ApiChapter
    getNovelWorldviewKeysByNovelId,
    getUserReferableFiles, ReferableFileItem,
    RuleStepParameterDefinition, // 使用 api.ts 中的权威类型
    StepParameterValueType,      // 使用 api.ts 中的权威类型
    ParameterTypeEnum as ApiParameterTypeEnum, // 使用 api.ts 中同步后端的枚举
} from '../services/api';
import { PREDEFINED_TASK_DETAILS_MAP, ParameterTypeEnum as FeParameterTypeEnum } from '../constants'; // 从 constants.ts 获取任务详情和前端维护的 ParameterTypeEnum (如果需要)

// 样式和图标
import componentStyles from './TaskSpecificParamsInput.module.css';
import pageViewStyles from '../pages/PageStyles.module.css';
import {
    HelpCircle, ChevronDown, AlertTriangle, Type as TypeIcon,
    Braces, FolderOpenOutlined as AntFolderOpen, // 使用 AntD 图标替代
    RefreshCw, Users, ListVideo, BookOpen, Globe2, InfoCircleOutlined as AntInfo, // 使用 AntD 图标
} from 'lucide-react'; // 保留其他 Lucide 图标

const { Text } = AntTypography;
const { Option: AntOption } = AntSelect; // Ant Design Select Option

// --- 类型定义 ---
// React Select 选项类型 (如果仍然在某些地方使用 React Select)
interface ReactSelectOption {
    value: string | number;
    label: string;
    title?: string;
    isDisabled?: boolean;
}

// 帮助提示组件
const HelpTooltip: React.FC<{ text?: string | null }> = ({ text }) => {
    if (!text) return null;
    return (
        <AntTooltip title={text}>
            <AntInfo className={componentStyles.tooltipIconAntd} style={{ marginLeft: '4px', cursor: 'help', opacity: 0.7 }} />
        </AntTooltip>
    );
};

// 文件选择模态框 (与您代码一致，但使用 AntD Modal 和 List)
interface FileSelectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onFileSelect: (fileReference: string) => void;
    novelId: number | null | undefined;
}
const FileSelectionModal: React.FC<FileSelectionModalProps> = ({ isOpen, onClose, onFileSelect, novelId }) => {
    const [availableFiles, setAvailableFiles] = useState<ReferableFileItem[]>([]);
    const [isLoadingFiles, setIsLoadingFiles] = useState(false);
    const [fileLoadError, setFileLoadError] = useState<string | null>(null);
    // const [externalUrl, setExternalUrl] = useState<string>(''); // 如果支持外部URL输入

    useEffect(() => {
        if (isOpen) {
            setIsLoadingFiles(true); setFileLoadError(null);
            getUserReferableFiles(novelId)
                .then(response => setAvailableFiles(response.items || [])) // PaginatedReferableFilesResponse
                .catch(err => {
                    const msg = `加载可引用文件列表失败: ${(err as Error).message || '未知错误'}`;
                    toast.error(msg, { toastId: `file-modal-load-err-${novelId || 'global'}` });
                    setFileLoadError(msg); setAvailableFiles([]);
                })
                .finally(() => setIsLoadingFiles(false));
        }
    }, [isOpen, novelId]);

    const handleSelectAndClose = (fileItem: ReferableFileItem) => {
        const ref = fileItem.id; // 使用文件ID作为引用
        if (ref && ref.trim()) { onFileSelect(ref.trim()); onClose(); }
        else { toast.warn("选中的文件缺少有效的ID。"); }
    };

    return (
        <AntModal
            title={<AntSpace><AntFolderOpen /> 选择文件引用</AntSpace>}
            open={isOpen}
            onCancel={onClose}
            footer={[<AntButton key="close" onClick={onClose}>关闭</AntButton>]}
            width={600}
        >
            {isLoadingFiles && <div style={{textAlign: 'center', padding: '20px'}}><AntSpin tip="加载文件列表..." /></div>}
            {fileLoadError && <AntAlert message="错误" description={fileLoadError} type="error" showIcon />}
            {!isLoadingFiles && !fileLoadError && availableFiles.length === 0 && <p>当前上下文中没有预注册的可引用文件。</p>}
            {!isLoadingFiles && !fileLoadError && availableFiles.length > 0 && (
                <AntList
                    dataSource={availableFiles}
                    renderItem={file => (
                        <AntList.Item
                            onClick={() => handleSelectAndClose(file)}
                            className={componentStyles.fileListItemSelectableAntd} // 自定义AntD列表项样式
                        >
                            <AntList.Item.Meta
                                avatar={<FileTextIcon size={16} />}
                                title={file.name}
                                description={`${file.file_type} - ${file.description || '无描述'}`}
                            />
                        </AntList.Item>
                    )}
                />
            )}
        </AntModal>
    );
};


// --- Props 定义 (与 RuleChainEditor 集成) ---
interface TaskSpecificParamsInputProps {
    // 参数定义，来自 RuleStepParameterDefinition (后端 schemas.py)
    // 这是一个 Record，键是参数名，值是该参数的定义对象 (不含当前实际值)
    parametersDef: Record<string, Omit<RuleStepParameterDefinition, 'value'>>;

    // 参数的当前【值】，键是参数名，值是参数的实际值。
    currentValues: Record<string, StepParameterValueType | undefined>;

    // 当任何参数的【值】发生变化时，此回调被调用。
    // 它应传递一个包含所有参数最新【值】的对象。
    onValuesChange: (newValues: Record<string, StepParameterValueType | undefined>) => void;

    disabled?: boolean;
    novelId?: number | null; // 用于动态加载小说相关元素
    appConfig?: ApplicationConfig | null; // 用于访问全局配置，例如模型列表
    availableLLMModels?: UserDefinedLLMConfig[]; // 已过滤的、可用的LLM模型列表
}

// --- 单个参数渲染器 ---
interface ParameterInputRendererProps {
    paramKey: string;
    // 参数定义 (不含 value，因为 value 由 currentValues 提供)
    paramDefinition: Omit<RuleStepParameterDefinition, 'value'>;
    currentValue: StepParameterValueType | undefined;
    onChange: (newValue: StepParameterValueType | undefined) => void;

    // 上下文 props (与 TaskSpecificParamsInputProps 一致)
    disabled?: boolean;
    novelId?: number | null;
    appConfig?: ApplicationConfig | null;
    availableLLMModels?: UserDefinedLLMConfig[];
    // 小说元素数据 (由 TaskSpecificParamsInput 获取并传递)
    novelCharacters: ApiCharacter[]; novelEvents: ApiEvent[]; novelChapters: ApiChapter[]; novelWorldviewKeys: string[];
    isLoadingNovelElements: Record<string, boolean>;
    openFileModal: (paramKey: string) => void;
}

const ParameterInputRenderer: React.FC<ParameterInputRendererProps> = ({
    paramKey, paramDefinition, currentValue, onChange, disabled, novelId,
    appConfig, availableLLMModels,
    novelCharacters, novelEvents, novelChapters, novelWorldviewKeys,
    isLoadingNovelElements, openFileModal
}) => {
    const inputId = `param-input-${paramKey.replace(/[\.\[\]]/g, '-')}`; // 移除路径，因为 basePath 不再使用
    const placeholderText = paramDefinition.config?.placeholder || `请输入${paramDefinition.label || paramKey}`;
    const fieldRequired = paramDefinition.required ?? false;

    // 渲染对象类型的参数 (递归)
    if (paramDefinition.param_type === ApiParameterTypeEnum.PARAMETER_TYPE_OBJECT) {
        if (!paramDefinition.schema) {
            return <AntAlert message={`对象参数 "${paramKey}" 缺少 schema 定义！`} type="error" showIcon />;
        }
        const currentObjectValues = typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue)
            ? currentValue as Record<string, StepParameterValueType>
            : {};

        return (
            <fieldset className={componentStyles.nestedFieldsetAntd}>
                <legend>
                    <Braces size={14}/> {paramDefinition.label || paramKey}
                    {paramDefinition.description && <HelpTooltip text={paramDefinition.description} />}
                </legend>
                <div className={componentStyles.nestedContentAntd}>
                    {Object.entries(paramDefinition.schema).map(([nestedKey, nestedDef]) => (
                        <AntForm.Item // 使用 AntD Form.Item 进行布局
                            key={nestedKey}
                            label={<>{nestedDef.label || nestedKey} {nestedDef.description && <HelpTooltip text={nestedDef.description} />}</>}
                            required={nestedDef.required}
                            className={componentStyles.formItemAntd}
                        >
                            <ParameterInputRenderer
                                paramKey={nestedKey}
                                paramDefinition={nestedDef as Omit<RuleStepParameterDefinition, 'value'>} // 类型断言
                                currentValue={currentObjectValues[nestedKey]}
                                onChange={(val) => {
                                    const newObject = { ...currentObjectValues, [nestedKey]: val };
                                    onChange(newObject);
                                }}
                                // 传递所有需要的上下文 props
                                disabled={disabled} novelId={novelId} appConfig={appConfig} availableLLMModels={availableLLMModels}
                                novelCharacters={novelCharacters} novelEvents={novelEvents} novelChapters={novelChapters}
                                novelWorldviewKeys={novelWorldviewKeys} isLoadingNovelElements={isLoadingNovelElements}
                                openFileModal={openFileModal}
                            />
                        </AntForm.Item>
                    ))}
                </div>
            </fieldset>
        );
    }

    // 渲染其他类型的参数输入控件 (使用 AntD 组件)
    switch (paramDefinition.param_type) {
        case ApiParameterTypeEnum.STATIC_BOOLEAN:
            return <AntSwitch checked={typeof currentValue === 'boolean' ? currentValue : false} onChange={onChange} disabled={disabled} />;
        case ApiParameterTypeEnum.STATIC_NUMBER:
            return <AntInputNumber id={inputId} value={typeof currentValue === 'number' ? currentValue : undefined} onChange={(value) => onChange(value === null ? undefined : value)} style={{ width: '100%' }} placeholder={placeholderText} min={paramDefinition.config?.min as number | undefined} max={paramDefinition.config?.max as number | undefined} step={paramDefinition.config?.step || 1} disabled={disabled} />;
        case ApiParameterTypeEnum.USER_INPUT_CHOICE:
            const options = paramDefinition.options?.map(opt => ({ value: String(opt.value), label: opt.label })) || [];
            const isMultiSelect = paramDefinition.config?.isMulti === true;
            let currentSelectValueAnt: any = undefined; // AntD Select 的 value
            if (isMultiSelect) { currentSelectValueAnt = Array.isArray(currentValue) ? (currentValue as any[]).map(String) : []; }
            else { currentSelectValueAnt = currentValue !== null && currentValue !== undefined ? String(currentValue) : undefined; }
            return (
                <AntSelect
                    value={currentSelectValueAnt}
                    onChange={(val) => onChange(isMultiSelect ? (val as string[]) : val as string | undefined)}
                    options={options}
                    mode={isMultiSelect ? 'multiple' : undefined}
                    allowClear
                    disabled={disabled || options.length === 0}
                    placeholder={placeholderText || "请选择..."}
                    style={{ width: '100%' }}
                    optionLabelProp="label"
                    filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                />
            );
        case ApiParameterTypeEnum.STATIC_TEXTAREA:
            return <AntInput.TextArea id={inputId} value={typeof currentValue === 'string' ? currentValue : ''} onChange={(e) => onChange(e.target.value)} rows={paramDefinition.config?.rows || 3} placeholder={placeholderText} disabled={disabled} />;
        case ApiParameterTypeEnum.FILE_REFERENCE_TEXT:
             return (
                <AntSpace.Compact style={{ width: '100%' }}>
                    <AntInput id={inputId} value={typeof currentValue === 'string' ? currentValue : ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholderText || "文件ID或引用路径"} disabled={disabled} />
                    {novelId && ( <AntButton icon={<AntFolderOpen />} onClick={() => openFileModal(paramKey)} disabled={disabled}>浏览</AntButton> )}
                </AntSpace.Compact>
            );
        case ApiParameterTypeEnum.MODEL_SELECTOR:
            const modelOptions = availableLLMModels?.filter(m => m.enabled && appConfig?.llm_providers[m.provider_tag]?.enabled)
                .map(m => ({ value: m.user_given_id, label: `${m.user_given_name} (${m.provider_tag})`, title: m.model_identifier_for_api })) || [];
            return (
                <AntSelect
                    value={typeof currentValue === 'string' ? currentValue : undefined}
                    onChange={(val) => onChange(val as string | undefined)}
                    options={modelOptions}
                    allowClear
                    disabled={disabled || modelOptions.length === 0}
                    placeholder="选择一个LLM模型..."
                    style={{ width: '100%' }}
                    showSearch
                    optionFilterProp="label"
                />
            );
        case ApiParameterTypeEnum.NOVEL_ELEMENT_CHARACTER_ID:
            const charOptions = novelCharacters.map(c => ({ value: String(c.id), label: c.name, title: c.name }));
            return ( <AntSelect value={currentValue !== null && currentValue !== undefined ? String(currentValue) : undefined} onChange={(val) => onChange(val ? Number(val) : undefined)} options={charOptions} allowClear showSearch disabled={disabled || !novelId || charOptions.length === 0} placeholder={novelId ? "选择角色..." : "请先关联小说"} style={{ width: '100%' }} loading={isLoadingNovelElements['characters']} optionFilterProp="label" /> );
        case ApiParameterTypeEnum.NOVEL_ELEMENT_EVENT_ID:
            const eventOptions = novelEvents.map(e => ({value: String(e.id), label: e.summary.substring(0,50) + (e.summary.length > 50 ? '...' : ''), title: e.summary}));
            return ( <AntSelect value={currentValue !== null && currentValue !== undefined ? String(currentValue) : undefined} onChange={(val) => onChange(val ? Number(val) : undefined)} options={eventOptions} allowClear showSearch disabled={disabled || !novelId || eventOptions.length === 0} placeholder={novelId ? "选择事件..." : "请先关联小说"} style={{ width: '100%' }} loading={isLoadingNovelElements['events']} optionFilterProp="label" /> );
        case ApiParameterTypeEnum.NOVEL_ELEMENT_CHAPTER_ID:
            const chapterOptions = novelChapters.sort((a,b)=>a.chapter_index - b.chapter_index).map(ch => ({value: String(ch.id), label: `第 ${ch.chapter_index + 1} 章: ${ch.title || '无标题'}`, title: ch.title || `第 ${ch.chapter_index + 1} 章`}));
            return ( <AntSelect value={currentValue !== null && currentValue !== undefined ? String(currentValue) : undefined} onChange={(val) => onChange(val ? Number(val) : undefined)} options={chapterOptions} allowClear showSearch disabled={disabled || !novelId || chapterOptions.length === 0} placeholder={novelId ? "选择章节ID..." : "请先关联小说"} style={{ width: '100%' }} loading={isLoadingNovelElements['chapters']} optionFilterProp="label" /> );
        case ApiParameterTypeEnum.NOVEL_WORLDVIEW_KEY:
            const worldviewKeyOptions = novelWorldviewKeys.map(k => ({value: k, label: k, title: k}));
            return ( <AntSelect value={typeof currentValue === 'string' ? currentValue : undefined} onChange={(val) => onChange(val as string | undefined)} options={worldviewKeyOptions} allowClear showSearch disabled={disabled || !novelId || worldviewKeyOptions.length === 0} placeholder={novelId ? "选择世界观设定键..." : "请先关联小说"} style={{ width: '100%' }} loading={isLoadingNovelElements['worldview_keys']} optionFilterProp="label" /> );
        
        case ApiParameterTypeEnum.NOVEL_SUMMARY: // 只读显示
             return <div className={componentStyles.readOnlyPlaceholderContainerAntd}><AlignLeft size={16}/> 将自动使用当前小说摘要</div>;
        case ApiParameterTypeEnum.NOVEL_ELEMENT_CHAPTER_CONTENT: // 只读显示
             return <div className={componentStyles.readOnlyPlaceholderContainerAntd}><AlignLeft size={16}/> 将自动使用指定章节内容 (通常通过 '章节ID' 参数选择)</div>;
        case ApiParameterTypeEnum.PREVIOUS_STEP_OUTPUT_FIELD: // 文本输入
            return <AntInput id={inputId} value={typeof currentValue === 'string' ? currentValue : ''} onChange={(e) => onChange(e.target.value)} placeholder="例如: $.summary 或 $.results[0].text" disabled={disabled} />;

        case ApiParameterTypeEnum.STATIC_STRING:
        default:
            return <AntInput id={inputId} value={typeof currentValue === 'string' ? currentValue : ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholderText} disabled={disabled} />;
    }
};


// --- 主组件 TaskSpecificParamsInput ---
const TaskSpecificParamsInput: React.FC<TaskSpecificParamsInputProps> = ({
    parametersDef,
    currentValues,
    onValuesChange,
    disabled = false,
    novelId,
    appConfig,
    availableLLMModels,
}) => {
    // 动态元素加载状态
    const [novelCharacters, setNovelCharacters] = useState<ApiCharacter[]>([]);
    const [novelEvents, setNovelEvents] = useState<ApiEvent[]>([]);
    const [novelChapters, setNovelChapters] = useState<ApiChapter[]>([]);
    const [novelWorldviewKeys, setNovelWorldviewKeys] = useState<string[]>([]);
    const [isLoadingNovelElements, setIsLoadingNovelElements] = useState<Record<string, boolean>>({});
    const [fileModalParamKey, setFileModalParamKey] = useState<string | null>(null); // 用于文件选择模态框

    // 数据获取函数
    const fetchElementData = useCallback(async (elementType: 'characters' | 'events' | 'chapters' | 'worldview_keys') => {
        if (!novelId) return;
        setIsLoadingNovelElements(prev => ({ ...prev, [elementType]: true }));
        try {
            if (elementType === 'characters') { const resp = await getCharactersByNovelId(novelId, { page: 1, page_size: 1000 }); setNovelCharacters(resp.items || []); }
            else if (elementType === 'events') { const resp = await getEventsByNovelId(novelId, { page: 1, page_size: 1000 }); setNovelEvents(resp.items || []); }
            else if (elementType === 'chapters') { const resp = await getChaptersByNovelId(novelId, { page: 1, page_size: 2000 }); setNovelChapters(resp.items || []); }
            else if (elementType === 'worldview_keys') { const resp = await getNovelWorldviewKeysByNovelId(novelId); setNovelWorldviewKeys(resp || []); }
        } catch (error) {
            toast.error(`加载小说 ${elementType} 失败: ${(error as Error).message}`, {toastId: `load-err-${elementType}-${novelId}`});
        } finally {
            setIsLoadingNovelElements(prev => ({ ...prev, [elementType]: false }));
        }
    }, [novelId]);

    useEffect(() => {
        if (novelId) {
            // 判断 parametersDef 中是否包含需要加载小说数据的参数类型
            const needsChars = Object.values(parametersDef).some(def => def.param_type === ApiParameterTypeEnum.NOVEL_ELEMENT_CHARACTER_ID);
            const needsEvents = Object.values(parametersDef).some(def => def.param_type === ApiParameterTypeEnum.NOVEL_ELEMENT_EVENT_ID);
            const needsChapters = Object.values(parametersDef).some(def => def.param_type === ApiParameterTypeEnum.NOVEL_ELEMENT_CHAPTER_ID || def.param_type === ApiParameterTypeEnum.NOVEL_ELEMENT_CHAPTER_CONTENT);
            const needsWorldviewKeys = Object.values(parametersDef).some(def => def.param_type === ApiParameterTypeEnum.NOVEL_WORLDVIEW_KEY);

            if (needsChars) fetchElementData('characters');
            if (needsEvents) fetchElementData('events');
            if (needsChapters) fetchElementData('chapters');
            if (needsWorldviewKeys) fetchElementData('worldview_keys');
        } else {
            setNovelCharacters([]); setNovelEvents([]); setNovelChapters([]); setNovelWorldviewKeys([]);
        }
    }, [novelId, parametersDef, fetchElementData]); // 当 novelId 或参数定义变化时重新加载

    // 处理单个参数值的变化，并调用 onValuesChange 回调
    const handleSingleParamValueChange = (paramName: string, newValue: StepParameterValueType | undefined) => {
        onValuesChange({
            ...currentValues,
            [paramName]: newValue,
        });
    };
    
    const handleOpenSpecificFileModal = (paramKey: string) => {
        setFileModalParamKey(paramKey);
    };
    const handleFileSelectedFromFileModal = (fileRef: string) => {
        if (fileModalParamKey) {
            handleSingleParamValueChange(fileModalParamKey, fileRef);
        }
        setFileModalParamKey(null);
    };

    if (Object.keys(parametersDef).length === 0) {
        return <div className={componentStyles.noParamsMessageAntd}><AntInfo style={{marginRight: '8px'}}/>当前任务类型没有需要配置的特定参数。</div>;
    }

    return (
        <div className={componentStyles.paramsFormContainerAntd}>
            {Object.entries(parametersDef).map(([paramName, definition]) => (
                <AntForm.Item
                    key={paramName}
                    label={
                        <AntSpace>
                            {definition.label || paramName}
                            {definition.required && <span className={pageViewStyles.requiredMarker}>*</span>}
                            {definition.description && (
                                <HelpTooltip text={definition.description} />
                            )}
                        </AntSpace>
                    }
                    className={componentStyles.formItemAntd}
                    // 校验状态和帮助文本可以由 AntD Form 实例通过 Controller 管理，或在此处手动设置
                    // validateStatus={currentValues[paramName]?.hasError ? 'error' : ''}
                    // help={currentValues[paramName]?.errorMessage || definition.description}
                >
                    <ParameterInputRenderer
                        paramKey={paramName}
                        paramDefinition={definition}
                        currentValue={currentValues[paramName]}
                        onChange={(value) => handleSingleParamValueChange(paramName, value)}
                        disabled={disabled}
                        novelId={novelId}
                        appConfig={appConfig}
                        availableLLMModels={availableLLMModels}
                        novelCharacters={novelCharacters}
                        novelEvents={novelEvents}
                        novelChapters={novelChapters}
                        novelWorldviewKeys={novelWorldviewKeys}
                        isLoadingNovelElements={isLoadingNovelElements}
                        openFileModal={handleOpenSpecificFileModal}
                    />
                </AntForm.Item>
            ))}
            <FileSelectionModal
                isOpen={!!fileModalParamKey}
                onClose={() => setFileModalParamKey(null)}
                onFileSelect={handleFileSelectedFromFileModal}
                novelId={novelId}
            />
        </div>
    );
};

export default TaskSpecificParamsInput;