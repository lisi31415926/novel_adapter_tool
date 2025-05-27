// frontend-react/src/pages/CharacterListPage.tsx
import React, { useState, useEffect, useCallback, useMemo, ChangeEvent as ReactChangeEvent } from 'react';
import { useParams, Link as RouterLink, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
    Layout,
    Typography,
    Button,
    Breadcrumb,
    Space,
    Input,
    Select,
    Modal,
    Form,
    InputNumber,
    Alert,
    Spin,
    Card, // 使用 Card 包裹筛选区域
    TablePaginationConfig,
} from 'antd'; // 确保导入所有需要的 Ant Design 组件
import {
    HomeOutlined,
    BookOutlined,
    UserOutlined,
    PlusCircleOutlined,
    SearchOutlined,
    FilterOutlined,
    RedoOutlined,
    // LeftOutlined, // 不再需要，导航用 RouterLink
    // DownOutlined, // Select 自带箭头
    // ExclamationCircleOutlined, // Popconfirm 自带图标
} from '@ant-design/icons';

// API 服务和类型
import {
    Novel,
    Character,
    getCharactersByNovelId,
    deleteCharacter as apiDeleteCharacter,
    createCharacter as apiCreateCharacter,
    updateCharacter as apiUpdateCharacter,
    getNovelById,
    PaginatedResponse,
    GetCharactersParams, // 用于 API 请求参数
    SortDirectionEnum,
    CharacterCreate,
    CharacterUpdate,
} from '../services/api';

// 子组件 CharacterList
import CharacterList from '../components/CharacterList';
import type { SortableCharacterFieldsList } from '../components/CharacterList'; // 导入排序字段类型

// 样式
import pageStyles from './PageStyles.module.css';
import styles from './CharacterListPage.module.css'; // 页面特定样式

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input; // 如果表单中需要

const ITEMS_PER_PAGE_OPTIONS_STR = ['10', '15', '20', '30', '50']; // AntD Table pageSizeOptions 需要字符串数组
const ITEMS_PER_PAGE_OPTIONS_NUM = ITEMS_PER_PAGE_OPTIONS_STR.map(Number);

// 预定义角色类型选项 (示例)
const ROLE_TYPE_OPTIONS_FOR_FILTER = ["主角", "配角", "反派", "导师", "次要角色", "未知角色类型"];


