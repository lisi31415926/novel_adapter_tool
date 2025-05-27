// frontend-react/src/components/PlotBranchManager.tsx
import React, { useState, useEffect, useCallback, FormEvent, useMemo } from 'react';
import { useNavigate } from 'react-router-dom'; //
import { toast } from 'react-toastify';
import {
    Typography,
    Button,
    Space,
    List,
    Card,
    Modal,
    Form,
    Input,
    Select,
    Spin,
    Alert,
    Popconfirm,
    Tooltip,
    Empty,
    Divider,
    Collapse,
    Tag,
    InputNumber,
    Checkbox, // 从 AntD 导入 Checkbox
} from 'antd'; // 统一导入 AntD 组件
import {
    PlusCircleOutlined,
    EditOutlined,
    DeleteOutlined,
    BranchesOutlined,
    ApartmentOutlined,
    EyeOutlined,
    QuestionCircleOutlined,
    FileTextOutlined,
    RobotOutlined,
    SubnodeOutlined,
    ReadOutlined, // 用于“查看内容”
    CopyOutlined, // 用于“以此为模板创建新版本”
} from '@ant-design/icons'; // 使用 AntD 图标

// API Services and Types
import {
    PlotBranch,
    PlotBranchCreate,
    PlotBranchUpdate,
    PlotBranchTypeEnum,
    PlotVersion,
    PlotVersionCreate,
    PlotVersionUpdate,
    PlotVersionStatusEnum,
    AISuggestionRequest,
    getPlotBranchesByNovelId,
    createPlotBranch as apiCreatePlotBranch,
    updatePlotBranch as apiUpdatePlotBranch,
    deletePlotBranch as apiDeletePlotBranch,
    getPlotVersionsByBranchId,
    createPlotVersion as apiCreatePlotVersion,
    updatePlotVersion as apiUpdatePlotVersion,
    deletePlotVersion as apiDeletePlotVersion,
    generateAISuggestedPlotVersion,
    Chapter,
    Event as ApiEvent,
    getChaptersByNovelId,
    getEventsByNovelId,
    PaginatedResponse,
    Novel, // 确保导入 Novel 类型，如果 props 中使用
} from '../services/api';

// Styles
import pageStyles from '../pages/PageStyles.module.css';
import styles from './PlotBranchManager.module.css';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;
const { TextArea } = Input;
const { Panel } = Collapse;

// Helper to map enum to AntD Select options (与 PlotVersionListPage.tsx 中类似)
const mapEnumToOptionsAntd = (enumObj: Record<string, string>, friendlyNames?: Record<string, string>) =>
    Object.entries(enumObj).map(([key, value]) => ({
        label: friendlyNames?.[key] || value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        value: key, // 对于 AntD Select，value 通常是枚举的键 (string)
    }));


// --- PlotBranchManager Props ---
interface PlotBranchManagerProps {
    novel: Novel; // 明确 novel 是必须的
    novelId: number;
    onMajorPlotChange?: () => void;
}

// --- Branch Form Modal Props & Form Values (AntD Form) ---
interface BranchFormValuesAntd extends Omit<PlotBranchCreate, 'branch_type' | 'origin_chapter_id' | 'origin_event_id'> {
    branch_type?: PlotBranchTypeEnum; // AntD Select value is string (enum key)
    origin_chapter_id?: number | null;
    origin_event_id?: number | null;
}
interface BranchFormModalAntdProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: PlotBranchCreate) => Promise<void>;
    initialData?: PlotBranch | null;
    novelId: number;
    isLoading: boolean;
    chaptersForSelect: Chapter[];
    eventsForSelect: ApiEvent[];
}

// --- Version Form Modal Props & Form Values (AntD Form) ---
interface VersionFormValuesAntd extends Omit<PlotVersionCreate, 'status' | 'is_ending' | 'content_summary' | 'plot_branch_id'> {
    status?: PlotVersionStatusEnum; // AntD Select value is string (enum key)
    is_ending?: boolean;
    content_summary?: string; // For TextArea input (JSON string)
    // plot_branch_id 将由父组件或上下文提供，不在此表单中
}
interface VersionFormModalAntdProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: PlotVersionCreate, branchId: number) => Promise<void>;
    initialData?: PlotVersion | null;
    branchId: number | null;
    isLoading: boolean;
}

