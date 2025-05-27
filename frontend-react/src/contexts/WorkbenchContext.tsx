// frontend-react/src/contexts/WorkbenchContext.tsx
import React, { createContext, useState, useContext, ReactNode, useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import {
    Novel,
    Chapter,
    RuleChain,
    RuleChainCreate,
    RuleChainExecuteRequest,
    RuleChainExecuteResponse,
    TextProcessRequest,
    TextProcessResponse,
    AdaptationPlanResponse,
    AdaptationGoalRequest,
    RuleChainDryRunResponse,
    executeRuleChainAndStream,
    executeRuleChain as apiExecuteRuleChain,
    parseAdaptationGoal,
    StreamChunk,
    StreamChunkActualData,
    getApplicationConfig,
    ApplicationConfig,
    UserDefinedLLMConfig,
    getLLMProviderTags,
    getRuleChainById,
    processTextWithLLM, // 用于通用的文本处理API
} from '../services/api';

// 假设 MaterialSnippet 定义在您的 WorkbenchContext.tsx 文件中或从其他地方导入
// 如果 MaterialSnippet 仅与 AdaptationWorkbenchPage.tsx 相关，则不需要在此定义
export interface MaterialSnippet {
    id: string;
    type: 'text' | 'image' | 'chain_result' | 'user_note'; // 示例类型
    content: string;
    sourceDescription?: string; // 例如 "章节 X 段落 Y" 或 "AI生成于 ZZZ"
    timestamp: Date;
    tags?: string[];
}

export interface WorkbenchVersion { // 版本快照类型
    id: string;
    name: string;
    content: string; // 通常是HTML或处理后的文本
    timestamp: Date;
    // 可以添加其他元数据，如基于哪个源版本、使用的规则链ID等
}


// --- 状态接口定义 ---
export interface WorkbenchContextState {
    currentNovel: Novel | null;
    currentChapter: Chapter | null;
    sourceText: string; // 用于规则链执行或通用文本处理的源文本
    referenceContent: string;
    referenceTitle: string;
    materials: MaterialSnippet[];

    // 规则链执行相关
    currentRuleChain: RuleChain | null;
    isLoadingChain: boolean; // 专门用于规则链加载和执行
    isStreamingChain: boolean; // 专门用于规则链流式状态
    chainExecutionResult: RuleChainExecuteResponse | RuleChainDryRunResponse | null;
    streamedChunks: StreamChunk[];
    finalStreamedOutput: string;
    chainError: string | null; // 专门用于规则链的错误信息

    // 单任务文本处理相关 (新分离的状态)
    singleTaskResult: TextProcessResponse | null;
    isProcessingSingleTask: boolean;
    singleTaskError: string | null;

    // 改编规划相关
    adaptationPlanAnalysis: AdaptationPlanResponse | null;
    isAnalyzingPlan: boolean; // 专门用于规划分析的加载状态
    planAnalysisError: string | null; // 专门用于规划分析的错误

    // 应用全局配置
    appConfig: ApplicationConfig | null;
    availableLLMModels: UserDefinedLLMConfig[];
    providerTags: string[];
    isLoadingConfig: boolean; // 应用配置加载状态
}

// --- 方法接口定义 ---
export interface WorkbenchContextType extends WorkbenchContextState {
    selectNovel: (novel: Novel | null) => void;
    selectChapter: (chapter: Chapter | null) => void;
    setSourceText: (text: string) => void;
    setReferenceContent: (content: string, title?: string) => void;
    addMaterialSnippet: (snippet: Omit<MaterialSnippet, 'id' | 'timestamp'>) => void;
    deleteMaterialSnippet: (snippetId: string) => void;
    updateMaterialSnippetTags: (snippetId: string, tags: string[]) => void;
    clearMaterials: () => void;

    loadRuleChainForEditing: (chainId: number) => Promise<RuleChain | null>;
    executeChain: (
        payloadOverride?: Partial<Omit<RuleChainExecuteRequest, 'rule_chain_id' | 'rule_chain_definition' | 'stream' | 'source_text'>>,
        stream?: boolean
    ) => Promise<void>;
    clearChainResults: () => void; // 重命名以更清晰

    // 单任务文本处理方法
    processTextWithTask: (request: TextProcessRequest) => Promise<TextProcessResponse | null>;
    clearSingleTaskResult: () => void; // 新增

    // 改编规划方法
    analyzeAdaptationGoal: (request: AdaptationGoalRequest) => Promise<AdaptationPlanResponse | null>;
    setAdaptationPlanAnalysis: (plan: AdaptationPlanResponse | null) => void;
    clearPlanAnalysis: () => void; // 新增

    reloadAppConfig: () => Promise<void>;
}


const WorkbenchContext = createContext<WorkbenchContextType | undefined>(undefined);

export const WorkbenchProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // --- 状态实现 ---
    const [currentNovel, setCurrentNovel] = useState<Novel | null>(null);
    const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
    const [sourceText, setSourceText] = useState<string>('');
    const [referenceContent, setReferenceContent] = useState<string>('');
    const [referenceTitle, setReferenceTitle] = useState<string>('');
    const [materials, setMaterials] = useState<MaterialSnippet[]>([]);

    const [currentRuleChain, setCurrentRuleChain] = useState<RuleChain | null>(null);
    const [isLoadingChain, setIsLoadingChain] = useState<boolean>(false);
    const [isStreamingChain, setIsStreamingChain] = useState<boolean>(false);
    const [chainExecutionResult, setChainExecutionResult] = useState<RuleChainExecuteResponse | RuleChainDryRunResponse | null>(null);
    const [streamedChunks, setStreamedChunks] = useState<StreamChunk[]>([]);
    const [finalStreamedOutput, setFinalStreamedOutput] = useState<string>('');
    const [chainError, setChainError] = useState<string | null>(null);

    // 新分离的单任务处理状态
    const [singleTaskResult, setSingleTaskResult] = useState<TextProcessResponse | null>(null);
    const [isProcessingSingleTask, setIsProcessingSingleTask] = useState<boolean>(false);
    const [singleTaskError, setSingleTaskError] = useState<string | null>(null);

    const [adaptationPlanAnalysis, setAdaptationPlanAnalysis] = useState<AdaptationPlanResponse | null>(null);
    const [isAnalyzingPlan, setIsAnalyzingPlan] = useState<boolean>(false);
    const [planAnalysisError, setPlanAnalysisError] = useState<string | null>(null);


    const [appConfig, setAppConfig] = useState<ApplicationConfig | null>(null);
    const [availableLLMModels, setAvailableLLMModels] = useState<UserDefinedLLMConfig[]>([]);
    const [providerTags, setProviderTags] = useState<string[]>([]);
    const [isLoadingConfig, setIsLoadingConfig] = useState<boolean>(true);

    // --- 方法实现 ---
    const selectNovel = useCallback((novel: Novel | null) => {
        setCurrentNovel(novel);
        setCurrentChapter(null);
        setSourceText(novel ? '' : ''); // 清空或根据业务逻辑设置默认
        setReferenceContent('', '');
        clearChainResults();
        clearSingleTaskResult();
        clearPlanAnalysis();
        setCurrentRuleChain(null);
    }, []); // 依赖项中不需要添加 clearXXX 方法，因为它们是稳定的 useCallback

    const selectChapter = useCallback((chapter: Chapter | null) => {
        setCurrentChapter(chapter);
        if (chapter) {
            setSourceText(chapter.content);
            setReferenceContent(chapter.content, `章节: ${chapter.title || `ID ${chapter.id}`}`);
        }
        clearChainResults();
        clearSingleTaskResult();
        // clearPlanAnalysis(); // 切换章节是否清空规划分析结果，取决于业务逻辑
    }, []); // 依赖项

    const addMaterialSnippet = useCallback((snippetData: Omit<MaterialSnippet, 'id' | 'timestamp'>) => {
        const newSnippet: MaterialSnippet = {
            ...snippetData,
            id: `material-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            timestamp: new Date(),
        };
        setMaterials(prev => [newSnippet, ...prev]);
        toast.success("素材已添加到工作台！");
    }, []);

    const deleteMaterialSnippet = useCallback((snippetId: string) => {
        setMaterials(prev => prev.filter(s => s.id !== snippetId));
        toast.info("素材已移除。");
    }, []);

    const updateMaterialSnippetTags = useCallback((snippetId: string, tags: string[]) => {
        setMaterials(prev => prev.map(s => s.id === snippetId ? { ...s, tags } : s));
    }, []);

    const clearMaterials = useCallback(() => setMaterials([]), []);

    const loadRuleChainForEditing = useCallback(async (chainId: number): Promise<RuleChain | null> => {
        setIsLoadingChain(true); setChainError(null);
        try {
            if (chainId === -1) { // 特殊值用于清空
                setCurrentRuleChain(null);
                clearChainResults();
                toast.info("已清空当前选中的规则链。");
                return null;
            }
            const chain = await getRuleChainById(chainId);
            setCurrentRuleChain(chain);
            // setSourceText(''); // 加载链时不一定清空源文本，让用户决定
            clearChainResults();
            toast.success(`规则链 "${chain.name}" 已加载。`);
            return chain;
        } catch (error) {
            const msg = `加载规则链 (ID: ${chainId}) 失败: ${(error as Error).message}`;
            toast.error(msg); setChainError(msg);
            setCurrentRuleChain(null);
            return null;
        } finally {
            setIsLoadingChain(false);
        }
    }, []); // clearChainResults 是稳定的回调，不需要加入依赖

    const executeChain = useCallback(async (
        payloadOverride?: Partial<Omit<RuleChainExecuteRequest, 'rule_chain_id' | 'rule_chain_definition' | 'stream' | 'source_text'>>,
        stream: boolean = false
    ) => {
        if (!currentRuleChain) { toast.error("请先加载一个规则链。"); return; }
        if (!sourceText.trim() && !payloadOverride?.source_text?.trim()) { // 同时检查覆盖的源文本
             toast.warn("源文本不能为空。"); return;
        }

        setIsLoadingChain(true); setIsStreamingChain(stream);
        setChainExecutionResult(null); setStreamedChunks([]); setFinalStreamedOutput(''); setChainError(null);

        const finalSourceText = payloadOverride?.source_text || sourceText;

        const basePayload: RuleChainExecuteRequest = {
            source_text: finalSourceText,
            novel_id: payloadOverride?.novel_id || currentNovel?.id || 0,
            rule_chain_id: currentRuleChain.id,
            stream: stream,
            dry_run: payloadOverride?.dry_run || false,
            user_provided_params: payloadOverride?.user_provided_params || {},
        };

        try {
            if (stream && !basePayload.dry_run) {
                let accumulatedOutput = '';
                await executeRuleChainAndStream(
                    basePayload,
                    (chunk) => {
                        setStreamedChunks(prev => [...prev, chunk]);
                        if (chunk.type === 'final_output' && typeof chunk.data.final_text === 'string') {
                            setFinalStreamedOutput(chunk.data.final_text);
                            accumulatedOutput = chunk.data.final_text; // 确保最终输出
                        } else if (chunk.type === 'step_result' && typeof chunk.data.output_snippet === 'string') {
                            // 可以在这里累积，但通常 final_output 更可靠
                        }
                    },
                    (error) => {
                        setChainError(error.message); toast.error(`流式处理错误: ${error.message}`);
                        setIsLoadingChain(false); setIsStreamingChain(false);
                    },
                    () => { // onComplete
                        setIsLoadingChain(false); setIsStreamingChain(false);
                        toast.success("规则链流式执行完成。");
                        // 构建一个类似非流式的结果对象
                        setChainExecutionResult({
                            original_text: finalSourceText,
                            final_output_text: accumulatedOutput, // 使用累积的最终输出
                            executed_chain_id: currentRuleChain.id,
                            executed_chain_name: currentRuleChain.name,
                            steps_results: streamedChunks
                                .filter(c => c.type === 'step_result')
                                .map(c => c.data as RuleChainExecuteResponse['steps_results'][0]), // 更准确的类型
                            total_execution_time: streamedChunks.find(c=>c.type === 'final_usage_info')?.data.total_execution_time, // 尝试从流中获取
                        });
                    }
                );
            } else {
                const result = await apiExecuteRuleChain(basePayload);
                setChainExecutionResult(result);
                toast.success(basePayload.dry_run ? '规则链预执行分析完成。' : '规则链执行成功！');
                setIsLoadingChain(false);
            }
        } catch (error: any) {
            const msg = error.message || '执行规则链时发生未知错误';
            setChainError(msg); toast.error(msg);
            setIsLoadingChain(false); setIsStreamingChain(false);
            if (!stream) {
                setChainExecutionResult({
                    original_text: finalSourceText, final_output_text: `错误: ${msg}`,
                    executed_chain_id: currentRuleChain.id, executed_chain_name: currentRuleChain.name,
                    steps_results: [], error_message: msg,
                });
            }
        }
    }, [currentRuleChain, sourceText, currentNovel]);

    const clearChainResults = useCallback(() => {
        setChainExecutionResult(null);
        setStreamedChunks([]);
        setFinalStreamedOutput('');
        setChainError(null);
    }, []);

    // 实现新分离的单任务处理方法
    const processTextWithTask = useCallback(async (request: TextProcessRequest): Promise<TextProcessResponse | null> => {
        setIsProcessingSingleTask(true); setSingleTaskError(null); setSingleTaskResult(null);
        try {
            const result = await processTextWithLLM(request);
            setSingleTaskResult(result);
            toast.success(`文本处理任务 "${request.task}" 完成！`);
            return result;
        } catch (error) {
            const msg = `执行任务 "${request.task}" 失败: ${(error as Error).message}`;
            setSingleTaskError(msg); toast.error(msg);
            // 返回一个包含错误信息的对象，方便调用方判断
            return {
                original_text: request.text,
                processed_text: `处理失败: ${msg}`,
                task_used: request.task,
                model_used: request.model_id,
                error: msg // 添加一个明确的error字段
            } as TextProcessResponse;
        } finally {
            setIsProcessingSingleTask(false);
        }
    }, []);

    const clearSingleTaskResult = useCallback(() => {
        setSingleTaskResult(null);
        setSingleTaskError(null);
    }, []);


    const analyzeAdaptationGoal = useCallback(async (request: AdaptationGoalRequest): Promise<AdaptationPlanResponse | null> => {
        setIsAnalyzingPlan(true); setPlanAnalysisError(null); setAdaptationPlanAnalysis(null);
        try {
            const result = await parseAdaptationGoal(request);
            setAdaptationPlanAnalysis(result);
            toast.success("改编目标解析完成！");
            return result;
        } catch (error) {
            const msg = `改编规划分析失败: ${(error as Error).message}`;
            setPlanAnalysisError(msg); toast.error(msg);
            return null;
        } finally {
            setIsAnalyzingPlan(false);
        }
    }, []);
    
    const clearPlanAnalysis = useCallback(() => {
        setAdaptationPlanAnalysis(null);
        setPlanAnalysisError(null);
    }, []);


    const reloadAppConfig = useCallback(async () => {
        setIsLoadingConfig(true);
        try {
            const configData = await getApplicationConfig();
            setAppConfig(configData);
            setAvailableLLMModels(configData.llm_settings?.available_models?.filter(m => m.enabled && configData.llm_providers[m.provider_tag]?.enabled) || []);
            const tags = await getLLMProviderTags();
            setProviderTags(tags || []);
            // toast.success("应用配置已刷新。"); // 初始加载时不提示
        } catch (error) {
            toast.error(`加载应用配置失败: ${(error as Error).message}`);
        } finally {
            setIsLoadingConfig(false);
        }
    }, []);

    useEffect(() => {
        reloadAppConfig();
    }, [reloadAppConfig]);


    const contextValue: WorkbenchContextType = {
        currentNovel, selectNovel,
        currentChapter, selectChapter,
        sourceText, setSourceText,
        referenceContent, setReferenceContent,
        referenceTitle,
        materials, addMaterialSnippet, deleteMaterialSnippet, updateMaterialSnippetTags, clearMaterials,

        currentRuleChain, loadRuleChainForEditing,
        executeChain,
        isLoadingChain, // 规则链加载/执行状态
        isStreamingChain, // 规则链流式状态
        chainExecutionResult,
        streamedChunks, finalStreamedOutput, chainError,
        clearChainResults,

        // 单任务处理
        singleTaskResult, isProcessingSingleTask, singleTaskError,
        processTextWithTask,
        clearSingleTaskResult,

        // 改编规划
        adaptationPlanAnalysis, setAdaptationPlanAnalysis, // 允许外部设置结果
        isAnalyzingPlan, planAnalysisError,
        analyzeAdaptationGoal,
        clearPlanAnalysis,

        appConfig, availableLLMModels, providerTags,
        isLoadingConfig, // 应用配置加载状态
        reloadAppConfig,
    };

    return (
        <WorkbenchContext.Provider value={contextValue}>
            {children}
        </WorkbenchContext.Provider>
    );
};

export const useWorkbenchContext = (): WorkbenchContextType => {
    const context = useContext(WorkbenchContext);
    if (context === undefined) {
        throw new Error('useWorkbenchContext 必须在 WorkbenchProvider 内部使用');
    }
    return context;
};