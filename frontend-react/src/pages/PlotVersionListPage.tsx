// frontend-react/src/pages/PlotVersionListPage.tsx
import React, { useState, useEffect, useCallback, FormEvent, useMemo } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import { toast } from 'react-toastify';

// 从 API 服务导入必要的类型和函数
import {
    PlotVersion,
    PlotVersionCreate,
    PlotVersionUpdate,
    PlotBranch,
    AISuggestionRequest,
    PlotVersionStatusEnum,
    getPlotVersionsByBranchId, // 用于获取某分支下的版本列表
    createPlotVersion,
    updatePlotVersion,
    deletePlotVersion,
    getPlotBranchById,         // 用于获取当前分支的信息
    generateAISuggestedPlotVersion,
    getNovelById,              // 用于获取小说标题等上下文信息
    Novel,
} from '../services/api'; //

// 导入页面通用样式和组件特定样式
import pageViewStyles from './PageStyles.module.css'; //
import styles from './PlotVersionListPage.module.css';   //

// 引入图标
import {
    List, PlusCircle, Edit3, Trash2, Loader, AlertTriangle, Info,
    ChevronLeft, GitFork, Brain, FileJson, ChevronDown, Save, CheckCircle // 新增Save, CheckCircle图标
} from 'lucide-react'; //

// 定义页面路由参数的类型
interface PlotVersionListPageParams extends Record<string, string | undefined> {
    novelId: string;
    branchId: string;
}

// --- 子组件：版本元数据编辑/创建模态框 Props ---
interface VersionFormModalProps {
    isOpen: boolean;        // 模态框是否可见
    onClose: () => void;    // 关闭模态框的回调
    onSubmit: (versionData: PlotVersionCreate | PlotVersionUpdate, isEditing: boolean) => Promise<void>; // 表单提交回调
    initialData?: PlotVersion | null; // 编辑时传入的初始版本数据
    branchId: number;       // 创建新版本时，必须指定所属的分支ID
    isLoading: boolean;     // 指示外部操作（如API提交）是否正在进行
}

