// frontend-react/src/pages/PlotVersionEditorPage.tsx
import React, { useState, useEffect, useCallback, useMemo, FormEvent } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import { toast } from 'react-toastify';
import Quill, { DeltaStatic, Sources, RangeStatic } from 'quill'; // 导入 Quill 核心类型
import 'quill/dist/quill.snow.css'; // Quill 编辑器核心样式
import DOMPurify from 'dompurify'; // 用于HTML清理
import Select, { SingleValue, StylesConfig as ReactSelectStylesConfig, GroupBase as ReactSelectGroupBase, OptionProps as ReactSelectOptionProps, components as ReactSelectComponents } from 'react-select'; // 导入 react-select 的类型

// 从 services/api.ts 导入所有需要的类型和API函数
import {
    getNovelById, Novel,
    getPlotBranchById, PlotBranch,
    getPlotVersionById, PlotVersion,
    createPlotVersion, updatePlotVersion, PlotVersionUpdate, // 确保 PlotVersionUpdate 也导入
    ApplicationConfig, getApplicationConfig,
    UserDefinedLLMConfig,
    TextProcessRequest, processTextWithLLM, PredefinedTaskEnum, TextProcessResponse // 添加 TextProcessResponse
} from '../services/api'; //

// 导入页面通用样式和组件特定样式
import pageViewStyles from './PageStyles.module.css'; //
import styles from './PlotVersionEditorPage.module.css'; //

// 引入图标
import {
    Save, ArrowLeft, Brain, Loader, AlertTriangle, Info, PlusCircle, Edit3, Maximize2, Minimize2,
    Settings, ListChecks, ChevronDown, HelpCircle, Lightbulb, SlidersHorizontal, RefreshCw, Cpu, TextSelect, Wand2, Play, X as CloseIcon
} from 'lucide-react'; //

// 如果这些子组件在此文件中定义或从其他地方导入，确保类型正确
// import LLMResultDisplay from '../components/LLMResultDisplay'; // (在此文件中未使用，但保持注释以供参考)
// import EnhancementPreviewModal from '../components/EnhancementPreviewModal'; // (在此文件中未使用)

// React Select 选项类型 (与您上传文件中的定义保持一致)
interface ReactSelectOption {
    value: string; // 通常是 user_given_id
    label: string;
    title?: string; // 用于 tooltip
}

// 帮助提示组件 (与您上传文件中的定义保持一致)
const HelpTooltipStandalone: React.FC<{ text: string }> = ({ text }) => (
    <span className={styles.helpIconWrapperInternal} title={text} style={{ marginLeft: '4px', verticalAlign: 'middle', cursor: 'help' }}>
        <HelpCircle size={13} className={styles.helpIconInternal} style={{ opacity: 0.7 }} />
    </span>
);

// 页面路由参数类型定义
interface PlotVersionEditorPageParams extends Record<string, string | undefined> {
    novelId: string;
    branchId: string;
    versionId?: string; // versionId 是可选的，用于区分创建和编辑模式
}

