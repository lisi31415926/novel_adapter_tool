// frontend-react/src/components/ChapterProcessor.tsx
import React, { useState, useEffect, useCallback, ChangeEvent, FormEvent, useMemo } from 'react';
import { useParams, Link as RouterLink, useNavigate } // 确保 useNavigate 导入
    from 'react-router-dom';
import { toast } from 'react-toastify';

import {
    getNovelDetail, Novel, Chapter, // 使用你的 Novel, Chapter 类型
    PredefinedTaskEnum, PostProcessingRuleEnum, RuleChain,
    RuleChainExecuteRequest, TextProcessRequest, TextProcessResponse, RuleChainExecuteResponse,
    getPredefinedTasks, getPostProcessingRules,
    processText, // 旧的 processText，如果还需要独立调用
    // executeRuleChain, // 旧的 executeRuleChain，将被 context 中的替换
    getRuleChains, // 用于规则链选择器获取列表
    NovelAnalysisStatusEnum, generateRAG, RAGGenerateRequest, RAGGenerateResponse,
    getAvailableLLMModels, UserDefinedLLMConfig as AvailableLLMModelResponseItem, // 类型名统一
    getAnalysisStatusInfo,
    ApplicationConfig, RuleChainDryRunResponse, // RuleChainStepCostEstimate 在旧版本中未使用，移除
    getApplicationConfig, GenerationConstraints, TokenCostLevelEnum,
    // 新增：从 api.ts 导入的，用于获取小说和章节数据的函数
    getNovelById, getChaptersByNovelId, updateChapter as apiUpdateChapter,
} from '../services/api'; // 确保路径正确

import TaskSpecificParamsInput from './TaskSpecificParamsInput';
import LLMResultDisplay from './LLMResultDisplay'; // 我们更新过的，消费 context 的版本
import ChainExecutionResultDisplay from './ChainExecutionResultDisplay'; // 用于旧的规则链执行结果展示
import DryRunConfirmModalFromComponent from '../components/DryRunConfirmModal'; // 从组件导入 DryRunConfirmModal
import RuleChainList from './RuleChainList'; // 规则链列表组件

import styles from './ChapterProcessor.module.css';
import pageViewStyles from '../pages/PageStyles.module.css'; // 确保引入通用页面样式
import {
    Play, Zap, SlidersHorizontal, BrainCircuit, Loader, Copy, ChevronDown, Info,
    AlertTriangle, Send, RefreshCw, BookOpen, DollarSign, EyeSlash, HelpCircle,
    ListChecks, AlertOctagon, X, Edit, ArrowLeft, Settings as SettingsIcon, PlayCircle, // 新增ArrowLeft等
} from 'lucide-react';

// 从你的文件中保留的 Context 导入
import { useWorkbench } from '../contexts/WorkbenchContext';

// ChapterProcessorParams 接口定义 (来自你的文件)
interface ChapterProcessorParams extends Record<string, string | undefined> {
    novelId: string;
    chapterIndex: string; // 注意：你的路由是用 chapterIndex，但获取章节通常用 chapterId
}

// CostLevelDisplay 类型定义 (来自你的文件)
type CostLevelDisplay = TokenCostLevelEnum | 'calculating_preview';


// HelpTooltipStandalone 组件定义 (来自你的文件)
const HelpTooltipStandalone: React.FC<{text: string}> = ({ text }) => (
    <span className={styles.helpIconWrapperInternal} title={text}>
        <HelpCircle size={12} className={styles.helpIconInternal} />
    </span>
);

// CostPreviewDisplay 组件定义 (来自你的文件，但其内部的 calculate 和 getCostLevelFromTokens 需要适配新的 appConfig 来源)
const CostPreviewDisplay: React.FC<{ level: CostLevelDisplay; message: string; isLoading?: boolean; }> = ({ level, message, isLoading }) => {
    const getCostLevelVisuals = () => {
        if (isLoading || level === 'calculating_preview') return { icon: <Loader size={14} className={styles.spinningIconSmall}/>, className: `${styles.costPreviewBadge} ${styles.costCalculating}`, label: '预估中...' };
        switch (level) {
            case TokenCostLevelEnum.LOW: return { icon: <DollarSign size={14}/>, className: `${styles.costPreviewBadge} ${styles.costLow}`, label: '低消耗' };
            case TokenCostLevelEnum.MEDIUM: return { icon: <><DollarSign size={14}/><DollarSign size={14}/></>, className: `${styles.costPreviewBadge} ${styles.costMedium}`, label: '中等消耗' };
            case TokenCostLevelEnum.HIGH: return { icon: <><DollarSign size={14}/><DollarSign size={14}/><DollarSign size={14}/></>, className: `${styles.costPreviewBadge} ${styles.costHigh}`, label: '高消耗' };
            default: return { icon: <EyeSlash size={14}/>, className: `${styles.costPreviewBadge} ${styles.costUnknown}`, label: '消耗级别未知' };
        }
    };
    const visuals = getCostLevelVisuals();
    return ( <div className={`${styles.costPreviewContainer} ${visuals.className}`} title={message}> {visuals.icon} <span>{visuals.label}</span> </div> );
};

