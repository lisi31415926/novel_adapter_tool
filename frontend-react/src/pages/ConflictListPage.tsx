// frontend-react/src/pages/ConflictListPage.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
    TablePaginationConfig,
    Collapse,
    Row,
    Col,
    Divider, // 新增 Divider
} from 'antd';
import {
    HomeOutlined,
    BookOutlined,
    ThunderboltOutlined,
    PlusCircleOutlined,
    SearchOutlined,
    FilterOutlined,
    RedoOutlined,
    DeleteOutlined, // 新增 DeleteOutlined
    PlusOutlined,   // 新增 PlusOutlined
} from '@ant-design/icons';

// API 服务和类型
import {
    Novel,
    Conflict as ConflictInfo,
    PlotVersion,
    Character,
    Event as ApiEvent,
    InvolvedEntity,
    getConflictsByNovelId,
    deleteConflict as apiDeleteConflict,
    createConflict as apiCreateConflict,
    updateConflict as apiUpdateConflict,
    getNovelById,
    getPlotVersionsByNovelId,
    getCharactersByNovelId as apiGetCharactersForSelect, // 重命名以区分
    getEventsByNovelId as apiGetEventsForSelect,         // 重命名以区分
    PaginatedResponse,
    GetConflictsParams,
    SortDirectionEnum,
    ConflictCreate,
    ConflictUpdate,
    ConflictLevelEnum,
    ConflictStatusEnum,
} from '../services/api';

// 从 constants.ts 导入转换后的枚举选项，用于表单下拉框和列表显示
import { OptionType, CONFLICT_LEVEL_OPTIONS, CONFLICT_STATUS_OPTIONS } from '../constants';

// 子组件 ConflictList (纯展示)
import ConflictList from '../components/ConflictList';
import type { SortableConflictFieldsList } from '../components/ConflictList';

// 样式
import pageStyles from './PageStyles.module.css';
import styles from './ConflictListPage.module.css';

const { Content } = Layout;
const { Title } = Typography;
const { Option } = Select;
const { TextArea } = Input;
const { Panel } = Collapse;

const ITEMS_PER_PAGE_OPTIONS = ['10', '20', '50', '100'];

// 涉及实体的类型选项 (用于 Form.List)
// 注意：此常量在 ConflictListPage.tsx 和 ConflictList.tsx 中都有定义，
// 理想情况下应提升到 constants.ts 或共享文件中。此处为保持文件独立性而重复定义。
const ENTITY_TYPE_OPTIONS_FOR_CONFLICT_FORM: OptionType[] = [
    { label: "角色 (Character)", value: "character" },
    { label: "事件 (Event)", value: "event" },
];


// 表单数据类型，特别处理 involved_entities
interface ConflictFormData extends Omit<ConflictCreate, 'involved_entities' | 'novel_id'> {
    involved_entities?: Array<{ entity_type?: string; entity_id?: string }>; // 允许 entity_id 为 string 以便 Select
}


