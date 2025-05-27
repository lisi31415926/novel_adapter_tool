// frontend-react/src/pages/ChapterProcessorPage.tsx
import React, { useState, useEffect, useCallback, useMemo, ChangeEvent, FormEvent } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
    Button as BootstrapButton,
    Form as BootstrapForm,
    Card as BootstrapCard,
    Spinner as BootstrapSpinner,
    Badge as BootstrapBadge,
    Row as BootstrapRow,
    Col as BootstrapCol,
    FloatingLabel as BootstrapFloatingLabel,
    Modal as BootstrapModal,
    Alert as BootstrapAlert,
    ListGroup as BootstrapListGroup,
} from 'react-bootstrap';

// 从 API 服务导入必要的类型和函数
import {
    getNovelById,
    getChaptersByNovelId,
    processTextWithLLM as apiProcessTextWithLLM,
    executeRuleChain as apiExecuteRuleChainOld,
    getApplicationConfig, // 主配置加载
    getRuleChains as apiGetRuleChains,
    getPredefinedTasks as apiGetPredefinedTasks,
    getNovelWorldviewSettings,
    ragGenerateWithNovelContext as apiRagGenerateWithNovelContext,
    searchSimilarChunksInNovel as apiSearchSimilarChunksInNovel,
    updateChapter as apiUpdateChapter,
    Novel,
    Chapter as ApiChapter,
    TextProcessRequest,
    TextProcessResponse,
    RuleChain,
    RuleChainExecuteRequest,
    RuleChainExecuteResponse,
    ApplicationConfig,
    PredefinedTask as ApiPredefinedTaskMeta,
    UserDefinedLLMConfig,
    RuleChainDryRunResponse,
    SimilaritySearchQuery,
    SimilaritySearchResponse,
    RAGGenerateRequest,
    RAGGenerateResponse,
    PredefinedTaskEnum,
    PostProcessingRuleEnum,
    TokenCostLevelEnum,
    NovelAnalysisStatusEnum,
    StepInputSourceEnum,
    GenerationConstraintsSchema,
} from '../services/api';

// 导入子组件
import TaskSpecificParamsInput from '../components/TaskSpecificParamsInput';
import LLMResultDisplay from '../components/LLMResultDisplay';
import ChainExecutionResultDisplay from '../components/ChainExecutionResultDisplay';
// DryRunConfirmModalInternalComponent 是页面内部定义的，用于旧流程
import RuleChainList from '../components/RuleChainList';
import SimilaritySearchResultsDisplay from '../components/SimilaritySearchResultsDisplay';

// 导入上下文
import { useWorkbenchContext } from '../contexts/WorkbenchContext';

// 导入样式
import styles from './ChapterProcessorPage.module.css';
import pageViewStyles from './PageStyles.module.css';
// import componentButtonStyles from '../components/Button.module.css'; // 如果有此文件

// 导入图标
import {
    Play, Zap, SlidersHorizontal, BrainCircuit, Loader, Copy, ChevronDown, Info,
    AlertTriangle, Send, RefreshCw, BookOpen, DollarSign, EyeSlash, HelpCircle,
    ListChecks, AlertOctagon, X as CloseIcon, Edit, ArrowLeft, Settings as SettingsIcon, PlayCircle,
    List as ListIcon, Filter as FilterIcon, BookCopy, Search as SearchIcon,
} from 'lucide-react';

// --- 辅助类型与接口 ---
interface Chapter extends ApiChapter {}
type CostLevelDisplay = TokenCostLevelEnum | 'calculating_preview';
interface CostPreviewDisplayProps {
    text: string;
    modelId: string | null;
    appConfig: ApplicationConfig | null;
    title?: string;
    additionalContextTokens?: number;
}
// --- 结束：辅助类型与接口 ---


// --- 辅助函数 ---
// calculateAccurateTokenEstimate 保持不变，已在之前版本中审查和确认
const calculateAccurateTokenEstimate = (
    text: string,
    modelId: string | null,
    appConfig: ApplicationConfig | null,
    additionalContextTokens: number = 0
): number => {
    if ((!text || !text.trim()) && additionalContextTokens === 0) return 0;
    if (!appConfig || !modelId) {
        const fallbackFactor = 2.5; // 通用回退因子
        return Math.ceil(((text?.length || 0) + additionalContextTokens * fallbackFactor) / fallbackFactor);
    }
    const { llm_settings } = appConfig;
    if (!llm_settings?.tokenizer_options) { // 确保 tokenizer_options 存在
         const fallbackFactor = 2.5;
        return Math.ceil(((text?.length || 0) + additionalContextTokens * fallbackFactor) / fallbackFactor);
    }

    const selectedModelConfig = llm_settings.available_models.find(m => m.user_given_id === modelId);
    const providerTag = selectedModelConfig?.provider_tag;
    let factor = llm_settings.tokenizer_options.default_chars_per_token_general || 2.5;

    if (providerTag && llm_settings.tokenizer_options.default_estimation_factors_by_provider?.[providerTag]) {
        factor = llm_settings.tokenizer_options.default_estimation_factors_by_provider[providerTag]!;
    } else if (selectedModelConfig?.provider_tag?.startsWith("lm_studio") && llm_settings.tokenizer_options.local_model_token_estimation_factors) {
        const localModelFactors = llm_settings.tokenizer_options.local_model_token_estimation_factors;
        // 确保 localModelFactors 和其内部结构存在
        const modelSpecificFactorInfo = localModelFactors?.[selectedModelConfig.user_given_id] || localModelFactors?.[selectedModelConfig.model_identifier_for_api];
        if (modelSpecificFactorInfo && typeof modelSpecificFactorInfo.chars_per_token === 'number' && modelSpecificFactorInfo.chars_per_token > 0) {
            factor = modelSpecificFactorInfo.chars_per_token;
        }
    }
    if (factor <= 0) factor = 2.5;
    return Math.ceil((text?.length || 0) / factor) + additionalContextTokens;
};

// CostPreviewDisplay 保持不变
const CostPreviewDisplay: React.FC<CostPreviewDisplayProps> = React.memo(({ text, modelId, appConfig, title, additionalContextTokens = 0 }) => {
    const estimatedTokens = calculateAccurateTokenEstimate(text, modelId, appConfig, additionalContextTokens);
    // 确保 appConfig 和 cost_estimation_tiers 存在
    const costPerMillionInput = modelId && appConfig?.cost_estimation_tiers?.token_cost_per_model?.[modelId]?.input_per_million;
    const estimatedCost = (costPerMillionInput !== null && costPerMillionInput !== undefined) ? (estimatedTokens / 1000000) * costPerMillionInput : null;
    
    let costString = "成本未知";
    if (estimatedCost !== null) {
        costString = estimatedCost < 0.0001 && estimatedCost > 0 ? `< $0.0001` : (estimatedCost === 0 ? "$0.000" : `$${estimatedCost.toFixed(4)}`);
    } else if (costPerMillionInput === undefined && modelId) {
        costString = "该模型成本未配置";
    }

    const generalFactor = appConfig?.llm_settings?.tokenizer_options?.default_chars_per_token_general || 2.5;
    const selectedModel = appConfig?.llm_settings.available_models.find(m => m.user_given_id === modelId);
    const providerTag = selectedModel?.provider_tag;
    const providerSpecificFactor = providerTag && appConfig?.llm_settings.tokenizer_options?.default_estimation_factors_by_provider
        ? appConfig.llm_settings.tokenizer_options.default_estimation_factors_by_provider[providerTag]
        : null;
    const factorUsed = (typeof providerSpecificFactor === 'number' && providerSpecificFactor > 0) ? providerSpecificFactor : generalFactor;


    return (
        <div className={styles.costPreview} title={title || "当前操作成本估算"}>
            <small>
                估算 Tokens: <strong title={`基于模型 ${selectedModel?.user_given_name || modelId || '未知'} (因子 ~${factorUsed.toFixed(1)})`}>{estimatedTokens}</strong>
                {text?.length > 0 && ` (原文 ${text.length} 字)`}
                {additionalContextTokens > 0 && ` (+${additionalContextTokens} 上下文 Tokens)`}
                , 估算成本: <strong title="基于所选模型输入成本">{costString}</strong>
            </small>
        </div>
    );
});