// --- AI Suggestion Modal Props & Form Values (AntD Form) ---
interface AISuggestionFormValuesAntd {
    user_prompt: string;
    model_id?: string | null;
    parent_version_id?: number | null; // 新增：允许选择父版本
}
interface AISuggestionBranchModalAntdProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: AISuggestionRequest, branchId: number) => Promise<void>;
    branch: PlotBranch | null;
    isLoading: boolean;
    availableLLMModels: { label: string; value: string }[];
    existingVersionsForBranch: PlotVersion[]; // 新增：传递当前分支的现有版本列表
}


// --- BranchFormModal Component (AntD) ---
const BranchFormModalAntd: React.FC<BranchFormModalAntdProps> = ({
    isOpen, onClose, onSubmit, initialData, novelId, isLoading, chaptersForSelect, eventsForSelect
}) => {
    const [form] = Form.useForm<BranchFormValuesAntd>();
    const branchTypeOptions = useMemo(() => mapEnumToOptionsAntd(PlotBranchTypeEnum, {
        [PlotBranchTypeEnum.MAIN_PLOT]: "主线剧情",
        [PlotBranchTypeEnum.SIDE_STORY]: "支线故事",
        [PlotBranchTypeEnum.WHAT_IF]: "What-If 探索",
        [PlotBranchTypeEnum.CHARACTER_ARC]: "角色专属弧光",
        [PlotBranchTypeEnum.ALTERNATE_ENDING]: "备选结局路径",
    }), []);


    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                form.setFieldsValue({
                    ...initialData,
                    branch_type: initialData.branch_type as PlotBranchTypeEnum,
                });
            } else {
                form.resetFields();
                form.setFieldsValue({ branch_type: PlotBranchTypeEnum.MAIN_PLOT });
            }
        }
    }, [initialData, form, isOpen]);

    const handleOk = async () => {
        try {
            const values = await form.validateFields();
            const payload: PlotBranchCreate = {
                name: values.name,
                description: values.description || null,
                branch_type: values.branch_type || PlotBranchTypeEnum.MAIN_PLOT,
                origin_chapter_id: values.origin_chapter_id || null,
                origin_event_id: values.origin_event_id || null,
            };
            await onSubmit(payload);
        } catch (info) {
            console.log('分支表单校验失败:', info);
            toast.warn("请检查表单输入项。");
        }
    };

    return (
        <Modal
            title={initialData ? `编辑剧情分支: ${initialData.name}` : "创建新剧情分支"}
            open={isOpen}
            onOk={handleOk}
            onCancel={onClose}
            confirmLoading={isLoading}
            destroyOnClose
            maskClosable={false}
            width={680} //
        >
            <Form form={form} layout="vertical" name="branch_form_antd">
                <Form.Item
                    name="name"
                    label="分支名称"
                    rules={[{ required: true, message: '请输入分支名称!' }]}
                >
                    <Input placeholder="例如：主角的黑化之路、林中奇遇" />
                </Form.Item>
                <Form.Item name="description" label="分支描述 (可选)">
                    <TextArea rows={3} placeholder="简要描述这个剧情分支的主要内容、主题或探索方向。" />
                </Form.Item>
                <Form.Item
                    name="branch_type"
                    label="分支类型"
                    rules={[{ required: true, message: '请选择分支类型!' }]}
                >
                    <Select placeholder="选择分支类型" options={branchTypeOptions} />
                </Form.Item>
                <Row gutter={16}>
                    <Col span={12}>
                        <Form.Item name="origin_chapter_id" label="起源章节 (可选)" tooltip="此分支从哪个主线章节分叉出去。">
                            <Select placeholder="选择起源章节" allowClear showSearch
                                filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                                options={chaptersForSelect.map(c => ({ label: `Ch. ${c.chapter_index + 1}: ${c.title || `ID ${c.id}`}`, value: c.id }))}
                            />
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        <Form.Item name="origin_event_id" label="起源事件 (可选)" tooltip="此分支由哪个关键事件触发或作为其后续。">
                            <Select placeholder="选择起源事件" allowClear showSearch
                                filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                                options={eventsForSelect.map(e => ({ label: `${e.summary.substring(0,30)}... (ID ${e.id})`, value: e.id }))}
                            />
                        </Form.Item>
                    </Col>
                </Row>
            </Form>
        </Modal>
    );
};