// --- 子组件：版本元数据编辑/创建模态框 ---
const VersionFormModal: React.FC<VersionFormModalProps> = ({
    isOpen, onClose, onSubmit, initialData, branchId, isLoading
}) => {
    // 表单内部状态
    const [versionName, setVersionName] = useState('');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState<PlotVersionStatusEnum>(PlotVersionStatusEnum.DRAFT);
    const [isEnding, setIsEnding] = useState<boolean>(false);
    // content_summary 在此模态框中只读显示，通过另一个专用模态框编辑
    const [contentSummaryDisplay, setContentSummaryDisplay] = useState<string>('AI建议或手动创建版本时将填充。');

    // 判断当前是编辑模式还是新建模式
    const isEditing = useMemo(() => !!initialData, [initialData]);

    // 当模态框打开或初始数据变化时，填充表单字段
    useEffect(() => {
        if (isOpen) {
            if (initialData) { // 编辑模式
                setVersionName(initialData.version_name || '');
                setDescription(initialData.description || '');
                setStatus(initialData.status || PlotVersionStatusEnum.DRAFT);
                setIsEnding(initialData.is_ending || false);
                // 将 content_summary (可能是对象) 格式化为JSON字符串以便只读显示
                setContentSummaryDisplay(initialData.content_summary ? JSON.stringify(initialData.content_summary, null, 2) : '此版本的剧情摘要为空或未设定。');
            } else { // 新建模式，设置默认值
                setVersionName(''); // 新建时版本名应为空或有默认提示
                setDescription('');
                setStatus(PlotVersionStatusEnum.DRAFT);
                setIsEnding(false);
                setContentSummaryDisplay('新版本创建后，AI建议或手动编辑将填充此摘要。');
            }
        }
    }, [isOpen, initialData]);

    // 处理表单提交
    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!versionName.trim()) {
            toast.warn("版本名称不能为空。");
            return;
        }
        const payload: PlotVersionCreate | PlotVersionUpdate = {
            version_name: versionName.trim(),
            description: description.trim() || undefined, // 空字符串转为 undefined
            status,
            is_ending,
            // content_summary 不在此模态框中编辑，所以不包含在提交的 payload 中
            // 如果是创建新版本，确保 plot_branch_id 被设置
        };
        if (!isEditing) { // 如果是创建新版本
            (payload as PlotVersionCreate).plot_branch_id = branchId;
        }
        await onSubmit(payload, isEditing); // 调用父组件传递的 onSubmit 处理函数
    };

    if (!isOpen) return null; // 如果模态框不可见，则不渲染

    return (
        <div className={pageViewStyles.modalOverlay}> {/* 使用通用模态框遮罩层样式 */}
            <div className={`${pageViewStyles.modalContent} ${styles.versionFormModalContent}`}> {/* 特定尺寸或样式的模态框内容区 */}
                <div className={pageViewStyles.modalHeader}> {/* 通用模态框头部 */}
                    <h4>{isEditing ? '编辑剧情版本元数据' : '创建新剧情版本'}</h4>
                    <button onClick={onClose} className={pageViewStyles.modalCloseButton} title="关闭" disabled={isLoading}>
                        <ChevronDown size={20} /> {/* AntD风格的关闭图标 */}
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className={pageViewStyles.modalBody}> {/* 通用模态框主体 */}
                        {/* 版本名称 */}
                        <div className={pageViewStyles.formGroup}>
                            <label htmlFor="versionNameModal">版本名称 <span className={pageViewStyles.requiredMarker}>*</span>:</label>
                            <input
                                type="text" id="versionNameModal" value={versionName}
                                onChange={(e) => setVersionName(e.target.value)}
                                className={pageViewStyles.inputField} required disabled={isLoading}
                                placeholder="例如：主角接受了神秘任务"
                            />
                        </div>
                        {/* 版本描述 */}
                        <div className={pageViewStyles.formGroup}>
                            <label htmlFor="versionDescriptionModal">版本描述 (可选):</label>
                            <textarea
                                id="versionDescriptionModal" value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={3} className={pageViewStyles.textareaField} disabled={isLoading}
                                placeholder="简要描述这个版本的主要内容或特点..."
                            />
                        </div>
                        {/* 状态和是否结局在同一行 */}
                         <div className={styles.formRow}> {/* 用于并排显示表单组 */}
                            <div className={pageViewStyles.formGroup}>
                                <label htmlFor="versionStatusModal">状态:</label>
                                <select
                                    id="versionStatusModal" value={status}
                                    onChange={(e) => setStatus(e.target.value as PlotVersionStatusEnum)}
                                    className={pageViewStyles.selectField} disabled={isLoading}
                                >
                                    {Object.values(PlotVersionStatusEnum).map(sVal => ( // 从枚举动态生成选项
                                        <option key={sVal} value={sVal}>{sVal.charAt(0).toUpperCase() + sVal.slice(1)}</option>
                                    ))}
                                </select>
                            </div>
                            <div className={pageViewStyles.formGroup} style={{alignItems: 'center', display: 'flex', paddingTop: 'var(--spacing-md)'}}>
                                <input
                                    type="checkbox" id="isEndingModal" checked={isEnding}
                                    onChange={(e) => setIsEnding(e.target.checked)}
                                    className={pageViewStyles.checkboxInput} disabled={isLoading}
                                />
                                <label htmlFor="isEndingModal" className={pageViewStyles.checkboxLabel}>是否为结局?</label>
                            </div>
                        </div>
                        {/* 内容摘要（只读显示） */}
                        <div className={pageViewStyles.formGroup}>
                            <label>内容摘要 (只读 - 请通过列表中的“编辑内容摘要”操作修改):</label>
                            <pre className={styles.contentSummaryPreview}>{contentSummaryDisplay}</pre>
                        </div>
                    </div>
                    <div className={pageViewStyles.modalFooter}> {/* 通用模态框脚部 */}
                        <button type="button" onClick={onClose} className="btn btn-sm btn-secondary" disabled={isLoading}>取消</button>
                        <button type="submit" className="btn btn-sm btn-primary" disabled={isLoading}>
                            {isLoading ? <Loader size={16} className="spinning-icon" /> : (isEditing ? '保存元数据' : '创建版本')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- 子组件：AI 建议版本模态框 Props ---
interface AISuggestionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (userPrompt: string, parentVersionId?: number) => Promise<void>; // 提交回调，包含用户提示和可选的父版本ID
    branchName: string; // 当前分支名称，用于模态框标题
    isLoading: boolean; // 指示外部AI建议生成是否正在进行
    existingVersions: PlotVersion[]; // 当前分支下的现有版本列表，用于选择父版本
}

// --- 子组件：AI 建议版本模态框 ---
const AISuggestionModal: React.FC<AISuggestionModalProps> = ({
    isOpen, onClose, onSubmit, branchName, isLoading, existingVersions
}) => {
    // 表单内部状态
    const [userPrompt, setUserPrompt] = useState<string>('');
    const [parentVersionId, setParentVersionId] = useState<string>(''); // 存储选中的父版本ID（字符串形式）

    // 当模态框打开时，重置表单字段
    useEffect(() => {
        if (isOpen) {
            setUserPrompt(''); 
            setParentVersionId(''); 
        }
    }, [isOpen]);

    // 处理表单提交
    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        if (!userPrompt.trim()) {
            toast.warn("请输入您对新版本的构想或问题。");
            return;
        }
        onSubmit(userPrompt, parentVersionId ? parseInt(parentVersionId,10) : undefined); // 调用父组件的 onSubmit
    };

    if (!isOpen) return null; // 如果模态框不可见，不渲染

    return (
        <div className={pageViewStyles.modalOverlay}> {/* 通用模态框遮罩 */}
            <div className={`${pageViewStyles.modalContent} ${styles.aiSuggestionModalContent}`}> {/* 特定尺寸的模态框内容 */}
                <div className={pageViewStyles.modalHeader}> {/* 通用模态框头部 */}
                    <h4><Lightbulb size={18} /> AI 辅助为分支 “{branchName}” 生成版本建议</h4>
                    <button onClick={onClose} className={pageViewStyles.modalCloseButton} title="关闭" disabled={isLoading}>
                         <ChevronDown size={20} /> {/* AntD风格的关闭图标 */}
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className={pageViewStyles.modalBody}> {/* 通用模态框主体 */}
                        <p className={styles.aiModalDescription}>
                            AI 将根据您的提示为剧情分支 “<strong>{branchName}</strong>” 生成一个新的剧情版本草稿。
                        </p>
                        {/* 用户提示输入 */}
                        <div className={pageViewStyles.formGroup}>
                            <label htmlFor="aiUserPromptVerPageModal">您的构想或关键问题 <span className={pageViewStyles.requiredMarker}>*</span>:</label>
                            <textarea
                                id="aiUserPromptVerPageModal" value={userPrompt}
                                onChange={(e) => setUserPrompt(e.target.value)}
                                rows={4} className={pageViewStyles.textareaField} required disabled={isLoading}
                                placeholder="例如：如果主角在这里做出了不同的选择会怎样？探索角色X的黑暗面..."
                            />
                        </div>
                        {/* 父版本选择 */}
                        <div className={pageViewStyles.formGroup}>
                            <label htmlFor="aiParentVersionVerPageModal">基于哪个现有版本进行衍生 (可选):</label>
                            <select
                                id="aiParentVersionVerPageModal" value={parentVersionId}
                                onChange={(e) => setParentVersionId(e.target.value)}
                                className={pageViewStyles.selectField} disabled={isLoading || existingVersions.length === 0}
                            >
                                <option value="">-- 不基于特定父版本 --</option>
                                {existingVersions.map(v => ( // 从传入的 existingVersions 动态生成选项
                                    <option key={v.id} value={v.id.toString()}>
                                        {v.version_name} (ID: {v.id}, 状态: {v.status})
                                    </option>
                                ))}
                            </select>
                            {existingVersions.length === 0 && <small className={pageViewStyles.helpText}>此分支下尚无其他版本可供参考。</small>}
                        </div>
                    </div>
                    <div className={pageViewStyles.modalFooter}> {/* 通用模态框脚部 */}
                        <button type="button" onClick={onClose} className="btn btn-sm btn-secondary" disabled={isLoading}>取消</button>
                        <button type="submit" className="btn btn-sm btn-primary" disabled={isLoading || !userPrompt.trim()}>
                            {isLoading ? <Loader size={16} className="spinning-icon" /> : '生成建议'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};


// --- 子组件：剧情版本内容摘要编辑模态框 Props ---
interface PlotVersionContentModalProps {
    isOpen: boolean;
    onClose: () => void;
    version: PlotVersion | null; // 当前正在编辑的版本对象
    onSave: (versionId: number, newContentSummary: Record<string, any>) => Promise<void>; // 保存回调
    isSaving: boolean; // 指示是否正在保存
}

// --- 子组件：剧情版本内容摘要编辑模态框 ---
const PlotVersionContentModal: React.FC<PlotVersionContentModalProps> = ({
    isOpen, onClose, version, onSave, isSaving
}) => {
    // 编辑器内部状态
    const [jsonInput, setJsonInput] = useState<string>('');
    const [isValidJson, setIsValidJson] = useState<boolean>(true); // 校验JSON输入是否有效

    // 当模态框打开或版本数据变化时，初始化JSON输入框
    useEffect(() => {
        if (isOpen && version) {
            try {
                // 将 content_summary 对象转换为格式化的JSON字符串以便编辑
                setJsonInput(version.content_summary ? JSON.stringify(version.content_summary, null, 2) : '{}');
                setIsValidJson(true); // 初始认为是有效的
            } catch (e) { // 如果序列化失败（理论上不应发生，因为我们存的是对象）
                setJsonInput('{\n  "error": "无法序列化当前内容摘要数据"\n}');
                setIsValidJson(false);
                toast.error("当前内容摘要数据格式错误，无法编辑。");
            }
        }
    }, [isOpen, version]);

    // 处理JSON输入框内容变化，并实时校验格式
    const handleJsonInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newText = e.target.value;
        setJsonInput(newText);
        try {
            JSON.parse(newText); // 尝试解析
            setIsValidJson(true);  // 解析成功则有效
        } catch (error) {
            setIsValidJson(false); // 解析失败则无效
        }
    };

    // 处理保存内容摘要的提交
    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!version) return;
        if (!isValidJson) {
            toast.error("内容摘要不是有效的JSON格式，请修正后再保存。");
            return;
        }
        try {
            const parsedData = JSON.parse(jsonInput); // 再次解析以获取最新数据
            if (typeof parsedData !== 'object' || parsedData === null || Array.isArray(parsedData)) { // 确保是对象而不是数组或简单类型
                toast.error("内容摘要数据必须是一个JSON对象。");
                return;
            }
            await onSave(version.id, parsedData); // 调用父组件的保存函数
        } catch (error) { // 捕获解析错误或提交过程中的其他错误
            console.error("保存内容摘要时JSON解析或提交错误:", error);
            toast.error(`保存失败: ${(error as Error).message || '未知错误'}`);
        }
    };

    if (!isOpen || !version) return null; // 模态框未打开或无版本数据则不渲染

    return (
        <div className={pageViewStyles.modalOverlay}> {/* 通用模态框遮罩 */}
            <div className={`${pageViewStyles.modalContent} ${styles.contentSummaryModalContent}`}> {/* 特定尺寸的模态框 */}
                <div className={pageViewStyles.modalHeader}> {/* 通用模态框头部 */}
                    <h4><FileJson size={18} /> 编辑版本 “{version.version_name}” 的内容摘要</h4>
                    <button onClick={onClose} className={pageViewStyles.modalCloseButton} title="关闭" disabled={isSaving}>
                        <ChevronDown size={20}/> {/* AntD风格关闭图标 */}
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className={pageViewStyles.modalBody}> {/* 通用模态框主体 */}
                        <p className={styles.contentSummaryEditHelpText}>
                            以JSON格式编辑此剧情版本的内容摘要。这是一个结构化字段，可以包含主题、关键情节、角色发展等。
                            AI建议生成版本时会自动填充此字段，您也可以在此手动修改。
                        </p>
                        {/* JSON编辑文本域 */}
                        <textarea
                            value={jsonInput}
                            onChange={handleJsonInputChange}
                            className={`${pageViewStyles.textareaField} ${styles.jsonEditTextarea} ${!isValidJson ? styles.invalidJsonInput : ''}`}
                            rows={18} // 给予足够的编辑空间
                            placeholder='例如：{ "main_theme": "主角的救赎", "key_plot_points": ["发现真相", "做出选择", "最终对决"] }'
                            disabled={isSaving}
                            aria-invalid={!isValidJson} // 无障碍属性，指示输入是否有效
                            aria-describedby="jsonContentValidationStatus" // 关联到下面的校验状态信息
                        />
                        {/* JSON校验状态显示 */}
                        <div id="jsonContentValidationStatus" className={styles.jsonValidationStatus}>
                            {!isValidJson && jsonInput.trim() && ( // 仅当输入非空且无效时显示错误
                                <><AlertTriangle size={14} className={styles.errorIcon} /> 无效的JSON格式。</>
                            )}
                            {isValidJson && jsonInput.trim() && ( // 仅当输入非空且有效时显示成功
                                <><CheckCircle size={14} className={styles.successIcon} /> JSON格式有效。</>
                            )}
                        </div>
                    </div>
                    <div className={pageViewStyles.modalFooter}> {/* 通用模态框脚部 */}
                        <button type="button" onClick={onClose} className="btn btn-sm btn-secondary" disabled={isSaving}>取消</button>
                        <button type="submit" className="btn btn-sm btn-primary" disabled={isSaving || !isValidJson || !jsonInput.trim()}>
                            {isSaving ? <Loader size={16} className="spinning-icon" /> : <Save size={16}/>}
                            {isSaving ? '保存中...' : '保存内容摘要'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};


// --- 主页面组件：PlotVersionListPage ---
const PlotVersionListPage: React.FC = () => {
    // 从路由参数获取 ID
    const { novelId: novelIdParam, branchId: branchIdParam } = useParams<PlotVersionListPageParams>();
    const navigate = useNavigate();

    // --- 状态定义 ---
    const [versions, setVersions] = useState<PlotVersion[]>([]);          // 当前分支下的版本列表
    const [branchInfo, setBranchInfo] = useState<PlotBranch | null>(null); // 当前分支的详细信息
    const [novelInfo, setNovelInfo] = useState<Novel | null>(null);       // 当前小说的信息 (用于面包屑等)
    const [isLoading, setIsLoading] = useState<boolean>(true);             // 主数据加载状态
    const [operationLoading, setOperationLoading] = useState<boolean>(false); // CRUD 操作加载状态
    const [error, setError] = useState<string | null>(null);               // 错误信息

    // 模态框相关状态
    const [isVersionModalOpen, setIsVersionModalOpen] = useState<boolean>(false);      // 版本元数据编辑模态框
    const [editingVersion, setEditingVersion] = useState<PlotVersion | null>(null);   // 正在编辑的版本
    const [isAISuggestionModalOpen, setIsAISuggestionModalOpen] = useState<boolean>(false); // AI建议模态框

    // 内容摘要编辑模态框相关状态
    const [isContentModalOpen, setIsContentModalOpen] = useState<boolean>(false);
    const [selectedVersionForContent, setSelectedVersionForContent] = useState<PlotVersion | null>(null);
    const [isSavingContentSummary, setIsSavingContentSummary] = useState<boolean>(false);


    // 将路由参数转换为数字ID
    const parsedNovelId = useMemo(() => novelIdParam ? parseInt(novelIdParam, 10) : null, [novelIdParam]);
    const parsedBranchId = useMemo(() => branchIdParam ? parseInt(branchIdParam, 10) : null, [branchIdParam]);

    // 获取分支信息和版本列表的函数
    const fetchVersionsAndBranchInfo = useCallback(async () => {
        if (!parsedNovelId || !parsedBranchId) { // 确保ID有效
            setError("无效的小说ID或分支ID。");
            setIsLoading(false);
            return;
        }
        setIsLoading(true); setError(null);
        try {
            // 并行获取分支数据、版本列表数据和小说数据
            const [branchData, versionsData, novelData] = await Promise.all([
                getPlotBranchById(parsedNovelId, parsedBranchId), // API已更新，传递 novelId
                getPlotVersionsByBranchId(parsedNovelId, parsedBranchId, 0, 200), // 假设获取前200个版本，可分页
                getNovelById(parsedNovelId) // 获取小说信息用于面包屑
            ]);
            setBranchInfo(branchData);
            setVersions(versionsData.versions || []); // PaginatedPlotVersionsResponse 结构
            // setTotalPages(versionsData.total_pages || 0); // 如果需要分页
            setNovelInfo(novelData);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "获取版本或分支信息失败";
            setError(errorMsg); toast.error(errorMsg);
        } finally {
            setIsLoading(false);
        }
    }, [parsedNovelId, parsedBranchId]); // 依赖于解析后的ID

    // 组件加载时获取数据
    useEffect(() => {
        if (parsedNovelId && parsedBranchId) {
            fetchVersionsAndBranchInfo();
        } else { // 如果ID无效
            setIsLoading(false);
            setError("URL参数缺失或无效：需要 novelId 和 branchId。");
        }
    }, [parsedNovelId, parsedBranchId, fetchVersionsAndBranchInfo]); // 依赖于解析后的ID和回调

    // --- 事件处理函数 ---
    // 打开创建版本模态框
    const handleOpenCreateVersionModal = () => { setEditingVersion(null); setIsVersionModalOpen(true); };
    // 打开编辑版本元数据模态框
    const handleOpenEditVersionModal = (version: PlotVersion) => { setEditingVersion(version); setIsVersionModalOpen(true); };
    // 打开AI建议版本模态框
    const handleOpenAISuggestionModal = () => { setIsAISuggestionModalOpen(true); };
    // 关闭版本元数据模态框
    const handleVersionModalClose = () => { setIsVersionModalOpen(false); setEditingVersion(null); };
    // 关闭AI建议模态框
    const handleAISuggestionModalClose = () => { setIsAISuggestionModalOpen(false); };

    // 打开内容摘要编辑模态框
    const handleOpenContentModal = (version: PlotVersion) => {
        setSelectedVersionForContent(version);
        setIsContentModalOpen(true);
    };
    // 关闭内容摘要编辑模态框
    const handleContentModalClose = () => {
        setIsContentModalOpen(false);
        setSelectedVersionForContent(null);
    };

    // 处理版本表单提交（创建或更新元数据）
    const handleVersionFormSubmit = async (versionData: PlotVersionCreate | PlotVersionUpdate, isEditingMode: boolean) => {
        if (!parsedNovelId || !parsedBranchId) return; // 安全检查
        setOperationLoading(true);
        try {
            let savedVersion: PlotVersion;
            if (isEditingMode && editingVersion) { // 更新模式
                // 当编辑元数据时，保留原有的 content_summary (因为它不由这个表单编辑)
                const payload: PlotVersionUpdate = {
                    ...versionData, // 包含 version_name, description, status, is_ending
                    content_summary: editingVersion.content_summary // 保持旧的 content_summary
                };
                savedVersion = await updatePlotVersion(parsedNovelId, editingVersion.id, payload); // API已更新，传递 novelId
                toast.success(`版本 "${savedVersion.version_name}" 元数据更新成功!`);
            } else { // 创建模式
                // content_summary 通常由AI或后续编辑填充，这里可以传空对象或让后端处理
                // plot_branch_id 已经在 versionData (类型是PlotVersionCreate) 中设置好了
                savedVersion = await createPlotVersion(parsedNovelId, versionData as PlotVersionCreate); // API已更新，传递 novelId
                toast.success(`新版本 "${savedVersion.version_name}" 创建成功!`);
            }
            handleVersionModalClose();       // 关闭模态框
            fetchVersionsAndBranchInfo();    // 刷新列表
        } catch (err) {
            const action = isEditingMode ? "更新" : "创建";
            const errorMsg = err instanceof Error ? err.message : `${action}版本时发生未知错误`;
            toast.error(`${action}版本失败: ${errorMsg}`);
        } finally {
            setOperationLoading(false);
        }
    };

    // 处理删除版本
    const handleDeleteVersion = async (versionId: number, versionName: string) => {
        if (!parsedNovelId) return;
        if (window.confirm(`您确定要删除剧情版本 "${versionName}" (ID: ${versionId}) 吗？此操作不可撤销。`)) {
            setOperationLoading(true);
            try {
                await deletePlotVersion(parsedNovelId, versionId); // API已更新，传递 novelId
                toast.success(`剧情版本 "${versionName}" 已成功删除。`);
                fetchVersionsAndBranchInfo(); // 刷新列表
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : "删除版本失败";
                toast.error(errorMsg);
            } finally {
                setOperationLoading(false);
            }
        }
    };
    
    // 处理AI建议版本提交
    const handleAISuggestionSubmit = async (userPrompt: string, parentVersionIdToSuggestFrom?: number) => {
        if (!parsedNovelId || !parsedBranchId) return; // 安全检查
        setOperationLoading(true);
        try {
            // AISuggestionRequest 包含 user_prompt 和可选的 parent_version_id
            const request: AISuggestionRequest = { user_prompt: userPrompt, parent_version_id: parentVersionIdToSuggestFrom };
            // generateAISuggestedPlotVersion API 需要 novelId 和 branchId
            const suggestedVersion = await generateAISuggestedPlotVersion(parsedNovelId, parsedBranchId, request);
            const currentBranchName = branchInfo?.name || `分支ID ${parsedBranchId}`;
            toast.success(
                <div>AI为分支 “{currentBranchName}” 生成了新的剧情版本草稿: 
                     <br/><strong>“{suggestedVersion.version_name}” (ID: {suggestedVersion.id})</strong>.
                     <br/>您现在可以查看和编辑此草稿。
                </div>, 
                { autoClose: 8000 }
            );
            handleAISuggestionModalClose(); // 关闭AI建议模态框
            fetchVersionsAndBranchInfo();   // 刷新版本列表
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "AI剧情版本建议生成失败。";
            toast.error(errorMsg);
        } finally {
            setOperationLoading(false);
        }
    };

    // 处理保存内容摘要
    const handleSaveContentSummary = async (versionIdToUpdate: number, newContentSummary: Record<string, any>) => {
        if (!parsedNovelId) return;
        setIsSavingContentSummary(true); // 开始保存内容摘要状态
        const versionToUpdateInState = versions.find(v => v.id === versionIdToUpdate); // 从当前状态中找到要更新的版本
        if (!versionToUpdateInState) {
            toast.error("未找到要更新内容摘要的版本。");
            setIsSavingContentSummary(false);
            return;
        }
        try {
            // 构建 PlotVersionUpdate 对象，只更新 content_summary
            // 其他元数据字段（如 name, description, status, is_ending）应保持不变
            const payload: PlotVersionUpdate = {
                version_name: versionToUpdateInState.version_name, // 保持原样
                description: versionToUpdateInState.description,   // 保持原样
                status: versionToUpdateInState.status,             // 保持原样
                is_ending: versionToUpdateInState.is_ending,       // 保持原样
                content_summary: newContentSummary,                // 更新此字段
            };
            await updatePlotVersion(parsedNovelId, versionIdToUpdate, payload); // API已更新，传递 novelId
            toast.success(`版本 "${versionToUpdateInState.version_name}" 的内容摘要已更新!`);
            handleContentModalClose();        // 关闭内容摘要编辑模态框
            fetchVersionsAndBranchInfo();     // 刷新列表以显示更新
        } catch (err: any) {
            const errorMsg = err.message || "保存内容摘要失败。";
            toast.error(errorMsg);
        } finally {
            setIsSavingContentSummary(false); // 结束保存内容摘要状态
        }
    };


    // --- 渲染逻辑 ---
    // 初始加载状态
    if (isLoading && !branchInfo && !novelInfo) {
        return <div className={`${pageViewStyles.pageContainer} ${styles.loadingContainer}`}><Loader size={32} className="spinning-icon" /> <span>加载版本数据...</span></div>;
    }
    // 错误状态
    if (error) {
        return <div className={`${pageViewStyles.pageContainer} ${pageViewStyles.pageErrorContainer}`}><AlertTriangle size={32} /> <span>{error}</span></div>;
    }
    // 如果分支或小说信息仍未加载完成（理论上isLoading会捕获，但作为保险）
    if (!branchInfo || !novelInfo) {
        return <div className={`${pageViewStyles.pageContainer} ${pageViewStyles.pageErrorContainer}`}><Info size={32} />未找到指定的分支或小说信息。</div>;
    }

    return (
        <div className={`${pageViewStyles.pageContainer} ${styles.versionListPageContainer}`}>
            {/* 面包屑导航和页面主标题 */}
             <div className={styles.pageHeaderNav}> {/* 使用新的导航容器类 */}
                 <RouterLink to={`/novels/${novelInfo.id}`} className="btn btn-sm btn-outline-secondary"> {/* 使用 Bootstrap 样式 */}
                    <ChevronLeft size={16}/> 返回《{novelInfo.title}》详情
                </RouterLink>
            </div>
            <div className={pageViewStyles.pageHeader}>
                <h1 className={pageViewStyles.pageTitle} style={{gap: 'var(--spacing-sm)'}}> {/* 增加标题内元素间距 */}
                    <List size={32} /> {/* 使用 List 图标代表列表 */}
                    剧情版本管理 - 分支: “{branchInfo.name}”
                </h1>
                <div className={styles.headerActions}> {/* 新增头部操作按钮容器 */}
                    <button onClick={handleOpenCreateVersionModal} className="btn btn-sm btn-success" disabled={operationLoading}> {/* 使用 Bootstrap 样式 */}
                        <PlusCircle size={16} /> 手动创建新版本
                    </button>
                    <button onClick={handleOpenAISuggestionModal} className="btn btn-sm btn-info" disabled={operationLoading}> {/* 使用 Bootstrap 样式 */}
                        <Lightbulb size={16} /> AI建议新版本
                    </button>
                </div>
            </div>

            {/* 页面描述 */}
            <p className={`${pageViewStyles.pageDescription} info-message`}> {/* 使用通用信息提示样式 */}
                管理剧情分支 “<strong>{branchInfo.name}</strong>” 下的所有剧情版本。您可以创建新版本、编辑现有版本元数据、通过AI获取版本建议，或导航到具体版本的编辑器。
            </p>
            {/* 操作进行中的加载提示条 */}
            {operationLoading && <div className={styles.operationLoadingBar}><Loader size={14} className="spinning-icon"/> 操作处理中...</div>}

            {/* 版本列表 */}
            {versions.length === 0 ? (
                <div className={`${pageViewStyles.noDataMessage} ${styles.noVersionsMessage}`}> {/* 无数据提示 */}
                    <Info size={18} /> 此剧情分支下还没有任何版本。
                </div>
            ) : (
                <ul className={styles.versionList}>
                    {versions.map(version => (
                        <li key={version.id} className={`${styles.versionItem} ${styles[`status${version.status.charAt(0).toUpperCase() + version.status.slice(1)}`]}`}> {/* 根据状态应用不同样式 */}
                            <div className={styles.versionInfo}>
                                <span className={styles.versionNameAndStatus}>
                                    <strong className={styles.versionName} title={version.version_name}>{version.version_name}</strong>
                                    <span className={`${styles.versionStatusTag} ${styles[`statusTag${version.status.charAt(0).toUpperCase() + version.status.slice(1)}`]}`} title={`状态: ${version.status}`}>{version.status}</span>
                                    {version.is_ending && <span className={styles.endingTag} title="此版本标记为一个结局">结局</span>}
                                </span>
                                {version.description && <p className={styles.versionDescription} title={version.description}>{version.description}</p>}
                                <div className={styles.versionMeta}>
                                    <span>ID: {version.id}</span>
                                    <span>内部版本号: {version.version_number}</span> {/* 显示版本号 */}
                                    <span>最后更新: {new Date(version.updated_at).toLocaleString()}</span>
                                    {/* 显示内容摘要的键数量，作为有无内容的简单指示 */}
                                    {version.content_summary && Object.keys(version.content_summary).length > 0 && 
                                        <span title={`内容摘要包含 ${Object.keys(version.content_summary).length} 个主键`}>有内容摘要</span>}
                                </div>
                            </div>
                            <div className={styles.versionActions}> {/* 版本操作按钮组 */}
                                {/* 新增：编辑内容摘要按钮 */}
                                <button 
                                    onClick={() => handleOpenContentModal(version)}
                                    className="btn btn-xs btn-outline-success" // 使用Bootstrap样式
                                    title="查看并编辑此版本的内容摘要"
                                    disabled={operationLoading}
                                >
                                    <FileJson size={12}/> 编辑内容摘要
                                </button>
                                <button 
                                    onClick={() => navigate(`/novels/${parsedNovelId}/branches/${parsedBranchId}/versions/${version.id}/editor`)} // 导航到版本编辑器
                                    className="btn btn-xs btn-outline-info" title="打开此版本进行详细内容编辑"> {/* 使用Bootstrap样式 */}
                                    <Edit3 size={12}/> 编辑完整内容
                                </button>
                                <button onClick={() => handleOpenEditVersionModal(version)} className="btn btn-xs btn-outline-secondary" title="编辑此版本元数据" disabled={operationLoading}><Edit3 size={12} /></button> {/* 使用Bootstrap样式 */}
                                <button onClick={() => handleDeleteVersion(version.id, version.version_name)} className="btn btn-xs btn-outline-danger" title="删除此版本" disabled={operationLoading}><Trash2 size={12} /></button> {/* 使用Bootstrap样式 */}
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {/* 版本元数据编辑/创建模态框 */}
            <VersionFormModal
                isOpen={isVersionModalOpen}
                onClose={handleVersionModalClose}
                onSubmit={handleVersionFormSubmit}
                initialData={editingVersion}
                branchId={parsedBranchId as number} // 确保 parsedBranchId 此时不为 null
                isLoading={operationLoading}
            />
            
            {/* AI 建议版本模态框 */}
            <AISuggestionModal
                isOpen={isAISuggestionModalOpen}
                onClose={handleAISuggestionModalClose}
                onSubmit={handleAISuggestionSubmit}
                branchName={branchInfo.name} // 直接传递分支名称
                isLoading={operationLoading}
                existingVersions={versions} // 传递当前分支下的版本列表
            />

            {/* 内容摘要编辑模态框 */}
            <PlotVersionContentModal
                isOpen={isContentModalOpen}
                onClose={handleContentModalClose}
                version={selectedVersionForContent} // 传递选中的版本对象
                onSave={handleSaveContentSummary}    // 传递保存回调
                isSaving={isSavingContentSummary}     // 传递保存状态
            />

        </div>
    );
};

export default PlotVersionListPage;