interface DryRunConfirmModalInternalProps {
    dryRunData: RuleChainDryRunResponse;
    chainName: string;
    onConfirm: () => void;
    onCancel: () => void;
    appConfig: ApplicationConfig | null;
    predefinedTaskLabels: Record<string, string>;
}
// DryRunConfirmModalInternalComponent 保持不变
const DryRunConfirmModalInternalComponent: React.FC<DryRunConfirmModalInternalProps> = React.memo(({
    dryRunData, chainName, onConfirm, onCancel, appConfig, predefinedTaskLabels
}) => {
    const getModelDisplayName = (modelId: string): string => {
        if (appConfig?.llm_settings.model_aliases) { const aliasEntry = Object.entries(appConfig.llm_settings.model_aliases).find(([_, id]) => id === modelId); if (aliasEntry) return `${aliasEntry[0]} (${modelId.split('/').pop()})`; } const availableModel = appConfig?.llm_settings.available_models.find(m => m.user_given_id === modelId); return availableModel?.user_given_name || modelId;
    };
    const getCostLevelFromEnum = (levelEnum: TokenCostLevelEnum | string): { label: string; className: string; icon: React.ReactNode } => {
        switch (levelEnum) {
            case TokenCostLevelEnum.LOW: return { label: "低消耗", className: `${styles.costBadge} ${styles.costLowModal}`, icon: <DollarSign size={16}/> };
            case TokenCostLevelEnum.MEDIUM: return { label: "中等消耗", className: `${styles.costBadge} ${styles.costMediumModal}`, icon: <><DollarSign size={16}/><DollarSign size={16}/></> };
            case TokenCostLevelEnum.HIGH: return { label: "高消耗", className: `${styles.costBadge} ${styles.costHighModal}`, icon: <><DollarSign size={16}/><DollarSign size={16}/><DollarSign size={16}/></> };
            default: return { label: "消耗未知", className: `${styles.costBadge} ${styles.costUnknownModal}`, icon: <HelpCircle size={16}/> };
        }
    };
    const overallCostVisuals = getCostLevelFromEnum(dryRunData.token_cost_level as TokenCostLevelEnum);

    return (
        <div className={styles.modalOverlay} data-testid="dry-run-modal-internal">
            <div className={`${styles.modalContent} ${styles.dryRunModalContent}`}>
                <div className={styles.modalHeader}><h3 className="mb-0">“{chainName}”成本预估</h3><BootstrapButton variant="close" aria-label="Close" onClick={onCancel}><CloseIcon size={20}/></BootstrapButton></div>
                <div className={`${styles.modalBody} ${styles.dryRunModalBodyScroll}`}>
                    <div className={styles.modalSummarySection}><p className={styles.modalOverallCost}><strong>总体预估消耗级别:</strong><span className={`${overallCostVisuals.className}`} title={`基于预估的总输入Token: ${dryRunData.estimated_total_prompt_tokens} 和总输出Token上限: ${dryRunData.estimated_total_completion_tokens}。实际消耗可能因模型具体行为和内容而异。`}>{overallCostVisuals.icon} {overallCostVisuals.label}</span></p><div className={styles.modalTokenTotals}><span>总预估Prompt Tokens: <strong>{dryRunData.estimated_total_prompt_tokens}</strong></span><span>总预估Completion Tokens (上限): <strong>{dryRunData.estimated_total_completion_tokens}</strong></span></div></div>
                    {dryRunData.warnings && dryRunData.warnings.length > 0 && (<div className={`${styles.modalWarningsContainer} alert alert-warning`}><AlertTriangle size={18} style={{ marginRight: 'var(--spacing-sm)', flexShrink: 0 }}/><div><strong>预估警告:</strong><ul className={styles.warningsList}>{dryRunData.warnings.map((warning, idx) => <li key={`warn-${idx}`}>{warning}</li>)}</ul></div></div>)}
                    {dryRunData.steps_estimates && dryRunData.steps_estimates.length > 0 && (<div className={styles.modalStepsTableContainer}><h6>各LLM步骤预估详情:</h6><div className={styles.tableScrollWrapper}><table className={styles.modalStepsTable}><thead><tr><th>步骤</th><th>任务类型</th><th>使用模型</th><th>Prompt Tokens (估)</th><th>Completion Tokens (上限)</th></tr></thead><tbody>{dryRunData.steps_estimates.map(step => (<tr key={`step-est-${step.step_order}`}><td>{step.step_order + 1}</td><td title={step.task_type}>{predefinedTaskLabels[step.task_type] || step.task_type}</td><td title={step.model_to_be_used}>{getModelDisplayName(step.model_to_be_used)}</td><td className={styles.numericalCell}>{(step.estimated_prompt_tokens === 0 && !step.task_type.toLowerCase().includes("rag")) ? <span className={styles.dynamicEstimateMarker} title="此步骤输入依赖上一步骤的输出或动态生成，此处预估为0或基于粗略假设。实际消耗可能不同。">动态*</span> : step.estimated_prompt_tokens}</td><td className={styles.numericalCell}>{step.max_completion_tokens ?? <span title="未在此步骤参数中指定最大完成Token，将使用LLM或应用默认值。">-</span>}</td></tr>))}</tbody></table></div></div>)}
                </div>
                <div className={styles.modalFooter}><BootstrapButton variant="secondary" size="sm" onClick={onCancel}>取消</BootstrapButton><BootstrapButton variant="primary" size="sm" onClick={onConfirm} title={dryRunData.token_cost_level === TokenCostLevelEnum.HIGH || (dryRunData.warnings && dryRunData.warnings.length > 0) ? "请注意预估的高消耗或警告信息后确认执行" : "确认并开始执行规则链"}>确认并执行{(dryRunData.token_cost_level === TokenCostLevelEnum.HIGH || (dryRunData.warnings && dryRunData.warnings.length > 0)) && <AlertOctagon size={16} style={{marginLeft: 'var(--spacing-xs)'}}/>}</BootstrapButton></div>
            </div>
        </div>
    );
});
// --- 结束：辅助函数和内部组件 ---