const CharacterListPage: React.FC = () => {
    const { novelId: novelIdParam } = useParams<{ novelId: string }>();
    const navigate = useNavigate();
    const novelId = novelIdParam ? parseInt(novelIdParam, 10) : null;

    // --- 组件状态定义 ---
    const [novel, setNovel] = useState<Novel | null>(null); // 当前小说信息
    const [characters, setCharacters] = useState<Character[]>([]); // 角色列表
    const [isLoading, setIsLoading] = useState<boolean>(true); // 主数据加载状态
    const [isModalLoading, setIsModalLoading] = useState<boolean>(false); // 模态框操作加载状态
    const [error, setError] = useState<string | null>(null); // 页面级错误

    // 模态框与表单状态
    const [isModalVisible, setIsModalVisible] = useState<boolean>(false);
    const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
    const [form] = Form.useForm<CharacterCreate | CharacterUpdate>();

    // 筛选、排序和分页状态
    const [searchTerm, setSearchTerm] = useState<string>(''); // 实时搜索输入
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>(''); // 防抖后的搜索词
    const [roleTypeFilter, setRoleTypeFilter] = useState<string>(''); // 'all' 或具体角色类型
    const [currentSortField, setCurrentSortField] = useState<SortableCharacterFieldsList>('name'); // 默认按名称排序
    const [currentSortDirection, setCurrentSortDirection] = useState<SortDirectionEnum>(SortDirectionEnum.ASC); // 默认升序
    const [pagination, setPagination] = useState<TablePaginationConfig>({
        current: 1,
        pageSize: ITEMS_PER_PAGE_OPTIONS_NUM[1], // 默认20
        total: 0,
        showSizeChanger: true,
        pageSizeOptions: ITEMS_PER_PAGE_OPTIONS_STR,
        showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条角色`, // 自定义总数显示
    });

    // 从小说数据中提取唯一的角色类型，用于筛选下拉框
    const uniqueRoleTypesForFilter = useMemo(() => {
        if (novel && novel.characters && novel.characters.length > 0) {
            const roles = new Set(novel.characters.map(c => c.role_type).filter(Boolean) as string[]);
            return Array.from(roles).sort();
        }
        // 如果 novel.characters 不可用或为空，可以使用一个预定义列表或留空
        return ROLE_TYPE_OPTIONS_FOR_FILTER;
    }, [novel]);


    // 搜索词防抖处理
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 500); // 500ms 防抖延迟
        return () => clearTimeout(handler);
    }, [searchTerm]);

    // 获取小说信息和角色列表的核心函数
    const fetchNovelAndCharacters = useCallback(async (
        page: number = pagination.current || 1,
        size: number = pagination.pageSize || ITEMS_PER_PAGE_OPTIONS_NUM[1],
        sortField: SortableCharacterFieldsList = currentSortField,
        sortDir: SortDirectionEnum = currentSortDirection,
        search: string = debouncedSearchTerm,
        roleFilter: string = roleTypeFilter,
        showRefreshToast: boolean = false // 控制是否显示刷新提示
    ) => {
        if (!novelId) {
            setError("无效的小说ID。");
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);
        if (showRefreshToast) {
            toast.info("正在刷新角色列表...", { autoClose: 1200 });
        }

        const params: GetCharactersParams = {
            page: page,
            page_size: size,
            name: search.trim() || undefined,
            role_type: roleFilter && roleFilter !== 'all' ? roleFilter : undefined,
            sort_by: sortField,
            sort_dir: sortDir,
        };

        try {
            // 获取小说基本信息 (仅在 novel 状态为空时获取)
            if (!novel) {
                const novelData = await getNovelById(novelId);
                setNovel(novelData);
            }
            // 获取角色列表
            const response = await getCharactersByNovelId(novelId, params);
            setCharacters(response.items || []);
            setPagination(prev => ({
                ...prev,
                current: response.page,
                pageSize: response.page_size,
                total: response.total_count,
            }));
            if (showRefreshToast) toast.success("角色列表已刷新！");
        } catch (err: any) {
            const errorMsg = err.response?.data?.detail || err.message || `加载角色列表失败。`;
            setError(errorMsg);
            toast.error(errorMsg);
            setCharacters([]); // 出错时清空列表
            setPagination(prev => ({ ...prev, total: 0, current: 1 })); // 重置分页
        } finally {
            setIsLoading(false);
        }
    }, [novelId, novel, pagination.current, pagination.pageSize, currentSortField, currentSortDirection, debouncedSearchTerm, roleTypeFilter]);

    // 初始加载和依赖项变化时获取数据
    useEffect(() => {
        if (novelId) {
            // 分页、排序或筛选条件变化时会自动调用 fetchNovelAndCharacters
            fetchNovelAndCharacters(
                pagination.current,
                pagination.pageSize,
                currentSortField,
                currentSortDirection,
                debouncedSearchTerm,
                roleTypeFilter
            );
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [novelId, pagination.current, pagination.pageSize, currentSortField, currentSortDirection, debouncedSearchTerm, roleTypeFilter, fetchNovelAndCharacters]);
    // 注意：fetchNovelAndCharacters 作为依赖项，但其内部依赖已包含在外部 useEffect 依赖项中，可以考虑移除以避免潜在循环，
    // 但为了确保在 novelId 或其他基础参数变化时正确重新执行（例如，当 novel prop 初始化时），保留它是安全的。

    // --- 事件处理函数 ---
    // 表格变化处理（分页、排序、筛选）
    const handleTableChange = (
        newPagination: TablePaginationConfig,
        antdFilters: Record<string, (React.Key | boolean)[] | null>, // AntD Table filters (本组件未使用表格内置筛选)
        sorter: any // SorterResult<Character> | SorterResult<Character>[]
    ) => {
        const singleSorter = Array.isArray(sorter) ? sorter[0] : sorter; // AntD Table 可能返回单个或数组
        const newSortField = singleSorter?.field as SortableCharacterFieldsList || 'name'; // 如果 sorter.field 未定义，则默认
        const newSortOrder = singleSorter?.order === 'ascend' ? SortDirectionEnum.ASC : singleSorter?.order === 'descend' ? SortDirectionEnum.DESC : SortDirectionEnum.ASC; // 默认升序

        setCurrentSortField(newSortField);
        setCurrentSortDirection(newSortOrder);
        setPagination(prev => ({
            ...prev,
            current: newPagination.current || 1,
            pageSize: newPagination.pageSize || ITEMS_PER_PAGE_OPTIONS_NUM[1],
        }));
        // 数据获取将由上面的 useEffect 因 pagination, currentSortField, currentSortDirection 变化而触发
    };


    const handleOpenModal = (character?: Character) => {
        if (character) {
            setEditingCharacter(character);
            form.setFieldsValue({
                ...character,
                first_appearance_chapter_index: character.first_appearance_chapter_index !== null && character.first_appearance_chapter_index !== undefined
                    ? character.first_appearance_chapter_index + 1 // 显示为1-based
                    : undefined, // 如果是 null 或 undefined，表单显示空
                aliases: character.aliases?.join(', ') || '', // 数组转为逗号分隔字符串
                // tags 字段也类似处理
                tags: character.tags?.join(', ') || '',
            });
        } else {
            setEditingCharacter(null);
            form.resetFields(); // 清空表单用于新建
        }
        setIsModalVisible(true);
    };

    const handleModalCancel = () => {
        setIsModalVisible(false);
        setEditingCharacter(null);
        form.resetFields();
    };

    const handleModalSave = async () => {
        if (!novelId) { toast.error("小说ID无效，无法保存角色。"); return; }
        try {
            const values = await form.validateFields(); // 触发表单校验
            setIsModalLoading(true); // 开始模态框内操作的加载状态

            const firstAppearanceIndex = values.first_appearance_chapter_index
                ? parseInt(String(values.first_appearance_chapter_index), 10) - 1 // 转回0-based
                : undefined;

            // 校验 first_appearance_chapter_index 是否为有效数字且不小于0
            if (values.first_appearance_chapter_index && (isNaN(firstAppearanceIndex as number) || (firstAppearanceIndex as number) < 0)) {
                 toast.warn("首次出场章节必须是一个有效的正整数。");
                 setIsModalLoading(false);
                 return; // 阻止后续执行
            }

            const characterDataPayload = { // 准备API请求的数据
                ...values,
                first_appearance_chapter_index: firstAppearanceIndex,
                aliases: values.aliases ? String(values.aliases).split(',').map((a: string) => a.trim()).filter(Boolean) : [],
                tags: values.tags ? String(values.tags).split(',').map((t: string) => t.trim()).filter(Boolean) : [],
            };

            if (editingCharacter && editingCharacter.id) { // 编辑模式
                await apiUpdateCharacter(novelId, editingCharacter.id, characterDataPayload as CharacterUpdate);
                toast.success(`角色 "${values.name}" 更新成功！`);
            } else { // 创建模式
                await apiCreateCharacter(novelId, characterDataPayload as CharacterCreate);
                toast.success(`角色 "${values.name}" 添加成功！`);
            }
            // 成功后，刷新列表到第一页，并清除筛选条件以看到新条目
            fetchNovelAndCharacters(1, pagination.pageSize, 'name', SortDirectionEnum.ASC, '', '', true);
            handleModalCancel(); // 关闭并重置模态框
        } catch (err: any) { // 捕获API错误或表单校验错误
            const errorMsg = err.response?.data?.detail || err.message || "保存角色信息失败。";
            // 如果是 AntD 表单校验的错误对象，它会有 errorFields 属性
            if (err.errorFields && Array.isArray(err.errorFields) && err.errorFields.length > 0) {
                // AntD Form 的 validateFields() 会自动在UI上显示错误，这里可以只记录日志或通用提示
                console.warn('表单校验失败:', err.errorFields);
                toast.error("表单包含无效输入，请检查红色标记的字段。");
            } else {
                toast.error(errorMsg); // API 调用错误
            }
        } finally {
            setIsModalLoading(false); // 结束模态框加载状态
        }
    };

    const handleDeleteCharacter = async (characterId: number) => {
        if (!novelId) return; // 安全检查
        // Popconfirm 确认后，父组件 CharacterList 会调用此函数
        setIsLoading(true); // 使用主列表的加载状态，因为会刷新列表
        try {
            await apiDeleteCharacter(novelId, characterId);
            toast.success(`角色 (ID: ${characterId}) 已成功删除。`);
            // 如果删除的是当前页的最后一条数据，并且当前页不是第一页，则刷新到前一页
            if (characters.length === 1 && (pagination.current || 1) > 1) {
                const prevPage = (pagination.current || 2) -1;
                setPagination(prev => ({ ...prev, current: prevPage }));
                // fetchNovelAndCharacters 会因 pagination.current 变化而触发
            } else {
                // 否则，刷新当前页
                fetchNovelAndCharacters(pagination.current, pagination.pageSize, currentSortField, currentSortDirection, debouncedSearchTerm, roleTypeFilter, true);
            }
        } catch (err: any) {
            const errorMsg = err.response?.data?.detail || err.message || "删除角色失败。";
            toast.error(errorMsg);
        } finally {
            setIsLoading(false);
        }
    };


    // --- 渲染逻辑 ---
    // 页面级加载状态
    if (isLoading && characters.length === 0 && !novel) {
        return <div className={pageStyles.pageLoadingContainer}><Spin size="large" tip="加载角色列表页面..." /></div>;
    }
    // 页面级错误状态 (例如，获取 novel 信息失败)
    if (error && !novel && !isLoading) {
        return (
            <Layout className={pageStyles.pageLayout}>
                <Content className={pageStyles.pageContent}>
                    <Alert
                        message="页面加载错误"
                        description={error}
                        type="error"
                        showIcon
                        action={
                            <Button onClick={() => fetchNovelAndCharacters(1, pagination.pageSize, currentSortField, currentSortDirection, debouncedSearchTerm, roleTypeFilter, true)} icon={<RedoOutlined />}>
                                重试加载
                            </Button>
                        }
                    />
                </Content>
            </Layout>
        );
    }
    // 如果 novel 未加载成功 (可能是ID无效)
    if (!novel && !isLoading) {
        return (
            <Layout className={pageStyles.pageLayout}>
                <Content className={pageStyles.pageContent}>
                    <Alert
                        message="小说信息未找到"
                        description="无法加载指定小说的数据，请确保小说ID正确或返回小说列表选择。"
                        type="warning"
                        showIcon
                        action={
                            <Button onClick={() => navigate("/novels")}>
                                返回小说列表
                            </Button>
                        }
                    />
                </Content>
            </Layout>
        );
    }


    return (
        <Layout className={pageStyles.pageLayout}>
            {/* 面包屑导航 */}
            <Breadcrumb className={pageStyles.breadcrumb}>
                <Breadcrumb.Item><RouterLink to="/"><HomeOutlined /> 首页</RouterLink></Breadcrumb.Item>
                <Breadcrumb.Item><RouterLink to="/novels"><BookOutlined /> 小说管理</RouterLink></Breadcrumb.Item>
                {novel && <Breadcrumb.Item><RouterLink to={`/novels/${novel.id}`}>《{novel.title}》</RouterLink></Breadcrumb.Item>}
                <Breadcrumb.Item>角色列表</Breadcrumb.Item>
            </Breadcrumb>

            <Content className={pageStyles.pageContent}>
                {/* 页面标题和操作按钮 */}
                <div className={pageStyles.titleBar}>
                    <Title level={2} className={pageStyles.pageTitle}>
                        <UserOutlined style={{marginRight: 8, color: 'var(--ant-primary-color)'}} /> 角色管理 {novel && `- 《${novel.title}》`}
                    </Title>
                    <Button type="primary" icon={<PlusCircleOutlined />} onClick={() => handleOpenModal()}>
                        添加新角色
                    </Button>
                </div>

                {/* 筛选和排序控件区域 */}
                <Card className={styles.filterControlsCardAntd} style={{ marginBottom: 16 }}>
                    <Form layout="inline" className={styles.filterFormAntd}>
                        <Form.Item label="搜索名称/描述">
                            <Input
                                placeholder="输入关键词..."
                                value={searchTerm}
                                onChange={(e: ReactChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                                style={{ width: 220 }}
                                prefix={<SearchOutlined />}
                                allowClear
                                disabled={isLoading}
                            />
                        </Form.Item>
                        <Form.Item label="角色类型">
                            <Select
                                value={roleTypeFilter}
                                onChange={(value) => setRoleTypeFilter(value)}
                                style={{ width: 170 }}
                                placeholder="所有类型"
                                allowClear
                                disabled={isLoading || uniqueRoleTypesForFilter.length === 0}
                                options={[{label: '所有类型', value: 'all'}, ...uniqueRoleTypesForFilter.map(role => ({ label: role, value: role }))]}
                            />
                        </Form.Item>
                        <Form.Item> {/* 刷新按钮可以保留，但主要依赖状态变化自动刷新 */}
                            <Button
                                onClick={() => fetchNovelAndCharacters(1, pagination.pageSize, currentSortField, currentSortDirection, debouncedSearchTerm, roleTypeFilter, true)}
                                icon={<RedoOutlined />}
                                loading={isLoading && characters.length > 0} // 仅在列表已有数据但仍在刷新时显示loading
                            >
                                应用筛选并刷新
                            </Button>
                        </Form.Item>
                    </Form>
                </Card>

                {/* 列表加载时，如果列表已有数据，错误提示可以更柔和，例如显示在列表上方而不是替换整个列表 */}
                {error && characters.length > 0 && (
                    <Alert message="刷新列表时出错" description={error} type="warning" showIcon closable onClose={() => setError(null)} style={{ marginBottom: 16 }}/>
                )}


                {/* 角色列表组件 */}
                <CharacterList
                    characters={characters}
                    isLoading={isLoading && characters.length === 0} // 主加载状态仅在列表为空时传递
                    novelId={novelId} // 确保传递 novelId
                    onDeleteCharacter={handleDeleteCharacter}
                    onEditCharacter={handleOpenModal}
                    pagination={pagination}
                    onTableChange={handleTableChange}
                />
            </Content>

            {/* 创建/编辑角色模态框 */}
            <Modal
                title={editingCharacter ? `编辑角色: ${editingCharacter.name}` : "添加新角色"}
                open={isModalVisible}
                onOk={handleModalSave}
                onCancel={handleModalCancel}
                confirmLoading={isModalLoading} // 使用模态框专属加载状态
                destroyOnClose // 关闭时销毁表单状态，确保下次打开是干净的
                maskClosable={false} // 点击模态框外部不关闭
                width={680} // 可根据表单内容调整宽度
            >
                <Form form={form} layout="vertical" name="character_form_modal">
                    <Form.Item
                        name="name"
                        label="角色名称"
                        rules={[{ required: true, message: '请输入角色名称!' }, {max: 255, message: '名称过长!'}]}
                    >
                        <Input placeholder="例如：李逍遥" />
                    </Form.Item>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item name="role_type" label="定位/身份 (可选)">
                                <Input placeholder="例如：主角, 导师, 神秘人" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="aliases" label="别名 (可选, 逗号分隔)">
                                <Input placeholder="例如：逍遥哥哥, 李十" />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item name="first_appearance_chapter_index" label="首次出场章节号 (1-based, 可选)"
                        tooltip="请填写章节的实际显示编号（从1开始）。"
                    >
                        <InputNumber min={1} style={{ width: '100%' }} placeholder="例如: 1 (表示第1章)" />
                    </Form.Item>
                    <Form.Item name="description" label="角色描述 (可选)">
                        <TextArea rows={3} placeholder="关于这个角色的简要描述、外貌、性格特点等。" />
                    </Form.Item>
                    <Form.Item name="core_setting" label="核心设定 (可选)">
                        <TextArea rows={2} placeholder="角色的核心背景设定或特殊能力等。" />
                    </Form.Item>
                     <Form.Item name="personality_traits" label="性格特点 (可选)">
                        <TextArea rows={2} placeholder="角色的主要性格特征，例如：乐观、冷静、易怒。" />
                    </Form.Item>
                     <Form.Item name="appearance_description" label="外貌描述 (可选)">
                        <TextArea rows={2} placeholder="角色的外貌特征，如发色、瞳色、衣着等。" />
                    </Form.Item>
                    <Form.Item name="background_story" label="背景故事 (可选)">
                        <TextArea rows={3} placeholder="角色的背景故事、成长经历或重要往事。" />
                    </Form.Item>
                    <Form.Item name="tags" label="标签 (可选, 逗号分隔)">
                        <Input placeholder="例如：剑客, 腹黑, 傲娇" />
                    </Form.Item>
                    <Form.Item name="avatar_url" label="头像URL (可选)">
                        <Input placeholder="输入角色头像图片的URL链接" />
                    </Form.Item>
                </Form>
            </Modal>
        </Layout>
    );
};

export default CharacterListPage;