const ConflictListPage: React.FC = () => {
    const { novelId: novelIdParam } = useParams<{ novelId: string }>();
    const navigate = useNavigate();
    const novelId = novelIdParam ? parseInt(novelIdParam, 10) : null;

    const [novel, setNovel] = useState<Novel | null>(null);
    const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
    const [plotVersions, setPlotVersions] = useState<PlotVersion[]>([]);
    const [plotVersionsMap, setPlotVersionsMap] = useState<Record<number, string>>({});
    const [charactersForSelect, setCharactersForSelect] = useState<Character[]>([]);
    const [eventsForSelect, setEventsForSelect] = useState<ApiEvent[]>([]);

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isModalLoading, setIsModalLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const [isModalVisible, setIsModalVisible] = useState<boolean>(false);
    const [editingConflict, setEditingConflict] = useState<ConflictInfo | null>(null);
    const [form] = Form.useForm<ConflictFormData>();

    const [filters, setFilters] = useState({
        description: '',
        conflict_level: null as ConflictLevelEnum | string | null,
        status: null as ConflictStatusEnum | string | null,
        plot_version_id: null as number | null,
        character_id: null as number | null,
        event_id: null as number | null,
    });
    const [debouncedDescriptionFilter, setDebouncedDescriptionFilter] = useState<string>('');
    const [currentSortField, setCurrentSortField] = useState<SortableConflictFieldsList>('level'); // 默认按级别排序
    const [currentSortDirection, setCurrentSortDirection] = useState<SortDirectionEnum>(SortDirectionEnum.DESC); // 例如默认按级别降序
    const [pagination, setPagination] = useState<TablePaginationConfig>({
        current: 1,
        pageSize: parseInt(ITEMS_PER_PAGE_OPTIONS[1], 10), // 默认20条
        total: 0,
        showSizeChanger: true,
        pageSizeOptions: ITEMS_PER_PAGE_OPTIONS,
        showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 项冲突`,
    });

    // 转换枚举为 Select 选项
    const conflictLevelOptionsForForm = useMemo(() => CONFLICT_LEVEL_OPTIONS.map(opt => ({label: opt.label, value: opt.value})), []);
    const conflictStatusOptionsForForm = useMemo(() => CONFLICT_STATUS_OPTIONS.map(opt => ({label: opt.label, value: opt.value})), []);


    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedDescriptionFilter(filters.description);
        }, 500);
        return () => clearTimeout(handler);
    }, [filters.description]);

    const fetchNovelAndRelatedData = useCallback(async () => {
        if (!novelId) return;
        try {
            const [novelData, versionsData, charsData, eventsData] = await Promise.all([
                novel && novel.id === novelId ? Promise.resolve(novel) : getNovelById(novelId),
                getPlotVersionsByNovelId(novelId, { page: 1, page_size: 1000 }),
                apiGetCharactersForSelect(novelId, { page: 1, page_size: 1000 }),
                apiGetEventsForSelect(novelId, { page: 1, page_size: 1000 })
            ]);
            if (!novel || novel.id !== novelId) setNovel(novelData);
            setPlotVersions(versionsData.items || []);
            setPlotVersionsMap(Object.fromEntries((versionsData.items || []).map(v => [v.id, v.name])));
            setCharactersForSelect(charsData.items || []);
            setEventsForSelect(eventsData.items || []);
        } catch (err) {
            const msg = "加载页面基础数据失败。";
            toast.error(msg); setError(msg + ` 详情: ${(err as Error).message}`);
        }
    }, [novelId, novel]);

    const fetchConflictsList = useCallback(async (
        page: number = pagination.current || 1,
        size: number = pagination.pageSize || parseInt(ITEMS_PER_PAGE_OPTIONS[1], 10),
        showToast: boolean = false
    ) => {
        if (!novelId) { setError("无效的小说ID。"); setIsLoading(false); return; }
        setIsLoading(true); setError(null);
        if (showToast) toast.info("刷新冲突列表...", { autoClose: 1200 });

        const params: GetConflictsParams = {
            page: page,
            page_size: size,
            description: debouncedDescriptionFilter.trim() || undefined,
            level: filters.conflict_level as ConflictLevelEnum || undefined, // 后端用 level
            status: filters.status as ConflictStatusEnum || undefined,
            plot_version_id: filters.plot_version_id || undefined,
            character_id: filters.character_id || undefined,
            event_id: filters.event_id || undefined,
            sort_by: currentSortField,
            sort_dir: currentSortDirection,
        };

        try {
            const response = await getConflictsByNovelId(novelId, params);
            setConflicts(response.items || []);
            setPagination(prev => ({
                ...prev,
                current: response.page,
                pageSize: response.page_size,
                total: response.total_count,
            }));
        } catch (err: any) {
            const errorMsg = err.response?.data?.detail || err.message || `加载冲突列表失败。`;
            setError(errorMsg); toast.error(errorMsg);
            setConflicts([]); setPagination(prev => ({ ...prev, total: 0, current: 1 }));
        } finally {
            setIsLoading(false);
        }
    }, [
        novelId, pagination.current, pagination.pageSize, debouncedDescriptionFilter,
        filters, currentSortField, currentSortDirection
    ]);

    useEffect(() => {
        if (novelId) fetchNovelAndRelatedData();
    }, [novelId, fetchNovelAndRelatedData]);

    useEffect(() => {
        if (novelId && novel) fetchConflictsList();
    }, [
        novelId, novel, pagination.current, pagination.pageSize,
        debouncedDescriptionFilter, filters, currentSortField, currentSortDirection, fetchConflictsList
    ]);


    const handleFilterChange = (changedFilters: Partial<typeof filters>) => {
        setFilters(prev => ({ ...prev, ...changedFilters }));
        setPagination(prev => ({ ...prev, current: 1 }));
    };

    const handleTableChange = (
        newPagination: TablePaginationConfig,
        _: Record<string, (React.Key | boolean)[] | null>, // antd filters，我们用自己的
        sorter: any
    ) => {
        const singleSorter = Array.isArray(sorter) ? sorter[0] : sorter;
        const newSortField = singleSorter?.field as SortableConflictFieldsList || 'level';
        const newSortOrder = singleSorter?.order === 'ascend' ? SortDirectionEnum.ASC : SortDirectionEnum.DESC;
        
        setCurrentSortField(newSortField);
        setCurrentSortDirection(newSortOrder);
        setPagination(prev => ({
            ...prev,
            current: newPagination.current || 1,
            pageSize: newPagination.pageSize || parseInt(ITEMS_PER_PAGE_OPTIONS[1], 10),
        }));
    };

    const handleOpenModal = (conflict?: ConflictInfo) => {
        if (conflict) {
            setEditingConflict(conflict);
            form.setFieldsValue({
                ...conflict,
                involved_entities: conflict.involved_entities?.map(entity => ({
                    entity_type: entity.entity_type,
                    entity_id: String(entity.entity_id),
                })) || [{ entity_type: undefined, entity_id: undefined }],
            });
        } else {
            setEditingConflict(null);
            form.resetFields();
            form.setFieldsValue({ involved_entities: [{ entity_type: undefined, entity_id: undefined }] });
            if (filters.plot_version_id) {
                form.setFieldsValue({ plot_version_id: filters.plot_version_id });
            }
        }
        setIsModalVisible(true);
    };

    const handleModalCancel = () => {
        setIsModalVisible(false);
        setEditingConflict(null);
        form.resetFields();
    };

    const handleModalSave = async () => {
        if (!novelId) { toast.error("小说ID无效。"); return; }
        try {
            const values = await form.validateFields();
            setIsModalLoading(true);

            const conflictDataPayload: Partial<ConflictCreate | ConflictUpdate> = {
                ...values,
                novel_id: novelId, // 确保novel_id已设置
                involved_entities: values.involved_entities
                    ?.filter(e => e && e.entity_type && e.entity_id)
                    .map(e => ({
                        entity_type: e.entity_type!,
                        entity_id: parseInt(e.entity_id!, 10),
                    })) || [],
            };
            // 清理掉表单专用的 involved_entities_str (如果之前有)
            delete (conflictDataPayload as any).involved_entities_str;


            if (editingConflict && editingConflict.id) {
                await apiUpdateConflict(novelId, editingConflict.id, conflictDataPayload as ConflictUpdate);
                toast.success(`冲突 "${values.description.substring(0, 20)}..." 更新成功！`);
            } else {
                await apiCreateConflict(novelId, conflictDataPayload as ConflictCreate);
                toast.success(`冲突 "${values.description.substring(0, 20)}..." 添加成功！`);
            }
            fetchConflictsList(1, pagination.pageSize, true);
            handleModalCancel();
        } catch (err: any) {
            const errorMsg = err.response?.data?.detail || err.message || "保存冲突信息失败。";
            if (err.errorFields) {
                 toast.error("表单校验失败，请检查所有字段，特别是“涉及实体”部分。");
            } else {
                toast.error(errorMsg);
            }
        } finally {
            setIsModalLoading(false);
        }
    };

    const handleDeleteConflict = async (conflictId: number) => {
        if (!novelId) return;
        setIsLoading(true);
        try {
            await apiDeleteConflict(novelId, conflictId);
            toast.success(`冲突 (ID: ${conflictId}) 删除成功！`);
            if (conflicts.length === 1 && (pagination.current || 1) > 1) {
                setPagination(prev => ({...prev, current: (prev.current || 2) - 1}));
            } else {
                fetchConflictsList(pagination.current, pagination.pageSize, true);
            }
        } catch (err: any) {
            toast.error(err.response?.data?.detail || err.message || "删除冲突失败。");
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading && conflicts.length === 0 && !novel && !error) {
        return <div className={pageStyles.pageLoadingContainer}><Spin size="large" tip="加载冲突数据..." /></div>;
    }
    if (error && !novel && !isLoading) {
        return (<Layout className={pageStyles.pageLayout}><Content className={pageStyles.pageContent}><Alert message="错误" description={error} type="error" showIcon action={<Button onClick={() => fetchNovelAndRelatedData()} icon={<RedoOutlined />}>重试基础数据</Button>} /></Content></Layout>);
    }
    if (!novel && !isLoading) {
        return (<Layout className={pageStyles.pageLayout}><Content className={pageStyles.pageContent}><Alert message="提示" description="未找到相关小说信息或加载失败。" type="info" showIcon action={<Button onClick={() => navigate("/novels")}>返回小说列表</Button>}/></Content></Layout>);
    }

    return (
        <Layout className={pageStyles.pageLayout}>
            <Breadcrumb className={pageStyles.breadcrumb}>
                <Breadcrumb.Item><RouterLink to="/"><HomeOutlined /> 首页</RouterLink></Breadcrumb.Item>
                <Breadcrumb.Item><RouterLink to="/novels"><BookOutlined /> 小说管理</RouterLink></Breadcrumb.Item>
                {novel && <Breadcrumb.Item><RouterLink to={`/novels/${novel.id}`}>《{novel.title}》</RouterLink></Breadcrumb.Item>}
                <Breadcrumb.Item>冲突列表</Breadcrumb.Item>
            </Breadcrumb>

            <Content className={pageStyles.pageContent}>
                <div className={pageStyles.titleBar}>
                    <Title level={2} className={pageStyles.pageTitle}><ThunderboltOutlined style={{marginRight: 8}}/> 冲突管理 {novel && `- 《${novel.title}》`}</Title>
                    <Button type="primary" icon={<PlusCircleOutlined />} onClick={() => handleOpenModal()}>
                        添加新冲突
                    </Button>
                </div>

                <Collapse ghost className={styles.filterCollapse} defaultActiveKey={['1']}>
                    <Panel header={<Space><FilterOutlined />筛选与搜索选项</Space>} key="1">
                        <Form layout="vertical" className={styles.filterFormAntd}>
                            <Row gutter={16}>
                                <Col xs={24} sm={12} md={8}>
                                    <Form.Item label="搜索描述/动机">
                                        <Input
                                            placeholder="关键词..."
                                            value={filters.description}
                                            onChange={(e) => handleFilterChange({ description: e.target.value })}
                                            prefix={<SearchOutlined />} allowClear disabled={isLoading}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12} md={8}>
                                    <Form.Item label="冲突级别">
                                        <Select
                                            value={filters.conflict_level}
                                            onChange={(value) => handleFilterChange({ conflict_level: value as ConflictLevelEnum | null })}
                                            placeholder="所有级别" options={conflictLevelOptionsForForm}
                                            allowClear disabled={isLoading}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12} md={8}>
                                    <Form.Item label="冲突状态">
                                        <Select
                                            value={filters.status}
                                            onChange={(value) => handleFilterChange({ status: value as ConflictStatusEnum | null })}
                                            placeholder="所有状态" options={conflictStatusOptionsForForm}
                                            allowClear disabled={isLoading}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12} md={8}>
                                    <Form.Item label="所属剧情版本">
                                        <Select
                                            value={filters.plot_version_id}
                                            onChange={(value) => handleFilterChange({ plot_version_id: value })}
                                            placeholder="所有剧情版本" allowClear
                                            disabled={isLoading || plotVersions.length === 0}
                                            loading={isLoading && plotVersions.length === 0 && !!novelId}
                                            options={plotVersions.map(pv => ({label: pv.name, value: pv.id}))}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12} md={8}>
                                    <Form.Item label="涉及角色">
                                        <Select
                                            value={filters.character_id}
                                            onChange={(value) => handleFilterChange({ character_id: value })}
                                            placeholder="所有角色" allowClear showSearch
                                            filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                                            disabled={isLoading || charactersForSelect.length === 0}
                                            loading={isLoading && charactersForSelect.length === 0 && !!novelId}
                                            options={charactersForSelect.map(char => ({label: char.name, value: char.id}))}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12} md={8}>
                                    <Form.Item label="关联事件">
                                        <Select
                                            value={filters.event_id}
                                            onChange={(value) => handleFilterChange({ event_id: value })}
                                            placeholder="所有事件" allowClear showSearch
                                            filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                                            disabled={isLoading || eventsForSelect.length === 0}
                                            loading={isLoading && eventsForSelect.length === 0 && !!novelId}
                                            options={eventsForSelect.map(evt => ({label: `${evt.summary.substring(0,25)}... (ID:${evt.id})`, value: evt.id}))}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} style={{ textAlign: 'right', marginTop: 8 }}>
                                    <Space>
                                        <Button onClick={() => {
                                            setFilters({ description: '', conflict_level: null, status: null, plot_version_id: null, character_id: null, event_id: null });
                                            setCurrentSortField('level'); // 改为级别
                                            setCurrentSortDirection(SortDirectionEnum.DESC);
                                            setPagination(prev => ({...prev, current:1}));
                                        }} disabled={isLoading}>
                                            重置所有筛选
                                        </Button>
                                         <Button type="primary" onClick={() => fetchConflictsList(1, pagination.pageSize, true)} icon={<RedoOutlined />} loading={isLoading}>
                                            应用筛选并刷新
                                        </Button>
                                    </Space>
                                </Col>
                            </Row>
                        </Form>
                    </Panel>
                </Collapse>

                {error && conflicts.length === 0 && (
                    <Alert message="数据加载错误" description={error} type="error" showIcon closable onClose={() => setError(null)} style={{ marginBottom: 16 }}/>
                )}

                <ConflictList
                    conflicts={conflicts}
                    isLoading={isLoading && conflicts.length > 0} // 列表内部loading状态
                    novelId={novelId}
                    plotVersionsMap={plotVersionsMap}
                    charactersMap={Object.fromEntries(charactersForSelect.map(c => [c.id, c.name]))}
                    eventsMap={Object.fromEntries(eventsForSelect.map(e => [e.id, e.summary || `事件ID:${e.id}`]))}
                    onDeleteConflict={handleDeleteConflict}
                    onEditConflict={handleOpenModal}
                    pagination={pagination}
                    onTableChange={handleTableChange}
                />
            </Content>

            <Modal
                title={editingConflict ? `编辑冲突: ${(editingConflict.description || '').substring(0,30)}...` : "添加新冲突"}
                open={isModalVisible}
                onOk={handleModalSave}
                onCancel={handleModalCancel}
                confirmLoading={isModalLoading}
                destroyOnClose
                maskClosable={false}
                width={760}
            >
                <Form form={form} layout="vertical" name="conflict_form_modal" initialValues={{ involved_entities: [{ entity_type: undefined, entity_id: undefined }] }}>
                    <Form.Item name="description" label="冲突描述" rules={[{ required: true, message: '请输入冲突描述!' }]}>
                        <TextArea rows={3} placeholder="详细描述冲突的双方、起因、核心矛盾点等。" />
                    </Form.Item>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item name="level" label="冲突级别" rules={[{ required: true, message: '请选择冲突级别!' }]}>
                                <Select placeholder="选择冲突级别" options={conflictLevelOptionsForForm}/>
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                             <Form.Item name="status" label="冲突状态" rules={[{ required: true, message: '请选择冲突状态!' }]}>
                                <Select placeholder="选择冲突状态" options={conflictStatusOptionsForForm}/>
                            </Form.Item>
                        </Col>
                    </Row>
                     <Form.Item name="intensity_level" label="激烈程度 (1-10, 可选)">
                        <InputNumber min={1} max={10} style={{width:'100%'}} placeholder="评估冲突的激烈程度"/>
                    </Form.Item>
                    <Form.Item name="plot_version_id" label="关联剧情版本 (可选)">
                        <Select placeholder="选择此冲突所属的剧情版本" allowClear loading={plotVersions.length === 0 && isLoading}>
                            {plotVersions.map(pv => <Option key={pv.id} value={pv.id}>{pv.name}</Option>)}
                        </Select>
                    </Form.Item>

                    <Form.List name="involved_entities">
                        {(fields, { add, remove }, { errors }) => (
                            <>
                                <Form.Item
                                    label="涉及实体 (可选)"
                                    tooltip="添加参与此冲突的角色或引发此冲突的关键事件。"
                                    style={{ marginBottom: 0 }}
                                >
                                    {fields.map((field, index) => (
                                        <Space key={field.key} style={{ display: 'flex', marginBottom: 8}} align="baseline" wrap={false}>
                                            <Form.Item
                                                {...field}
                                                name={[field.name, 'entity_type']}
                                                rules={[{ required: true, message: '请选择实体类型' }]}
                                                noStyle
                                            >
                                                <Select placeholder="类型" style={{ width: 130 }} options={ENTITY_TYPE_OPTIONS_FOR_CONFLICT_FORM} onChange={() => {
                                                    const currentEntities = form.getFieldValue('involved_entities') || [];
                                                    if(currentEntities[index]) {
                                                        currentEntities[index].entity_id = undefined; // 清空ID
                                                        form.setFieldsValue({ involved_entities: currentEntities });
                                                    }
                                                }}/>
                                            </Form.Item>
                                            <Form.Item
                                                {...field}
                                                name={[field.name, 'entity_id']}
                                                rules={[{ required: true, message: '请选择具体实体' }]}
                                                noStyle
                                            >
                                                <Select
                                                    placeholder="选择具体实体"
                                                    showSearch
                                                    style={{ width: 280 }}
                                                    filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                                                    disabled={!form.getFieldValue(['involved_entities', index, 'entity_type'])}
                                                    options={
                                                        form.getFieldValue(['involved_entities', index, 'entity_type']) === 'character'
                                                        ? charactersForSelect.map(c => ({ label: c.name, value: String(c.id) }))
                                                        : form.getFieldValue(['involved_entities', index, 'entity_type']) === 'event'
                                                            ? eventsForSelect.map(e => ({ label: `${e.summary.substring(0,30)}... (ID:${e.id})`, value: String(e.id) }))
                                                            : []
                                                    }
                                                />
                                            </Form.Item>
                                            {fields.length > 0 &&
                                                <Button type="text" danger onClick={() => remove(field.name)} icon={<DeleteOutlined />} />
                                            }
                                        </Space>
                                    ))}
                                    <Button type="dashed" onClick={() => add({entity_type: undefined, entity_id: undefined})} block icon={<PlusOutlined />}>
                                        添加涉及实体
                                    </Button>
                                    <Form.ErrorList errors={errors} />
                                </Form.Item>
                            </>
                        )}
                    </Form.List>


                    <Form.Item name="motivation_character_a" label="动机 (A方, 可选)" style={{marginTop: 16}}>
                        <TextArea rows={2} placeholder="冲突中A方的动机或目标" />
                    </Form.Item>
                    <Form.Item name="motivation_character_b" label="动机 (B方, 可选)">
                        <TextArea rows={2} placeholder="冲突中B方的动机或目标" />
                    </Form.Item>
                     <Form.Item name="resolution_details" label="解决详情 (可选)">
                        <TextArea rows={3} placeholder="冲突是如何解决的，结果如何？" disabled={form.getFieldValue('status') !== ConflictStatusEnum.RESOLVED}/>
                    </Form.Item>
                </Form>
            </Modal>
        </Layout>
    );
};

export default ConflictListPage;