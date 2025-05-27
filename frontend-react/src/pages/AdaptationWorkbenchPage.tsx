// frontend-react/src/pages/AdaptationWorkbenchPage.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo, ChangeEvent as ReactChangeEvent } from 'react'; // ReactChangeEvent 用于区分 AntD 的 ChangeEvent
import { toast } from 'react-toastify';
import ReactQuill, { Quill } from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import DOMPurify from 'dompurify';
import {
    Layout,
    Card,
    Input,
    Button,
    Typography,
    Space,
    Divider,
    Spin,
    Modal,
    Tooltip,
    Result,
    Row,
    Col,
    Empty,
    Select as AntSelect, // 使用 AntD Select
    Popover, // 用于更复杂的帮助提示
    Segmented, // 用于布局模式切换
    List as AntList, // 用于版本历史
    Menu, // 用于面板操作
    Dropdown,
} from 'antd';
import {
    LayoutDashboardOutlined,
    ExperimentOutlined,
    EditOutlined,
    BookOutlined,
    CodeOutlined,
    PlayCircleOutlined,
    ClearOutlined,
    AppstoreAddOutlined,
    InfoCircleOutlined,
    SaveOutlined,
    ClockCircleOutlined,
    PlusCircleOutlined,
    DeleteOutlined,
    ArrowsAltOutlined,
    ShrinkOutlined,
    MoreOutlined,
    CopyOutlined,
    EyeOutlined,
    TagsOutlined,
    MessageOutlined,
    FileTextOutlined, // 用于素材类型
    MenuOutlined, // 用于拖拽手柄
    ApartmentOutlined, // 用于规则链图标
} from '@ant-design/icons';

