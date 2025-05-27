// frontend-react/src/pages/AdaptationPlannerPage.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
    Layout,
    Typography,
    Form,
    Input,
    Button,
    Select,
    Spin,
    Alert,
    Breadcrumb,
    Card,
    Row,
    Col,
    Space,
    Tooltip,
    Modal,
    Divider,
    List as AntList, // 使用 AntD List
    Tag, Popconfirm,
} from 'antd';
import {
    SaveOutlined,
    ArrowLeftOutlined,
    BulbOutlined,
    LoadingOutlined,
    InfoCircleOutlined,
    PlusCircleOutlined,
    EditOutlined,
    RobotOutlined,
    ApartmentOutlined,
    HomeOutlined,
    BookOutlined,
    RedoOutlined,
    ExperimentOutlined,
    FileTextOutlined,
} from '@ant-design/icons';

// API 服务和类型
import {
    getNovelById,
    Novel,
    getAdaptationPlanById,
    createAdaptationPlan,
    updateAdaptationPlan,
    AdaptationPlan,
    AdaptationPlanCreate,
    AdaptationPlanUpdate,
    AdaptationPlanResponse as ApiAdaptationPlanResponse,
    AdaptationGoalRequest,
    RuleChain,
    RuleChainCreate,
    TextProcessRequest, // 需要导入
    PredefinedTaskEnum, // 需要导入
    // ApplicationConfig, UserDefinedLLMConfig 从 WorkbenchContext 获取
} from '../services/api';

// 工作台上下文
import { useWorkbenchContext } from '../contexts/WorkbenchContext';

// 子组件 (如果需要)
// import RuleChainList from '../components/RuleChainList';
// import LLMResultDisplay from '../components/LLMResultDisplay';

// 样式
import pageStyles from './PageStyles.module.css';
import styles from './AdaptationPlannerPage.module.css';

const { Content } = Layout;
const { Title, Paragraph, Text, Link: AntLink } = Typography; // AntLink 用于文本链接
const { Option } = Select;
const { TextArea } = Input;

// --- 类型定义 ---
interface AdaptationPlannerPageParams extends Record<string, string | undefined> { novelId: string; planId?: string; }
// 表单数据类型，与 AdaptationPlanCreate/Update 的字段对应
interface AdaptationPlanFormData {
    title: string;
    target_audience?: string | null;
    adaptation_format?: string | null;
    main_themes_focus?: string | null;
    key_elements_to_preserve?: string | null;
    key_elements_to_omit_or_change?: string | null;
    character_arc_adjustments?: string | null;
    plot_modifications?: string | null;
    tone_and_style?: string | null;
    additional_notes?: string | null;
    novel_id: number; // 确保 novel_id 存在
}