// --- VersionFormModal Component (AntD) ---
const VersionFormModalAntd: React.FC<VersionFormModalAntdProps> = ({
    isOpen, onClose, onSubmit, initialData, branchId, isLoading
}) => {
    const [form] = Form.useForm<VersionFormValuesAntd>();
    const plotVersionStatusOptions = useMemo(() => mapEnumToOptionsAntd(PlotVersionStatusEnum), []); //

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                form.setFieldsValue({
                    ...initialData,
                    status: initialData.status,
                    content_summary: initialData.content_summary ? JSON.stringify(initialData.content_summary, null, 2) : '{}',
                });
            } else {
                form.resetFields();
                form.setFieldsValue({ status: PlotVersionStatusEnum.DRAFT, is_ending: false, content_summary: '{}' });
            }
        }
    }, [initialData, form, isOpen]);

    const handleOk = async () => {
        if (!branchId) { toast.error("未指定版本所属的剧情分支ID。"); return; }
        try {
            const values = await form.validateFields();
            let summaryObject = {};
            try {
                if (values.content_summary && values.content_summary.trim()) {
                    summaryObject = JSON.parse(values.content_summary);
                }
            } catch (e) {
                toast.error("内容摘要不是有效的JSON格式。"); return;
            }
            const payload: PlotVersionCreate = {
                plot_branch_id: branchId,
                version_name: values.version_name,
                description: values.description || null,
                status: values.status || PlotVersionStatusEnum.DRAFT,
                content_summary: summaryObject,
                content: values.content || null, // 允许 content 为空
                is_ending: values.is_ending || false,
            };
            await onSubmit(payload, branchId);
        } catch (info) {
            console.log('版本表单校验失败:', info);
            toast.warn("请检查表单输入项。");
        }
    };

    return (
        <Modal
            title={initialData ? `编辑剧情版本: ${initialData.version_name}` : "创建新剧情版本"}
            open={isOpen}
            onOk={handleOk}
            onCancel={onClose}
            confirmLoading={isLoading}
            destroyOnClose
            maskClosable={false}
            width={720} //
        >
            <Form form={form} layout="vertical" name="version_form_antd">
                <Form.Item
                    name="version_name"
                    label="版本名称"
                    rules={[{ required: true, message: '请输入版本名称!' }]}
                >
                    <Input placeholder="例如：初稿, 阳光结局, 暗黑结局探索" />
                </Form.Item>
                <Form.Item name="description" label="版本描述 (可选)">
                    <TextArea rows={2} placeholder="描述此版本的主要特点、核心情节或与分支主线的差异。" />
                </Form.Item>
                <Row gutter={16}>
                    <Col span={12}>
                        <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态!' }]}>
                            <Select placeholder="选择版本状态" options={plotVersionStatusOptions} />
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        <Form.Item name="is_ending" valuePropName="checked" label=" " style={{paddingTop: 30}}>
                            <Checkbox>标记为结局</Checkbox>
                        </Form.Item>
                    </Col>
                </Row>
                <Form.Item name="content" label="版本核心内容 (可选, Markdown或文本)">
                    <TextArea rows={4} placeholder="粘贴或撰写此版本的核心剧情文本、关键对话或场景描述。" />
                </Form.Item>
                <Form.Item
                    name="content_summary"
                    label="内容摘要 (JSON对象, 可选)"
                    tooltip="结构化的内容摘要，例如包含主题、关键转折点、角色发展等。如果由AI生成，此字段可能自动填充。"
                    rules={[{
                        validator: async (_, value) => {
                            if (!value || !value.trim() || value.trim() === '{}') return Promise.resolve();
                            try { JSON.parse(value); return Promise.resolve(); }
                            catch (e) { return Promise.reject(new Error('必须是有效的JSON对象格式! 例如: {"theme": "redemption"} 或留空。')); }
                        }
                    }]}
                >
                    <TextArea rows={3} placeholder={`例如：{\n  "main_theme": "主角的救赎之旅",\n  "key_events": ["事件A", "事件B"]\n}`} />
                </Form.Item>
            </Form>
        </Modal>
    );
};