import {
    DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { useDroppable } from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';

// 导入工作台上下文 (深度集成，规则链执行核心)
import { useWorkbenchContext, MaterialSnippet, WorkbenchVersion } from '../contexts/WorkbenchContext';

// API 服务和类型
import {
    RuleChain,
    RuleChainCreate,
    getRuleChains,
    // ApplicationConfig 和 UserDefinedLLMConfig 现在从 WorkbenchContext 获取
} from '../services/api';

// 子组件
import MaterialSnippetCard from '../components/MaterialSnippetCard'; // 保持，但 props 会更新
import FullContentModal from '../components/FullContentModal';     // 保持
import RuleChainList from '../components/RuleChainList';          // AntD 版本
import LLMResultDisplay from '../components/LLMResultDisplay';      // AntD 版本，消费 context

// 样式
import pageStyles from './PageStyles.module.css';
import styles from './AdaptationWorkbenchPage.module.css';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// --- 类型定义 ---
interface DraggableMaterialSnippet extends MaterialSnippet {
    isPlaceholder?: boolean;
}
interface ReactSelectOption { value: string; label: string; title?: string; } // 保留用于可能的内部选择逻辑

// --- 主组件 ---
const AdaptationWorkbenchPage: React.FC = () => {
    const {
        sourceText, setSourceText,
        referenceContent, referenceTitle,
        materials, addMaterialSnippet, deleteMaterialSnippet, updateMaterialSnippetTags, clearMaterials,
        currentNovel, // 如果工作台需要感知当前小说上下文
        currentRuleChain, loadRuleChainForEditing, // setSelectedRuleChain 已被 loadRuleChainForEditing 替代部分功能
        executeChain, // 包含流式和非流式逻辑
        isLoading: isExecutingChain, // 上下文中的 isLoading 代表规则链执行状态
        isStreaming,
        chainExecutionResult,
        streamedChunks,
        finalStreamedOutput,
        llmError,
        clearResults,
        appConfig, // 从上下文获取
        availableLLMModels, // 从上下文获取
        // 以下是您版本中与版本快照相关的，我们将它们保留在页面状态中，因为它们与UI交互更紧密
        // versions, setVersions, currentVersion, setCurrentVersion, addVersion
    } = useWorkbenchContext();

    // --- 编辑器与版本快照状态 (保留在页面，因为它们与UI直接交互) ---
    const [editorContentHtml, setEditorContentHtml] = useState<string>(sourceText || ''); // Quill 编辑器的 HTML 内容，与 sourceText 同步
    const quillRef = useRef<ReactQuill>(null);
    const editorContainerRef = useRef<HTMLDivElement>(null);

    const [versions, setVersions] = useState<WorkbenchVersion[]>([]); // 页面管理自己的版本列表
    const [currentVersion, setCurrentVersion] = useState<WorkbenchVersion | null>(null);
    const [newVersionName, setNewVersionName] = useState<string>('');
    const [versionToCompareA, setVersionToCompareA] = useState<WorkbenchVersion | null>(null);
    const [versionToCompareB, setVersionToCompareB] = useState<WorkbenchVersion | null>(null);
    const [isComparisonModalOpen, setIsComparisonModalOpen] = useState<boolean>(false);
    const [isSavingVersion, setIsSavingVersion] = useState<boolean>(false);

    // --- 素材拖拽与显示状态 (保留) ---
    const [activeId, setActiveId] = useState<string | null>(null);
    const [isDraggingMaterial, setIsDraggingMaterial] = useState<boolean>(false);
    const [viewingSnippet, setViewingSnippet] = useState<MaterialSnippet | null>(null);
    const [showHelp, setShowHelp] = useState<boolean>(false);
    const [activeFullscreenPanel, setActiveFullscreenPanel] = useState<'source' | 'reference' | 'execution' | 'versions' | null>(null);

    // --- 规则链选择相关状态 (新增，使用AntD) ---
    const [isRuleChainModalOpen, setIsRuleChainModalOpen] = useState(false);
    const [allAvailableChains, setAllAvailableChains] = useState<RuleChain[]>([]);
    const [isChainListLoading, setIsChainListLoading] = useState(false);

    // --- dnd-kit Hooks (保留) ---
    const sensors = useSensors(useSensor(PointerSensor));
    const { setNodeRef: setEditorDroppableRef, isOver: isEditorDroppableOver } = useDroppable({ id: 'workbench-editor' });

    // --- 虚拟化列表 Hooks (保留) ---
    const materialListParentRef = useRef<HTMLDivElement>(null);
    const materialRowVirtualizer = useVirtualizer({
        count: materials.length,
        getScrollElement: () => materialListParentRef.current,
        estimateSize: () => 70, // MaterialSnippetCard AntD 版本估算高度
        overscan: 5,
    });
    const versionHistoryParentRef = useRef<HTMLDivElement>(null);
    const versionRowVirtualizer = useVirtualizer({
        count: versions.length,
        getScrollElement: () => versionHistoryParentRef.current,
        estimateSize: () => 45, // 版本项 AntD List.Item 估算高度
        overscan: 8,
    });


    // --- Effect Hooks ---
    // 同步编辑器内容: sourceText (context) <-> editorContentHtml (local) <-> Quill
    useEffect(() => {
        // 当上下文的 sourceText 变化时，更新本地 HTML 状态和 Quill 编辑器
        if (sourceText !== editorContentHtml && quillRef.current) {
            const editor = quillRef.current.getEditor();
            const currentEditorHTML = editor.root.innerHTML;
            const sourceTextSanitized = DOMPurify.sanitize(sourceText || '');
            if (currentEditorHTML !== sourceTextSanitized) {
                editor.root.innerHTML = sourceTextSanitized; // 用清理后的HTML更新Quill
            }
            setEditorContentHtml(sourceTextSanitized); // 更新本地HTML状态
        } else if (sourceText !== editorContentHtml && !quillRef.current) {
            // 如果 Quill 还未初始化，仅更新本地HTML状态
            setEditorContentHtml(DOMPurify.sanitize(sourceText || ''));
        }
    }, [sourceText]); // 仅依赖 sourceText (来自 context)

    // Quill 编辑器初始化
    useEffect(() => {
        if (editorContainerRef.current && !quillRef.current && !isLoadingMaterialsOrVersions) { // 确保在主要数据加载完成后初始化
            const quill = new Quill(editorContainerRef.current, {
                theme: 'snow',
                modules: { toolbar: [ /* ... (保持您的工具栏配置) ... */ ]},
                placeholder: "输入或拖拽素材开始..."
            });
            quillInstanceRef.current = quill;
            // 初始化时，如果 editorContentHtml 有内容 (可能来自 context 的 sourceText)，则设置
            if (editorContentHtml) {
                 const editorInitialContent = DOMPurify.sanitize(editorContentHtml);
                 quill.root.innerHTML = editorInitialContent;
            }

            quill.on('text-change', (delta, oldDelta, source) => {
                if (source === 'user') {
                    const currentHtml = quill.root.innerHTML;
                    setEditorContentHtml(currentHtml); // 更新本地HTML状态
                    setSourceText(currentHtml); // 更新上下文的sourceText
                }
            });
        }
        // Quill 实例的清理通常由React卸载DOM时自动处理，或在其父容器卸载时手动destroy
    }, [isLoadingMaterialsOrVersions, setSourceText]); // 依赖isLoading确保在非加载时初始化


    // --- 事件处理函数 ---
    const handleDragStart = useCallback((event: DragStartEvent) => {
        setActiveId(event.active.id as string);
        setIsDraggingMaterial(true);
    }, []);

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null); setIsDraggingMaterial(false);
        if (!over || over.id !== 'workbench-editor' || !quillRef.current) return;

        const draggedSnippet = materials.find(s => `material-${s.id}` === active.id);
        if (draggedSnippet) {
            const quill = quillRef.current.getEditor();
            const range = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
            // AntD 风格的嵌入（或保持您之前的HTML嵌入）
            const snippetHtml = `
                <div class="ant-alert ant-alert-info material-snippet-embed" data-snippet-id="${DOMPurify.sanitize(draggedSnippet.id)}" contenteditable="false" style="margin: 8px 0; padding: 8px 12px; border-radius: 4px;">
                    <div class="ant-alert-icon"><InfoCircleOutlined /></div>
                    <div class="ant-alert-content">
                        <div class="ant-alert-message" style="font-weight:500;">素材: ${DOMPurify.sanitize(draggedSnippet.sourceDescription || '未知来源')} (${DOMPurify.sanitize(draggedSnippet.type || '通用')})</div>
                        <div class="ant-alert-description" style="font-size:0.9em; color:#555;">${DOMPurify.sanitize(draggedSnippet.content.substring(0, 100) + (draggedSnippet.content.length > 100 ? '...' : ''))}</div>
                    </div>
                </div><p><br></p>`;
            quill.clipboard.dangerouslyPasteHTML(range.index, snippetHtml, 'user');
            quill.setSelection(quill.getLength(), 0, 'silent');
            const newEditorHtml = quill.root.innerHTML;
            setEditorContentHtml(newEditorHtml);
            setSourceText(newEditorHtml);
        }
    }, [materials, setSourceText]);

    // 版本管理 (使用页面状态，setVersions, currentVersion, setCurrentVersion, addVersion 需在此实现或从 props 传入)
    const handleSaveVersion = useCallback(async () => {
        if (!newVersionName.trim()) { toast.warn("请输入版本名称。"); return; }
        const currentHtml = quillRef.current ? quillRef.current.getEditor().root.innerHTML : editorContentHtml;
        if (!currentHtml.trim() || currentHtml === "<p><br></p>") { toast.warn("编辑器内容为空。"); return; }
        setIsSavingVersion(true);
        // 模拟异步保存
        await new Promise(resolve => setTimeout(resolve, 500));
        const newVersion: WorkbenchVersion = {
            id: `version-${Date.now()}`,
            name: newVersionName,
            content: currentHtml,
            timestamp: new Date(),
        };
        setVersions(prev => [newVersion, ...prev]); // 新版本放前面
        setCurrentVersion(newVersion);
        toast.success(`版本 "${newVersionName}" 已保存。`);
        setNewVersionName('');
        setIsSavingVersion(false);
    }, [newVersionName, editorContentHtml, versions, setVersions, setCurrentVersion]); // addVersion 已被内联

    const handleLoadVersion = useCallback((version: WorkbenchVersion) => {
        setCurrentVersion(version); // 这会触发 useEffect 更新 Quill 编辑器
        toast.info(`已加载版本: "${version.name}"`);
    }, [setCurrentVersion]);

    const handleDeleteVersion = useCallback((versionId: string) => {
        if (window.confirm("确定删除此版本吗？")) {
            setVersions(prev => prev.filter(v => v.id !== versionId));
            if (currentVersion?.id === versionId) {
                setCurrentVersion(null); // 如果删除的是当前版本，清空编辑器
                setSourceText('');     // 同时清空上下文的源文本
            }
            toast.success("版本已删除。");
        }
    }, [versions, currentVersion, setCurrentVersion, setVersions, setSourceText]);


    const handleOpenCompareModal = useCallback(() => { /* ... (保留您版本中的逻辑) ... */ }, [versions]);
    const handleViewSnippet = useCallback((snippet: MaterialSnippet) => { setViewingSnippet(snippet); }, []);
    const handleCloseViewSnippetModal = useCallback(() => { setViewingSnippet(null); }, []); // 分开，避免与比较模态框混淆
    const handleCloseCompareModal = useCallback(() => { setIsComparisonModalOpen(false); }, []);


    const quillModules = useMemo(() => ({ toolbar: [ /* ... (您的工具栏配置) ... */ ] }), []);
    const activeMaterialSnippet = useMemo(() => materials.find(s => `material-${s.id}` === activeId), [activeId, materials]);

    // --- 规则链处理相关 (使用 AntD) ---
    const handleOpenRuleChainModalAnt = async () => {
        setIsRuleChainModalOpen(true); setIsChainListLoading(true);
        try {
            const chainsData = await getRuleChains({ page: 1, page_size: 1000, is_template: false });
            setAllAvailableChains(chainsData.items || []);
        } catch (error) { toast.error('加载规则链列表失败。'); }
        finally { setIsChainListLoading(false); }
    };

    const handleSelectRuleChainForExecAnt = async (chainId: number) => {
        setIsRuleChainModalOpen(false);
        if (currentRuleChain?.id === chainId) { toast.info("该规则链已加载。"); return; }
        toast.info(`正在加载规则链 (ID: ${chainId})...`);
        try {
            const loadedChain = await loadRuleChainForEditing(chainId); // 这个方法会更新上下文的 currentRuleChain
            if (!loadedChain) throw new Error("加载失败");
            toast.success(`规则链 "${loadedChain.name}" 已就绪。`);
        } catch (error) { toast.error(`加载规则链失败: ${(error as Error).message}`); }
    };

    const handleExecuteChainAnt = useCallback(() => {
        const currentHtmlForExec = quillRef.current ? quillRef.current.getEditor().root.innerHTML : editorContentHtml;
        if (!currentHtmlForExec.trim() || currentHtmlForExec === "<p><br></p>") { toast.warn('编辑器内容为空。'); return; }
        if (!currentRuleChain) { toast.warn('请先选择一个规则链。'); return; }
        
        setSourceText(currentHtmlForExec); // 确保上下文源文本最新
        executeChain({ novel_id: currentNovel?.id }, true); // stream: true。novel_id从context取
    }, [currentNovel, currentRuleChain, editorContentHtml, executeChain, setSourceText]);

    const applyLLMResultToEditorAnt = useCallback((textToApply: string) => {
        if (quillRef.current) {
            const editor = quillRef.current.getEditor();
            const currentLength = editor.getLength();
            // 插入内容，并在前后添加空行以分隔
            const htmlToInsert = `<p><br></p><div class="llm-result-applied" style="background:#f0f8ff; padding:10px; border-left:3px solid #007bff; margin:10px 0;">${DOMPurify.sanitize(textToApply)}</div><p><br></p>`;
            editor.clipboard.dangerouslyPasteHTML(currentLength > 1 ? currentLength : 0, htmlToInsert, 'user');
            const newContent = editor.root.innerHTML;
            setEditorContentHtml(newContent);
            setSourceText(newContent);
            toast.success('AI结果已追加到编辑器。');
        }
    }, [setSourceText]);

    // --- 统一的清空工作台操作 ---
    const handleClearAllWorkbench = () => {
        if (window.confirm("确定要清空工作台吗？这将移除源文本、所有素材和结果。版本快照不会被删除。")) {
            setSourceText(''); // 通过 context 清空源文本，会自动同步到 editorContentHtml
            clearMaterials();  // 通过 context 清空素材
            clearResults();    // 通过 context 清空AI结果
            setSelectedRuleChainForExecution(null); // 清空本地选中的链 (如果 currentRuleChain 在 context 中也应清空)
            if (currentRuleChain && loadRuleChainForEditing) { // 如果上下文中有选中的链，尝试通过加载一个不存在的ID来“清空”它
                 loadRuleChainForEditing(-1).catch(()=>{/*忽略错误*/}); // 或者 context 提供一个 clearSelectedChain 方法
            }
            toast.success('工作台已清空。');
        }
    };

    // --- 全屏切换 ---
    const togglePanelFullscreen = (panelName: 'source' | 'reference' | 'execution' | 'versions') => {
        setActiveFullscreenPanel(prev => prev === panelName ? null : panelName);
    };


    // --- 渲染逻辑 (使用 AntD) ---
    const isLoadingOverall = isLoadingMaterialsOrVersions || isSavingVersion || isChainListLoading || isExecutingChain || isStreaming;

    const quillEditorComponent = useMemo(() => (
        <div className={`${styles.quillEditorContainerAntd} ${isEditorDroppableOver ? styles.editorDroppableOverAntd : ''}`} ref={setEditorDroppableRef}>
            <div ref={editorContainerRef} className={styles.quillEditorInstanceAntd}></div>
        </div>
    ), [isEditorDroppableOver]);

    // 面板头部操作按钮 (通用)
    const panelHeaderActions = (panelKey: 'source' | 'reference' | 'execution' | 'versions', extraActions?: React.ReactNode) => (
        <Space>
            {extraActions}
            <Tooltip title={activeFullscreenPanel === panelKey ? "退出全屏" : "全屏此面板"}>
                <Button
                    type="text"
                    icon={activeFullscreenPanel === panelKey ? <ShrinkOutlined /> : <ArrowsAltOutlined />}
                    onClick={() => togglePanelFullscreen(panelKey)}
                />
            </Tooltip>
        </Space>
    );


    return (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} modifiers={[restrictToWindowEdges]}>
            <Layout className={`${pageStyles.pageLayout} ${styles.workbenchPageContainerAntd} ${activeFullscreenPanel ? styles.fullscreenActivePageAntd : ''}`}>
                <header className={`${pageStyles.pageHeader} ${styles.workbenchHeaderAntd} ${activeFullscreenPanel ? styles.fullscreenHiddenAntd : ''}`}>
                    <Title level={2} className={pageStyles.pageTitle} style={{ margin: 0 }}>
                        <LayoutDashboardOutlined style={{ marginRight: 10 }} /> 改编工作台
                    </Title>
                    <Space>
                        <Button onClick={handleClearAllWorkbench} icon={<ClearOutlined />} disabled={isLoadingOverall}>清空工作台</Button>
                        <Button onClick={() => setShowHelp(!showHelp)} icon={<InfoCircleOutlined />}>{showHelp ? '隐藏帮助' : '帮助'}</Button>
                    </Space>
                </header>
                {showHelp && !activeFullscreenPanel && ( <Alert message="工作台使用说明" description="左侧为素材区，中间为编辑和AI执行区，右侧为版本历史。拖拽素材到编辑器，选择规则链并执行。" type="info" showIcon closable style={{ margin: '0 24px 16px 24px' }} /> )}

                <Content className={`${styles.workbenchLayoutAntd} ${activeFullscreenPanel ? styles.fullscreenModeLayoutAntd : ''}`}>
                    {/* 左侧面板: 素材区 & 参考内容区 */}
                    <Col xs={24} md={24} lg={6}
                         className={`${styles.workbenchPanelAntd} ${styles.leftPanelAntd} ${activeFullscreenPanel && activeFullscreenPanel !== 'reference' ? styles.fullscreenHiddenAntd : ''} ${activeFullscreenPanel === 'reference' ? styles.fullscreenActivePanelAntd : ''}`}
                    >
                        <Card title={<><BookOutlined /> 参考资料</>}
                              className={styles.fixedHeightCardAntd}
                              extra={panelHeaderActions('reference', 
                                  <Tooltip title="刷新参考内容（如果来自章节）">
                                      <Button type="text" icon={<RefreshCw size={14}/>} onClick={() => {
                                          if(currentNovel && currentNovel.chapters && currentNovel.chapters.length > 0 && currentNovel.chapters[0].content) {
                                            setReferenceContent(currentNovel.chapters[0].content, currentNovel.chapters[0].title || "章节1")
                                          } else {
                                            setReferenceContent("暂无参考内容", "参考");
                                          }
                                      }} />
                                  </Tooltip>
                              )}
                              bodyStyle={{ flexGrow: 1, display: 'flex', flexDirection: 'column', padding: '12px' }}
                        >
                            <Title level={5} style={{marginTop:0, marginBottom:8, fontSize:'0.9em', color:'var(--color-muted)'}}>{referenceTitle || "无标题参考"}</Title>
                            <TextArea value={referenceContent || ''} readOnly autoSize={{ minRows: 3, maxRows: 8 }} style={{flexGrow:1, resize:'none', fontSize:'0.85em'}} placeholder="从章节处理器发送或在此手动粘贴参考文本..."/>
                        </Card>
                        <Card title={<><BoxesOutlined /> 可用素材 ({materials.length})</>}
                              className={`${styles.fixedHeightCardAntd} ${styles.materialsCardAntd}`}
                              extra={panelHeaderActions('reference', // 也用 reference key 控制全屏
                                <Popconfirm title="确定清空所有素材吗？" onConfirm={clearMaterials} okText="清空" cancelText="取消" disabled={materials.length === 0}>
                                  <Button type="text" danger icon={<DeleteOutlined />} disabled={materials.length === 0 || isLoadingOverall} />
                                </Popconfirm>
                              )}
                              bodyStyle={{ flexGrow: 1, overflow: 'hidden', padding: 0 }}
                        >
                            <div ref={materialListParentRef} className={styles.virtualListContainerAntd}>
                                {isLoadingMaterialsOrVersions && materials.length === 0 && <div className={styles.panelPlaceholderAntd}><Spin tip="加载素材..." /></div>}
                                {!isLoadingMaterialsOrVersions && materials.length === 0 && !errorMaterialsOrVersions && (<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无素材" style={{paddingTop: '30px'}}/> )}
                                {errorMaterialsOrVersions && <Result status="warning" title="加载素材出错" subTitle={errorMaterialsOrVersions} />}
                                {materials.length > 0 && (
                                    <div style={{ height: `${materialRowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                                        {materialRowVirtualizer.getVirtualItems().map(virtualItem => {
                                            const snippet = materials[virtualItem.index];
                                            return (
                                                <div key={snippet.id} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${virtualItem.size}px`, transform: `translateY(${virtualItem.start}px)`, padding: '4px 8px' }} ref={materialRowVirtualizer.measureElement} data-index={virtualItem.index}>
                                                    <MaterialSnippetCard
                                                        snippet={snippet}
                                                        onViewFullContent={handleViewSnippet}
                                                        onDeleteSnippet={deleteMaterialSnippet}
                                                        onEditTags={() => {/* 标签编辑逻辑 */}} // 待实现
                                                        isEditingTags={false} tempTags="" onTempTagsChange={()=>{}} onSubmitTags={()=>{}} onCancelEditTags={()=>{}}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </Card>
                    </Col>

                    {/* 中间面板: 编辑器与AI执行 */}
                    <Col xs={24} md={24} lg={12}
                         className={`${styles.workbenchPanelAntd} ${styles.centerPanelAntd} ${activeFullscreenPanel && activeFullscreenPanel !== 'source' ? styles.fullscreenHiddenAntd : ''} ${activeFullscreenPanel === 'source' ? styles.fullscreenActivePanelAntd : ''}`}
                    >
                        <Card title={<><EditOutlined /> 工作区内容编辑器</>}
                              className={`${styles.fixedHeightCardAntd} ${styles.editorWrapperCardAntd}`}
                              extra={panelHeaderActions('source', currentVersion && <Tag color="geekblue">当前版本: {currentVersion.name}</Tag>)}
                              bodyStyle={{ flexGrow: 1, display: 'flex', flexDirection: 'column', padding: '12px' }}
                        >
                            {quillEditorComponent}
                        </Card>

                        <Card title={<><BrainCircuit /> AI规则链处理</>}
                              className={`${styles.fixedHeightCardAntd} ${styles.executionCardAntd}`}
                              extra={panelHeaderActions('execution',
                                <Button onClick={handleClearResults} icon={<ClearOutlined />} size="small" disabled={!chainExecutionResult && !llmError && !isExecutingChain && !isStreaming}>清空结果</Button>
                              )}
                              bodyStyle={{ flexGrow: 1, display: 'flex', flexDirection: 'column', padding: '12px' }}
                        >
                             <Space direction="vertical" style={{width:'100%'}}>
                                <Space style={{width:'100%', justifyContent:'space-between'}}>
                                    <AntSelect<string, { value: string; label: string; title?: string; }> // 明确类型
                                        showSearch
                                        placeholder="选择或搜索规则链..."
                                        optionFilterProp="label"
                                        value={currentRuleChain?.id ? String(currentRuleChain.id) : undefined}
                                        loading={isChainListLoading}
                                        style={{flexGrow: 1, minWidth: 200}}
                                        onFocus={!currentRuleChain && allAvailableChains.length === 0 ? handleOpenRuleChainModalAnt : undefined} // 首次聚焦如果列表为空则自动打开模态框
                                        onChange={(value) => { if(value) handleSelectRuleChainForExecAnt(Number(value))}}
                                        dropdownRender={(menu) => (
                                            <>
                                              {menu}
                                              <Divider style={{ margin: '8px 0' }} />
                                              <Button type="text" icon={<AppstoreAddOutlined />} block onClick={handleOpenRuleChainModalAnt} style={{textAlign:'left'}}>
                                                浏览并选择规则链...
                                              </Button>
                                            </>
                                          )}
                                    >
                                        {allAvailableChains.filter(c => !c.is_template).map(c => (
                                            <AntSelect.Option key={c.id} value={String(c.id)} label={c.name} title={c.description || c.name}>
                                                {c.name} {c.novel_id && <Tag>小说专属</Tag>}
                                            </AntSelect.Option>
                                        ))}
                                    </AntSelect>
                                    <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleExecuteChainAnt} loading={isExecutingChain || isStreaming} disabled={!currentRuleChain || !sourceText.trim()}>
                                        {isExecutingChain || isStreaming ? '执行中...' : '执行规则链'}
                                    </Button>
                                </Space>
                            </Space>
                            <div className={styles.resultDisplayScrollContainerAntd}> {/* 新增滚动容器 */}
                                <LLMResultDisplay
                                    onApplyToEditor={applyLLMResultToEditorAnt}
                                    showApplyButton={true}
                                    novelIdContext={currentNovel?.id} // 使用 context 中的 novel
                                />
                            </div>
                        </Card>
                    </Col>

                    {/* 右侧面板: 版本历史 */}
                    <Col xs={24} md={24} lg={6}
                         className={`${styles.workbenchPanelAntd} ${styles.rightPanelAntd} ${activeFullscreenPanel && activeFullscreenPanel !== 'versions' ? styles.fullscreenHiddenAntd : ''} ${activeFullscreenPanel === 'versions' ? styles.fullscreenActivePanelAntd : ''}`}
                    >
                         <Card title={<><ClockCircleOutlined /> 版本快照 ({versions.length})</>}
                               className={`${styles.fixedHeightCardAntd} ${styles.versionsCardAntd}`}
                               extra={panelHeaderActions('versions', 
                                <Button type="dashed" icon={<PlusCircleOutlined />} size="small" onClick={handleSaveVersion} loading={isSavingVersion} disabled={isLoadingOverall || !newVersionName.trim()}>
                                    {isSavingVersion ? "保存中..." : "保存当前版本"}
                                </Button>
                               )}
                               bodyStyle={{ flexGrow: 1, display: 'flex', flexDirection: 'column', padding: '12px' }}
                        >
                             <Input value={newVersionName} onChange={(e) => setNewVersionName(e.target.value)} placeholder="输入新版本名称..." style={{marginBottom: 12}} disabled={isSavingVersion || isLoadingOverall}/>
                             <div ref={versionHistoryParentRef} className={styles.virtualListContainerAntd}>
                                {isLoadingMaterialsOrVersions && versions.length === 0 && <div className={styles.panelPlaceholderAntd}><Spin tip="加载版本..." /></div>}
                                {!isLoadingMaterialsOrVersions && versions.length === 0 && (<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无版本快照" style={{paddingTop: '30px'}}/>)}
                                {versions.length > 0 && (
                                    <div style={{ height: `${versionRowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                                        {versionRowVirtualizer.getVirtualItems().map(virtualRow => {
                                            const version = versions.slice().reverse()[virtualRow.index]; // 最新的在最前
                                            const isCurrent = currentVersion?.id === version.id;
                                            return (
                                                <div key={version.id} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)`, padding: '0 4px' }} ref={versionRowVirtualizer.measureElement} data-index={virtualRow.index}>
                                                     <AntList.Item className={`${styles.versionListItemAntd} ${isCurrent ? styles.activeVersionAntd : ''}`}>
                                                        <AntList.Item.Meta
                                                            title={<Button type="link" onClick={() => handleLoadVersion(version)} disabled={isLoadingOverall} className={styles.versionNameButtonAntd}>{version.name}</Button>}
                                                            description={<Text type="secondary" style={{fontSize:'0.8em'}}>{new Date(version.timestamp).toLocaleString([], {dateStyle:'short', timeStyle:'short'})}</Text>}
                                                        />
                                                        <Space>
                                                            {versions.length >= 2 && <Button size="small" type="text" icon={<MoreOutlined />} onClick={handleOpenCompareModal} title="与其他版本比较"/>}
                                                            <Popconfirm title="确定删除此版本吗？" onConfirm={() => handleDeleteVersion(version.id)} okText="删除" cancelText="取消">
                                                                <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={isLoadingOverall || isSavingVersion}/>
                                                            </Popconfirm>
                                                        </Space>
                                                    </AntList.Item>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            {versions.length >= 2 && (
                                <Button onClick={handleOpenCompareModal} icon={<Compare size={14}/>} block style={{marginTop:12}} disabled={isLoadingOverall}>
                                    版本内容比较
                                </Button>
                            )}
                        </Card>
                    </Col>
                </Content>

                {/* 拖拽覆盖层 (与您的版本一致) */}
                <DragOverlay>{activeId && activeMaterialSnippet ? (<div className={styles.dragOverlayItemWrapperAntd}><MaterialSnippetCard snippet={activeMaterialSnippet} isDragging={true} onEditTags={()=>{}} isEditingTags={false} tempTags="" onTempTagsChange={()=>{}} onSubmitTags={()=>{}} onCancelEditTags={()=>{}} /></div>) : null}</DragOverlay>
                
                {/* 模态框 (查看素材详情、版本比较、规则链选择 - 使用 AntD Modal) */}
                {viewingSnippet && <FullContentModal snippet={viewingSnippet} onClose={handleCloseViewSnippetModal} />}
                <Modal title={<Space><Compare size={18}/>版本比较</Space>} open={isComparisonModalOpen} onCancel={handleCloseCompareModal} footer={null} width={900} bodyStyle={{minHeight: 400, display:'flex', flexDirection:'column'}}>
                    <Space style={{marginBottom:16}}>
                        <AntSelect value={versionToCompareA?.id || undefined} onChange={(value) => setVersionToCompareA(versions.find(v => v.id === value) || null)} style={{width:300}} placeholder="选择版本A" options={versions.map(v=>({label:v.name, value:v.id}))} />
                        <Text strong>对比</Text>
                        <AntSelect value={versionToCompareB?.id || undefined} onChange={(value) => setVersionToCompareB(versions.find(v => v.id === value) || null)} style={{width:300}} placeholder="选择版本B" options={versions.map(v=>({label:v.name, value:v.id}))} />
                    </Space>
                    <Row gutter={16} style={{flexGrow:1}}>
                        <Col span={12} style={{display:'flex', flexDirection:'column'}}><Card title={versionToCompareA?.name || "版本A"} style={{flexGrow:1}} bodyStyle={{overflowY:'auto', height:'calc(100% - 56px)'}}><ReactQuill value={DOMPurify.sanitize(versionToCompareA?.content || '')} readOnly theme="bubble" modules={{toolbar:false}}/></Card></Col>
                        <Col span={12} style={{display:'flex', flexDirection:'column'}}><Card title={versionToCompareB?.name || "版本B"} style={{flexGrow:1}} bodyStyle={{overflowY:'auto', height:'calc(100% - 56px)'}}><ReactQuill value={DOMPurify.sanitize(versionToCompareB?.content || '')} readOnly theme="bubble" modules={{toolbar:false}}/></Card></Col>
                    </Row>
                </Modal>
                <Modal title="选择规则链" open={isRuleChainModalOpen} onCancel={() => setIsRuleChainModalOpen(false)} footer={null} width={800} destroyOnClose>
                    <Spin spinning={isChainListLoading} tip="加载中...">
                        <RuleChainList ruleChains={allAvailableChains.filter(c => !c.is_template)} isLoading={isChainListLoading} onSelectChain={handleSelectRuleChainForExecAnt} isSelectMode={true} />
                    </Spin>
                </Modal>
            </Layout>
        </DndContext>
    );
};

export default AdaptationWorkbenchPage;