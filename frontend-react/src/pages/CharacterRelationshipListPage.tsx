// frontend-react/src/pages/CharacterRelationshipListPage.tsx
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
    Popconfirm,
    Alert,
    Spin,
    Tag,
    TablePaginationConfig,
    Collapse,
    Row,
    Col,
    Divider,
} from 'antd';
import {
    HomeOutlined,
    BookOutlined,
    TeamOutlined, // Icon for relationships
    PlusCircleOutlined,
    SearchOutlined,
    FilterOutlined,
    RedoOutlined,
    ExclamationCircleOutlined,
    DeleteOutlined,
    PlusOutlined,
} from '@ant-design/icons';

// API 服务和类型
import {
    Novel,
    Character,
    CharacterRelationship,
    PlotVersion,
    DynamicChange, // For the form
    getCharacterRelationshipsByNovelId,
    deleteCharacterRelationship as apiDeleteRelationship,
    createCharacterRelationship as apiCreateRelationship,
    updateCharacterRelationship as apiUpdateRelationship,
    getNovelById,
    getCharactersByNovelId as apiGetCharactersForSelect, // To select characters for relationships
    getPlotVersionsByNovelId, // If relationships are tied to plot versions
    PaginatedResponse,
    GetCharacterRelationshipsParams,
    SortDirectionEnum,
    CharacterRelationshipCreate,
    CharacterRelationshipUpdate,
    RelationshipTypeEnum,
    RelationshipStatusEnum,
} from '../services/api'; //

// 从 constants.ts 导入 OptionType 和相关选项
import { OptionType } from '../constants'; //

// 子组件 CharacterRelationshipList (纯展示)
import CharacterRelationshipList from '../components/CharacterRelationshipList'; //
import type { SortableRelationshipFields } from '../components/CharacterRelationshipList'; //

// 样式
import pageStyles from './PageStyles.module.css';
import styles from './CharacterRelationshipListPage.module.css';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;
const { Panel } = Collapse;

const ITEMS_PER_PAGE_OPTIONS = ['10', '20', '50', '100'];

// 将后端的枚举 (通常是 {KEY: "Value"} 对象) 转换为 AntD Select 的 options 格式
const mapEnumToOptions = (enumObj: Record<string, string>, useValueAsLabel: boolean = false): OptionType[] => {
    if (!enumObj || typeof enumObj !== 'object') {
        return [];
    }
    return Object.entries(enumObj).map(([key, value]) => {
        let label = value;
        if (!useValueAsLabelIfNotFound && typeof key === 'string') { // prefer formatted key if value isn't explicitly a label
            label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        } else if (useValueAsLabelIfNotFound && typeof value === 'string') {
            label = value;
        }
        return { label, value: key };
    });
};
// 假设一个辅助函数用于决定是否使用枚举值作为标签
const useValueAsLabelIfNotFound = true;


// 表单中 DynamicChange 的类型
interface FormDynamicChange {
    chapter_index?: number | null;
    event_trigger?: string | null;
    change_description: string;
}

// 表单数据类型
interface RelationshipFormData extends Omit<CharacterRelationshipCreate, 'dynamic_changes' | 'character_a_id' | 'character_b_id'> {
    character_a_id?: string | null; // Select uses string values
    character_b_id?: string | null; // Select uses string values
    dynamic_changes?: FormDynamicChange[];
}