// --- AISuggestionBranchModal Component (AntD) ---
const AISuggestionBranchModalAntd: React.FC<AISuggestionBranchModalAntdProps> = ({
    isOpen, onClose, onSubmit, branch, isLoading, availableLLMModels, existingVersionsForBranch
}) => {
    const [form] = Form.useForm<AISuggestionFormValuesAntd>();

    useEffect(() => {
        if (isOpen) {
            form.resetFields();
            if (branch?.description) {
                form.setFieldsValue({ user_prompt: `基于剧情分支 "${branch.name}"（描述：${branch.description.substring(0,100)}...），请构想一个有趣的新版本。` });
            } else if (branch) {
                form.setFieldsValue({ user_prompt: `为剧情分支 "${branch.name}" 构想一个新的剧情版本。` });
            }
        }
    }, [isOpen, branch, form]);

    const handleOk = async () => {
        if (!branch) return;
        try {
            const values = await form.validateFields();
            const payload: AISuggestionRequest = {
                user_prompt: values.user_prompt,
                model_id: values.model_id || null,
                parent_version_id: values.parent_version_id || undefined,
            };
            await onSubmit(payload, branch.id);
        } catch (info) {
            console.log('AI建议表单校验失败:', info);
            toast.warn("请检查表单输入项。");
        }
    };

    return (
        <Modal
            title={<Space><RobotOutlined />为分支 “{branch?.name}” AI建议新版本</Space>}
            open={isOpen}
            onOk={handleOk}
            onCancel={onClose}
            confirmLoading={isLoading}
            destroyOnClose
            maskClosable={false}
            width={680} //
        >
            <Form form={form} layout="vertical" name="ai_suggestion_form_antd">
                <Paragraph type="secondary" className={styles.aiModalDescriptionAntd}>
                    AI将根据您的提示为剧情分支 “<strong>{branch?.name}</strong>” 生成一个新的剧情版本草稿，包含名称、描述和结构化的内容摘要。
                </Paragraph>
                <Form.Item
                    name="user_prompt"
                    label="您的构想或关键问题"
                    rules={[{ required: true, message: '请输入给AI的提示!' }]}
                >
                    <TextArea rows={5} placeholder="例如：如果主角在这里做出了截然不同的选择，故事会如何发展？探索角色X的黑暗面，并设计一个悲剧结局。希望包含元素A、B、C。" />
                </Form.Item>
                <Form.Item name="parent_version_id" label="基于哪个现有版本进行衍生 (可选)" tooltip="选择一个父版本，AI将参考其内容进行推演。">
                    <Select placeholder="不基于特定父版本 (默认)" allowClear
                        options={existingVersionsForBranch.map(v => ({ label: `${v.version_name} (ID ${v.id})`, value: v.id }))}
                    />
                </Form.Item>
                <Form.Item name="model_id" label="选择LLM模型 (可选)" tooltip="默认使用系统为AI规划任务配置的模型。">
                    <Select
                        placeholder="使用规划服务默认模型或选择"
                        options={availableLLMModels}
                        allowClear
                    />
                </Form.Item>
            </Form>
        </Modal>
    );
};