// DryRunConfirmModal 组件定义 (来自你的文件)
// 注意：这个组件现在通过 '../components/DryRunConfirmModal' 导入，所以这里的定义可以移除或仅作参考
// 但我还是保留你上传的版本，以防你的导入路径有误或希望使用这里的版本
interface DryRunConfirmModalPropsFromUploaded {
    dryRunData: RuleChainDryRunResponse;
    chainName: string;
    onConfirm: () => void;
    onCancel: () => void;
    predefinedTaskLabels: Record<string, string>;
    appConfig: ApplicationConfig | null;
}
const DryRunConfirmModalInternal: React.FC<DryRunConfirmModalPropsFromUploaded> = ({ dryRunData, chainName, onConfirm, onCancel, predefinedTaskLabels, appConfig }) => {
    const getModelDisplayName = (modelId: string): string => {
        if (appConfig?.llm_settings.model_aliases) { const aliasEntry = Object.entries(appConfig.llm_settings.model_aliases).find(([_, id]) => id === modelId); if (aliasEntry) return `${aliasEntry[0]} (${modelId.split('/').pop()})`; } const availableModel = appConfig?.llm_settings.available_models.find(m => m.user_given_id === modelId); return availableModel?.user_given_name || modelId;
    };
    const getCostLevelFromEnum = (levelEnum: TokenCostLevelEnum): { label: string; className: string; icon: React.ReactNode } => { /* ... (保持你原来的实现) ... */
        switch (levelEnum) {
            case TokenCostLevelEnum.LOW: return { label: "低消耗", className: `${styles.costBadge} ${styles.costLowModal}`, icon: <DollarSign size={16}/> };
            case TokenCostLevelEnum.MEDIUM: return { label: "中等消耗", className: `${styles.costBadge} ${styles.costMediumModal}`, icon: <><DollarSign size={16}/><DollarSign size={16}/></> };
            case TokenCostLevelEnum.HIGH: return { label: "高消耗", className: `${styles.costBadge} ${styles.costHighModal}`, icon: <><DollarSign size={16}/><DollarSign size={16}/><DollarSign size={16}/></> };
            default: return { label: "消耗未知", className: `${styles.costBadge} ${styles.costUnknownModal}`, icon: <HelpCircle size={16}/> };
        }
    };
    const overallCostVisuals = getCostLevelFromEnum(dryRunData.token_cost_level as TokenCostLevelEnum); // 类型断言
    return (
        <div className={styles.modalOverlay}>
            <div className={`${styles.modalContent} ${styles.dryRunModalContent}`}>
                <div className={styles.modalHeader}><h3>执行规则链 “{chainName}” 前的成本预估</h3><button onClick={onCancel} className={styles.modalCloseButton} title="取消执行并关闭" aria-label="关闭成本预估模态框"><X size={22}/></button></div>
                <div className={styles.modalBody}>
                    <div className={styles.modalSummarySection}><p className={styles.modalOverallCost}><strong>总体预估消耗级别:</strong><span className={`${overallCostVisuals.className}`} title={`基于预估的总输入Token: ${dryRunData.estimated_total_prompt_tokens} 和总输出Token上限: ${dryRunData.estimated_total_completion_tokens}。实际消耗可能因模型具体行为和内容而异。`}>{overallCostVisuals.icon} {overallCostVisuals.label}</span></p><div className={styles.modalTokenTotals}><span>总预估Prompt Tokens: <strong>{dryRunData.estimated_total_prompt_tokens}</strong></span><span>总预估Completion Tokens (上限): <strong>{dryRunData.estimated_total_completion_tokens}</strong></span></div></div>
                    {dryRunData.warnings && dryRunData.warnings.length > 0 && (<div className={`${styles.modalWarningsContainer} warning-message`}><AlertTriangle size={18} style={{ marginRight: 'var(--spacing-sm)', flexShrink: 0, color: 'var(--color-warning-text)' }}/><div><strong style={{ color: 'var(--color-warning-dark)'}}>预估警告:</strong><ul className={styles.warningsList}>{dryRunData.warnings.map((warning, idx) => <li key={`warn-${idx}`}>{warning}</li>)}</ul></div></div>)}
                    {dryRunData.steps_estimates && dryRunData.steps_estimates.length > 0 && (<div className={styles.modalStepsTableContainer}><h4>各LLM步骤预估详情:</h4><div className={styles.tableScrollWrapper}><table className={styles.modalStepsTable}><thead><tr><th>步骤</th><th>任务类型</th><th>使用模型 <HelpTooltipStandalone text="系统根据任务偏好和模型可用性，为此步骤选择的将实际执行的LLM模型。" /></th><th>Prompt Tokens (估) <HelpTooltipStandalone text="此步骤处理输入数据并构建的Prompt，预估消耗的Token数量。标记为“动态*”表示输入主要依赖上一步骤的输出或动态生成，预估值可能为0或基于粗略假设，实际消耗可能不同。" /></th><th>Completion Tokens (上限) <HelpTooltipStandalone text="在此步骤的LLM调用中，允许模型生成的最大Token数量。实际生成的内容长度可能小于此值。此值直接影响潜在成本。" /></th></tr></thead><tbody>{dryRunData.steps_estimates.map(step => (<tr key={`step-est-${step.step_order}`}><td>{step.step_order + 1}</td><td title={step.task_type}>{predefinedTaskLabels[step.task_type] || step.task_type}</td><td title={step.model_to_be_used}>{getModelDisplayName(step.model_to_be_used)}</td><td className={styles.numericalCell}>{(step.estimated_prompt_tokens === 0 && !step.task_type.toLowerCase().includes("rag")) ? <span className={styles.dynamicEstimateMarker} title="此步骤输入依赖上一步骤的输出或动态生成，此处预估为0或基于粗略假设。实际消耗可能不同。">动态*</span> : step.estimated_prompt_tokens}</td><td className={styles.numericalCell}>{step.max_completion_tokens || <span title="未在此步骤参数中指定最大完成Token，将使用LLM或应用默认值。">-</span>}</td></tr>))}</tbody></table></div></div>)}
                </div>
                <div className={styles.modalFooter}><button onClick={onCancel} className="btn btn-secondary">取消</button><button onClick={onConfirm} className="btn btn-primary" title={dryRunData.token_cost_level === TokenCostLevelEnum.HIGH || (dryRunData.warnings && dryRunData.warnings.length > 0) ? "请注意预估的高消耗或警告信息后确认执行" : "确认并开始执行规则链"}>确认并执行{(dryRunData.token_cost_level === TokenCostLevelEnum.HIGH || (dryRunData.warnings && dryRunData.warnings.length > 0)) && <AlertOctagon size={16} style={{marginLeft: 'var(--spacing-xs)'}}/>}</button></div>
            </div>
        </div>
    );
};