// --- 主组件 ---
const AdaptationPlannerPage: React.FC = () => {
    const { novelId: novelIdParam, planId: planIdParam } = useParams<AdaptationPlannerPageParams>();
    const navigate = useNavigate();
    const [form] = Form.useForm<AdaptationPlanFormData>();

    const {
        currentNovel, selectNovel,
        sourceText, setSourceText, // 用于AI目标分析的主要输入文本
        analyzeAdaptationGoal, // 用于分析整个改编目标
        processTextWithTask,   // 用于为特定字段生成建议
        adaptationPlanAnalysis, setAdaptationPlanAnalysis, clearPlanAnalysis,
        isAnalyzingPlan, planAnalysisError, // 规划分析的加载和错误状态
        singleTaskResult, isProcessingSingleTask, singleTaskError, clearSingleTaskResult, // 单任务处理的状态
        appConfig,
        availableLLMModels,
    } = useWorkbenchContext();

    // --- 页面状态 ---
    const [novelForPlanner, setNovelForPlanner] = useState<Novel | null>(currentNovel);
    const [initialPlanJson, setInitialPlanJson] = useState<string>(''); // 用于比较表单是否改动
    const [isLoadingPage, setIsLoadingPage] = useState<boolean>(true);
    const [isSavingPlan, setIsSavingPlan] = useState<boolean>(false);
    const [pageError, setPageError] = useState<string | null>(null);

    const [isAiSuggestionModalOpen, setIsAiSuggestionModalOpen] = useState(false);
    const [aiSuggestionModelId, setAiSuggestionModelId] = useState<string | null>(null);
    const [aiSuggestionPromptForField, setAiSuggestionPromptForField] = useState(''); // 用户为特定字段输入的额外提示
    const [targetFieldForAISuggestion, setTargetFieldForAISuggestion] = useState<keyof AdaptationPlanFormData | null>(null);

    const parsedNovelId = useMemo(() => novelIdParam ? parseInt(novelIdParam, 10) : null, [novelIdParam]);
    const parsedPlanId = useMemo(() => planIdParam ? parseInt(planIdParam, 10) : null, [planIdParam]);
    const isEditing = Boolean(parsedPlanId);

    const enabledUserModelsForSelect = useMemo(() => {
        if (!appConfig || !availableLLMModels) return [];
        return availableLLMModels
            .filter(m => m.enabled && appConfig.llm_providers[m.provider_tag]?.enabled)
            .map(m => ({
                value: m.user_given_id,
                label: `${m.user_given_name} (${m.provider_tag})`,
            }));
    }, [availableLLMModels, appConfig]);

    // --- 数据加载与同步 ---
    const loadPageData = useCallback(async () => {
        setIsLoadingPage(true); setPageError(null);
        if (!parsedNovelId) {
            setPageError("无效的小说ID。"); setIsLoadingPage(false); return;
        }
        try {
            if (!novelForPlanner || novelForPlanner.id !== parsedNovelId) {
                const novelData = await getNovelById(parsedNovelId);
                setNovelForPlanner(novelData);
                selectNovel(novelData);
            } else if (currentNovel && novelForPlanner?.id !== currentNovel.id && novelForPlanner?.id === parsedNovelId) {
                selectNovel(novelForPlanner);
            }

            if (isEditing && parsedPlanId) {
                const planApiData = await getAdaptationPlanById(parsedNovelId, parsedPlanId);
                const formData = convertPlanApiToFormData(planApiData);
                form.setFieldsValue(formData);
                setInitialPlanJson(JSON.stringify(formData));
            } else {
                const defaultTitle = novelForPlanner ? `《${novelForPlanner.title}》的新改编计划` : '新改编计划';
                const newPlanBase: AdaptationPlanFormData = {
                    title: defaultTitle, novel_id: parsedNovelId,
                    target_audience: '', adaptation_format: '', main_themes_focus: '',
                    key_elements_to_preserve: '', key_elements_to_omit_or_change: '',
                    character_arc_adjustments: '', plot_modifications: '',
                    tone_and_style: '', additional_notes: '',
                };
                form.setFieldsValue(newPlanBase);
                setInitialPlanJson(JSON.stringify(newPlanBase));
            }

            if (appConfig && !aiSuggestionModelId) {
                const defaultModel = appConfig.llm_settings.task_model_preference?.[PredefinedTaskEnum.PLANNING_GENERATE_DRAFT] ||
                                     appConfig.llm_settings.default_model_id ||
                                     enabledUserModelsForSelect[0]?.value;
                setAiSuggestionModelId(defaultModel || null);
            }
        } catch (err) {
            const msg = (err as Error).message || "加载改编规划器数据失败。";
            setPageError(msg); toast.error(msg);
        } finally {
            setIsLoadingPage(false);
        }
    }, [parsedNovelId, parsedPlanId, isEditing, novelForPlanner, currentNovel, selectNovel, form, appConfig, enabledUserModelsForSelect, aiSuggestionModelId]);

    useEffect(() => { loadPageData(); }, [loadPageData]);

    const convertPlanApiToFormData = (planApi: AdaptationPlan): AdaptationPlanFormData => ({
        title: planApi.title,
        novel_id: planApi.novel_id,
        target_audience: planApi.target_audience || '',
        adaptation_format: planApi.adaptation_format || '',
        main_themes_focus: planApi.main_themes_focus || '',
        key_elements_to_preserve: planApi.key_elements_to_preserve || '',
        key_elements_to_omit_or_change: planApi.key_elements_to_omit_or_change || '',
        character_arc_adjustments: planApi.character_arc_adjustments || '',
        plot_modifications: planApi.plot_modifications || '',
        tone_and_style: planApi.tone_and_style || '',
        additional_notes: planApi.additional_notes || '',
    });

    const isPlanDirty = useMemo(() => {
        const currentFormData = form.getFieldsValue(true);
        return JSON.stringify(currentFormData) !== initialPlanJson;
    }, [form, initialPlanJson]); // 依赖 form 实例和 initialPlanJson

    // --- 事件处理 ---
    const handleSavePlan = async () => {
        try {
            const values = await form.validateFields();
            if (!parsedNovelId) { toast.error("小说ID无效。"); return; }
            setIsSavingPlan(true);
            const payload = { ...values, novel_id: parsedNovelId };
            Object.keys(payload).forEach(key => {
                if (payload[key as keyof typeof payload] === '') {
                    (payload as any)[key] = null;
                }
            });

            let savedPlan: AdaptationPlan;
            if (isEditing && parsedPlanId) {
                savedPlan = await updateAdaptationPlan(parsedNovelId, parsedPlanId, payload as AdaptationPlanUpdate);
            } else {
                savedPlan = await createAdaptationPlan(parsedNovelId, payload as AdaptationPlanCreate);
            }
            const newFormData = convertPlanApiToFormData(savedPlan);
            form.setFieldsValue(newFormData);
            setInitialPlanJson(JSON.stringify(newFormData));
            toast.success(`改编计划 "${savedPlan.title}" 已保存！`);
            if (!isEditing && savedPlan.id) {
                navigate(`/novels/${parsedNovelId}/adaptation-plans/edit/${savedPlan.id}`, { replace: true });
            }
        } catch (errInfo: any) {
            if (errInfo && errInfo.errorFields) {
                 toast.error("表单校验失败，请检查输入。");
            } else {
                toast.error(`保存失败: ${(errInfo as Error).message || '未知错误。'}`);
            }
        } finally {
            setIsSavingPlan(false);
        }
    };

    const handleOpenAISuggestionModal = (fieldName?: keyof AdaptationPlanFormData) => {
        clearSingleTaskResult(); // 清空上次单任务结果
        setTargetFieldForAISuggestion(fieldName || null);
        if (fieldName) {
            const fieldMeta = formFieldsMeta.find(f => f.name === fieldName);
            setAiSuggestionPromptForField(''); // 清空用户提示
        } else {
            setAiSuggestionPromptForField(''); // 清空用户提示
        }
        setIsAiSuggestionModalOpen(true);
    };

    const handleExecuteAISuggestion = async () => {
        if (!novelForPlanner) { toast.error("请先关联小说。"); return; }
        if (!appConfig || !aiSuggestionModelId) { toast.error("AI配置或模型选择不完整。"); return; }

        if (targetFieldForAISuggestion) { // 为特定字段生成建议
            const fieldMeta = formFieldsMeta.find(f => f.name === targetFieldForAISuggestion);
            const currentFieldValue = form.getFieldValue(targetFieldForAISuggestion) || '';
            const requestForField: TextProcessRequest = {
                text: currentFieldValue,
                task: PredefinedTaskEnum.CUSTOM_INSTRUCTION,
                custom_instruction: `请为改编计划中的字段 "${fieldMeta?.label || targetFieldForAISuggestion}" 提供一些具体、有创意的填写建议。字段的当前内容是：“${currentFieldValue}”。用户的额外提示或期望是：“${aiSuggestionPromptForField}”。请直接输出建议的文本内容，使其可以直接填充到该字段。`,
                model_id: aiSuggestionModelId,
            };
            const fieldSuggestionResult = await processTextWithTask(requestForField); // 调用上下文方法
            if (fieldSuggestionResult && fieldSuggestionResult.processed_text && !fieldSuggestionResult.error) {
                form.setFieldsValue({ [targetFieldForAISuggestion]: fieldSuggestionResult.processed_text });
                toast.success(`已为字段 "${fieldMeta?.label}" 生成建议并填充。`);
                setIsAiSuggestionModalOpen(false);
            } else {
                toast.error(fieldSuggestionResult?.error || "AI未能为该字段生成有效建议。");
            }
        } else { // 为整个计划分析并生成草稿/推荐
            if (!sourceText.trim()) {
                toast.warn("请在“AI改编目标分析”文本框中输入您的整体改编目标描述。");
                return;
            }
            const goalRequest: AdaptationGoalRequest = {
                goal_description: sourceText,
                novel_id: novelForPlanner.id,
                // model_id: aiSuggestionModelId, // 后端规划服务会自行选择模型
            };
            const analysisResult = await analyzeAdaptationGoal(goalRequest);
            if (analysisResult) { // analyzeAdaptationGoal 内部已处理 toast
                // 如果有 parsed_goal，可以尝试智能填充表单
                if (analysisResult.parsed_goal) {
                    const updatedFormData = { ...form.getFieldsValue(true) };
                    let fieldsUpdated = false;
                    Object.entries(analysisResult.parsed_goal).forEach(([key, value]) => {
                        if (value && key in updatedFormData && typeof (updatedFormData as any)[key] === 'string') {
                           (updatedFormData as any)[key] = String(value);
                            fieldsUpdated = true;
                        }
                    });
                     if(analysisResult.planner_log && analysisResult.planner_log.length > 0) {
                        const currentNotes = updatedFormData.additional_notes || "";
                        updatedFormData.additional_notes = `${currentNotes}\n\n--- AI规划日志与建议 ---\n${analysisResult.planner_log.join('\n')}`.trim();
                        fieldsUpdated = true;
                    }
                    if (fieldsUpdated) {
                        form.setFieldsValue(updatedFormData);
                        setInitialPlanJson(JSON.stringify(updatedFormData)); // 更新基线，因为是AI填充的
                        toast.info("AI已根据分析结果尝试填充部分计划字段。");
                    }
                }
                 setIsAiSuggestionModalOpen(false); // 如果是为整个计划生成，完成后也关闭通用模态框
            }
        }
    };

    const handleNavigateToRuleChainEditor = (chainDraft: RuleChainCreate) => {
        if (!parsedNovelId) { toast.error("当前规划未关联小说，无法创建小说专属规则链。"); return; }
        navigate(`/rule-chains/edit/new?fromPlanner=true&novelId=${parsedNovelId}`, { state: { initialDraft: chainDraft, source: 'planner' } });
    };

    const formFieldsMeta: Array<{
        name: keyof AdaptationPlanFormData;
        label: string;
        tooltip: string;
        placeholder: string;
        isTextArea?: boolean;
        rows?: number;
        span?: number;
    }> = [
        { name: 'title', label: '计划标题', tooltip: '为您的改编计划起一个明确的标题。', placeholder: '例如：《魔戒》改编为赛博朋克风格动画系列', span: 24 },
        { name: 'adaptation_format', label: '改编形式', tooltip: '目标作品的媒介形式，如电影、电视剧、游戏等。', placeholder: '例如：动画电影, 真人短剧系列', span: 12 },
        { name: 'target_audience', label: '目标受众', tooltip: '描述改编作品主要面向的观众群体。', placeholder: '例如：青少年 (12-18岁), 科幻爱好者', span: 12 },
        { name: 'main_themes_focus', label: '核心主题与侧重点', tooltip: '希望在改编中突出和强调的核心主题或情感。', placeholder: '例如：强调反抗与自由，侧重探讨科技伦理', isTextArea: true, rows: 3, span: 24 },
        { name: 'key_elements_to_preserve', label: '关键保留元素', tooltip: '列出原著中必须保留的核心设定、情节或角色。', placeholder: '例如：主角的标志性武器，某个经典场景，特定世界观规则', isTextArea: true, rows: 3, span: 24 },
        { name: 'key_elements_to_omit_or_change', label: '关键删改元素', tooltip: '指出原著中计划省略、合并或进行较大改动的部分。', placeholder: '例如：删减部分次要角色线，修改故事结局的情感基调', isTextArea: true, rows: 3, span: 24 },
        { name: 'character_arc_adjustments', label: '角色弧光调整', tooltip: '描述主要角色的成长轨迹或性格变化在改编中需要做出的调整。', placeholder: '例如：主角A的成长线提前，配角B的动机更加复杂化', isTextArea: true, rows: 4, span: 24 },
        { name: 'plot_modifications', label: '情节结构调整', tooltip: '说明改编后故事大纲、关键转折点与原著的主要差异。', placeholder: '例如：采用三幕式结构，增加新的开端引入悬念，结局改为开放式', isTextArea: true, rows: 5, span: 24 },
        { name: 'tone_and_style', label: '基调与风格', tooltip: '描述改编作品的整体情感基调和视觉/叙事风格。', placeholder: '例如：整体基调更为黑暗写实，采用非线性叙事，视觉风格参考《银翼杀手》', isTextArea: true, rows: 3, span: 24 },
        { name: 'additional_notes', label: '其他备注', tooltip: '任何与改编相关的其他思考、约束条件或市场考虑。', placeholder: '例如：预算限制，目标上线平台，希望避免的常见套路等', isTextArea: true, rows: 3, span: 24 },
    ];

    // --- 渲染逻辑 ---
    if (isLoadingPage) {
        return <div className={pageStyles.pageLoadingContainer}><Spin size="large" tip="加载改编规划器..." /></div>;
    }
    if (pageError) {
        return (<Layout className={pageStyles.pageLayout}><Content className={pageStyles.pageContent}><Alert message="加载错误" description={pageError} type="error" showIcon closable onClose={() => setPageError(null)} action={<Button onClick={loadPageData} icon={<RedoOutlined />}>重试</Button>}/></Content></Layout>);
    }
    if (!novelForPlanner && !isLoadingPage) {
        return (<Layout className={pageStyles.pageLayout}><Content className={pageStyles.pageContent}><Alert message="未找到小说" description="无法加载此改编规划所属的小说信息。请确保小说ID正确。" type="warning" action={<Button onClick={() => navigate("/novels")}>返回小说列表</Button>} /></Content></Layout>);
    }

    return (
        <Layout className={pageStyles.pageLayout}>
            <Breadcrumb className={pageStyles.breadcrumb}>
                <Breadcrumb.Item><RouterLink to="/"><HomeOutlined /> 首页</RouterLink></Breadcrumb.Item>
                <Breadcrumb.Item><RouterLink to="/novels"><BookOutlined /> 小说管理</RouterLink></Breadcrumb.Item>
                {novelForPlanner && <Breadcrumb.Item><RouterLink to={`/novels/${novelForPlanner.id}`}>{novelForPlanner.title}</RouterLink></Breadcrumb.Item>}
                <Breadcrumb.Item>{isEditing ? '编辑改编计划' : '新建改编计划'}</Breadcrumb.Item>
            </Breadcrumb>

            <Content className={pageStyles.pageContent}>
                <div className={pageStyles.titleBar}>
                    <Title level={2} className={pageStyles.pageTitle}>
                        <BulbOutlined style={{ color: 'var(--ant-primary-color)' }} /> {isEditing ? `编辑改编计划: ${form.getFieldValue('title') || '加载中...'}` : '新建改编计划'}
                    </Title>
                    <Space>
                        <Button onClick={() => navigate(isEditing && parsedNovelId && parsedPlanId ? `/novels/${parsedNovelId}/adaptation-plans` : (parsedNovelId ? `/novels/${parsedNovelId}`: '/novels'))} icon={<ArrowLeftOutlined />}>
                            {isEditing ? "返回计划列表" : "返回小说详情"}
                        </Button>
                        <Button type="primary" icon={<SaveOutlined />} onClick={handleSavePlan} loading={isSavingPlan} disabled={isSavingPlan || isLoadingPage || !isPlanDirty}>
                            {isSavingPlan ? '保存中...' : (isEditing ? (isPlanDirty ? '保存更改' : '已保存') : '创建计划')}
                        </Button>
                    </Space>
                </div>
                <Paragraph className={pageStyles.pageDescription}>
                    为小说 <Text strong>《{novelForPlanner?.title || '未知'}》</Text> 制定详细的改编计划。您可以在下方填写各个维度的改编思路，或使用AI辅助生成建议。
                </Paragraph>

                <Card title={<Space><RobotOutlined /> AI 改编目标分析与规则链建议</Space>} className={styles.aiAnalysisCard}
                     extra={<Button type="primary" ghost icon={<ExperimentOutlined />} onClick={() => handleOpenAISuggestionModal()} disabled={isAnalyzingPlan || isProcessingSingleTask}>AI分析与建议</Button>}
                >
                    <TextArea
                        rows={5}
                        placeholder="请在此输入您对小说《{novelForPlanner?.title || '当前小说'}》的整体改编目标和期望，例如：“我想将这部奇幻小说改编成一部适合青少年的动画电影剧本，保留核心世界观和主角成长线，但简化部分黑暗情节，增加幽默元素。”AI将尝试解析您的目标并给出建议。"
                        value={sourceText}
                        onChange={(e) => setSourceText(e.target.value)}
                        disabled={isAnalyzingPlan || isProcessingSingleTask}
                        className={styles.goalDescriptionTextArea}
                    />
                     {(isAnalyzingPlan || isProcessingSingleTask) && <div style={{textAlign:'center', marginTop:'10px'}}><Spin tip={isAnalyzingPlan ? "AI分析中..." : "AI处理中..."} /></div>}
                     {planAnalysisError && <Alert message="AI分析出错" description={planAnalysisError} type="error" showIcon style={{marginTop:'10px'}}/>}
                     {singleTaskError && <Alert message="AI建议出错" description={singleTaskError} type="error" showIcon style={{marginTop:'10px'}}/>} {/* 显示单任务错误 */}
                     {adaptationPlanAnalysis && (
                        <div className={styles.analysisResultContainer}>
                            <Divider>AI分析结果</Divider>
                            {adaptationPlanAnalysis.parsed_goal && Object.keys(adaptationPlanAnalysis.parsed_goal).length > 0 && (
                                <Card type="inner" title="解析出的目标要素" size="small">
                                    <AntList
                                        size="small"
                                        dataSource={Object.entries(adaptationPlanAnalysis.parsed_goal).filter(([_, value]) => value && (!Array.isArray(value) || value.length > 0))}
                                        renderItem={([key, value]) => (
                                            <AntList.Item>
                                                <Text strong style={{textTransform:'capitalize'}}>{key.replace(/_/g, ' ')}:</Text> {Array.isArray(value) ? value.join(', ') : String(value)}
                                            </AntList.Item>
                                        )}
                                    />
                                </Card>
                            )}
                            {adaptationPlanAnalysis.recommended_chains && adaptationPlanAnalysis.recommended_chains.length > 0 && (
                                <Card type="inner" title="推荐的规则链模板" size="small" style={{marginTop:16}}>
                                   <AntList
                                        itemLayout="horizontal"
                                        dataSource={adaptationPlanAnalysis.recommended_chains}
                                        renderItem={item => (
                                            <AntList.Item actions={[<Button type="link" size="small" onClick={()=>navigate(`/rule-templates/edit/${item.chain_id}`)}>查看模板</Button>]}>
                                                <AntList.Item.Meta
                                                    avatar={<ApartmentOutlined style={{color: 'var(--ant-primary-color)'}}/>}
                                                    title={<AntLink onClick={()=>navigate(`/rule-templates/edit/${item.chain_id}`)}>{item.chain_name}</AntLink>}
                                                    description={
                                                        <Space direction="vertical" size="small">
                                                            <Text type="secondary" style={{fontSize:'0.85em'}}>{item.description || item.reasoning || '无更多描述'}</Text>
                                                            <Tag>相关度: {item.relevance_score.toFixed(2)}</Tag>
                                                        </Space>
                                                    }
                                                />
                                            </AntList.Item>
                                        )}
                                    />
                                </Card>
                            )}
                            {adaptationPlanAnalysis.generated_chain_draft && (
                                <Card type="inner" title="AI生成的规则链草稿" size="small" style={{marginTop:16}}
                                    actions={[
                                        <Button type="primary" icon={<EditOutlined/>} onClick={()=> handleNavigateToRuleChainEditor(adaptationPlanAnalysis.generated_chain_draft!)}>编辑并使用此草稿</Button>
                                    ]}
                                >
                                    <Title level={5}>{adaptationPlanAnalysis.generated_chain_draft.name}</Title>
                                    <Paragraph ellipsis={{rows:2, expandable:true, symbol:"展开描述"}}>描述: {adaptationPlanAnalysis.generated_chain_draft.description || "无描述"}</Paragraph>
                                    <Text strong>步骤数: {adaptationPlanAnalysis.generated_chain_draft.steps?.length || 0}</Text>
                                </Card>
                            )}
                             {adaptationPlanAnalysis.planner_log && adaptationPlanAnalysis.planner_log.length > 0 && (
                                <details style={{marginTop:16, fontSize:'0.9em'}}>
                                    <summary style={{cursor:'pointer', fontWeight:'500'}}>查看AI规划日志</summary>
                                    <pre className={styles.plannerLogPre}>{adaptationPlanAnalysis.planner_log.join('\n')}</pre>
                                </details>
                            )}
                        </div>
                     )}
                </Card>

                <Divider>手动编辑改编计划详情</Divider>
                <Form form={form} layout="vertical" onValuesChange={() => {/*isPlanDirty 会通过 useMemo 更新*/}} onFinish={handleSavePlan} disabled={isSavingPlan || isLoadingPage}>
                    <Row gutter={[24, 16]}>
                        {formFieldsMeta.map(field => (
                            <Col xs={24} sm={field.span || 24} key={field.name}>
                                <Form.Item
                                    name={field.name}
                                    label={
                                        <Space>
                                            {field.label}
                                            <Tooltip title={field.tooltip}><InfoCircleOutlined style={{color:'rgba(0,0,0,0.45)'}}/></Tooltip>
                                        </Space>
                                    }
                                    rules={field.name === 'title' ? [{ required: true, message: '计划标题不能为空!' }] : []}
                                >
                                    {field.isTextArea ? (
                                        <TextArea rows={field.rows || 3} placeholder={field.placeholder} />
                                    ) : (
                                        <Input placeholder={field.placeholder} />
                                    )}
                                </Form.Item>
                                {field.name !== 'title' && novelForPlanner && appConfig && (
                                     <Button type="dashed" icon={<RobotOutlined />} size="small" onClick={() => handleOpenAISuggestionModal(field.name as keyof AdaptationPlanFormData)} style={{marginTop:'-12px', marginBottom:'12px'}} disabled={isAnalyzingPlan || isProcessingSingleTask}>AI建议此项</Button>
                                )}
                            </Col>
                        ))}
                    </Row>
                </Form>
            </Content>

            {/* AI为特定字段生成建议的模态框 */}
            <Modal
                title={<Space><RobotOutlined/>AI为字段 “{formFieldsMeta.find(f=>f.name === targetFieldForAISuggestion)?.label || targetFieldForAISuggestion}” 生成建议</Space>}
                open={isAiSuggestionModalOpen}
                onOk={handleExecuteAISuggestion}
                onCancel={() => { setIsAiSuggestionModalOpen(false); clearSingleTaskResult(); }}
                confirmLoading={isProcessingSingleTask} // 使用单任务的加载状态
                okText="获取建议"
                cancelText="取消"
                width={600}
                destroyOnClose // 关闭时销毁内部组件状态
            >
                <Form layout="vertical">
                    {targetFieldForAISuggestion && <Form.Item label="当前字段内容 (仅供参考)"> <TextArea value={form.getFieldValue(targetFieldForAISuggestion) || ''} readOnly autoSize={{minRows:2, maxRows:4}}/> </Form.Item> }
                    <Form.Item label="选择用于AI建议的LLM模型">
                        <Select
                            value={aiSuggestionModelId}
                            onChange={(value) => setAiSuggestionModelId(value)}
                            options={enabledUserModelsForSelect}
                            placeholder="选择模型或使用默认"
                            style={{width:'100%'}}
                            loading={!appConfig || isLoadingPage} // 页面或配置加载中
                            disabled={!appConfig || enabledUserModelsForSelect.length === 0 || isProcessingSingleTask}
                        />
                    </Form.Item>
                    <Form.Item label="您的额外提示或上下文 (可选)">
                        <TextArea
                            rows={4}
                            value={aiSuggestionPromptForField}
                            onChange={(e) => setAiSuggestionPromptForField(e.target.value)}
                            placeholder={targetFieldForAISuggestion ? `您希望AI在为“${formFieldsMeta.find(f=>f.name === targetFieldForAISuggestion)?.label}”生成建议时额外考虑什么？` : "您对整个计划的AI分析有什么额外要求或提示？"}
                            disabled={isProcessingSingleTask}
                        />
                    </Form.Item>
                    {isProcessingSingleTask && <div style={{textAlign:'center'}}><Spin tip="AI建议生成中..." /></div>}
                    {singleTaskError && <Alert message="AI建议出错" description={singleTaskError} type="error" showIcon style={{marginTop:10}}/>}
                    {singleTaskResult && singleTaskResult.processed_text && (
                        <Alert message="AI建议预览" description={<Paragraph copyable={{tooltips:['复制建议','已复制']}} ellipsis={{rows:5, expandable:true, symbol:"展开"}}>{singleTaskResult.processed_text}</Paragraph>} type="success" showIcon style={{marginTop:10}}/>
                    )}
                </Form>
            </Modal>
        </Layout>
    );
};

export default AdaptationPlannerPage;