const ChapterProcessorPage: React.FC = () => {
    const { novelId: novelIdParamFromRoute, chapterId: chapterIdParamFromRoute } = useParams<{ novelId: string; chapterId: string }>();
    const navigate = useNavigate();

    // --- 从 WorkbenchContext 获取核心状态和方法 ---
    const {
        currentNovel: novelFromContext,
        selectNovel: selectNovelInContext,
        currentChapter: chapterFromContext,
        selectChapter: selectChapterInContext,
        sourceText: sourceTextFromContext,
        setSourceText: setSourceTextInContext,
        referenceContent, setReferenceContent,
        executeChain: executeChainFromContext,
        isLoading: isWorkbenchProcessing,
        isStreaming: isWorkbenchStreaming,
        currentRuleChain: currentRuleChainInContext,
        loadRuleChainForEditing: loadRuleChainToContext,
        clearResults: clearWorkbenchResults,
        addMaterialSnippet,
        appConfig: appConfigFromContext, // 使用上下文中的 appConfig
    } = useWorkbenchContext();

    // --- 页面主要数据状态 (优先从Context初始化) ---
    const novelId = useMemo(() => novelIdParamFromRoute ? parseInt(novelIdParamFromRoute, 10) : (novelFromContext?.id || null), [novelIdParamFromRoute, novelFromContext]);
    const currentChapterIdFromRoute = useMemo(() => chapterIdParamFromRoute ? parseInt(chapterIdParamFromRoute, 10) : null, [chapterIdParamFromRoute]);

    const [novelForPage, setNovelForPage] = useState<Novel | null>(novelFromContext);
    const [currentChapterForPage, setCurrentChapterForPage] = useState<Chapter | null>(chapterFromContext);
    const [editableContent, setEditableContent] = useState<string>(sourceTextFromContext || chapterFromContext?.content || '');
    const [chaptersForSelection, setChaptersForSelection] = useState<Chapter[]>([]);
    const [isLoadingPageData, setIsLoadingPageData] = useState<boolean>(!novelFromContext || !chapterFromContext);
    const [errorPageData, setErrorPageData] = useState<string | null>(null);
    const [isSavingChapter, setIsSavingChapter] = useState<boolean>(false);
    const [availableLLMModelsForPage, setAvailableLLMModelsForPage] = useState<UserDefinedLLMConfig[]>([]);
    const [predefinedTasksOptions, setPredefinedTasksOptions] = useState<ApiPredefinedTaskMeta[]>([]);

    // --- 旧流程独立状态 (保持不变) ---
    const [selectedModelIdForSingle, setSelectedModelIdForSingle] = useState<string | null>(null);
    const [selectedTaskForSingle, setSelectedTaskForSingle] = useState<PredefinedTaskEnum>(PredefinedTaskEnum.SUMMARIZE_TEXT);
    const [taskParamsForSingle, setTaskParamsForSingle] = useState<Record<string, any>>({});
    const [customInstructionForSingle, setCustomInstructionForSingle] = useState<string>('');
    const [selectedPostProcessingForSingle, setSelectedPostProcessingForSingle] = useState<PostProcessingRuleEnum[]>([]);
    const [llmResultForSingle, setLlmResultForSingle] = useState<TextProcessResponse | null>(null);
    const [isProcessingSingleTask, setIsProcessingSingleTask] = useState<boolean>(false);
    const [textProcessCostPreview, setTextProcessCostPreview] = useState<{level: CostLevelDisplay, message: string}>({level: TokenCostLevelEnum.UNKNOWN, message: '待操作或配置模型'});
    const [availableRuleChainsForOld, setAvailableRuleChainsForOld] = useState<RuleChain[]>([]);
    const [selectedRuleChainIdForOld, setSelectedRuleChainIdForOld] = useState<string>('');
    const [ruleChainInputTextForOld, setRuleChainInputTextForOld] = useState<string>(editableContent);
    const [chainResultForOld, setChainResultForOld] = useState<RuleChainExecuteResponse | RuleChainDryRunResponse | null>(null);
    const [isExecutingChainOld, setIsExecutingChainOld] = useState<boolean>(false);
    const [chainDryRunResultForOld, setChainDryRunResultForOld] = useState<RuleChainDryRunResponse | null>(null);
    const [isFetchingDryRunOld, setIsFetchingDryRunOld] = useState<boolean>(false);
    const [showDryRunModalLegacy, setShowDryRunModalLegacy] = useState<boolean>(false);
    const [worldview, setWorldview] = useState<Record<string, any> | null>(null);
    const [showWorldviewOld, setShowWorldviewOld] = useState<boolean>(false);
    const [ragQueryOld, setRagQueryOld] = useState<string>('');
    const [ragInstructionOld, setRagInstructionOld] = useState<string>('请根据以下上下文信息回答问题或完成指示：');
    const [ragParamsForOld, setRagParamsForOld] = useState<Partial<RAGGenerateRequest>>({ top_n_context: 3 });
    const [isProcessingRAGOld, setIsProcessingRAGOld] = useState<boolean>(false);
    const [ragResultOld, setRagResultOld] = useState<RAGGenerateResponse | null>(null);
    const [ragErrorOld, setRagErrorOld] = useState<string | null>(null);
    const [similarityResultsOld, setSimilarityResultsOld] = useState<SimilaritySearchResponse | null>(null);
    const [isSearchingSimilarityOld, setIsSearchingSimilarityOld] = useState<boolean>(false);
    const [ragCostPreview, setRagCostPreview] = useState<{level: CostLevelDisplay, message: string}>({level: TokenCostLevelEnum.UNKNOWN, message: '输入RAG指令以评估消耗'});

    // --- 工作台规则链选择相关状态 ---
    const [showRuleChainSelectorModal, setShowRuleChainSelectorModal] = useState<boolean>(false);
    const [allRuleChainsForContextSelect, setAllRuleChainsForContextSelect] = useState<RuleChain[]>([]);

    const predefinedTaskLabels = useMemo(() => {
        return predefinedTasksOptions.reduce((acc, task) => {
            acc[task.id] = task.label; // task.id 已经是 PredefinedTaskEnum 的值
            return acc;
        }, {} as Record<string, string>);
    }, [predefinedTasksOptions]);

    // --- 数据加载与同步 Effect Hooks ---
    // 初始化加载：应用配置，小说详情，章节列表，世界观，旧规则链列表
    const fetchInitialData = useCallback(async () => {
        setIsLoadingPageData(true); setErrorPageData(null);
        try {
            let currentAppConfig = appConfigFromContext;
            if (!currentAppConfig) { // 如果上下文没有，则从API获取
                currentAppConfig = await getApplicationConfig();
                // setAppConfigInContext(currentAppConfig); // 假设有此方法，否则 WorkbenchContext 应该自己加载
            }
            if (currentAppConfig) {
                const enabledModels = currentAppConfig.llm_settings?.available_models?.filter(m => m.enabled && currentAppConfig.llm_providers[m.provider_tag]?.enabled) || [];
                setAvailableLLMModelsForPage(enabledModels);
                // 为旧单任务流程设置默认模型
                if (enabledModels.length > 0 && !selectedModelIdForSingle) {
                    const defaultModelId = currentAppConfig.llm_settings?.default_model_id;
                    setSelectedModelIdForSingle(defaultModelId && enabledModels.find(m => m.user_given_id === defaultModelId) ? defaultModelId : enabledModels[0].user_given_id);
                }
            }
            const tasksMeta = await apiGetPredefinedTasks();
            setPredefinedTasksOptions(tasksMeta);

            if (!novelId) { setErrorPageData("未提供有效的小说ID。"); setIsLoadingPageData(false); return; }

            let novelDataToUse = novelFromContext?.id === novelId ? novelFromContext : await getNovelById(novelId);
            setNovelForPage(novelDataToUse);
            if (novelFromContext?.id !== novelDataToUse.id) {
                selectNovelInContext(novelDataToUse);
            }
            
            const fetchedChaptersData = await getChaptersByNovelId(novelId, { page: 1, page_size: 1000 });
            setChaptersForSelection(fetchedChaptersData.items);

            let chapterToLoadFromApiOrCache = (chapterFromContext?.novel_id === novelId && chapterFromContext?.id === currentChapterIdFromRoute)
                ? chapterFromContext
                : fetchedChaptersData.items.find(c => c.id === currentChapterIdFromRoute);
            
            if (!chapterToLoadFromApiOrCache && fetchedChaptersData.items.length > 0) {
                chapterToLoadFromApiOrCache = fetchedChaptersData.items[0];
                if (currentChapterIdFromRoute) toast.info(`指定的章节ID ${currentChapterIdFromRoute} 未在该小说中找到，已加载第一章。`);
            }

            if (chapterToLoadFromApiOrCache) {
                setCurrentChapterForPage(chapterToLoadFromApiOrCache);
                if (chapterFromContext?.id !== chapterToLoadFromApiOrCache.id) {
                    selectChapterInContext(chapterToLoadFromApiOrCache);
                }
                const contentToSet = chapterToLoadFromApiOrCache.content;
                setEditableContent(contentToSet);
                setSourceTextInContext(contentToSet); // 初始加载时同步上下文
                setRuleChainInputTextForOld(contentToSet);
                setReferenceContent(contentToSet, `当前章节: ${chapterToLoadFromApiOrCache.title || `章节 ${chapterToLoadFromApiOrCache.chapter_index + 1}`}`);
            } else {
                setEditableContent(''); setSourceTextInContext(''); setRuleChainInputTextForOld('');
                setReferenceContent('', '无选定章节');
                if (novelDataToUse) toast.warn(`小说《${novelDataToUse.title}》还没有章节。`);
            }
            
            const worldviewData = await getNovelWorldviewSettings(novelId);
            setWorldview(worldviewData);
            const chainsResponse = await apiGetRuleChains({ page: 1, page_size: 1000, is_template: false });
            const chains = chainsResponse.items || [];
            setAvailableRuleChainsForOld(chains);
            setAllRuleChainsForContextSelect(chains);

        } catch (err: any) {
            const msg = err.message || '加载页面数据失败。';
            setErrorPageData(msg);
            toast.error(msg);
        } finally {
            setIsLoadingPageData(false);
        }
    }, [
        novelId, currentChapterIdFromRoute, novelFromContext, chapterFromContext,
        appConfigFromContext, selectNovelInContext, selectChapterInContext,
        setSourceTextInContext, setReferenceContent, selectedModelIdForSingle
    ]);

    useEffect(() => {
        fetchInitialData();
    }, [fetchInitialData]); // 初始加载

    // 监听路由参数变化，重新加载章节数据
    useEffect(() => {
        if (currentChapterIdFromRoute && chaptersForSelection.length > 0) {
            const chapterFromRoute = chaptersForSelection.find(c => c.id === currentChapterIdFromRoute);
            if (chapterFromRoute) {
                if (!currentChapterForPage || currentChapterForPage.id !== chapterFromRoute.id) {
                    setCurrentChapterForPage(chapterFromRoute);
                    selectChapterInContext(chapterFromRoute);
                    const newContent = chapterFromRoute.content;
                    setEditableContent(newContent);
                    setSourceTextInContext(newContent);
                    setRuleChainInputTextForOld(newContent);
                    setReferenceContent(newContent, `当前章节: ${chapterFromRoute.title || `章节 ${chapterFromRoute.chapter_index + 1}`}`);
                    clearWorkbenchResults();
                    setLlmResultForSingle(null); setChainResultForOld(null); setRagResultOld(null); setSimilarityResultsOld(null);
                }
            } else if (novelId && chaptersForSelection.length > 0 && (!currentChapterForPage || currentChapterForPage.novel_id !== novelId)){
                // 如果路由指定的 chapterId 无效，但 novelId 有效且有章节，则尝试导航到第一个章节
                const firstChapter = chaptersForSelection[0];
                if (firstChapter) {
                     toast.warn(`路由参数中的章节 ID ${currentChapterIdFromRoute} 无效，已导航到此小说的第一章。`);
                     navigate(`/novels/${novelId}/processor/${firstChapter.id}`, { replace: true });
                }
            }
        } else if (!currentChapterIdFromRoute && novelId && chaptersForSelection.length > 0 && (!currentChapterForPage || currentChapterForPage.novel_id !== novelId)) {
            // 如果URL没有指定章节ID，并且当前章节不属于当前小说，则加载当前小说的第一章
            const firstChapterOfCurrentNovel = chaptersForSelection[0]; // 已按 novelId 筛选，直接取第一个
            if (firstChapterOfCurrentNovel) {
                 navigate(`/novels/${novelId}/processor/${firstChapterOfCurrentNovel.id}`, { replace: true });
            }
        }
    }, [currentChapterIdFromRoute, chaptersForSelection, currentChapterForPage, novelId, navigate, selectChapterInContext, setSourceTextInContext, setReferenceContent, clearWorkbenchResults]);
    
    // 双向绑定：当编辑器内容由用户改变时，同步到上下文的 sourceText
    useEffect(() => {
        if (editableContent !== sourceTextFromContext) {
            setSourceTextInContext(editableContent);
        }
    }, [editableContent, sourceTextFromContext, setSourceTextInContext]);

    // 双向绑定：当上下文中的 sourceText 变化时（例如，由其他组件修改），同步回本页面的编辑器
    useEffect(() => {
        // 只有当上下文的源文本与当前编辑区内容确实不同时才更新，以避免不必要的重渲染或光标跳动
        if (sourceTextFromContext !== null && sourceTextFromContext !== undefined && sourceTextFromContext !== editableContent) {
            setEditableContent(sourceTextFromContext);
        }
    }, [sourceTextFromContext]); // 移除了 editableContent，因为它会导致无限循环


    // --- 事件处理函数 ---
    const handleChapterSelectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const newChapterId = parseInt(event.target.value);
        if (isNaN(newChapterId) || !novelId) return;
        navigate(`/novels/${novelId}/processor/${newChapterId}`, { replace: true });
    };

    const handleSaveChanges = async () => {
        if (!currentChapterForPage || !novelId) { toast.error("未选中有效章节或小说。"); return; }
        // 检查内容是否真的发生变化
        if (editableContent === currentChapterForPage.content) {
            toast.info("章节内容未作修改，无需保存。");
            return;
        }
        setIsSavingChapter(true);
        try {
            const updatePayload: Partial<ApiChapter> = { content: editableContent };
            const updatedChapter = await apiUpdateChapter(currentChapterForPage.id, updatePayload);

            setCurrentChapterForPage(updatedChapter);
            selectChapterInContext(updatedChapter);
            setEditableContent(updatedChapter.content);
            // setSourceTextInContext(updatedChapter.content); // 已通过 editableContent 的 useEffect 同步
            setChaptersForSelection(prevChapters => prevChapters.map(ch => ch.id === updatedChapter.id ? updatedChapter : ch));
            toast.success(`章节 "${updatedChapter.title || `ID: ${updatedChapter.id}`}" 内容已成功保存到数据库！`);
        } catch (error) {
            toast.error(`保存章节内容失败: ${(error as Error).message}`);
        } finally {
            setIsSavingChapter(false);
        }
    };

    const handleExecuteChainViaContext = useCallback(() => {
        if (!novelForPage) { toast.warn('当前未加载小说信息。'); return; }
        if (!currentRuleChainInContext) { toast.warn('请先选择一个规则链加载到工作台。'); return; }
        if (!editableContent.trim()) { toast.warn('编辑区文本为空，无法执行。'); return; }
        // sourceText 已通过 editableContent 的 useEffect 同步到上下文
        executeChainFromContext({ novel_id: novelForPage.id }, true);
        toast.info(`已开始执行规则链: "${currentRuleChainInContext.name}" (流式)。`);
    }, [novelForPage, currentRuleChainInContext, editableContent, executeChainFromContext]);

    const applyWorkbenchOutputToChapterEditor = useCallback((textToApply: string) => {
        setEditableContent(textToApply);
        toast.success("工作台结果已应用到章节内容编辑器。");
    }, []);

    const copyWorkbenchOutputToClipboard = useCallback((textToCopy: string) => {
        navigator.clipboard.writeText(textToCopy)
            .then(() => toast.success("工作台结果已复制到剪贴板。"))
            .catch(err => toast.error(`复制失败: ${err}`));
    }, []);

    const handleOpenRuleChainSelectorForContext = async () => {
        if (isWorkbenchProcessing || isWorkbenchStreaming) { toast.warn("工作台当前有AI任务正在处理中。"); return; }
        clearWorkbenchResults();
        try {
            // 获取最新的非模板规则链列表
            const chainsData = await apiGetRuleChains({ page: 1, page_size: 1000, is_template: false });
            setAllRuleChainsForContextSelect(chainsData.items || []);
            setShowRuleChainSelectorModal(true);
        } catch (error) {
            toast.error("加载可用规则链列表失败。");
        }
    };

    const handleRuleChainSelectedForContext = useCallback(async (chainId: number, chainName?: string) => {
        setShowRuleChainSelectorModal(false);
        toast.info(`准备加载规则链: ${chainName || `ID ${chainId}`} 到工作台...`);
        try {
            const loadedChain = await loadRuleChainToContext(chainId);
            if (loadedChain) {
                toast.success(`规则链 "${loadedChain.name}" 已加载到工作台。`);
            } else {
                toast.error(`加载规则链 "${chainName || `ID ${chainId}`}" 失败。`);
            }
        } catch (error) {
            toast.error(`加载规则链到工作台时出错: ${(error as Error).message}`);
        }
    }, [loadRuleChainToContext]);

    // --- 旧流程函数 ---
    const handleProcessTextOld = async () => {
        if (!currentChapterForPage || !editableContent.trim()) { toast.warn("章节内容为空或编辑区无文本。"); return; }
        if (!appConfigFromContext) { toast.error("应用配置加载中..."); return; }
        const modelIdToUse = taskParamsForSingle.model_id || selectedModelIdForSingle || appConfigFromContext.llm_settings.default_model_id || availableLLMModelsForPage[0]?.user_given_id;
        if (!modelIdToUse) { toast.warn('请在参数中选择LLM模型或确保应用有默认模型。'); return; }

        const { level: costLevel, message: costMessage } = textProcessCostPreview;
        const taskOption = predefinedTasksOptions.find(t => t.id === selectedTaskForSingle);
        const taskLabel = taskOption ? taskOption.label : selectedTaskForSingle;
        const confirmMsg = `即将使用任务 "${taskLabel}" 处理当前编辑区内容。\n预估消耗级别: ${String(costLevel).toUpperCase()}.\n详细信息: ${costMessage}\n\n是否确定继续执行？`;
        if (!window.confirm(confirmMsg)) { toast.info("文本处理操作已取消。"); return; }

        setIsProcessingSingleTask(true); setLlmResultForSingle(null);
        toast.info(`正在执行任务: "${taskLabel}"...`, { autoClose: 2000 });
        const { model_id: _m, llm_override_parameters, generation_constraints, ...taskSpecificParamsOnly } = taskParamsForSingle;
        try {
            const requestData: TextProcessRequest = {
                text: editableContent, task: selectedTaskForSingle,
                parameters: Object.keys(taskSpecificParamsOnly).length > 0 ? taskSpecificParamsOnly : undefined,
                custom_instruction: customInstructionForSingle.trim() || undefined,
                post_processing_rules: selectedPostProcessingForSingle.length > 0 ? selectedPostProcessingForSingle : undefined,
                model_id: modelIdToUse,
                llm_override_parameters: llm_override_parameters,
                generation_constraints: generation_constraints,
            };
            const response = await apiProcessTextWithLLM(requestData);
            setLlmResultForSingle(response);
            toast.success(`任务 "${taskLabel}" 处理成功！`);
        } catch (err: any) {
            const errorMsg = err.message || (err.response?.data?.detail || "文本处理时发生未知错误。");
            setLlmResultForSingle({ original_text: editableContent, processed_text: `处理失败: ${errorMsg}`, task_used: selectedTaskForSingle, parameters_used: taskSpecificParamsOnly, model_used: modelIdToUse || appConfigFromContext?.llm_settings.default_llm_fallback || "默认模型", instruction_used: customInstructionForSingle, constraints_applied: generation_constraints, constraints_satisfied: null });
            toast.error(`任务 "${taskLabel}" 处理失败: ${errorMsg}`);
        } finally {
            setIsProcessingSingleTask(false);
        }
    };
    
    const actuallyExecuteRuleChainOld = async () => {
        if (!novelId || !selectedRuleChainIdForOld || !ruleChainInputTextForOld.trim()) { toast.warn("请选择规则链并确保有输入文本。"); return; }
        if (!appConfigFromContext) { toast.error("应用配置未加载。"); return; }
        setIsExecutingChainOld(true); setChainResultForOld(null);
        const chainName = availableRuleChainsForOld.find(c => c.id.toString() === selectedRuleChainIdForOld)?.name || `规则链ID ${selectedRuleChainIdForOld}`;
        toast.info(`正在执行规则链: "${chainName}"...`, { autoClose: 2000 });
        try {
            const actualRequest: RuleChainExecuteRequest = { source_text: ruleChainInputTextForOld, novel_id: novelId, rule_chain_id: parseInt(selectedRuleChainIdForOld, 10), dry_run: false, stream: false };
            const response = await apiExecuteRuleChainOld(actualRequest);
            setChainResultForOld(response as RuleChainExecuteResponse);
            toast.success(`规则链 "${chainName}" 执行成功！`);
        } catch (err: any) {
            const errorMsg = err.message || (err.response?.data?.detail || "规则链执行时发生未知错误。");
            setChainResultForOld({ original_text: ruleChainInputTextForOld, final_output_text: `规则链执行失败: ${errorMsg}`, executed_chain_name: chainName, executed_chain_id: parseInt(selectedRuleChainIdForOld), steps_results: [{ step_order: 0, task_type: "CHAIN_EXECUTION_FAILURE", input_text_snippet: ruleChainInputTextForOld.substring(0, 100) + (ruleChainInputTextForOld.length > 100 ? "..." : ""), output_text_snippet: `错误: ${errorMsg}`, status: "failure" as any, error: errorMsg }] });
            toast.error(`规则链 "${chainName}" 执行失败: ${errorMsg}`);
        } finally {
            setIsExecutingChainOld(false); setShowDryRunModalLegacy(false); setChainDryRunResultForOld(null);
        }
    };

    const handleExecuteRuleChainWithDryRunOld = async () => {
        if (!novelId || !selectedRuleChainIdForOld || !ruleChainInputTextForOld.trim() || !appConfigFromContext) { toast.warn("请提供小说ID、选择规则链并确保输入文本。"); return; }
        setIsFetchingDryRunOld(true); setChainDryRunResultForOld(null); setShowDryRunModalLegacy(false);
        const chainName = availableRuleChainsForOld.find(c => c.id.toString() === selectedRuleChainIdForOld)?.name || `规则链ID ${selectedRuleChainIdForOld}`;
        toast.info(`正在预估规则链 "${chainName}" 的执行消耗...`);
        try {
            const dryRunRequest: RuleChainExecuteRequest = { source_text: ruleChainInputTextForOld, novel_id: novelId, rule_chain_id: parseInt(selectedRuleChainIdForOld, 10), dry_run: true, stream: false };
            const dryRunResponse = await apiExecuteRuleChainOld(dryRunRequest);
            setChainDryRunResultForOld(dryRunResponse as RuleChainDryRunResponse); // 确保类型
            setIsFetchingDryRunOld(false);
            if (dryRunResponse) { setShowDryRunModalLegacy(true); }
            else { toast.error("成本预估未能成功返回有效的预估详情。"); }
        } catch (err: any) {
            setIsFetchingDryRunOld(false);
            const errorMsg = err.message || (err.response?.data?.detail || "规则链成本预估时发生未知错误。");
            toast.error(`成本预估失败: ${errorMsg}`);
        }
    };
    
    const handleGenerateRAGOld = async (event?: FormEvent) => {
        if (event) event.preventDefault();
        if (!novelId || !ragInstructionOld.trim() || !novelForPage || !appConfigFromContext) { toast.warn("请提供小说ID和RAG指令。"); return; }
        if (novelForPage.vectorization_status !== NovelAnalysisStatusEnum.COMPLETED) { toast.error("当前小说的向量化未完成，无法执行RAG。"); return; }
        
        setIsProcessingRAGOld(true); setRagResultOld(null); setRagErrorOld(null);
        toast.info("正在进行RAG检索与内容生成...", { autoClose: 2000 });
        const { model_id: ragModelIdFromParams, llm_override_parameters: ragLlmOverridesFromParams, generation_constraints: ragGcFromParams, top_n_context: ragTopNFromParams } = ragParamsForOld;
        try {
            const requestData: RAGGenerateRequest = {
                instruction: `${ragInstructionOld}\n\n用户查询/问题：${ragQueryOld}`,
                top_n_context: typeof ragTopNFromParams === 'number' ? ragTopNFromParams : (appConfigFromContext?.llm_settings.rag_default_top_n_context || 3),
                model_id: ragModelIdFromParams || selectedModelIdForSingle || appConfigFromContext?.llm_settings.default_model_id,
                llm_override_parameters: ragLlmOverridesFromParams || undefined,
                generation_constraints: ragGcFromParams || undefined
            };
            if (!requestData.model_id) { toast.error("执行RAG需要指定一个LLM模型。"); setIsProcessingRAGOld(false); return;}
            const response = await apiRagGenerateWithNovelContext(novelId, requestData);
            setRagResultOld(response);
            toast.success("RAG 内容生成成功！");
            if (response.retrieved_context_snippets && response.retrieved_context_snippets.length > 0) {
                setSimilarityResultsOld({ query_text: ragQueryOld || ragInstructionOld, results: response.retrieved_context_snippets.map((snippet, index) => ({ id: `rag-res-${index}`, text: snippet, metadata: { source: "RAG结果上下文" }, distance: 0 })), search_time: response.search_time });
            } else { setSimilarityResultsOld(null); }
        } catch (err: any) {
            const errorMsg = err.message || (err.response?.data?.detail || "RAG 内容生成时发生未知错误。");
            setRagErrorOld(errorMsg); toast.error(`RAG 生成失败: ${errorMsg}`);
        } finally {
            setIsProcessingRAGOld(false);
        }
    };

    const handleSearchSimilarityOld = async () => {
        if (!novelId || !ragQueryOld.trim()) { toast.warn("请提供小说ID和检索查询。"); return; }
        if (!appConfigFromContext) { toast.error("应用配置未加载。"); return; }
        if (novelForPage?.vectorization_status !== NovelAnalysisStatusEnum.COMPLETED) { toast.error("当前小说的向量化未完成，无法执行相似性搜索。"); return; }
        setIsSearchingSimilarityOld(true); setSimilarityResultsOld(null); setRagResultOld(null);
        toast.info("正在执行相似性检索...");
        try {
            const requestData: SimilaritySearchQuery = { query: ragQueryOld, top_n: ragParamsForOld.top_n_context || (appConfigFromContext?.llm_settings.rag_default_top_n_context || 5) };
            const response = await apiSearchSimilarChunksInNovel(novelId, requestData);
            setSimilarityResultsOld(response);
            toast.success("相似性检索完成！");
        } catch (err: any) {
            const errorMsg = err.message || (err.response?.data?.detail || "相似性检索时发生未知错误。");
            setErrorPageData(errorMsg); 
            toast.error(`相似性检索失败: ${errorMsg}`);
        } finally {
            setIsSearchingSimilarityOld(false);
        }
    };

    // --- 成本预估 Effect Hooks (保持不变) ---
    useEffect(() => {
        if (!currentChapterForPage || !appConfigFromContext?.llm_settings) { setTextProcessCostPreview({level: TokenCostLevelEnum.UNKNOWN, message: '等待章节和配置'}); return; }
        setTextProcessCostPreview({level: 'calculating_preview', message: '计算中...'});
        const modelIdForEst = taskParamsForSingle.model_id || selectedModelIdForSingle || appConfigFromContext.llm_settings.default_model_id;
        const estPromptTokens = calculateAccurateTokenEstimate(editableContent + (customInstructionForSingle || ''), modelIdForEst, appConfigFromContext);
        
        const llmOverridesEst = taskParamsForSingle.llm_override_parameters as Record<string, any> | undefined;
        const gcEst = taskParamsForSingle.generation_constraints as Partial<GenerationConstraintsSchema> | undefined;
        let maxOutputTokensEst = appConfigFromContext.llm_settings.default_max_completion_tokens || 2048;
        if (llmOverridesEst?.max_tokens !== undefined) maxOutputTokensEst = llmOverridesEst.max_tokens;
        else if (llmOverridesEst?.max_completion_tokens !== undefined) maxOutputTokensEst = llmOverridesEst.max_completion_tokens;
        else if (llmOverridesEst?.max_output_tokens !== undefined) maxOutputTokensEst = llmOverridesEst.max_output_tokens;
        else if (gcEst?.max_length !== undefined && gcEst.max_length !== null) maxOutputTokensEst = gcEst.max_length;
        
        const totalEst = estPromptTokens + maxOutputTokensEst; 
        const costLevelEst = getCostLevelFromTokensOld(totalEst);
        const modelNameDisplayEst = modelIdForEst ? (availableLLMModelsForPage.find(m=>m.user_given_id === modelIdForEst)?.user_given_name || modelIdForEst) : '系统默认';
        setTextProcessCostPreview({ level: costLevelEst, message: `模型: ${modelNameDisplayEst}。输入约 ${estPromptTokens} tokens, 输出上限 ${maxOutputTokensEst} tokens。` });
    }, [editableContent, customInstructionForSingle, taskParamsForSingle, selectedModelIdForSingle, appConfigFromContext, getCostLevelFromTokensOld, currentChapterForPage, availableLLMModelsForPage]); // calculateAccurateTokenEstimate 移出依赖

    useEffect(() => {
        if (!appConfigFromContext?.llm_settings || !ragInstructionOld.trim()) { setRagCostPreview({level: TokenCostLevelEnum.UNKNOWN, message: '输入RAG指令评估'}); return; }
        setRagCostPreview({level: 'calculating_preview', message: '计算中...'});
        const modelIdForRagEst = ragParamsForOld.model_id || selectedModelIdForSingle || appConfigFromContext.llm_settings.default_model_id;
        const ragInputTextForEst = ragInstructionOld + (ragQueryOld || '');
        const estInstrTokensRag = calculateAccurateTokenEstimate(ragInputTextForEst, modelIdForRagEst, appConfigFromContext);
        
        const topNContext = ragParamsForOld.top_n_context || appConfigFromContext.llm_settings.rag_default_top_n_context || 3;
        // 确保 avg_tokens_per_rag_chunk 及其内部结构存在
        const avgTokensPerChunkData = appConfigFromContext.cost_estimation_tiers?.avg_tokens_per_rag_chunk;
        let avgTokensPerChunkVal = 250;
        if (avgTokensPerChunkData) {
            if (typeof avgTokensPerChunkData.default === 'number') avgTokensPerChunkVal = avgTokensPerChunkData.default;
            if (modelIdForRagEst && typeof avgTokensPerChunkData[modelIdForRagEst] === 'number') {
                avgTokensPerChunkVal = avgTokensPerChunkData[modelIdForRagEst];
            }
        }
        const estimatedContextTokens = topNContext * avgTokensPerChunkVal;

        const llmOverridesRagEst = ragParamsForOld.llm_override_parameters as Record<string, any> | undefined;
        const gcRagEst = ragParamsForOld.generation_constraints as Partial<GenerationConstraintsSchema> | undefined;
        let maxOutputTokensRagEst = appConfigFromContext.llm_settings.default_max_completion_tokens || 2048;
        if (llmOverridesRagEst?.max_tokens !== undefined) maxOutputTokensRagEst = llmOverridesRagEst.max_tokens;
        else if (gcRagEst?.max_length !== undefined && gcRagEst.max_length !== null) maxOutputTokensRagEst = gcRagEst.max_length;
        
        const totalEstRag = estInstrTokensRag + estimatedContextTokens + maxOutputTokensRagEst; 
        const levelRagEst = getCostLevelFromTokensOld(totalEstRag);
        const modelNameRagDisplayEst = modelIdForRagEst ? (availableLLMModelsForPage.find(m=>m.user_given_id === modelIdForRagEst)?.user_given_name || modelIdForRagEst) : '系统默认(RAG)';
        setRagCostPreview({ level: levelRagEst, message: `模型: ${modelNameRagDisplayEst}。指令+查询约 ${estInstrTokensRag} + 上下文约 ${estimatedContextTokens} Tokens, 输出上限 ${maxOutputTokensRagEst} Tokens。` });
    }, [ragInstructionOld, ragQueryOld, ragParamsForOld, selectedModelIdForSingle, appConfigFromContext, getCostLevelFromTokensOld, availableLLMModelsForPage]); // calculateAccurateTokenEstimate 移出依赖

    // --- 综合加载状态 ---
    const isAnyCriticalLoading = isLoadingPageData || (!appConfigFromContext && !errorPageData);
    const isAnyBackgroundAction = isSavingChapter || isProcessingSingleTask || isExecutingChainOld || isProcessingRAGOld || isFetchingDryRunOld || isWorkbenchProcessing || isWorkbenchStreaming || isSearchingSimilarityOld;

    // --- 渲染 ---
    if (isAnyCriticalLoading && !currentChapterForPage && !novelForPage) {
        return <div className={`${pageViewStyles.pageContainer} ${styles.loadingContainer}`}><Loader size={32} className={pageViewStyles.spinningIcon} /> <span>加载章节处理器核心数据...</span></div>;
    }
    if (errorPageData && !currentChapterForPage && !novelForPage) {
        return <div className={`${pageViewStyles.pageContainer} ${pageViewStyles.pageErrorContainer}`}><AlertTriangle size={32} /><span>{errorPageData}</span><RouterLink to={`/novels/${novelId || ''}`} className="btn btn-sm btn-secondary mt-3">返回小说详情</RouterLink></div>;
    }
    // 修正：即使有章节可选但未选，只要novelId有效且小说信息已加载，就不应显示“无法加载”
    if (!novelId || !novelForPage || (!currentChapterForPage && !isAnyCriticalLoading && chaptersForSelection.length > 0 && !currentChapterIdFromRoute)) {
         // 如果 novelId 无效，或者小说信息 novelForPage 未加载，则显示错误
        if (!novelId || !novelForPage) {
            return (<div className={`${pageViewStyles.pageContainer} ${pageViewStyles.pageErrorContainer}`}><Info size={32} /><span>无法加载小说数据，或指定的小说不存在。</span><RouterLink to={`/novels/`} className="btn btn-sm btn-secondary mt-3">返回小说列表</RouterLink></div>);
        }
        // 如果 novelId 和 novelForPage 都有效，但没有章节信息，则提示选择章节
        if (chaptersForSelection.length === 0 && !isLoadingPageData) {
            return (<div className={`${pageViewStyles.pageContainer} ${pageViewStyles.pageErrorContainer}`}><Info size={32} /><span>小说《{novelForPage.title}》尚无章节。</span><RouterLink to={`/novels/${novelId}`} className="btn btn-sm btn-secondary mt-3">返回小说详情</RouterLink></div>);
        }
        // 如果有章节但当前未选择，则提示用户选择
        if (chaptersForSelection.length > 0 && !currentChapterForPage && !isLoadingPageData) {
             return (<div className={`${pageViewStyles.pageContainer} ${styles.loadingContainer}`}><Info size={32} /> <span>请从上方选择一个章节开始处理。</span></div>);
        }
    }
    if (!appConfigFromContext && !isAnyCriticalLoading) {
        return <div className={`${pageViewStyles.pageContainer} ${pageViewStyles.pageErrorContainer}`}><AlertTriangle size={32} /><span>应用配置加载失败，部分AI功能可能受限。</span> <BootstrapButton variant="warning" size="sm" onClick={() => window.location.reload()}>尝试刷新页面</BootstrapButton> </div>;
    }

    return (
        <div className={`${pageViewStyles.pageContainer} ${styles.chapterProcessorPage}`}>
            {/* 页面头部 */}
            <BootstrapRow className="mb-3 align-items-center">
                <BootstrapCol xs="auto">
                    <BootstrapButton variant="outline-secondary" size="sm" onClick={() => navigate(novelId ? `/novels/${novelId}` : '/novels')} title="返回小说详情或列表">
                        <ArrowLeft size={16} /> <span className="d-none d-md-inline ms-1">返回</span>
                    </BootstrapButton>
                </BootstrapCol>
                <BootstrapCol>
                    <h1 className={`${pageViewStyles.pageTitle} mb-0`}>
                        <Zap size={26} />
                        章节处理器: <span className={styles.chapterTitleHighlight}>
                            {currentChapterForPage?.title || (currentChapterForPage ? `章节 ${currentChapterForPage.chapter_index + 1}` : '请选择章节')}
                        </span>
                    </h1>
                    {novelForPage && <BootstrapBadge bg="info" text="dark" pill className="ms-2 align-self-center"><BookOpen size={14} className="me-1"/>{novelForPage.title}</BootstrapBadge>}
                </BootstrapCol>
                 <BootstrapCol xs="auto" className="d-flex align-items-center">
                    {chaptersForSelection.length > 0 ? (
                        <BootstrapFloatingLabel controlId="chapterSelectDropdownPage" label="切换章节" className="me-2">
                            <BootstrapForm.Select
                                value={currentChapterForPage?.id || ''}
                                onChange={handleChapterSelectChange}
                                disabled={isLoadingPageData || isAnyBackgroundAction}
                                aria-label="选择要处理的章节"
                                size="sm" style={{minWidth: '220px'}}
                            >
                                <option value="" disabled={!!currentChapterForPage}>-- 选择章节 --</option>
                                {chaptersForSelection.map(ch => (
                                    <option key={ch.id} value={ch.id} title={ch.title || `章节 ${ch.chapter_index + 1}`}>
                                        C{ch.chapter_index !== null && ch.chapter_index >= 0 ? String(ch.chapter_index +1).padStart(3,'0') : '???'}: {ch.title ? (ch.title.length > 30 ? ch.title.substring(0,27)+'...' : ch.title) : `章节ID ${ch.id}`}
                                    </option>
                                ))}
                            </BootstrapForm.Select>
                        </BootstrapFloatingLabel>
                    ) : (
                        !isLoadingPageData && <span className="text-muted me-2 small">此小说暂无章节</span>
                    )}
                    <BootstrapButton
                        variant="success" size="sm" onClick={handleSaveChanges}
                        disabled={isSavingChapter || editableContent === (currentChapterForPage?.content || '') || isLoadingPageData || isAnyBackgroundAction || !currentChapterForPage}
                        title={!currentChapterForPage ? "请先选择章节" : (editableContent === (currentChapterForPage?.content || '') ? "章节内容未修改" : "保存对当前章节内容的更改")}
                        style={{minWidth: '110px'}}
                    >
                        {isSavingChapter ? <BootstrapSpinner as="span" animation="border" size="sm" className="me-1" /> : <Edit size={14} className="me-1" />}
                        {isSavingChapter ? ' 保存中...' : ' 保存内容'}
                    </BootstrapButton>
                </BootstrapCol>
            </BootstrapRow>

            {/* 主要布局 */}
            <BootstrapRow>
                <BootstrapCol md={12} lg={7} className="mb-3 mb-lg-0"> {/* 编辑区 */}
                    <BootstrapCard className={`${styles.editorCard} h-100`}>
                        <BootstrapCard.Header as="h5" className="d-flex justify-content-between align-items-center bg-light-subtle py-2">
                            <span><Edit size={16} className="me-2"/>编辑章节原文</span>
                            <BootstrapButton variant="link" size="sm" onClick={() => {if(currentChapterForPage) {setEditableContent(currentChapterForPage.content);}}} disabled={editableContent === (currentChapterForPage?.content || '') || isAnyBackgroundAction || !currentChapterForPage} title="重置为原始内容">
                                <RefreshCw size={12}/> 重置
                            </BootstrapButton>
                        </BootstrapCard.Header>
                        <BootstrapCard.Body className="d-flex flex-column p-2">
                            <BootstrapFloatingLabel controlId="chapterProcessorContentTextarea" label={currentChapterForPage ? "章节内容" : "请先选择章节"} className="flex-grow-1">
                                <BootstrapForm.Control
                                    as="textarea"
                                    value={editableContent}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                                        setEditableContent(e.target.value);
                                    }}
                                    className={`${styles.contentTextArea} h-100`}
                                    placeholder={currentChapterForPage ? "在此编辑当前选定章节的正文内容..." : "请先从上方选择一个章节。"}
                                    disabled={isAnyBackgroundAction || isLoadingPageData || !currentChapterForPage}
                                />
                            </BootstrapFloatingLabel>
                             <div className="mt-2 text-muted small d-flex justify-content-between align-items-center">
                                <span>当前字数: {editableContent.length} (原始: {currentChapterForPage?.content.length || 0})</span>
                                {appConfigFromContext && <CostPreviewDisplay text={editableContent} modelId={selectedModelIdForSingle || appConfigFromContext?.llm_settings.default_model_id || null} appConfig={appConfigFromContext} title="编辑区内容" />}
                            </div>
                        </BootstrapCard.Body>
                    </BootstrapCard>
                </BootstrapCol>

                <BootstrapCol md={12} lg={5}> {/* AI工具和结果区 */}
                    <div className={styles.toolsAndResultsArea}>
                        {/* 工作台规则链执行模块 */}
                        <BootstrapCard className={`${styles.processingCard} mb-3`}>
                            <BootstrapCard.Header as="h5" className="bg-primary-subtle text-primary-emphasis py-2"><PlayCircle size={17} className="me-2"/>规则链处理 (工作台)</BootstrapCard.Header>
                            <BootstrapCard.Body className="p-3">
                                <div className={styles.ruleChainSelectionArea}>
                                    <p className="mb-2 small text-muted">
                                        已选 (工作台): <strong className={styles.selectedRuleChainName}>
                                            {currentRuleChainInContext ? currentRuleChainInContext.name : '未选择规则链'}
                                        </strong>
                                    </p>
                                    <BootstrapButton variant="outline-primary" onClick={handleOpenRuleChainSelectorForContext} className="mb-2 w-100 btn-sm" disabled={isAnyBackgroundAction}>
                                        <ListIcon size={14} className="me-1" /> 选择/加载规则链
                                    </BootstrapButton>
                                    <BootstrapButton variant="primary" onClick={handleExecuteChainViaContext} disabled={!currentRuleChainInContext || isAnyBackgroundAction || !editableContent.trim()} className="w-100" size="lg" title={!currentRuleChainInContext ? "请先选择并加载规则链" : `执行链 "${currentRuleChainInContext?.name}"`}>
                                        {isWorkbenchProcessing || isWorkbenchStreaming ? <BootstrapSpinner as="span" animation="border" size="sm" className="me-1" /> : <PlayCircle size={18} className="me-1" />}
                                        {isWorkbenchProcessing || isWorkbenchStreaming ? ' 处理中...' : `执行已选链`}
                                    </BootstrapButton>
                                    {(isWorkbenchProcessing || isWorkbenchStreaming) && <p className="text-muted mt-2 small text-center">AI任务执行中...</p>}
                                </div>
                            </BootstrapCard.Body>
                        </BootstrapCard>

                        {/* AI结果显示区 (消费工作台上下文) */}
                        <div className={`${styles.resultsDisplaySection} mt-2 flex-grow-1`}>
                            <h6 className="mb-2 small text-muted"><Zap size={14} className="me-1" /> AI处理结果 (来自工作台):</h6>
                            <LLMResultDisplay
                                onApplyToEditor={applyWorkbenchOutputToChapterEditor}
                                onCopyToClipboard={copyWorkbenchOutputToClipboard}
                                showApplyButton={true}
                                novelIdContext={novelId || undefined}
                                chapterIndexContext={currentChapterForPage?.chapter_index}
                            />
                        </div>
                        
                        {/* 旧的独立工具模块 */}
                        <details className={styles.toolSectionDetails}>
                            <summary className={styles.toolSectionSummary}><SettingsIcon size={14} className="me-2"/>独立AI工具 (单步/RAG/旧链)</summary>
                            <div className={styles.toolSectionContent}>
                                {/* 单任务处理 */}
                                {appConfigFromContext && availableLLMModelsForPage.length > 0 && (
                                    <BootstrapCard className="mb-3">
                                        <BootstrapCard.Header as="h6" className="bg-light-subtle py-2"><Zap size={16} className="me-1"/>单任务处理 (独立)</BootstrapCard.Header>
                                        <BootstrapCard.Body className="p-3">
                                            <BootstrapForm.Group className="mb-2">
                                                <BootstrapFloatingLabel controlId="taskSelectOldPage" label="选择预定义任务" bsPrefix={`${pageViewStyles.floatingLabelPrefix} form-floating`}>
                                                    <BootstrapForm.Select value={selectedTaskForSingle} onChange={(e) => setSelectedTaskForSingle(e.target.value as PredefinedTaskEnum)} disabled={isAnyBackgroundAction} size="sm">
                                                        {predefinedTasksOptions.map(task => <option key={task.id} value={task.id}>{task.label}</option>)}
                                                    </BootstrapForm.Select>
                                                </BootstrapFloatingLabel>
                                            </BootstrapForm.Group>
                                            <TaskSpecificParamsInput
                                                parametersDef={PREDEFINED_TASK_DETAILS_MAP[selectedTaskForSingle]?.parameters || {}} // 假设常量中有参数定义
                                                currentValues={taskParamsForSingle}
                                                onValuesChange={setTaskParamsForSingle}
                                                availableLLMModels={availableLLMModelsForPage}
                                                appConfig={appConfigFromContext}
                                                disabled={isAnyBackgroundAction}
                                                novelId={novelId}
                                            />
                                            <CostPreviewDisplay text={editableContent + (customInstructionForSingle||'')} modelId={taskParamsForSingle.model_id || selectedModelIdForSingle || appConfigFromContext?.llm_settings.default_model_id || null} appConfig={appConfigFromContext} title="单任务处理" />
                                            {selectedTaskForSingle === PredefinedTaskEnum.CUSTOM_INSTRUCTION && ( /* ... */ )}
                                            <BootstrapForm.Group className="mb-2"> {/* ... 后处理选择 ... */} </BootstrapForm.Group>
                                            <BootstrapButton onClick={handleProcessTextOld} disabled={isAnyBackgroundAction || !currentChapterForPage || !editableContent.trim()} variant="info" className="w-100 mt-2 btn-sm">
                                                {isProcessingSingleTask ? <BootstrapSpinner as="span" animation="border" size="sm"/> : <Zap size={14} />} {isProcessingSingleTask ? '处理中...' : '执行单任务'}
                                            </BootstrapButton>
                                            {llmResultForSingle && <LLMResultDisplay resultToShow={llmResultForSingle} />}
                                        </BootstrapCard.Body>
                                    </BootstrapCard>
                                )}

                                {/* 旧规则链处理 */}
                                {availableRuleChainsForOld.length > 0 && ( /* ... */ )}
                                
                                {/* 旧RAG模块 */}
                                {novelForPage?.vectorization_status === NovelAnalysisStatusEnum.COMPLETED && appConfigFromContext && ( /* ... */ )}
                            </div>
                        </details>
                    </div>
                </BootstrapCol>
            </BootstrapRow>

            {/* 规则链选择模态框 (用于 WorkbenchContext) */}
            <BootstrapModal show={showRuleChainSelectorModal} onHide={() => setShowRuleChainSelectorModal(false)} size="lg" centered scrollable backdrop="static">
                <BootstrapModal.Header closeButton> <BootstrapModal.Title><ListIcon size={20} className="me-2" /> 选择规则链加载到工作台</BootstrapModal.Title> </BootstrapModal.Header>
                <BootstrapModal.Body className={styles.ruleChainSelectorModalBody}>
                    <p className="text-muted small mb-3">选择一个规则链加载到工作台上下文，之后可以点击“执行已选链(工作台)”按钮处理当前编辑区内容。</p>
                    <RuleChainList
                        onSelectChain={handleRuleChainSelectedForContext}
                        isSelectMode={true}
                        ruleChains={allRuleChainsForContextSelect}
                        isLoading={isLoadingPageData && allRuleChainsForContextSelect.length === 0}
                        error={null}
                        onRefreshList={async () => { try {const chainsData = await apiGetRuleChains({ page: 1, page_size: 1000, is_template: false }); setAllRuleChainsForContextSelect(chainsData.items || []); } catch { toast.error("刷新规则链列表失败");}}}
                    />
                </BootstrapModal.Body>
                <BootstrapModal.Footer><BootstrapButton variant="secondary" size="sm" onClick={() => setShowRuleChainSelectorModal(false)}>关闭</BootstrapButton></BootstrapModal.Footer>
            </BootstrapModal>

            {/* 旧的 DryRunConfirmModal */}
            {showDryRunModalLegacy && chainDryRunResultForOld && appConfigFromContext && (
                <DryRunConfirmModalInternalComponent
                    dryRunData={chainDryRunResultForOld}
                    chainName={availableRuleChainsForOld.find(c => c.id.toString() === selectedRuleChainIdForOld)?.name || `ID ${selectedRuleChainIdForOld}`}
                    onConfirm={() => { setShowDryRunModalLegacy(false); actuallyExecuteRuleChainOld(); }}
                    onCancel={() => { setShowDryRunModalLegacy(false); toast.info("规则链执行已取消。"); setChainDryRunResultForOld(null); }}
                    appConfig={appConfigFromContext}
                    predefinedTaskLabels={predefinedTaskLabels}
                />
            )}
        </div>
    );
};

export default ChapterProcessorPage;