const ChapterProcessor: React.FC = () => {
    const { novelId: novelIdParamFromRoute, chapterIndex: chapterIndexParamFromRoute } = useParams<ChapterProcessorParams>(); // 从路由获取参数
    const navigate = useNavigate();

    // 从 WorkbenchContext 获取
    const {
        setSourceText: setSourceTextInContext,      // 设置源文本到工作台上下文
        executeChain: executeChainFromContext,      // 执行规则链的方法 (已支持流式)
        isLoading: isWorkbenchProcessing,           // 工作台上下文的通用加载状态 (例如规则链执行时)
        isStreaming: isWorkbenchStreaming,          // 工作台上下文：是否正在流式传输AI结果
        currentRuleChain: currentRuleChainInContext, // 工作台上下文：当前加载的规则链
        setCurrentRuleChain: setCurrentRuleChainInContext, // 工作台上下文：设置当前规则链
        loadRuleChainForEditing: loadRuleChainToContext, // 工作台上下文：通过ID加载规则链到上下文
        clearResults: clearWorkbenchResults,      // 工作台上下文：清除LLM结果和状态
        selectedNovel: novelFromContext,            // 工作台上下文：当前选中的小说对象
        selectNovel: selectNovelInContext,          // 工作台上下文：设置当前选中的小说
        addMaterialSnippet,                         // 工作台上下文：添加素材
        setReferenceContent,                        // 工作台上下文：设置参考内容
    } = useWorkbench();

    // 将路由参数转换为数字ID或null
    const novelId = useMemo(() => novelIdParamFromRoute ? parseInt(novelIdParamFromRoute, 10) : null, [novelIdParamFromRoute]);
    // 你的路由参数是 chapterIndex，但API通常用 chapterId。这里假设 chapterIndexParam 是实际的数据库 chapter.id
    const chapterIdToLoad = useMemo(() => chapterIndexParamFromRoute ? parseInt(chapterIndexParamFromRoute, 10) : null, [chapterIndexParamFromRoute]);

    // --- 组件内部状态 (大部分沿用你上传的版本) ---
    const [novelForPage, setNovelForPage] = useState<Novel | null>(null); // 用于显示小说标题等信息
    const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null); // 当前处理的章节对象
    const [editableContent, setEditableContent] = useState<string>(''); // 章节内容编辑区
    const [chaptersForSelection, setChaptersForSelection] = useState<Chapter[]>([]); // 小说下的章节列表（用于选择）

    const [isLoadingPageData, setIsLoadingPageData] = useState<boolean>(true); // 页面整体初始数据加载状态
    const [errorPageData, setErrorPageData] = useState<string | null>(null);  // 页面数据加载错误
    const [isSavingChapter, setIsSavingChapter] = useState<boolean>(false);     // 保存章节内容的加载状态

    // 原有的单任务处理相关状态
    const [appConfig, setAppConfig] = useState<ApplicationConfig | null>(null); // 应用配置，包含模型列表等
    const [availableLLMModelsForPage, setAvailableLLMModelsForPage] = useState<AvailableLLMModelResponseItem[]>([]); // 可用LLM模型列表
    const [loadingModelsError, setLoadingModelsError] = useState<string | null>(null); // 加载模型列表错误

    const [selectedTaskForSingle, setSelectedTaskForSingle] = useState<PredefinedTaskEnum>(PredefinedTaskEnum.SUMMARIZE); // 单任务：选的任务
    const [taskParamsForSingle, setTaskParamsForSingle] = useState<Record<string, any>>({}); // 单任务：特定参数
    const [customInstructionForSingle, setCustomInstructionForSingle] = useState<string>(''); // 单任务：自定义指令
    const [selectedPostProcessingForSingle, setSelectedPostProcessingForSingle] = useState<PostProcessingRuleEnum[]>([]); // 单任务：后处理规则
    const [llmResultForSingle, setLlmResultForSingle] = useState<TextProcessResponse | null>(null); // 单任务：执行结果
    const [isProcessingSingleTask, setIsProcessingSingleTask] = useState<boolean>(false); // 单任务：执行状态
    const [textProcessCostPreview, setTextProcessCostPreview] = useState<{level: CostLevelDisplay, message: string}>({level: 'unknown', message: '待操作或配置模型'});

    // 原有的规则链处理相关状态 (旧的，未使用WorkbenchContext的流程)
    const [availableRuleChainsForOld, setAvailableRuleChainsForOld] = useState<RuleChain[]>([]); // 旧规则链列表
    const [selectedRuleChainIdForOld, setSelectedRuleChainIdForOld] = useState<string>(''); // 旧：选的链ID
    const [ruleChainInputTextForOld, setRuleChainInputTextForOld] = useState<string>(''); // 旧：链输入
    const [chainResultForOld, setChainResultForOld] = useState<RuleChainExecuteResponse | RuleChainDryRunResponse | null>(null); // 旧：链结果
    const [isExecutingChainOld, setIsExecutingChainOld] = useState<boolean>(false); // 旧：链执行状态
    const [chainDryRunResultForOld, setChainDryRunResultForOld] = useState<RuleChainDryRunResponse | null>(null); // 旧：DryRun结果
    const [isFetchingDryRunOld, setIsFetchingDryRunOld] = useState<boolean>(false); // 旧：DryRun获取状态
    const [showDryRunModalOld, setShowDryRunModalOld] = useState<boolean>(false); // 旧：DryRun模态框

    // 原有的RAG处理相关状态
    const [ragInstructionForOld, setRagInstructionForOld] = useState<string>(''); // 旧：RAG指令
    const [ragParamsForOld, setRagParamsForOld] = useState<Record<string, any>>({ top_n_context: 3 }); // 旧：RAG参数
    const [isGeneratingRAGOld, setIsGeneratingRAGOld] = useState<boolean>(false); // 旧：RAG执行状态
    const [ragResultForOld, setRagResultForOld] = useState<RAGGenerateResponse | null>(null); // 旧：RAG结果
    const [ragErrorForOld, setRagErrorForOld] = useState<string | null>(null); // 旧：RAG错误
    const [ragCostPreview, setRagCostPreview] = useState<{level: CostLevelDisplay, message: string}>({level: 'unknown', message: '待操作或配置模型'});

    // 预定义任务和后处理规则的选项 (来自你的文件)
    const predefinedTasksOptions = useMemo(() => getPredefinedTasks(), []);
    const postProcessingRulesOptions = useMemo(() => getPostProcessingRules(), []);
    const predefinedTaskLabels = useMemo(() => {
        return predefinedTasksOptions.reduce((acc, task) => { acc[task.value] = task.label; return acc; }, {} as Record<string, string>);
    }, [predefinedTasksOptions]);

    // --- 新增：用于通过 WorkbenchContext 执行规则链的状态 ---
    const [showRuleChainSelectorModalForContext, setShowRuleChainSelectorModalForContext] = useState<boolean>(false);
    const [selectedRuleChainInfoForContext, setSelectedRuleChainInfoForContext] = useState<{id: number, name: string} | null>(null);
    const [allRuleChainsForContextSelect, setAllRuleChainsForContextSelect] = useState<RuleChain[]>([]); // 存储所有规则链用于选择器

    // Effect Hook: 获取应用配置和页面初始数据 (小说、章节列表)
    useEffect(() => {
        const fetchInitialPageData = async () => {
            setIsLoadingPageData(true); setErrorPageData(null); setLoadingModelsError(null);
            try {
                const config = await getApplicationConfig(); // 获取应用配置
                setAppConfig(config);
                if (config.llm_settings?.available_models) {
                    const enabledModels = config.llm_settings.available_models.filter(m => m.enabled);
                    setAvailableLLMModelsForPage(enabledModels); // 设置页面可用的LLM模型
                    if (enabledModels.length > 0) {
                        const defaultModelFromConfig = config.llm_settings.default_model_id;
                        const modelToSelect = defaultModelFromConfig && enabledModels.find(m => m.user_given_id === defaultModelFromConfig)
                            ? defaultModelFromConfig
                            : enabledModels[0].user_given_id;
                        // setSelectedModelIdForSingle(modelToSelect); // 初始化单任务的模型选择 (旧)
                    } else {
                        toast.warn("配置中没有启用的LLM模型，部分AI处理功能可能受限。");
                    }
                }
                // setPredefinedTasksForSingle(getPredefinedTasks()); // 旧

                // 获取规则链列表 (用于旧的执行流程 和 新的规则链选择器)
                const chains = await getRuleChains(0, 1000, false); // 获取所有非模板规则链
                setAvailableRuleChainsForOld(chains || []); // 旧
                setAllRuleChainsForContextSelect(chains || []); // 新

                if (novelId) { // 如果有小说ID
                    const novelData = await getNovelById(novelId); // 使用新的 getNovelById
                    setNovelForPage(novelData);                   // 设置页面级小说信息
                    selectNovelInContext(novelData);              // 将小说信息设置到工作台上下文
                    setNovelTitle(novelData.title);               // 旧状态，用于兼容你之前的UI

                    const fetchedChapters = await getChaptersByNovelId(novelId); // 使用新的 getChaptersByNovelId
                    setChaptersForSelection(fetchedChapters); // 设置用于选择的章节列表

                    // 根据 chapterIdToLoad 确定初始选中的章节
                    let chapterToSelect: Chapter | null = null;
                    if (chapterIdToLoad) {
                        chapterToSelect = fetchedChapters.find(c => c.id === chapterIdToLoad) || null;
                        if (!chapterToSelect && fetchedChapters.length > 0) {
                            toast.info(`指定的章节ID ${chapterIdToLoad} 未找到，已加载小说第一章内容。`);
                            chapterToSelect = fetchedChapters[0];
                        }
                    } else if (fetchedChapters.length > 0) {
                        chapterToSelect = fetchedChapters[0]; // 默认选择第一章
                    }

                    if (chapterToSelect) {
                        setCurrentChapter(chapterToSelect);
                        setEditableContent(chapterToSelect.content);
                        setSourceTextInContext(chapterToSelect.content); // 将章节内容设置到工作台上下文的源文本
                        setRuleChainInputTextForOld(chapterToSelect.content); // 旧
                        setReferenceContent(chapterToSelect.content, `当前章节: ${chapterToSelect.title || `章节 ${chapterToSelect.chapter_index + 1}`}`); // 设置工作台参考内容
                    } else if (novelData) { // 有小说但没有章节
                        toast.warn(`小说《${novelData.title}》还没有章节内容。`);
                    }
                } else { // 没有小说ID，可能是新流程或错误
                    setErrorPageData("未提供小说ID，无法加载章节数据。");
                }
            } catch (err: any) {
                setErrorPageData(err.message || '加载页面初始数据失败');
                toast.error(err.message || '加载页面初始数据失败');
            } finally {
                setIsLoadingPageData(false);
            }
        };
        fetchInitialPageData();
    }, [novelId, chapterIdToLoad, selectNovelInContext, setSourceTextInContext, setReferenceContent]); // 依赖项

    // 处理章节选择变化
    const handleChapterSelectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const newChapterId = parseInt(event.target.value);
        const chapter = chaptersForSelection.find(c => c.id === newChapterId);
        if (chapter) {
            setCurrentChapter(chapter);
            setEditableContent(chapter.content);
            setSourceTextInContext(chapter.content); // 更新工作台上下文的源文本
            setRuleChainInputTextForOld(chapter.content); // 旧

            // 清理各种结果
            setLlmResultForSingle(null);
            setChainResultForOld(null);
            setRagResultForOld(null);
            // setSimilarityResultsForOld(null); // 如果有的话
            clearWorkbenchResults(); // 清理工作台上下文的结果

            if (novelId) {
                // 更新URL，但不直接导航，让用户体验更平滑
                // navigate(`/novels/${novelId}/processor/${newChapterId}`, { replace: true });
                // 可以在这里调用一个函数来更新URL而不重新加载页面，如果需要的话
            }
        }
    };

    // 保存章节内容修改 (沿用你原有的逻辑)
    const handleSaveChanges = async () => {
        if (!currentChapter || !novelId) return;
        setIsSavingChapter(true);
        try {
            const updatedChapter = await apiUpdateChapter(novelId, currentChapter.id, { content: editableContent });
            setCurrentChapter(updatedChapter); // 更新本地状态
            setEditableContent(updatedChapter.content); // 确保编辑区同步
            toast.success(`章节 "${updatedChapter.title || `ID: ${updatedChapter.id}`}" 内容已保存!`);
        } catch (error) {
            toast.error(`保存章节失败: ${(error as Error).message}`);
        } finally {
            setIsSavingChapter(false);
        }
    };

    // --- 用于通过 WorkbenchContext 执行规则链的函数 ---
    const handleOpenRuleChainSelectorForContext = () => {
        if (isWorkbenchProcessing || isWorkbenchStreaming) {
            toast.warn("工作台当前有AI任务正在处理中，请稍后再试。"); return;
        }
        clearWorkbenchResults(); // 执行新链前清空工作台上下文的旧结果
        setShowRuleChainSelectorModalForContext(true);
    };

    const handleRuleChainSelectedForContext = async (chainId: number, chainName?: string) => {
        setSelectedRuleChainInfoForContext({id: chainId, name: chainName || `规则链 #${chainId}`});
        setShowRuleChainSelectorModalForContext(false);
        toast.info(`已选择规则链: ${chainName || `规则链 #${chainId}`} 用于通过工作台执行。正在加载其定义...`);
        try {
            // 使用 loadRuleChainToContext 将选择的链加载到工作台上下文
            const loadedChain = await loadRuleChainToContext(chainId);
            if (!loadedChain) {
                toast.error(`加载规则链 "${chainName}" 到工作台失败。请稍后重试执行。`);
                setSelectedRuleChainInfoForContext(null); // 加载失败则清空选择
                setCurrentRuleChainInContext(null);    // 清空上下文中的链
            } else {
                toast.success(`规则链 "${loadedChain.name}" 已准备就绪，可以执行。`);
                // currentRuleChainInContext 已经被 loadRuleChainToContext 设置了
            }
        } catch (error) {
            toast.error(`加载规则链时出错: ${(error as Error).message}`);
            setSelectedRuleChainInfoForContext(null);
            setCurrentRuleChainInContext(null);
        }
    };

    const handleExecuteChainViaContext = async () => {
        if (!novelFromContext) { // 检查工作台上下文中的小说
            toast.warn('工作台上下文中未指定小说，请先返回小说列表选择。'); return;
        }
        if (!currentRuleChainInContext) { // 检查工作台上下文中的规则链
            toast.warn('请先通过“选择规则链（工作台）”按钮选择并加载一个规则链到工作台。'); return;
        }
        if (!currentChapter && !editableContent.trim()) { // 检查源文本
            toast.warn('当前没有章节内容或编辑区文本为空，无法执行。'); return;
        }

        // 使用编辑区的内容 (editableContent) 作为源文本，并更新到上下文
        setSourceTextInContext(editableContent);

        // 调用上下文中的 executeChain 方法。它将使用上下文中的 sourceText 和 currentRuleChain
        // {} 表示不传递额外的覆盖参数给 executeChain，它会使用步骤或全局配置
        executeChainFromContext({}, true); // true 表示使用流式处理
    };

    // 回调：将 LLMResultDisplay (来自工作台上下文) 的输出应用到本页面的章节内容编辑器
    const applyWorkbenchOutputToChapterEditor = useCallback((textToApply: string) => {
        setEditableContent(textToApply); // 更新可编辑内容
        toast.success("工作台AI处理结果已应用到章节内容编辑器。");
    }, []);

    // 回调：复制 LLMResultDisplay (来自工作台上下文) 的输出到用户剪贴板
    const copyWorkbenchOutputToClipboard = useCallback((textToCopy: string) => {
        navigator.clipboard.writeText(textToCopy)
            .then(() => toast.success("工作台AI处理结果已复制到剪贴板。"))
            .catch(err => toast.error(`复制到剪贴板失败: ${err}`));
    }, []);


    // --- 沿用你原有的单任务、旧规则链、RAG处理函数，但确保它们使用页面自身的状态 ---
    // 例如 handleProcessText (旧), handleExecuteRuleChainWithDryRun (旧), handleGenerateRAG (旧)
    // 注意：这些旧的函数会使用它们独立的加载状态 (isProcessingSingleTask, isExecutingChainOld, isGeneratingRAGOld)
    // 和结果状态 (llmResultForSingle, chainResultForOld, ragResultForOld)

    // calculateRoughTokenEstimate 和 getCostLevelFromTokens (来自你的文件，但依赖 appConfig)
    const calculateRoughTokenEstimate = useCallback((text1: string, text2?: string): number => {
        if (!appConfig) return Math.ceil(((text1?.length || 0) + (text2?.length || 0)) / 2.5); // 回退
        // 这里可以使用更精确的 tokenizer_service.estimate_token_count，但它需要model_id
        // 简单起见，如果需要精确估算，应将模型选择也集成到这些旧的处理流程中
        const factor = appConfig.llm_settings.tokenizer_options?.default_chars_per_token_general || 2.5;
        return Math.ceil(((text1?.length || 0) + (text2?.length || 0)) / factor);
    }, [appConfig]);

    const getCostLevelFromTokens = useCallback((totalExpectedTokens: number): CostLevelDisplay => {
        if (!appConfig?.cost_estimation_tiers) return 'unknown';
        const tiers = appConfig.cost_estimation_tiers;
        if (totalExpectedTokens <= 0) return 'unknown';
        if (totalExpectedTokens < tiers.low_max_tokens) return TokenCostLevelEnum.LOW;
        if (totalExpectedTokens < tiers.medium_max_tokens) return TokenCostLevelEnum.MEDIUM;
        return TokenCostLevelEnum.HIGH;
    }, [appConfig]);

    // 单任务处理成本预估useEffect (来自你的文件，稍作调整)
    useEffect(() => {
        if (!currentChapter || !appConfig || !appConfig.llm_settings) { setTextProcessCostPreview({level: 'unknown', message: '等待章节和配置加载...'}); return; }
        setTextProcessCostPreview({level: 'calculating_preview', message: '正在计算预估消耗...'});
        const inputText = editableContent; const instrText = customInstructionForSingle; // 使用编辑区内容和单任务自定义指令
        const estimatedPromptTokens = calculateRoughTokenEstimate(inputText, instrText);
        const llmOverridesInParams = taskParamsForSingle.llm_override_parameters; const genConstraintsInParams = taskParamsForSingle.generation_constraints;
        let maxOutputTokens = appConfig.llm_settings.default_max_completion_tokens || 2000;
        if (llmOverridesInParams && (llmOverridesInParams.max_tokens !== undefined || llmOverridesInParams.max_completion_tokens !== undefined || llmOverridesInParams.max_output_tokens !== undefined )) { maxOutputTokens = llmOverridesInParams.max_tokens || llmOverridesInParams.max_completion_tokens || llmOverridesInParams.max_output_tokens; }
        else if (genConstraintsInParams && genConstraintsInParams.max_length !== undefined) { maxOutputTokens = genConstraintsInParams.max_length; }
        const totalExpected = estimatedPromptTokens + maxOutputTokens; const level = getCostLevelFromTokens(totalExpected);
        let modelNameForDisplay = taskParamsForSingle.model_id ? (availableLLMModelsForPage.find(m=>m.user_given_id === taskParamsForSingle.model_id)?.user_given_name || taskParamsForSingle.model_id) : '系统默认';
        setTextProcessCostPreview({ level, message: `模型: ${modelNameForDisplay}。预估输入约 ${estimatedPromptTokens} tokens, 输出上限 ${maxOutputTokens} tokens。` });
    }, [editableContent, customInstructionForSingle, taskParamsForSingle.model_id, taskParamsForSingle.llm_override_parameters, taskParamsForSingle.generation_constraints, appConfig, calculateRoughTokenEstimate, getCostLevelFromTokens, currentChapter, availableLLMModelsForPage]);

    // RAG成本预估useEffect (来自你的文件，稍作调整)
    useEffect(() => {
        if (!appConfig || !appConfig.llm_settings || !ragInstructionForOld) { setRagCostPreview({level: 'unknown', message: '输入RAG指令以评估消耗'}); return; }
        setRagCostPreview({level: 'calculating_preview', message: '正在计算RAG预估消耗...'});
        const estimatedInstrTokens = calculateRoughTokenEstimate(ragInstructionForOld);
        const llmOverridesInRagParams = ragParamsForOld.llm_override_parameters; const genConstraintsInRagParams = ragParamsForOld.generation_constraints;
        let maxOutputTokensRag = appConfig.llm_settings.default_max_completion_tokens || 2000;
        if (llmOverridesInRagParams && (llmOverridesInRagParams.max_tokens !== undefined || llmOverridesInRagParams.max_completion_tokens !== undefined || llmOverridesInRagParams.max_output_tokens !== undefined )) { maxOutputTokensRag = llmOverridesInRagParams.max_tokens || llmOverridesInRagParams.max_completion_tokens || llmOverridesInRagParams.max_output_tokens; }
        else if (genConstraintsInRagParams && genConstraintsInRagParams.max_length !== undefined) { maxOutputTokensRag = genConstraintsInRagParams.max_length;}
        let level: CostLevelDisplay = 'unknown';
        let modelNameForRagDisplay = ragParamsForOld.model_id ? (availableLLMModelsForPage.find(m=>m.user_given_id === ragParamsForOld.model_id)?.user_given_name || ragParamsForOld.model_id) : '系统默认(RAG)';
        // ... (你的成本级别判断逻辑) ...
        setRagCostPreview({ level, message: `模型: ${modelNameForRagDisplay}。RAG指令约 ${estimatedInstrTokens} prompt tokens, 输出上限 ${maxOutputTokensRag} tokens。总消耗还依赖检索到的上下文长度。` });
    }, [ragInstructionForOld, ragParamsForOld.model_id, ragParamsForOld.llm_override_parameters, ragParamsForOld.generation_constraints, appConfig, calculateRoughTokenEstimate, availableLLMModelsForPage]);


    // handleProcessText (旧的单任务处理，保持你的实现，但使用页面状态)
    const handleProcessTextOld = async () => {
        if (!currentChapter || !editableContent.trim()) { toast.warn("当前章节内容为空或编辑区无文本。"); return; }
        if (!appConfig) { toast.error("应用配置加载中..."); return; }
        // const selectedModelIdForTask = taskParamsForSingle.model_id || appConfig.llm_settings.default_model_id; // 确保有模型
        const selectedModelIdForTask = taskParamsForSingle.model_id || availableLLMModelsForPage.find(m=>m.user_given_id === appConfig.llm_settings.default_model_id)?.user_given_id || availableLLMModelsForPage[0]?.user_given_id;

        if (!selectedModelIdForTask) { toast.warn('请在参数配置中选择一个LLM模型或确保应用有默认模型。'); return; }

        const { level, message } = textProcessCostPreview; const taskLabel = predefinedTasksOptions.find(t => t.value === selectedTaskForSingle)?.label || selectedTaskForSingle;
        const confirmMessage = `即将使用任务 "${taskLabel}" 处理当前编辑区内容。\n预估消耗级别: ${String(level).toUpperCase()}.\n详细信息: ${message}\n\n是否确定继续执行？`;
        if (!window.confirm(confirmMessage)) { toast.info("文本处理操作已取消。"); return; }

        setIsProcessingSingleTask(true); setLlmResultForSingle(null);
        toast.info(`正在执行任务: "${taskLabel}"...`, { autoClose: 2000 });
        const { model_id: modelIdFromTaskParams, llm_override_parameters: llmOverridesFromTaskParams, generation_constraints: gcFromTaskParams, ...taskSpecificParamsOnly } = taskParamsForSingle;
        try {
            const requestData: TextProcessRequest = {
                text: editableContent, // 使用编辑区内容
                task: selectedTaskForSingle,
                parameters: Object.keys(taskSpecificParamsOnly).length > 0 ? taskSpecificParamsOnly : undefined,
                custom_instruction: customInstructionForSingle.trim() || undefined,
                post_processing_rules: selectedPostProcessingForSingle.length > 0 ? selectedPostProcessingForSingle : undefined,
                model_id: selectedModelIdForTask, // 确保传递模型ID
                llm_override_parameters: llmOverridesFromTaskParams || undefined,
                generation_constraints: gcFromTaskParams || undefined
            };
            const response = await processText(requestData); // 调用旧的 processText API
            setLlmResultForSingle(response);
            toast.success(`任务 "${taskLabel}" 处理成功！`);
        } catch (err: any) {
            const errorMsg = err.message || (err.response?.data?.detail || "文本处理时发生未知错误。");
            setLlmResultForSingle({ original_text: editableContent, processed_text: `处理失败: ${errorMsg}`, task_used: selectedTaskForSingle, parameters_used: taskSpecificParamsOnly, model_used: modelIdFromTaskParams || appConfig?.llm_settings.default_llm_fallback || "默认模型", instruction_used: customInstructionForSingle, constraints_applied: gcFromTaskParams, constraints_satisfied: null });
            toast.error(`任务 "${taskLabel}" 处理失败: ${errorMsg}`);
        } finally {
            setIsProcessingSingleTask(false);
        }
    };

    // actuallyExecuteRuleChain (旧，保持你的实现，使用页面状态)
    const actuallyExecuteRuleChainOld = async () => {
        if (!novelId || !selectedRuleChainIdForOld || !ruleChainInputTextForOld.trim()) { /* ... */ return; }
        if (!appConfig) { /* ... */ return; }
        setIsExecutingChainOld(true); setChainResultForOld(null);
        const chainName = availableRuleChainsForOld.find(c => c.id.toString() === selectedRuleChainIdForOld)?.name || `规则链ID ${selectedRuleChainIdForOld}`;
        toast.info(`正在执行规则链: "${chainName}"...`, { autoClose: 2000 });
        try {
            const actualRequest: RuleChainExecuteRequest = { source_text: ruleChainInputTextForOld, novel_id: novelId, rule_chain_id: parseInt(selectedRuleChainIdForOld, 10), dry_run: false };
            const response = await executeRuleChain(actualRequest) as RuleChainExecuteResponse; // 调用旧的 executeRuleChain API
            setChainResultForOld(response);
            toast.success(`规则链 "${chainName}" 执行成功！`);
        } catch (err: any) {
            // ... (你的错误处理) ...
            const errorMsg = err.message || (err.response?.data?.detail || "规则链执行时发生未知错误。");
            setChainResultForOld({ original_text: ruleChainInputTextForOld, final_output_text: `规则链执行失败: ${errorMsg}`, executed_chain_name: chainName, executed_chain_id: parseInt(selectedRuleChainIdForOld), steps_results: [{ step_order: 0, task_type: "CHAIN_EXECUTION_FAILURE", input_text_snippet: ruleChainInputTextForOld.substring(0, 100) + (ruleChainInputTextForOld.length > 100 ? "..." : ""), output_text_snippet: `错误: ${errorMsg}`, status: "failure" as any, error: errorMsg }] });
            toast.error(`规则链 "${chainName}" 执行失败: ${errorMsg}`);
        } finally {
            setIsExecutingChainOld(false); setShowDryRunModalOld(false); setChainDryRunResultForOld(null);
        }
    };

    // handleExecuteRuleChainWithDryRun (旧，保持你的实现，使用页面状态)
    const handleExecuteRuleChainWithDryRunOld = async () => {
        if (!novelId || !selectedRuleChainIdForOld || !ruleChainInputTextForOld.trim() || !appConfig) { /* ... */ return; }
        setIsFetchingDryRunOld(true); setChainDryRunResultForOld(null); setShowDryRunModalOld(false);
        const chainName = availableRuleChainsForOld.find(c => c.id.toString() === selectedRuleChainIdForOld)?.name || `规则链ID ${selectedRuleChainIdForOld}`;
        toast.info(`正在预估规则链 "${chainName}" 的执行消耗...`);
        try {
            const dryRunRequest: RuleChainExecuteRequest = { source_text: ruleChainInputTextForOld, novel_id: novelId, rule_chain_id: parseInt(selectedRuleChainIdForOld, 10), dry_run: true };
            const dryRunResponse = await executeRuleChain(dryRunRequest) as RuleChainDryRunResponse; // 调用旧的 executeRuleChain API
            setChainDryRunResultForOld(dryRunResponse);
            setIsFetchingDryRunOld(false);
            if (dryRunResponse) { setShowDryRunModalOld(true); }
            else { toast.error("成本预估未能成功返回有效的预估详情。"); }
        } catch (err: any) {
            setIsFetchingDryRunOld(false);
            const errorMsg = err.message || (err.response?.data?.detail || "规则链成本预估时发生未知错误。");
            toast.error(`成本预估失败: ${errorMsg}`);
        }
    };

    // handleGenerateRAG (旧，保持你的实现，使用页面状态)
    const handleGenerateRAGOld = async (event?: FormEvent) => {
        if (event) event.preventDefault();
        if (!novelId || !ragInstructionForOld.trim() || !novelForPage || !appConfig) { /* ... */ return; }
        if (novelForPage.analysis_status !== NovelAnalysisStatusEnum.VECTORIZED) { /* ... */ return; }
        const { level, message } = ragCostPreview;
        const confirmMessage = `即将执行RAG辅助生成。\n预估消耗级别: ${String(level).toUpperCase()}.\n详细信息: ${message}\n\n是否确定继续执行？`;
        if (!window.confirm(confirmMessage)) { toast.info("RAG生成操作已取消。"); return; }

        setIsGeneratingRAGOld(true); setRagResultForOld(null); setRagErrorForOld(null);
        toast.info("正在进行RAG检索与内容生成...", { autoClose: 2000 });
        const { model_id: ragModelIdFromParams, llm_override_parameters: ragLlmOverridesFromParams, generation_constraints: ragGcFromParams, top_n_context: ragTopNFromParams } = ragParamsForOld;
        try {
            const requestData: RAGGenerateRequest = { instruction: ragInstructionForOld, top_n_context: typeof ragTopNFromParams === 'number' ? ragTopNFromParams : 3, model_id: ragModelIdFromParams || undefined, llm_override_parameters: ragLlmOverridesFromParams || undefined, generation_constraints: ragGcFromParams || undefined };
            const response = await generateRAG(novelId, requestData); // 调用旧的 RAG API
            setRagResultForOld(response);
            toast.success("RAG 内容生成成功！");
        } catch (err: any) {
            const errorMsg = err.message || (err.response?.data?.detail || "RAG 内容生成时发生未知错误。");
            setRagErrorForOld(errorMsg);
            toast.error(`RAG 生成失败: ${errorMsg}`);
        } finally {
            setIsGeneratingRAGOld(false);
        }
    };

    // 综合判断是否有任何操作正在进行
    const isAnyLoadingAction = isLoadingPageData || isSavingChapter || isProcessingSingleTask || isExecutingChainOld || isGeneratingRAGOld || isFetchingDryRunOld || isWorkbenchProcessing || isWorkbenchStreaming;

    if (isLoadingPageData && !currentChapter && !novelForPage && !appConfig) {
        return <div className={`${pageViewStyles.pageContainer} ${styles.loadingContainer}`}><Loader size={32} className={pageViewStyles.spinningIcon} /> <span>加载章节处理器核心数据...</span></div>;
    }
    if (errorPageData && !currentChapter && !novelForPage) {
        return <div className={`${pageViewStyles.pageContainer} ${pageViewStyles.pageErrorContainer}`}><AlertTriangle size={32} /><span>{errorPageData}</span><RouterLink to={`/novels/${novelId || ''}`} className="btn btn-sm btn-secondary" style={{marginTop: 'var(--spacing-md)'}}>返回小说详情</RouterLink></div>;
    }
    if (!novelId || (!currentChapter && !isLoadingPageData) || !novelForPage) { // novelForPage 也加入判断
        return (<div className={`${pageViewStyles.pageContainer} ${pageViewStyles.pageErrorContainer}`}><Info size={32} /><span>无法加载章节数据，或指定的小说/章节不存在。</span><RouterLink to={`/novels/${novelIdParam || ''}`} className="btn btn-sm btn-secondary" style={{ marginTop: 'var(--spacing-md)' }}>返回小说详情</RouterLink></div>);
    }
    if (!appConfig && !isLoadingPageData) { // 如果页面数据加载完，但appConfig仍未加载（例如，单独的配置加载失败）
        return <div className={`${pageViewStyles.pageContainer} ${pageViewStyles.pageErrorContainer}`}><AlertTriangle size={32} /><span>应用配置加载失败，部分AI功能可能受限。</span> <button onClick={() => window.location.reload()} className="btn btn-sm btn-warning">尝试刷新页面</button> </div>;
    }


    return (
        <div className={`${pageViewStyles.pageContainer} ${componentStyles.chapterProcessorPage}`}> {/* 使用 componentStyles */}
            {/* 页面头部和返回按钮 */}
            <Row className="mb-4 align-items-center">
                <Col xs="auto">
                    <Button variant="outline-secondary" onClick={() => navigate(`/novels/${novelId}`)} title="返回小说详情页">
                        <ArrowLeft size={20} /> <span className="d-none d-md-inline">返回</span>
                    </Button>
                </Col>
                <Col>
                    <h1 className={pageViewStyles.pageTitle}>
                        章节处理器: <span className={componentStyles.chapterTitleHighlight}>
                            {currentChapter?.title || (currentChapter ? `章节 ${currentChapter.chapter_index + 1}` : '未选择章节')}
                        </span>
                    </h1>
                    <Badge bg="info" pill className="ms-0 ms-md-2">
                        <BookOpen size={14} className="me-1"/>小说: {novelForPage?.title || '加载中...'}
                    </Badge>
                </Col>
                 <Col xs="auto" className="d-flex align-items-center">
                    {/* 选择章节下拉框，移到标题右侧 */}
                    {chaptersForSelection.length > 0 && (
                        <FloatingLabel controlId="chapterSelectDropdown" label="选择章节" className="me-2" style={{minWidth: '200px'}}>
                            <Form.Select
                                value={currentChapter?.id || ''}
                                onChange={handleChapterSelectChange}
                                disabled={chaptersForSelection.length === 0 || isLoadingPageData || isAnyLoadingAction}
                                aria-label="选择要处理的章节"
                            >
                                <option value="" disabled>-- 请选择一个章节 --</option>
                                {chaptersForSelection.map(ch => (
                                    <option key={ch.id} value={ch.id}>
                                        C{ch.chapter_index !== null && ch.chapter_index >= 0 ? String(ch.chapter_index +1).padStart(3,'0') : '???'}: {ch.title || `章节 ${ch.id}`}
                                    </option>
                                ))}
                            </Form.Select>
                        </FloatingLabel>
                    )}
                    <Button
                        variant="success"
                        size="sm"
                        onClick={handleSaveChanges}
                        disabled={isSavingChapter || editableContent === (currentChapter?.content || '') || isLoadingPageData || isAnyLoadingAction}
                        title={editableContent === (currentChapter?.content || '') ? "内容未修改" : "保存对章节内容的更改"}
                    >
                        {isSavingChapter ? <Spinner as="span" animation="border" size="sm" className="me-1" /> : <SettingsIcon size={16} className="me-1" />}
                        {isSavingChapter ? ' 保存中...' : ' 保存修改'}
                    </Button>
                </Col>
            </Row>

            {/* 主要布局：编辑区在左，AI工具在右 */}
            <Row > {/* gutter prop is for react-bootstrap Row, not standard div */}
                <Col md={12} lg={7} className="mb-3 mb-lg-0"> {/* 编辑区 */}
                    <Card className={`${componentStyles.editorCard} h-100`}>
                        <Card.Header as="h5" className="d-flex justify-content-between align-items-center bg-light">
                            <span><Edit size={20} className="me-2"/>编辑章节内容</span>
                            {/* 保存按钮移至页面顶部右侧 */}
                        </Card.Header>
                        <Card.Body className="d-flex flex-column">
                            <FloatingLabel controlId="chapterContentTextarea" label="章节正文" className="flex-grow-1">
                                <Form.Control
                                    as="textarea"
                                    value={editableContent}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEditableContent(e.target.value)}
                                    className={`${componentStyles.contentTextArea} h-100`}
                                    placeholder="在此编辑章节内容..."
                                    disabled={isAnyLoadingAction || isLoadingPageData}
                                />
                            </FloatingLabel>
                            <div className="mt-2 text-muted d-flex justify-content-between">
                                <small>当前字数: {editableContent.length} (原始字数: {currentChapter?.content.length || 0})</small>
                                <Button variant="link" size="sm" onClick={() => {if(currentChapter) setEditableContent(currentChapter.content);}} disabled={editableContent === (currentChapter?.content || '')} title="将编辑区内容重置为本章节的原始保存内容">
                                    <RefreshCw size={12}/> 重置为原始内容
                                </Button>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>

                <Col md={12} lg={5}> {/* AI工具和结果区 */}
                    <div className={componentStyles.toolsAndResultsArea}>
                        {/* 新增：通过 WorkbenchContext 执行规则链的模块 */}
                        <Card className={`${componentStyles.processingCard} mb-3`}>
                            <Card.Header as="h5" className="bg-light"><PlayCircle size={20} className="me-2"/>应用AI规则链 (工作台上下文)</Card.Header>
                            <Card.Body>
                                <div className={componentStyles.ruleChainSelectionArea}>
                                    <p className="mb-2">
                                        当前选定规则链 (用于工作台): <strong className={componentStyles.selectedRuleChainName}>
                                            {selectedRuleChainInfoForContext ? selectedRuleChainInfoForContext.name : (currentRuleChainInContext ? currentRuleChainInContext.name : '未选择或未加载')}
                                        </strong>
                                    </p>
                                    <Button
                                        variant="outline-primary"
                                        onClick={handleOpenRuleChainSelectorForContext}
                                        className="mb-2 w-100"
                                        disabled={isAnyLoadingAction}
                                    >
                                        <ListIcon size={18} className="me-1" /> 选择/加载规则链至工作台
                                    </Button>
                                    <Button
                                        variant="primary"
                                        onClick={handleExecuteChainViaContext}
                                        disabled={!currentRuleChainInContext || isAnyLoadingAction}
                                        className="w-100"
                                        size="lg"
                                        title={!currentRuleChainInContext ? "请先选择并加载一个规则链到工作台" : `对当前章节内容执行规则链 "${currentRuleChainInContext?.name}" (流式)`}
                                    >
                                        {isWorkbenchProcessing || isWorkbenchStreaming ? <Spinner as="span" animation="border" size="sm" className="me-1" /> : <PlayCircle size={20} className="me-1" />}
                                        {isWorkbenchProcessing || isWorkbenchStreaming ? ' 处理中...' : `执行链 (工作台)`}
                                    </Button>
                                    {(isWorkbenchProcessing || isWorkbenchStreaming) && <p className="text-muted mt-2 small text-center">工作台AI任务执行中，请稍候...</p>}
                                </div>
                            </Card.Body>
                        </Card>

                        {/* 原有的单任务、旧规则链、RAG模块，用details包裹使其可折叠 */}
                        <details className={componentStyles.toolSectionDetails}>
                            <summary className={componentStyles.toolSectionSummary}>独立AI工具 (旧版/单步/RAG)</summary>
                            <div className={componentStyles.toolSectionContent}>
                                {/* 旧的单任务处理模块 */}
                                <Card className="mb-3">
                                    <Card.Header as="h6">单任务处理 (独立)</Card.Header>
                                    <Card.Body>
                                        <Form.Group className="mb-2">
                                            <FloatingLabel controlId="taskSelectOld" label="选择预定义任务">
                                                <Form.Select value={selectedTaskForSingle} onChange={(e) => setSelectedTaskForSingle(e.target.value as PredefinedTaskEnum)} disabled={isAnyLoadingAction || !appConfig}>
                                                    {predefinedTasksOptions.map(task => <option key={task.value} value={task.value}>{task.label}</option>)}
                                                </Form.Select>
                                            </FloatingLabel>
                                        </Form.Group>
                                        {/* 旧的TaskSpecificParamsInput，注意它可能不兼容最新的 context 驱动的 LLMResultDisplay */}
                                        <TaskSpecificParamsInput
                                            taskType={selectedTaskForSingle}
                                            currentParams={taskParamsForSingle}
                                            onChange={setTaskParamsForSingle}
                                            availableLLMModels={availableLLMModelsForPage}
                                            appConfig={appConfig}
                                            // estimatedInputTokens={chapterContentTokens + calculateRoughTokenEstimate(customInstructionForSingle)} // 这个需要从父组件传入
                                            disabled={isAnyLoadingAction || !appConfig}
                                        />
                                        <CostPreviewDisplay level={textProcessCostPreview.level} message={textProcessCostPreview.message} isLoading={textProcessCostPreview.level === 'calculating_preview'} />
                                        {selectedTaskForSingle === PredefinedTaskEnum.CUSTOM_INSTRUCTION && (
                                            <Form.Group className="mb-2">
                                                 <FloatingLabel controlId="customInstructionOld" label="自定义指令 (可选)">
                                                    <Form.Control as="textarea" rows={2} value={customInstructionForSingle} onChange={(e) => setCustomInstructionForSingle(e.target.value)} placeholder="例如：请将 {text} 改写为更简洁的现代风格。" disabled={isAnyLoadingAction || !appConfig} />
                                                 </FloatingLabel>
                                            </Form.Group>
                                        )}
                                        {/* 旧的后处理规则等... */}
                                        <Button onClick={handleProcessTextOld} disabled={isAnyLoadingAction || !currentChapter || !editableContent.trim() || !appConfig} variant="info" className="w-100 mt-2">
                                            {isProcessingSingleTask ? <Spinner as="span" animation="border" size="sm"/> : <Zap size={16} />} {isProcessingSingleTask ? '处理中...' : '执行单任务 (独立)'}
                                        </Button>
                                    </Card.Body>
                                </Card>

                                {/* 旧的规则链处理模块 */}
                                <Card className="mb-3">
                                    <Card.Header as="h6">规则链处理 (独立)</Card.Header>
                                    <Card.Body>
                                        <Form.Group className="mb-2">
                                            <FloatingLabel controlId="ruleChainInputOld" label="输入文本 (独立规则链)">
                                                <Form.Control as="textarea" rows={3} value={ruleChainInputTextForOld} onChange={e => setRuleChainInputTextForOld(e.target.value)} disabled={isAnyLoadingAction || !appConfig} placeholder="默认使用当前章节内容" />
                                            </FloatingLabel>
                                        </Form.Group>
                                        <Form.Group className="mb-2">
                                             <FloatingLabel controlId="ruleChainSelectOld" label="选择规则链 (独立)">
                                                <Form.Select value={selectedRuleChainIdForOld} onChange={e => { setSelectedRuleChainIdForOld(e.target.value); setChainDryRunResultForOld(null); setChainResultForOld(null); }} disabled={isAnyLoadingAction || availableRuleChainsForOld.length === 0 || !appConfig}>
                                                    <option value="">-- 选择规则链 --</option>
                                                    {availableRuleChainsForOld.map(chain => <option key={chain.id} value={chain.id.toString()}>{chain.name} {chain.is_template ? '(模板)' : ''}</option>)}
                                                </Form.Select>
                                             </FloatingLabel>
                                        </Form.Group>
                                        <Button onClick={handleExecuteRuleChainWithDryRunOld} disabled={isAnyLoadingAction || !selectedRuleChainIdForOld || !novelId || !ruleChainInputTextForOld.trim() || !appConfig} variant="primary" className="w-100 mt-2">
                                            {isFetchingDryRunOld ? <Spinner as="span" animation="border" size="sm"/> : <Play size={16} />} {isFetchingDryRunOld ? '预估中...' : '预估并执行规则链 (独立)'}
                                        </Button>
                                    </Card.Body>
                                </Card>
                                {/* 旧的RAG处理模块等... */}
                            </div>
                        </details>

                         {/* 结果显示区域 */}
                        <div className={`${componentStyles.resultsDisplaySection} mt-3 flex-grow-1`}>
                            <h6 className="mb-3"><Eye size={18} className="me-2" /> AI处理结果预览 (通过工作台上下文):</h6>
                            <LLMResultDisplay
                                // 这个 LLMResultDisplay 将消费来自 WorkbenchContext 的结果
                                onApplyToEditor={applyWorkbenchOutputToChapterEditor}
                                onCopyToClipboard={copyWorkbenchOutputToClipboard}
                                showApplyButton={true}
                                novelIdContext={novelId || undefined} // novelId 可能为 null
                                chapterIndexContext={currentChapter?.chapter_index}
                            />
                        </div>
                    </div>
                </Col>
            </Row>

            {/* 规则链选择模态框 (用于新的 WorkbenchContext 流程) */}
            <Modal show={showRuleChainSelectorModalForContext} onHide={() => setShowRuleChainSelectorModalForContext(false)} size="lg" centered scrollable>
                <Modal.Header closeButton> <Modal.Title><ListIcon size={24} className="me-2" /> 选择规则链加载到工作台</Modal.Title> </Modal.Header>
                <Modal.Body className={componentStyles.ruleChainSelectorModalBody}>
                    <p className="text-muted">选择一个规则链加载到工作台上下文，之后可以点击“执行链(工作台)”按钮处理当前章节内容。</p>
                    <RuleChainList
                        onSelectChain={(chainId, chainName) => handleRuleChainSelectedForContext(chainId, chainName)}
                        isSelectMode={true}
                        ruleChains={allRuleChainsForContextSelect} // 传递获取到的所有规则链
                        isLoading={isLoadingPageData} // 可以共用页面加载状态
                        error={null} // 假设列表本身的加载错误不在此处处理
                        onRefreshList={() => { /* 可选：如果 RuleChainList 有刷新按钮，可以在这里触发API刷新所有链 */ }}
                    />
                </Modal.Body>
                <Modal.Footer><Button variant="secondary" onClick={() => setShowRuleChainSelectorModalForContext(false)}>关闭</Button></Modal.Footer>
            </Modal>

            {/* 旧的 DryRunConfirmModal (如果仍然需要) */}
            {showDryRunModalOld && chainDryRunResultForOld && appConfig && (
                <DryRunConfirmModalInternal // 使用你文件中的内部版本或导入的组件
                    dryRunData={chainDryRunResultForOld}
                    chainName={availableRuleChainsForOld.find(c => c.id.toString() === selectedRuleChainIdForOld)?.name || `ID ${selectedRuleChainIdForOld}`}
                    onConfirm={() => { setShowDryRunModalOld(false); actuallyExecuteRuleChainOld(); }}
                    onCancel={() => { setShowDryRunModalOld(false); toast.info("规则链执行已取消。"); setChainDryRunResultForOld(null); }}
                    predefinedTaskLabels={predefinedTaskLabels}
                    appConfig={appConfig}
                />
            )}
        </div>
    );
};

export default ChapterProcessor;