const CharacterRelationshipListPage: React.FC = () => {
    const { novelId: novelIdParam } = useParams<{ novelId: string }>();
    const navigate = useNavigate();
    const novelId = novelIdParam ? parseInt(novelIdParam, 10) : null;

    const [novel, setNovel] = useState<Novel | null>(null);
    const [relationships, setRelationships] = useState<CharacterRelationship[]>([]);
    const [charactersForSelect, setCharactersForSelect] = useState<Character[]>([]);
    const [plotVersions, setPlotVersions] = useState<PlotVersion[]>([]); // 如果关系关联剧情版本

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isModalLoading, setIsModalLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const [isModalVisible, setIsModalVisible] = useState<boolean>(false);
    const [editingRelationship, setEditingRelationship] = useState<CharacterRelationship | null>(null);
    const [form] = Form.useForm<RelationshipFormData>();

    const [filters, setFilters] = useState({
        character_id: null as number | null, // Filter by one character involved
        relationship_type: null as RelationshipTypeEnum | string | null,
        status: null as RelationshipStatusEnum | string | null,
        plot_version_id: null as number | null,
    });
    const [currentSortField, setCurrentSortField] = useState<SortableRelationshipFields>('character_a_id'); // Default sort
    const [currentSortDirection, setCurrentSortDirection] = useState<SortDirectionEnum>(SortDirectionEnum.ASC);
    const [pagination, setPagination] = useState<TablePaginationConfig>({
        current: 1,
        pageSize: parseInt(ITEMS_PER_PAGE_OPTIONS[1], 10),
        total: 0,
        showSizeChanger: true,
        pageSizeOptions: ITEMS_PER_PAGE_OPTIONS,
        showTotal: (total, range) => `${range[0]}-${range[1]} 共 ${total} 项`,
    });

    const relationshipTypeOptions = useMemo(() => mapEnumToOptions(RelationshipTypeEnum, true), []); //
    const relationshipStatusOptions = useMemo(() => mapEnumToOptions(RelationshipStatusEnum, true), []); //


    const fetchNovelAndRelatedData = useCallback(async () => {
        if (!novelId) return;
        // setIsLoading(true); // 主加载由 fetchRelationships 控制
        try {
            const promises = [
                novel && novel.id === novelId ? Promise.resolve(novel) : getNovelById(novelId),
                apiGetCharactersForSelect(novelId, { page: 1, page_size: 1000 }), // Get all characters for select
                getPlotVersionsByNovelId(novelId, { page: 1, page_size: 1000 }),
            ];
            const [novelData, charsData, versionsData] = await Promise.all(promises as [
                Promise<Novel>,
                Promise<PaginatedResponse<Character>>,
                Promise<PaginatedResponse<PlotVersion>>
            ]);

            if (!novel || novel.id !== novelId) setNovel(novelData);
            setCharactersForSelect(charsData.items || []);
            setPlotVersions(versionsData.items || []);
        } catch (err) {
            const msg = "加载页面所需基础数据 (小说、角色、剧情版本) 失败。";
            toast.error(msg);
            console.error(msg, err);
            setError(msg + ` 详情: ${(err as Error).message}`);
        }
    }, [novelId, novel]);

    const fetchRelationships = useCallback(async (
        page: number = pagination.current || 1,
        size: number = pagination.pageSize || parseInt(ITEMS_PER_PAGE_OPTIONS[1], 10),
        showToast: boolean = false
    ) => {
        if (!novelId) { setError("无效的小说ID。"); setIsLoading(false); return; }
        setIsLoading(true); setError(null);
        if (showToast) toast.info("刷新人物关系列表...", { autoClose: 1200 });

        const params: GetCharacterRelationshipsParams = {
            page: page,
            page_size: size,
            character_id: filters.character_id || undefined,
            relationship_type: filters.relationship_type as RelationshipTypeEnum || undefined,
            status: filters.status as RelationshipStatusEnum || undefined,
            plot_version_id: filters.plot_version_id !== null ? filters.plot_version_id : undefined,
            sort_by: currentSortField,
            sort_dir: currentSortDirection,
        };

        try {
            const response = await getCharacterRelationshipsByNovelId(novelId, params);
            setRelationships(response.items || []);
            setPagination(prev => ({
                ...prev,
                current: response.page,
                pageSize: response.page_size,
                total: response.total_count,
            }));
        } catch (err: any) {
            const errorMsg = err.response?.data?.detail || err.message || `加载人物关系列表失败。`;
            setError(errorMsg); toast.error(errorMsg);
            setRelationships([]); setPagination(prev => ({ ...prev, total: 0, current: 1 }));
        } finally {
            setIsLoading(false);
        }
    }, [
        novelId, pagination.current, pagination.pageSize,
        filters, currentSortField, currentSortDirection
    ]);

    useEffect(() => {
        if (novelId) {
            fetchNovelAndRelatedData();
        }
    }, [novelId, fetchNovelAndRelatedData]);

    useEffect(() => {
        if (novelId && novel && charactersForSelect.length > 0) { // Ensure characters are loaded for context
            fetchRelationships(pagination.current, pagination.pageSize, false);
        }
    }, [
        novelId, novel, charactersForSelect, // Depends on characters being available
        pagination.current, pagination.pageSize,
        filters, currentSortField, currentSortDirection, fetchRelationships
    ]);


    const handleFilterChange = (changedFilters: Partial<typeof filters>) => {
        setFilters(prev => ({ ...prev, ...changedFilters }));
        setPagination(prev => ({ ...prev, current: 1 }));
    };

    const handleTableChange = (
        newPagination: TablePaginationConfig,
        tableFiltersFromAnt: Record<string, (React.Key | boolean)[] | null>,
        sorter: any
    ) => {
        const singleSorter = Array.isArray(sorter) ? sorter[0] : sorter;
        const newSortField = singleSorter?.field as SortableRelationshipFields || 'character_a_id';
        const newSortOrder = singleSorter?.order === 'ascend' ? SortDirectionEnum.ASC : singleSorter?.order === 'descend' ? SortDirectionEnum.DESC : SortDirectionEnum.ASC;
        
        setCurrentSortField(newSortField);
        setCurrentSortDirection(newSortOrder);
        setPagination(prev => ({
            ...prev,
            current: newPagination.current || 1,
            pageSize: newPagination.pageSize || parseInt(ITEMS_PER_PAGE_OPTIONS[1], 10),
        }));
    };

    const handleOpenModal = (relationship?: CharacterRelationship) => {
        if (relationship) {
            setEditingRelationship(relationship);
            form.setFieldsValue({
                ...relationship,
                character_a_id: String(relationship.character_a_id),
                character_b_id: String(relationship.character_b_id),
                dynamic_changes: relationship.dynamic_changes?.map(dc => ({ ...dc })) || [{ change_description: '' }],
            });
        } else {
            setEditingRelationship(null);
            form.resetFields();
            form.setFieldsValue({ dynamic_changes: [{ change_description: '' }] });
            if (filters.plot_version_id) {
                form.setFieldsValue({ plot_version_id: filters.plot_version_id });
            }
        }
        setIsModalVisible(true);
    };

    const handleModalCancel = () => {
        setIsModalVisible(false);
        setEditingRelationship(null);
        form.resetFields();
    };

    const handleModalSave = async () => {
        if (!novelId) { toast.error("小说ID无效。"); return; }
        try {
            const values = await form.validateFields();
            setIsModalLoading(true);

            const charAId = parseInt(values.character_a_id || '0', 10);
            const charBId = parseInt(values.character_b_id || '0', 10);

            if (charAId === charBId && charAId !== 0) {
                toast.error("角色A和角色B不能是同一个人。");
                setIsModalLoading(false);
                return;
            }
            if (charAId === 0 || charBId === 0) {
                toast.error("请选择关系双方的角色。");
                setIsModalLoading(false);
                return;
            }


            const relationshipDataPayload: Partial<CharacterRelationshipCreate | CharacterRelationshipUpdate> = {
                ...values,
                character_a_id: charAId,
                character_b_id: charBId,
                dynamic_changes: values.dynamic_changes?.filter(dc => dc && dc.change_description && dc.change_description.trim() !== '') || [],
            };

            if (editingRelationship && editingRelationship.id) {
                await apiUpdateRelationship(novelId, editingRelationship.id, relationshipDataPayload as CharacterRelationshipUpdate);
                toast.success(`人物关系更新成功！`);
            } else {
                await apiCreateRelationship(novelId, relationshipDataPayload as CharacterRelationshipCreate);
                toast.success(`人物关系添加成功！`);
            }
            fetchRelationships(1, pagination.pageSize, true);
            handleModalCancel();
        } catch (err: any) {
            const errorMsg = err.response?.data?.detail || err.message || "保存人物关系信息失败。";
            if (err.errorFields) {
                 toast.error("表单校验失败，请检查所有字段。");
            } else {
                toast.error(errorMsg);
            }
        } finally {
            setIsModalLoading(false);
        }
    };

    const handleDeleteRelationship = async (relationshipId: number) => {
        if (!novelId) return;
        setIsLoading(true);
        try {
            await apiDeleteRelationship(novelId, relationshipId);
            toast.success(`人物关系 (ID: ${relationshipId}) 删除成功！`);
            if (relationships.length === 1 && (pagination.current || 1) > 1) {
                setPagination(prev => ({...prev, current: (prev.current || 2) - 1}));
            } else {
                fetchRelationships(pagination.current, pagination.pageSize, true);
            }
        } catch (err: any) {
            toast.error(err.response?.data?.detail || err.message || "删除人物关系失败。");
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading && relationships.length === 0 && !novel && !error) {
        return <div className={pageStyles.pageLoadingContainer}><Spin size="large" tip="加载人物关系数据..." /></div>;
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
                <Breadcrumb.Item>人物关系</Breadcrumb.Item>
            </Breadcrumb>

            <Content className={pageStyles.pageContent}>
                <div className={pageStyles.titleBar}>
                    <Title level={2} className={pageStyles.pageTitle}><TeamOutlined style={{marginRight: 8}}/> 人物关系管理 {novel && `- 《${novel.title}》`}</Title>
                    <Button type="primary" icon={<PlusCircleOutlined />} onClick={() => handleOpenModal()}>
                        添加新关系
                    </Button>
                </div>

                <Collapse ghost className={styles.filterCollapse} defaultActiveKey={['1']}>
                    <Panel header={<Space><FilterOutlined />筛选选项</Space>} key="1">
                        <Form layout="vertical" className={styles.filterFormAntd}>
                            <Row gutter={16}>
                                <Col xs={24} sm={12} md={6}>
                                    <Form.Item label="涉及角色">
                                        <Select
                                            value={filters.character_id}
                                            onChange={(value) => handleFilterChange({ character_id: value })}
                                            placeholder="选择角色" allowClear showSearch
                                            filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                                            disabled={isLoading || charactersForSelect.length === 0}
                                            loading={isLoading && charactersForSelect.length === 0 && !!novelId}
                                            options={charactersForSelect.map(char => ({label: char.name, value: char.id}))}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12} md={6}>
                                    <Form.Item label="关系类型">
                                        <Select
                                            value={filters.relationship_type}
                                            onChange={(value) => handleFilterChange({ relationship_type: value as RelationshipTypeEnum | null })}
                                            placeholder="所有类型" options={relationshipTypeOptions}
                                            allowClear disabled={isLoading}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12} md={6}>
                                    <Form.Item label="关系状态">
                                        <Select
                                            value={filters.status}
                                            onChange={(value) => handleFilterChange({ status: value as RelationshipStatusEnum | null })}
                                            placeholder="所有状态" options={relationshipStatusOptions}
                                            allowClear disabled={isLoading}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12} md={6}>
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
                                <Col xs={24} style={{ textAlign: 'right', marginTop: 8 }}>
                                    <Space>
                                        <Button onClick={() => {
                                            setFilters({ character_id: null, relationship_type: null, status: null, plot_version_id: null });
                                            setCurrentSortField('character_a_id');
                                            setCurrentSortDirection(SortDirectionEnum.ASC);
                                            setPagination(prev => ({...prev, current:1}));
                                        }} disabled={isLoading}>
                                            重置所有筛选
                                        </Button>
                                         <Button type="primary" onClick={() => fetchRelationships(1, pagination.pageSize, true)} icon={<RedoOutlined />} loading={isLoading}>
                                            应用筛选并刷新
                                        </Button>
                                    </Space>
                                </Col>
                            </Row>
                        </Form>
                    </Panel>
                </Collapse>

                {error && relationships.length === 0 && (
                    <Alert message="数据加载错误" description={error} type="error" showIcon closable onClose={() => setError(null)} style={{ marginBottom: 16 }}/>
                )}

                <CharacterRelationshipList
                    relationships={relationships}
                    isLoading={isLoading && relationships.length > 0}
                    novelId={novelId}
                    characterMap={Object.fromEntries(charactersForSelect.map(c => [c.id, c.name]))}
                    plotVersionsMap={plotVersionsMap}
                    onDeleteRelationship={handleDeleteRelationship}
                    onEditRelationship={handleOpenModal}
                    pagination={pagination}
                    onTableChange={handleTableChange}
                />
            </Content>

            <Modal
                title={editingRelationship ? `编辑人物关系` : "添加新人物关系"}
                open={isModalVisible}
                onOk={handleModalSave}
                onCancel={handleModalCancel}
                confirmLoading={isModalLoading}
                destroyOnClose
                maskClosable={false}
                width={800} // 增加宽度以容纳 Form.List
            >
                <Form form={form} layout="vertical" name="relationship_form_modal" initialValues={{ dynamic_changes: [{change_description: ''}]}}>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item name="character_a_id" label="角色 A" rules={[{ required: true, message: '请选择角色A!' }]}>
                                <Select
                                    showSearch placeholder="选择角色A"
                                    filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                                    options={charactersForSelect.map(c => ({label: c.name, value: String(c.id)}))}
                                    disabled={isModalLoading}
                                />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                             <Form.Item name="character_b_id" label="角色 B" rules={[{ required: true, message: '请选择角色B!' }]}>
                                <Select
                                    showSearch placeholder="选择角色B"
                                    filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                                    options={charactersForSelect.filter(c => String(c.id) !== form.getFieldValue('character_a_id')) // 排除已选的角色A
                                        .map(c => ({label: c.name, value: String(c.id)}))
                                    }
                                    disabled={isModalLoading || !form.getFieldValue('character_a_id')}
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item name="relationship_type" label="关系类型" rules={[{ required: true, message: '请选择关系类型!' }]}>
                                <Select placeholder="选择关系类型" options={relationshipTypeOptions} disabled={isModalLoading}/>
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                             <Form.Item name="status" label="关系状态" rules={[{ required: true, message: '请选择关系状态!' }]}>
                                <Select placeholder="选择关系状态" options={relationshipStatusOptions} disabled={isModalLoading}/>
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item name="description" label="关系描述 (可选)">
                        <TextArea rows={3} placeholder="详细描述这段关系的性质、背景和重要性等。" />
                    </Form.Item>
                     <Form.Item name="plot_version_id" label="关联剧情版本 (可选)">
                        <Select placeholder="选择此关系所属的剧情版本" allowClear loading={plotVersions.length === 0 && isLoading /* 使用页面主加载状态 */} disabled={isModalLoading}>
                            {plotVersions.map(pv => <Option key={pv.id} value={pv.id}>{pv.name}</Option>)}
                        </Select>
                    </Form.Item>
                     <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item name="start_chapter_index" label="关系开始于章节 (0-based, 可选)">
                                <InputNumber min={0} style={{width:'100%'}} placeholder="输入章节索引"/>
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="end_chapter_index" label="关系结束于章节 (0-based, 可选)">
                                <InputNumber min={0} style={{width:'100%'}} placeholder="输入章节索引"/>
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.List name="dynamic_changes">
                        {(fields, { add, remove }, { errors }) => (
                            <>
                                <Divider orientation="left" plain>关系动态变化 (可选)</Divider>
                                {fields.map((field, index) => (
                                    <Card size="small" key={field.key} style={{ marginBottom: 16, background:'#fafafa' }}
                                          title={<Text type="secondary">变化记录 #{index + 1}</Text>}
                                          extra={<Button type="text" danger onClick={() => remove(field.name)} icon={<DeleteOutlined />} disabled={isModalLoading}/>}
                                    >
                                        <Row gutter={16}>
                                            <Col xs={24} sm={8}>
                                                <Form.Item
                                                    {...field}
                                                    name={[field.name, 'chapter_index']}
                                                    label="发生于章节 (0-based)"
                                                    // noStyle
                                                    // rules={[{ type: 'integer', message: '必须是整数' }]} // 也可以添加校验
                                                >
                                                    <InputNumber placeholder="章节索引" style={{width:'100%'}} min={0}/>
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} sm={16}>
                                                <Form.Item
                                                    {...field}
                                                    name={[field.name, 'event_trigger']}
                                                    label="触发事件/原因 (可选)"
                                                    // noStyle
                                                >
                                                    <Input placeholder="描述触发此变化的事件或原因" />
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                        <Form.Item
                                            {...field}
                                            name={[field.name, 'change_description']}
                                            label="变化描述"
                                            rules={[{ required: true, message: '请输入变化描述' }]}
                                            // noStyle
                                        >
                                            <TextArea rows={2} placeholder="描述关系如何变化" />
                                        </Form.Item>
                                    </Card>
                                ))}
                                <Form.Item>
                                    <Button type="dashed" onClick={() => add({change_description: ''})} block icon={<PlusOutlined />} disabled={isModalLoading}>
                                        添加动态变化记录
                                    </Button>
                                    <Form.ErrorList errors={errors} />
                                </Form.Item>
                            </>
                        )}
                    </Form.List>
                </Form>
            </Modal>
        </Layout>
    );
};

export default CharacterRelationshipListPage;