// --- PlotBranchManager Main Component ---
const PlotBranchManager: React.FC<PlotBranchManagerProps> = ({ novelId, novelTitle, onMajorPlotChange }) => {
    const [branches, setBranches] = useState<PlotBranch[]>([]);
    const [branchVersions, setBranchVersions] = useState<Record<number, PlotVersion[]>>({});
    const [isLoadingBranches, setIsLoadingBranches] = useState<boolean>(true);
    const [isLoadingVersions, setIsLoadingVersions] = useState<Record<number, boolean>>({});
    const [error, setError] = useState<string | null>(null);
    const [operationLoading, setOperationLoading] = useState<boolean>(false);

    const [isBranchFormModalOpen, setIsBranchFormModalOpen] = useState<boolean>(false);
    const [editingBranch, setEditingBranch] = useState<PlotBranch | null>(null);
    const [isVersionFormModalOpen, setIsVersionFormModalOpen] = useState<boolean>(false);
    const [editingVersion, setEditingVersion] = useState<PlotVersion | null>(null);
    const [currentBranchForVersionModal, setCurrentBranchForVersionModal] = useState<PlotBranch | null>(null);
    const [isAISuggestionModalOpen, setIsAISuggestionModalOpen] = useState<boolean>(false);
    const [selectedBranchForAISuggestion, setSelectedBranchForAISuggestion] = useState<PlotBranch | null>(null);

    const [chaptersForSelect, setChaptersForSelect] = useState<Chapter[]>([]);
    const [eventsForSelect, setEventsForSelect] = useState<ApiEvent[]>([]);
    // const [availableLLMsForAI, setAvailableLLMsForAI] = useState<{label: string, value: string}[]>([]); // 假设从配置或context获取

    const navigate = useNavigate(); // 用于导航到版本编辑器

    const fetchBranchesAndRelated = useCallback(async (showToast = false) => {
        if (!novelId) return;
        setIsLoadingBranches(true); setError(null);
        if (showToast) toast.info("刷新剧情分支列表...", { autoClose: 1000 });
        try {
            const [branchesResponse, chaptersResponse, eventsResponse] = await Promise.all([
                getPlotBranchesByNovelId(novelId),
                getChaptersByNovelId(novelId, { page: 1, page_size: 1000 }),
                getEventsByNovelId(novelId, { page: 1, page_size: 1000 })
            ]);
            setBranches(branchesResponse.items || []);
            setChaptersForSelect(chaptersResponse.items || []);
            setEventsForSelect(eventsResponse.items || []);
        } catch (err) {
            const msg = `获取剧情分支或关联数据失败: ${(err as Error).message}`;
            setError(msg); toast.error(msg);
        } finally {
            setIsLoadingBranches(false);
        }
    }, [novelId]);

    useEffect(() => {
        fetchBranchesAndRelated();
    }, [fetchBranchesAndRelated]);

    const fetchVersionsForBranch = useCallback(async (branchId: number, showToast = false) => {
        if (!novelId) return;
        setIsLoadingVersions(prev => ({ ...prev, [branchId]: true }));
        if (showToast) toast.info(`加载分支 #${branchId} 的版本...`, { autoClose: 1000 });
        try {
            const response = await getPlotVersionsByBranchId(novelId, branchId);
            setBranchVersions(prev => ({ ...prev, [branchId]: response.items || [] }));
        } catch (err) {
            toast.error(`获取分支 #${branchId} 的版本失败: ${(err as Error).message}`);
        } finally {
            setIsLoadingVersions(prev => ({ ...prev, [branchId]: false }));
        }
    }, [novelId]);

    // CRUD Handlers (与 PlotVersionListPage.tsx 中基本一致, 仅 API 调用路径和参数调整)
    const handleBranchFormSubmitAntd = async (values: PlotBranchCreate) => {
        if (!novelId) return;
        setOperationLoading(true);
        try {
            if (editingBranch) {
                await apiUpdatePlotBranch(novelId, editingBranch.id, values as PlotBranchUpdate);
                toast.success(`剧情分支 "${values.name}" 更新成功!`);
            } else {
                await apiCreatePlotBranch(novelId, values);
                toast.success(`剧情分支 "${values.name}" 创建成功!`);
            }
            setIsBranchFormModalOpen(false); setEditingBranch(null);
            fetchBranchesAndRelated(true);
            onMajorPlotChange?.();
        } catch (err) {
            toast.error(`保存剧情分支失败: ${(err as Error).message}`);
        } finally {
            setOperationLoading(false);
        }
    };
    const handleDeleteBranchAntd = async (branchId: number, branchName: string) => {
        if (!novelId) return;
        setOperationLoading(true);
        try {
            await apiDeletePlotBranch(novelId, branchId);
            toast.success(`剧情分支 "${branchName}" 已删除。`);
            fetchBranchesAndRelated(true);
            onMajorPlotChange?.();
        } catch (err) {
            toast.error(`删除剧情分支 "${branchName}" 失败: ${(err as Error).message}`);
        } finally {
            setOperationLoading(false);
        }
    };
    const handleVersionFormSubmitAntd = async (values: PlotVersionCreate, branchIdToSubmitTo: number) => {
        if (!novelId || !branchIdToSubmitTo) return;
        setOperationLoading(true);
        try {
            if (editingVersion) {
                await apiUpdatePlotVersion(novelId, branchIdToSubmitTo, editingVersion.id, values as PlotVersionUpdate);
                toast.success(`剧情版本 "${values.version_name}" 更新成功!`);
            } else {
                await apiCreatePlotVersion(novelId, branchIdToSubmitTo, values);
                toast.success(`剧情版本 "${values.version_name}" 创建成功!`);
            }
            setIsVersionFormModalOpen(false); setEditingVersion(null); setCurrentBranchForVersionModal(null);
            fetchVersionsForBranch(branchIdToSubmitTo, true);
            onMajorPlotChange?.();
        } catch (err) {
            toast.error(`保存剧情版本失败: ${(err as Error).message}`);
        } finally {
            setOperationLoading(false);
        }
    };
    const handleDeleteVersionAntd = async (branchId: number, versionId: number, versionName: string) => {
        if (!novelId || !branchId) return;
        setOperationLoading(true);
        try {
            await apiDeletePlotVersion(novelId, branchId, versionId);
            toast.success(`剧情版本 "${versionName}" 已删除。`);
            fetchVersionsForBranch(branchId, true);
            onMajorPlotChange?.();
        } catch (err) {
            toast.error(`删除剧情版本 "${versionName}" 失败: ${(err as Error).message}`);
        } finally {
            setOperationLoading(false);
        }
    };
    const handleAISuggestionSubmitAntd = async (values: AISuggestionRequest, branchIdForAISuggest: number) => {
        if (!novelId || !branchIdForAISuggest) return;
        setOperationLoading(true);
        try {
            const newVersion = await generateAISuggestedPlotVersion(novelId, branchIdForAISuggest, values);
            toast.success(`AI 为分支 #${branchIdForAISuggest} 建议了新版本 "${newVersion.version_name}"!`, {autoClose: 5000});
            setIsAISuggestionModalOpen(false); setSelectedBranchForAISuggestion(null);
            fetchVersionsForBranch(branchIdForAISuggest, true);
            onMajorPlotChange?.();
        } catch (err) {
            toast.error(`AI建议新版本失败: ${(err as Error).message}`);
        } finally {
            setOperationLoading(false);
        }
    };

    // Modal Open/Close handlers
    const handleOpenBranchModalAntd = (branch?: PlotBranch) => { setEditingBranch(branch || null); setIsBranchFormModalOpen(true); };
    const handleBranchFormModalCloseAntd = () => { setIsBranchFormModalOpen(false); setEditingBranch(null); };
    const handleOpenVersionModalAntd = (branch: PlotBranch, version?: PlotVersion) => { setCurrentBranchForVersionModal(branch); setEditingVersion(version || null); setIsVersionFormModalOpen(true); };
    const handleVersionFormModalCloseAntd = () => { setIsVersionFormModalOpen(false); setEditingVersion(null); setCurrentBranchForVersionModal(null); };
    const handleOpenAISuggestionModalAntd = (branch: PlotBranch) => { setSelectedBranchForAISuggestion(branch); setIsAISuggestionModalOpen(true); };
    const handleAISuggestionModalCloseAntd = () => { setIsAISuggestionModalOpen(false); setSelectedBranchForAISuggestion(null); };


    if (isLoadingBranches && branches.length === 0) {
        return <div className={pageStyles.pageLoadingContainer}><Spin tip="加载剧情分支管理模块..." /></div>;
    }
    if (error && branches.length === 0) {
        return <Alert message="错误" description={error} type="error" showIcon action={<Button onClick={() => fetchBranchesAndRelated(true)} icon={<RedoOutlined />}>重试</Button>} />;
    }

    return (
        <div className={`${styles.plotBranchManagerContainerAntd} ${pageStyles.section}`}>
            <Space style={{ marginBottom: 16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <Title level={3} style={{ margin: 0 }} className={pageStyles.subSectionTitle}>
                    <BranchesOutlined style={{ marginRight: 8, color:'var(--ant-primary-color)' }} />
                    剧情分支与版本
                </Title>
                <Button type="primary" icon={<PlusCircleOutlined />} onClick={() => handleOpenBranchModalAntd()}>
                    创建新剧情分支
                </Button>
            </Space>

            {operationLoading && <div style={{textAlign:'center', margin:'10px 0'}}><Spin tip="操作处理中..."/></div>}

            {branches.length === 0 && !isLoadingBranches && (
                <Empty description="暂无剧情分支。点击右上角按钮开始创建吧！" />
            )}

            <Collapse accordion onChange={(key) => {
                const activeBranchId = key ? (Array.isArray(key) ? key[0] : key) : null;
                if (activeBranchId && typeof activeBranchId === 'string') {
                    const branchIdNum = parseInt(activeBranchId);
                    if (!branchVersions[branchIdNum]) { // 仅当未加载过或数据为空时获取
                        fetchVersionsForBranch(branchIdNum, true);
                    }
                }
            }}>
                {branches.map(branch => (
                    <Panel
                        header={
                            <Space style={{width:'100%', justifyContent:'space-between'}}>
                                <Text strong>{branch.name}</Text>
                                <Tag color={branch.branch_type === PlotBranchTypeEnum.MAIN_PLOT ? "blue" : "geekblue"}>
                                    {mapEnumToOptionsAntd(PlotBranchTypeEnum).find(opt => opt.value === branch.branch_type)?.label || branch.branch_type}
                                </Tag>
                            </Space>
                        }
                        key={String(branch.id)}
                        extra={
                            <Space onClick={(e) => e.stopPropagation()} className={styles.branchPanelActionsAntd}>
                                <Tooltip title="编辑此分支信息">
                                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => handleOpenBranchModalAntd(branch)} loading={operationLoading}/>
                                </Tooltip>
                                <Popconfirm
                                    title={<Text>确定删除分支 “<Text strong>{branch.name}</Text>” 及其所有版本吗？此操作不可撤销。</Text>}
                                    onConfirm={() => handleDeleteBranchAntd(branch.id, branch.name)}
                                    okText="删除" cancelText="取消" okButtonProps={{danger:true}}
                                    icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
                                >
                                    <Button size="small" type="text" danger icon={<DeleteOutlined />} loading={operationLoading} />
                                </Popconfirm>
                            </Space>
                        }
                        className={styles.branchPanelAntd}
                    >
                        <Paragraph type="secondary" ellipsis={{rows:2, expandable: true, symbol:'展开描述'}} style={{marginBottom:8}}>
                            {branch.description || "暂无描述。"}
                        </Paragraph>
                        {(branch.origin_chapter_id || branch.origin_event_id) && (
                            <Text type="secondary" style={{fontSize:'0.8em', display:'block', marginBottom:12}}>
                                起源于: {branch.origin_chapter_id && `章节ID ${branch.origin_chapter_id}`}
                                {branch.origin_chapter_id && branch.origin_event_id && " / "}
                                {branch.origin_event_id && `事件ID ${branch.origin_event_id}`}
                            </Text>
                        )}
                        <Divider style={{margin:'12px 0'}}/>
                        <Space style={{width:'100%', justifyContent:'space-between', marginBottom:12}}>
                            <Text strong><SubnodeOutlined /> 版本列表 ({branchVersions[branch.id]?.length || 0})</Text>
                            <Space>
                                <Button size="small" icon={<RobotOutlined />} onClick={() => handleOpenAISuggestionModalAntd(branch)} loading={operationLoading}>AI建议新版本</Button>
                                <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => handleOpenVersionModalAntd(branch)} loading={operationLoading}>添加新版本</Button>
                            </Space>
                        </Space>
                        {isLoadingVersions[branch.id] && <div style={{textAlign:'center', padding:20}}><Spin tip="加载版本..." /></div>}
                        {!isLoadingVersions[branch.id] && (!branchVersions[branch.id] || branchVersions[branch.id]?.length === 0) && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此分支下暂无版本。" />}
                        {branchVersions[branch.id] && branchVersions[branch.id]!.length > 0 && (
                            <List
                                itemLayout="horizontal"
                                dataSource={branchVersions[branch.id]!.sort((a,b) => (a.version_number || 0) - (b.version_number || 0) )}
                                className={styles.versionListWithinBranchAntd}
                                renderItem={version => (
                                    <List.Item
                                        className={styles.versionListItemAntd}
                                        actions={[
                                            <Tooltip title="查看版本内容详情"><Button size="small" type="text" icon={<ReadOutlined />} onClick={() => Modal.info({
                                                title: `版本 "${version.version_name}" 内容`, width: '80vw', maskClosable:true,
                                                content: <pre style={{maxHeight:'70vh', overflowY:'auto', whiteSpace:'pre-wrap', wordBreak:'break-all', background:'#f9f9f9', padding:10, borderRadius:4}}>{version.content || version.description || "无详细内容。"}</pre>,
                                                okText:"关闭"
                                            })}/></Tooltip>,
                                            <Tooltip title="编辑此版本"><Button size="small" type="text" icon={<EditOutlined />} onClick={() => handleOpenVersionModalAntd(branch, version)} loading={operationLoading}/></Tooltip>,
                                            <Popconfirm title={`删除版本 "${version.version_name}"?`} onConfirm={() => handleDeleteVersionAntd(branch.id, version.id, version.version_name)} okText="删除" cancelText="取消" okButtonProps={{danger:true}}>
                                                <Button size="small" type="text" danger icon={<DeleteOutlined />} loading={operationLoading}/>
                                            </Popconfirm>,
                                            <Tooltip title="以此版本为基础创建副本">
                                                <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => {
                                                    setCurrentBranchForVersionModal(branch);
                                                    setEditingVersion({ ...version, version_name: `${version.version_name} (副本)`, id: undefined }); // 清除ID表示新建
                                                    setIsVersionFormModalOpen(true);
                                                }} loading={operationLoading}/>
                                            </Tooltip>
                                        ]}
                                    >
                                        <List.Item.Meta
                                            avatar={<FileTextOutlined style={{fontSize:18, color: version.is_ending ? "var(--ant-error-color)" : "var(--ant-primary-color)"}}/>}
                                            title={
                                                <AntLink onClick={() => navigate(`/novels/${novelId}/branches/${branch.id}/versions/edit/${version.id}`)} title={`点击编辑版本 "${version.version_name}" 的完整内容`}>
                                                   {version.version_name} <Text type="secondary" style={{fontSize:'0.8em'}}>(v{version.version_number})</Text>
                                                </AntLink>
                                            }
                                            description={
                                                <Space direction="vertical" size="small">
                                                    <Text type="secondary" style={{fontSize:'0.85em'}} ellipsis={{rows:2, expandable: true, symbol:'展开描述'}}>{version.description || "暂无描述"}</Text>
                                                    <Space>
                                                         <Tag color={mapEnumToOptionsAntd(PlotVersionStatusEnum).find(s => s.value === version.status)?.color || "default"}>
                                                            状态: {mapEnumToOptionsAntd(PlotVersionStatusEnum).find(s => s.value === version.status)?.label || version.status}
                                                        </Tag>
                                                        {version.is_ending && <Tag color="volcano">标记为结局</Tag>}
                                                    </Space>
                                                </Space>
                                            }
                                        />
                                    </List.Item>
                                )}
                            />
                        )}
                    </Panel>
                ))}
            </Collapse>

            <BranchFormModalAntd
                isOpen={isBranchFormModalOpen}
                onClose={handleBranchFormModalCloseAntd}
                onSubmit={handleBranchFormSubmitAntd}
                initialData={editingBranch}
                novelId={novelId!}
                isLoading={operationLoading}
                chaptersForSelect={chaptersForSelect}
                eventsForSelect={eventsForSelect}
            />
            {currentBranchForVersionModal && (
                <VersionFormModalAntd
                    isOpen={isVersionFormModalOpen}
                    onClose={handleVersionFormModalCloseAntd}
                    onSubmit={handleVersionFormSubmitAntd}
                    initialData={editingVersion}
                    branchId={currentBranchForVersionModal.id}
                    isLoading={operationLoading}
                />
            )}
            {selectedBranchForAISuggestion && (
                 <AISuggestionBranchModalAntd
                    isOpen={isAISuggestionModalOpen}
                    onClose={handleAISuggestionModalCloseAntd}
                    onSubmit={handleAISuggestionSubmitAntd}
                    branch={selectedBranchForAISuggestion}
                    isLoading={operationLoading}
                    availableLLMModels={availableLLMsForAISuggest}
                    existingVersionsForBranch={branchVersions[selectedBranchForAISuggestion.id] || []}
                />
            )}
        </div>
    );
};

export default PlotBranchManager;