const PlotVersionEditorPage: React.FC = () => {
    // --- 路由与导航 ---
    const { novelId: novelIdParam, branchId: branchIdParam, versionId: versionIdParam } = useParams<PlotVersionEditorPageParams>(); //
    const navigate = useNavigate(); //

    // --- 核心数据状态 ---
    const [novel, setNovel] = useState<Novel | null>(null); // 当前小说信息
    const [branch, setBranch] = useState<PlotBranch | null>(null); // 当前分支信息
    const [version, setVersion] = useState<Partial<PlotVersion>>({ // 当前版本数据 (创建时为部分，编辑时为完整)
        version_name: '',
        description: '',
        content: '', // 编辑器内容将是 HTML 字符串
    });
    const [initialVersionJson, setInitialVersionJson] = useState<string>(''); // 用于比较内容是否有更改

    // --- UI与加载状态 ---
    const [isLoading, setIsLoading] = useState<boolean>(true); // 页面主要数据加载状态
    const [isSaving, setIsSaving] = useState<boolean>(false);  // 保存操作进行中状态
    const [error, setError] = useState<string | null>(null);    // 页面级错误信息

    // --- 应用配置与模型列表状态 ---
    const [appConfig, setAppConfig] = useState<ApplicationConfig | null>(null); //
    const [userDefinedLLMModels, setUserDefinedLLMModels] = useState<UserDefinedLLMConfig[]>([]); //
    const [isLoadingConfig, setIsLoadingConfig] = useState<boolean>(true); //
    const [loadingConfigError, setLoadingConfigError] = useState<string | null>(null); //
    const [defaultLLMModelId, setDefaultLLMModelId] = useState<string | undefined>(undefined); //

    // --- AI 辅助功能状态 ---
    const [isAISuggestionModalOpen, setIsAISuggestionModalOpen] = useState<boolean>(false); //
    const [aiSuggestionModelId, setAISuggestionModelId] = useState<string | null>(null); // 选中的AI建议模型ID (user_given_id)
    const [aiSuggestionParams, setAISuggestionParams] = useState<Partial<TextProcessRequest>>({}); // AI建议请求参数
    const [aiSuggestionInputText, setAISuggestionInputText] = useState<string>(''); // 提供给AI的输入文本
    const [isProcessingAISuggestion, setIsProcessingAISuggestion] = useState<boolean>(false); // AI建议处理中状态
    const [aiSuggestionResult, setAISuggestionResult] = useState<TextProcessResponse | null>(null); // AI建议结果 (修改类型)
    const [aiSuggestionError, setAISuggestionError] = useState<string | null>(null); // AI建议错误
    const [currentQuillSelection, setCurrentQuillSelection] = useState<RangeStatic | null>(null); // Quill 编辑器当前选区

    // --- Refs ---
    const quillInstanceRef = React.useRef<Quill | null>(null); // Quill 编辑器实例引用
    const editorContainerRef = React.useRef<HTMLDivElement>(null); // 编辑器容器div的引用

    // --- Memoized 值 ---
    const parsedNovelId = useMemo(() => novelIdParam ? parseInt(novelIdParam, 10) : null, [novelIdParam]); //
    const parsedBranchId = useMemo(() => branchIdParam ? parseInt(branchIdParam, 10) : null, [branchIdParam]); //
    const parsedVersionId = useMemo(() => versionIdParam ? parseInt(versionIdParam, 10) : null, [versionIdParam]); //
    const isEditing = useMemo(() => Boolean(parsedVersionId), [parsedVersionId]); // 是否为编辑模式

    // 可用于模型选择的已启用的用户定义模型列表 (React Select 格式)
    const enabledUserModelsForSelect = useMemo((): ReactSelectOption[] => { //
        if (!appConfig || !userDefinedLLMModels) return [];
        return userDefinedLLMModels
            .filter(m => m.enabled && appConfig.llm_providers[m.provider_tag]?.enabled)
            .map(m => ({
                value: m.user_given_id,
                label: `${m.user_given_name} (${m.provider_tag} / ${m.model_identifier_for_api.split('/').pop()?.substring(0,20)}${m.model_identifier_for_api.length > 20 ? '...' : ''})`,
                title: `ID: ${m.user_given_id}, Provider: ${m.provider_tag}, API Model: ${m.model_identifier_for_api}`
            }))
            .sort((a,b) => a.label.localeCompare(b.label));
    }, [userDefinedLLMModels, appConfig]);

    // --- Quill 编辑器初始化 ---
    useEffect(() => { //
        if (editorContainerRef.current && !quillInstanceRef.current && !isLoading) { // 确保在主要数据加载完成后初始化
            const quill = new Quill(editorContainerRef.current, {
                theme: 'snow',
                modules: {
                    toolbar: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        ['link', 'blockquote'], // 移除 image 和 video
                        ['clean']
                    ]
                },
                placeholder: '输入剧情版本详细内容...'
            });

            quill.on('text-change', (delta: DeltaStatic, oldDelta: DeltaStatic, source: Sources) => { //
                if (source === 'user') {
                    // 使用 editor.root.innerHTML 获取HTML内容，而不是 editor.getContents() (Delta)
                    setVersion(prev => ({ ...prev, content: quill.root.innerHTML }));
                }
            });
            
            quill.on('selection-change', (range: RangeStatic | null, oldRange: RangeStatic | null, source: Sources) => { //
                if (range && source === 'user') {
                    const text = quill.getText(range.index, range.length);
                    setAISuggestionInputText(text);
                    setCurrentQuillSelection(range);
                } else if (!range && source === 'user') {
                    setAISuggestionInputText('');
                    setCurrentQuillSelection(null);
                }
            });

            quillInstanceRef.current = quill;
            
            // 加载初始内容 (在主要数据加载后，编辑器初始化时)
            if (version.content && quillInstanceRef.current) {
                const editorCurrentContent = quillInstanceRef.current.root.innerHTML;
                const versionContentSanitized = DOMPurify.sanitize(version.content || ''); // 确保清理
                if (editorCurrentContent !== versionContentSanitized) { // 避免不必要的 setContents
                    quillInstanceRef.current.root.innerHTML = versionContentSanitized;
                }
            }
        }
        // 清理函数，组件卸载时销毁 Quill 实例
        return () => {
            if (quillInstanceRef.current && quillInstanceRef.current.container && editorContainerRef.current) {
                // quillInstanceRef.current = null; // 直接设为null，不再尝试销毁，由React卸载处理
            }
        };
    }, [isLoading, version.content]); // 依赖 isLoading 确保在数据加载后初始化，依赖 version.content 以便在版本切换时重新加载内容

    // --- 数据加载逻辑 ---
    const loadData = useCallback(async () => { //
        setIsLoading(true); setIsLoadingConfig(true);
        setError(null); setLoadingConfigError(null);

        try {
            const config = await getApplicationConfig(); //
            setAppConfig(config);
            setUserDefinedLLMModels(config.llm_settings?.available_models || []);
            const effectiveDefaultModelId = config.llm_settings?.default_model_id || 
                                          (config.llm_settings?.available_models?.find(m => m.enabled && config.llm_providers[m.provider_tag]?.enabled)?.user_given_id);
            setDefaultLLMModelId(effectiveDefaultModelId);
            setAISuggestionModelId(effectiveDefaultModelId || null);
            setIsLoadingConfig(false);
        } catch (err: any) {
            const msg = (err as Error).message || "加载应用核心配置失败。";
            setLoadingConfigError(msg); toast.error(msg, {toastId: "plot-editor-config-load-error"});
            setIsLoadingConfig(false);
        }

        if (!parsedNovelId || !parsedBranchId) {
            setError("无效的小说ID或分支ID。"); setIsLoading(false); return;
        }

        try {
            const [novelData, branchData] = await Promise.all([ // 并行获取小说和分支信息
                getNovelById(parsedNovelId), //
                getPlotBranchById(parsedNovelId, parsedBranchId) //
            ]);
            setNovel(novelData);
            setBranch(branchData);

            if (isEditing && parsedVersionId) { // 编辑模式
                const versionData = await getPlotVersionById(parsedNovelId, parsedBranchId, parsedVersionId); //
                const sanitizedContent = DOMPurify.sanitize(versionData.content || ''); // 清理HTML
                setVersion({ ...versionData, content: sanitizedContent });
                setInitialVersionJson(JSON.stringify({...versionData, content: sanitizedContent })); // 设置初始JSON用于比较
            } else { // 创建新版本模式
                const newVersionBase: Partial<PlotVersion> = {
                    version_name: `新版本 @ ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                    description: '',
                    content: '<p><br></p>', // Quill 空内容通常是这个
                    plot_branch_id: parsedBranchId, // 关联到当前分支
                };
                setVersion(newVersionBase);
                setInitialVersionJson(JSON.stringify(newVersionBase)); // 设置初始JSON
            }
        } catch (err: any) {
            const msg = (err as Error).message || (isEditing ? "加载剧情版本详情失败。" : "加载小说或分支数据失败。");
            setError(msg); toast.error(msg);
        } finally {
            setIsLoading(false);
        }
    }, [parsedNovelId, parsedBranchId, parsedVersionId, isEditing]);

    useEffect(() => { loadData(); }, [loadData]);

    // --- 检查版本内容是否有更改 ---
    const isVersionDirty = useMemo(() => { //
        const currentVersionForCompare: Partial<PlotVersion> = { ...version, plot_branch_id: version.plot_branch_id ?? parsedBranchId };
        let initialVersionObject: Partial<PlotVersion> = {};
        try {
            if (initialVersionJson) initialVersionObject = JSON.parse(initialVersionJson);
        } catch { /* 忽略解析错误 */ }
        const initialVersionForCompare: Partial<PlotVersion> = { ...initialVersionObject, plot_branch_id: (initialVersionObject as PlotVersion).plot_branch_id ?? parsedBranchId };
        return JSON.stringify(currentVersionForCompare) !== JSON.stringify(initialVersionForCompare);
    }, [version, initialVersionJson, parsedBranchId]);

    // --- 处理表单输入变化 ---
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { //
        const { name, value } = e.target;
        setVersion(prev => ({ ...prev, [name]: value }));
    };

    // --- 保存版本内容 ---
    const handleSaveVersion = async (e?: FormEvent) => { //
        if (e) e.preventDefault();
        if (!version.version_name?.trim()) { toast.error("版本名称不能为空。"); return; }
        if (!parsedNovelId || !parsedBranchId) { toast.error("小说ID或分支ID无效。"); return; }
        
        // 从 Quill 实例获取当前 HTML 内容并清理
        const currentHtmlContent = quillInstanceRef.current ? DOMPurify.sanitize(quillInstanceRef.current.root.innerHTML) : (version.content || '');

        setIsSaving(true); setError(null);
        const versionDataToSave: Partial<PlotVersion> = { // 使用 Partial<PlotVersion> 因为创建时不含 id
            ...version,
            content: currentHtmlContent,
            plot_branch_id: parsedBranchId, // 确保分支ID已设置
        };

        try {
            let savedVersion: PlotVersion;
            if (isEditing && parsedVersionId) {
                // 对于更新，需要传递完整的 PlotVersionUpdate 类型（或确保 PlotVersion 兼容）
                // PlotVersion 类型已包含 content，后端 PlotVersionUpdate schema 也应包含 content (如果允许更新)
                savedVersion = await updatePlotVersion(parsedNovelId, parsedBranchId, parsedVersionId, versionDataToSave as PlotVersionUpdate); //
            } else {
                // 对于创建，需要传递 PlotVersionCreate 类型
                // Omit<PlotVersion, 'id' | 'created_at' | 'updated_at' | 'order_in_branch'>; // order_in_branch 是后端处理
                // 确保 versionDataToSave 符合创建时的类型要求 (例如，没有id, created_at, updated_at)
                const createPayload: Omit<PlotVersion, 'id' | 'created_at' | 'updated_at' | 'version_number' | 'chapters_in_version'> = {
                     ...(versionDataToSave as Omit<PlotVersion, 'id' | 'created_at' | 'updated_at' | 'version_number' | 'chapters_in_version'>)
                };
                savedVersion = await createPlotVersion(parsedNovelId, parsedBranchId, createPayload ); //
            }
            const sanitizedSavedContent = DOMPurify.sanitize(savedVersion.content || '');
            setVersion({ ...savedVersion, content: sanitizedSavedContent }); // 更新本地状态为保存后的版本
            setInitialVersionJson(JSON.stringify({...savedVersion, content: sanitizedSavedContent})); // 更新比较基线
            toast.success(`剧情版本 "${savedVersion.version_name}" 已成功保存！`);
            if (!isEditing && savedVersion.id) { // 如果是新建且成功，导航到编辑页面
                navigate(`/novels/${parsedNovelId}/branches/${parsedBranchId}/versions/edit/${savedVersion.id}`, { replace: true });
            }
        } catch (err: any) {
            const msg = (err as Error).message || "保存剧情版本失败。";
            setError(msg); toast.error(`保存失败: ${msg}`);
        } finally {
            setIsSaving(false);
        }
    };
    
    // 检查Quill编辑器内容是否有效为空 (例如仅包含 <p><br></p>)
    const isQuillContentEffectivelyEmpty = (htmlContent: string): boolean => { //
        if (!htmlContent) return true;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        const textContent = tempDiv.textContent || tempDiv.innerText || "";
        return textContent.trim() === "" && htmlContent.toLowerCase() === "<p><br></p>"; // 更精确的空编辑器判断
    };
    
    // --- AI 辅助功能处理逻辑 ---
    const handleOpenAISuggestionModal = (task: PredefinedTaskEnum = PredefinedTaskEnum.SUMMARIZE) => { //
        if (!appConfig) { toast.error("应用配置未加载，无法使用AI功能。"); return; }
        const editor = quillInstanceRef.current;
        let textForAI = aiSuggestionInputText; // 优先使用选中的文本
        if (!textForAI.trim() && editor) { // 如果没有选中，尝试获取编辑器光标附近或全部内容
            const selection = editor.getSelection();
            if (selection && selection.length === 0 && selection.index > 0) { // 光标处，尝试取前后文
                const prevText = editor.getText(Math.max(0, selection.index - 500), 500);
                const nextText = editor.getText(selection.index, 500);
                textForAI = `${prevText}${nextText}`.trim();
            }
            if (!textForAI.trim()) { // 再不行就用全部内容
                textForAI = editor.getText() || (typeof version.content === 'string' ? version.content : '');
            }
        }
        textForAI = textForAI.substring(0, 3000); // 限制AI输入长度

        setAISuggestionParams({
            task: task,
            model_id: aiSuggestionModelId || defaultLLMModelId, // 使用 state 中的 aiSuggestionModelId
            custom_instruction: task === PredefinedTaskEnum.CUSTOM_INSTRUCTION ? '请基于以下文本进行操作：' : undefined,
        });
        setAISuggestionInputText(textForAI);
        setIsAISuggestionModalOpen(true);
        setAISuggestionResult(null); // 清空旧结果
        setAISuggestionError(null);  // 清空旧错误
    };

    const handleExecuteAISuggestion = async () => { //
        if (!appConfig || !aiSuggestionModelId) { toast.error("AI配置或模型选择不完整。"); return; }
        if (!aiSuggestionInputText.trim() && aiSuggestionParams.task !== PredefinedTaskEnum.GENERATE_PLOT_POINTS) {
             toast.warn("AI处理需要输入文本（或选择编辑器中的文本）。"); return;
        }
        setIsProcessingAISuggestion(true); setAISuggestionResult(null); setAISuggestionError(null);
        const request: TextProcessRequest = { // 明确类型
            text: aiSuggestionInputText,
            task: aiSuggestionParams.task || PredefinedTaskEnum.SUMMARIZE,
            model_id: aiSuggestionModelId, // user_given_id
            parameters: aiSuggestionParams.parameters,
            custom_instruction: aiSuggestionParams.custom_instruction,
        };
        try {
            const result = await processTextWithLLM(request); //
            setAISuggestionResult(result); // 结果类型为 TextProcessResponse
            if (result.processed_text && !result.processed_text.toLowerCase().startsWith("错误:")) {
                toast.success("AI建议生成成功！");
            } else {
                toast.error("AI建议处理返回错误或空结果。");
                setAISuggestionError(result.processed_text || "处理失败，LLM未返回有效文本。");
            }
        } catch (err: any) {
            const errorMsg = (err as Error).message || "AI建议生成失败。";
            setAISuggestionError(errorMsg); toast.error(`处理失败: ${errorMsg}`);
        } finally {
            setIsProcessingAISuggestion(false);
        }
    };
    
    const applyAISuggestionToEditor = (textToApply: string) => { //
        if (!quillInstanceRef.current) { toast.error("编辑器未初始化。"); return; }
        const editor = quillInstanceRef.current;
        editor.focus(); // 确保编辑器获得焦点
        const targetRange = currentQuillSelection; // 使用调用AI时的选区
        if (targetRange && typeof targetRange.index === 'number') {
            editor.deleteText(targetRange.index, targetRange.length, Quill.sources.USER); //
            editor.insertText(targetRange.index, textToApply, Quill.sources.USER); //
            editor.setSelection(targetRange.index + textToApply.length, 0, Quill.sources.USER); //
        } else {
            const insertAt = editor.getSelection(true)?.index ?? editor.getLength(); //
            editor.insertText(insertAt, textToApply + '\n', Quill.sources.USER); //
            editor.setSelection(insertAt + textToApply.length + 1, 0, Quill.sources.USER); //
        }
        setVersion(prev => ({ ...prev, content: editor.root.innerHTML })); // 更新主状态
        setIsAISuggestionModalOpen(false); // 关闭模态框
        setAISuggestionResult(null);       // 清空结果
    };

    // --- React Select 自定义样式 ---
    const selectStyles: ReactSelectStylesConfig<ReactSelectOption, false, ReactSelectGroupBase<ReactSelectOption>> = { //
        control: (base, state) => ({ ...base, minHeight: '38px', fontSize: 'var(--font-size-base)', borderColor: state.isFocused ? 'var(--color-primary)' : 'var(--border-color-input)' }),
        menu: (base) => ({ ...base, zIndex: 1060, fontSize: 'var(--font-size-base)' }),
        menuPortal: base => ({ ...base, zIndex: 1060 }), // 确保下拉菜单在模态框之上
        option: (styles, { data, isDisabled, isFocused, isSelected }) => ({ ...styles, backgroundColor: isDisabled ? undefined : isSelected ? 'var(--color-primary)' : isFocused ? 'var(--hover-bg-color)' : undefined, color: isDisabled ? 'var(--color-muted)' : isSelected ? 'white' : 'var(--text-color-base)', cursor: isDisabled ? 'not-allowed' : 'default', whiteSpace: 'normal', wordBreak: 'break-word' }),
    };
    // react-select 自定义 NoOptionsMessage 组件
    const NoOptionsMessage = (props: any) => ( <ReactSelectComponents.NoOptionsMessage {...props}> <span style={{fontSize: '0.85em'}}>{props.selectProps.noOptionsMessage()}</span> </ReactSelectComponents.NoOptionsMessage> );
    // react-select 自定义 Option 组件 (例如添加 title 属性)
    const CustomOption = (props: ReactSelectOptionProps<ReactSelectOption, false, ReactSelectGroupBase<ReactSelectOption>>) => ( <ReactSelectComponents.Option {...props} title={props.data.title || props.label}/> );


    // --- 渲染逻辑 ---
    if (isLoading || (isLoadingConfig && !appConfig)) { // 同时检查主要数据和配置的加载状态
        return <div className={`${pageViewStyles.pageLoadingContainer}`}><Loader size={32} /> 正在加载剧情版本编辑器...</div>;
    }
    // 如果配置加载失败但主要数据已加载，或主要数据加载失败
    if ((loadingConfigError && !appConfig && !isLoading) || (error && (!novel || !branch) && !isLoading)) { //
        return (
            <div className={`${pageViewStyles.pageContainer} ${pageViewStyles.pageErrorContainer}`}>
                <AlertTriangle size={32}/>
                <span>{loadingConfigError || error || "数据加载失败，且配置信息不完整。"}</span>
                <button onClick={loadData} className="btn btn-sm btn-primary" style={{marginTop: 'var(--spacing-md)'}}>
                    <RefreshCw size={14}/> 重试加载
                </button>
                <RouterLink to={`/novels/${novelIdParam || ''}/branches/${branchIdParam || ''}/versions`} className="btn btn-sm btn-secondary" style={{marginTop: 'var(--spacing-sm)'}}>返回版本列表</RouterLink>
            </div>
        );
    }
    if (!novel || !branch) { // 如果主要数据仍然未加载成功
        return <div className={`${pageViewStyles.pageContainer} ${pageViewStyles.pageErrorContainer}`}><Info size={32}/>未找到小说或分支信息。</div>;
    }
    if (!appConfig && !isLoadingConfig) { // 如果配置在重试后仍未加载成功
        return <div className={`${pageViewStyles.pageLoadingContainer}`}><Loader size={32} /> 重要的应用配置数据加载失败，编辑器功能可能受限。正在尝试...</div>;
    }

    return (
        <div className={`${pageViewStyles.pageContainer} ${styles.editorPageContainer}`}>
            {/* 页面头部 */}
            <div className={pageViewStyles.pageHeader}>
                <button onClick={() => navigate(`/novels/${parsedNovelId}/branches/${parsedBranchId}/versions`)} className={`btn btn-sm btn-outline-secondary ${styles.backButton}`} title="返回版本列表">
                    <ArrowLeft size={18} /> 返回版本列表
                </button>
                <h2 className={pageViewStyles.pageTitle}>
                    {isEditing ? <Edit3 size={28} /> : <PlusCircle size={28} />}
                    {isEditing ? `编辑剧情版本: ${version.version_name || '加载中...'}` : '创建新剧情版本'}
                </h2>
                <button onClick={handleSaveVersion} className={`btn btn-sm btn-primary ${styles.saveButton}`} disabled={isSaving || isLoading || !isVersionDirty}>
                    <Save size={16} /> {isSaving ? '保存中...' : (isVersionDirty ? '保存版本' : '已保存')}
                </button>
            </div>
            {/* 小说和分支上下文信息 */}
            <p className={styles.contextInfo}>小说: <strong>《{novel.title}》</strong> / 分支: <strong>{branch.name}</strong></p>
            {/* 错误提示区域 */}
            {error && <div className={`${pageViewStyles.errorMessage} error-message`} style={{marginBottom: 'var(--spacing-md)'}}><AlertTriangle size={16}/> {error}</div>}
            
            {/* 编辑器表单 */}
            <form onSubmit={handleSaveVersion} className={styles.editorForm}>
                {/* 版本名称 */}
                <div className={pageViewStyles.formGroup}>
                    <label htmlFor="version_name_editor">版本名称 <span className={styles.requiredMarker}>*</span>:</label>
                    <input type="text" id="version_name_editor" name="version_name" value={version.version_name || ''} onChange={handleInputChange} className={pageViewStyles.inputField} required disabled={isSaving || isLoading}/>
                </div>
                {/* 版本描述 */}
                <div className={pageViewStyles.formGroup}>
                    <label htmlFor="description_editor">版本描述 (可选):<HelpTooltipStandalone text="简要描述这个剧情版本的主要内容、特点或与其他版本的区别。" /></label>
                    <textarea id="description_editor" name="description" value={version.description || ''} onChange={handleInputChange} rows={3} className={pageViewStyles.textareaField} disabled={isSaving || isLoading}/>
                </div>

                {/* Quill 编辑器 */}
                <div className={pageViewStyles.formGroup}>
                    <label htmlFor="content_editor">版本内容:<HelpTooltipStandalone text="剧情版本的详细文本内容，支持富文本编辑。" /></label>
                    {/* AI工具栏 (按钮组) */}
                    <div className={styles.editorToolbarExtension}> {/* */}
                        <button type="button" onClick={() => handleOpenAISuggestionModal(PredefinedTaskEnum.EXPAND_TEXT)} className="btn btn-xs btn-outline-secondary" disabled={!aiSuggestionInputText.trim() || isProcessingAISuggestion || !appConfig} title="AI扩展选中内容"> <TextSelect size={14}/> 扩展选中 </button> {/* 修改图标 */}
                        <button type="button" onClick={() => handleOpenAISuggestionModal(PredefinedTaskEnum.REWRITE_TEXT)} className="btn btn-xs btn-outline-secondary" disabled={!aiSuggestionInputText.trim() || isProcessingAISuggestion || !appConfig} title="AI改写选中内容"> <RefreshCw size={14}/> 改写选中 </button>
                        <button type="button" onClick={() => handleOpenAISuggestionModal(PredefinedTaskEnum.SUMMARIZE_TEXT)} className="btn btn-xs btn-outline-secondary" disabled={!aiSuggestionInputText.trim() || isProcessingAISuggestion || !appConfig} title="AI总结选中内容"> <ListChecks size={14}/> 总结选中 </button>
                        <button type="button" onClick={() => handleOpenAISuggestionModal(PredefinedTaskEnum.GENERATE_PLOT_POINTS)} className="btn btn-xs btn-outline-secondary" disabled={isProcessingAISuggestion || !appConfig} title="AI生成新的剧情点子"> <Lightbulb size={14}/> 生成点子 </button>
                    </div>
                    {/* 编辑器容器 */}
                    <div ref={editorContainerRef} className={styles.quillEditorContainer}></div> {/* */}
                </div>

                {/* 表单操作按钮 */}
                <div className={styles.formActions}>
                    <button type="submit" className="btn btn-primary" disabled={isSaving || isLoading || !isVersionDirty}>
                        <Save size={16}/> {isSaving ? '保存中...' : (isEditing ? '更新剧情版本' : '创建剧情版本')}
                    </button>
                </div>
            </form>

            {/* AI 建议模态框 */}
            {isAISuggestionModalOpen && ( //
                <div className={pageViewStyles.modalOverlay} data-visible={isAISuggestionModalOpen}>
                    <div className={`${pageViewStyles.modalContent} ${styles.aiModalContentSizing}`}>
                        <div className={pageViewStyles.modalHeader}>
                            <h4><Wand2 size={18}/> AI 辅助内容生成</h4>
                            <button onClick={() => setIsAISuggestionModalOpen(false)} className={pageViewStyles.modalCloseButton} disabled={isProcessingAISuggestion}><CloseIcon size={22} /></button>
                        </div>
                        <div className={pageViewStyles.modalBody}>
                            {/* AI 任务选择 */}
                            <div className={pageViewStyles.formGroup}>
                                <label htmlFor="aiSuggestionTaskModal">AI 任务:</label>
                                <select 
                                    id="aiSuggestionTaskModal" 
                                    className={pageViewStyles.selectField}
                                    value={aiSuggestionParams.task || ''}
                                    onChange={(e) => setAISuggestionParams(prev => ({...prev, task: e.target.value as PredefinedTaskEnum}))}
                                    disabled={isProcessingAISuggestion}
                                >
                                    {/* 动态生成任务选项，可以使用 constants.ts 中的映射 */}
                                    <option value={PredefinedTaskEnum.EXPAND_TEXT}>扩展文本</option>
                                    <option value={PredefinedTaskEnum.REWRITE_TEXT}>改写文本</option>
                                    <option value={PredefinedTaskEnum.SUMMARIZE_TEXT}>总结文本</option>
                                    <option value={PredefinedTaskEnum.GENERATE_PLOT_POINTS}>生成剧情点</option>
                                    <option value={PredefinedTaskEnum.CUSTOM_INSTRUCTION}>自定义指令</option>
                                </select>
                            </div>
                            {/* 模型选择 */}
                            <div className={pageViewStyles.formGroup}>
                                <label htmlFor="aiSuggestionModelSelectModal">选择LLM模型:</label>
                                <Select<ReactSelectOption, false, ReactSelectGroupBase<ReactSelectOption>> // 明确泛型参数
                                    inputId="aiSuggestionModelSelectModal"
                                    options={enabledUserModelsForSelect}
                                    value={enabledUserModelsForSelect.find(opt => opt.value === aiSuggestionModelId) || null}
                                    onChange={(selectedOption) => setAISuggestionModelId(selectedOption ? selectedOption.value : null)} // selectedOption 可以是 null
                                    isClearable
                                    placeholder="选择模型或使用默认..."
                                    isDisabled={isProcessingAISuggestion || enabledUserModelsForSelect.length === 0}
                                    noOptionsMessage={() => enabledUserModelsForSelect.length === 0 ? "无可用模型" : "无匹配项"}
                                    styles={selectStyles} 
                                    components={{ Option: CustomOption, NoOptionsMessage }} // 传递自定义组件
                                    menuPortalTarget={document.body} // 确保下拉菜单在模态框之上
                                />
                            </div>
                            {/* 自定义指令输入 (如果任务是自定义指令) */}
                            {aiSuggestionParams.task === PredefinedTaskEnum.CUSTOM_INSTRUCTION && (
                                <div className={pageViewStyles.formGroup}>
                                    <label htmlFor="aiCustomInstructionModal">自定义指令:</label>
                                    <textarea 
                                        id="aiCustomInstructionModal"
                                        value={aiSuggestionParams.custom_instruction || ''}
                                        onChange={(e) => setAISuggestionParams(prev => ({...prev, custom_instruction: e.target.value}))}
                                        rows={3} className={pageViewStyles.textareaField}
                                        disabled={isProcessingAISuggestion}
                                        placeholder="请输入详细的自定义指令..."
                                    />
                                </div>
                            )}
                            {/* 参考文本输入 */}
                             <div className={pageViewStyles.formGroup}>
                                <label htmlFor="aiSuggestionInputContextModal">参考文本 (AI输入):</label>
                                <textarea 
                                    id="aiSuggestionInputContextModal"
                                    value={aiSuggestionInputText}
                                    onChange={(e) => setAISuggestionInputText(e.target.value)}
                                    rows={5} className={pageViewStyles.textareaField}
                                    disabled={isProcessingAISuggestion}
                                    placeholder="选中的文本或相关上下文将显示在此..."
                                />
                            </div>
                            {/* 加载与错误提示 */}
                            {isProcessingAISuggestion && <div className={pageViewStyles.loadingMessage}><Loader size={18} className="spinning-icon"/> AI处理中...</div>}
                            {aiSuggestionError && <div className={`${pageViewStyles.errorMessage} error-message`}><AlertTriangle size={16}/> {aiSuggestionError}</div>}
                            {/* AI结果预览与应用 */}
                            {aiSuggestionResult && aiSuggestionResult.processed_text && ( // 确保是 TextProcessResponse 结构
                                <div className={styles.aiResultPreviewSection}>
                                    <h5>AI 生成结果预览:</h5>
                                    <div className={styles.aiResultTextPreview}>
                                        { aiSuggestionResult.processed_text }
                                    </div>
                                    <button 
                                        onClick={() => applyAISuggestionToEditor(aiSuggestionResult!.processed_text!)}  // 确保非空
                                        className="btn btn-sm btn-success"
                                        style={{marginTop: 'var(--spacing-sm)'}}
                                    >
                                        应用到编辑器
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className={pageViewStyles.modalFooter}>
                            <button type="button" onClick={() => setIsAISuggestionModalOpen(false)} className="btn btn-sm btn-secondary" disabled={isProcessingAISuggestion}>取消</button>
                            <button type="button" onClick={handleExecuteAISuggestion} className="btn btn-sm btn-primary" disabled={isProcessingAISuggestion || !aiSuggestionModelId}>
                                {isProcessingAISuggestion ? <Loader size={16} className="spinning-icon"/> : <Play size={16}/>}
                                {isProcessingAISuggestion ? '生成中...' : '执行AI生成'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PlotVersionEditorPage;