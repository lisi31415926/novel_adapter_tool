// frontend-react/src/pages/EventListPage.tsx
import React, { useState, useEffect, useCallback, useMemo, ChangeEvent as ReactChangeEvent } from 'react'; // ReactChangeEvent 用于区分 AntD 的 ChangeEvent
import { useParams, Link as RouterLink, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import moment from 'moment';
import {
    Layout,
    Typography,
    Button,
    Breadcrumb,
    Space,
    Input,
    Select,
    DatePicker,
    Modal,
    Form,
    InputNumber,
    Popconfirm,
    Alert,
    Spin,
    Tag,
    TablePaginationConfig,
    Collapse,
    // Checkbox, // 如果需要 Checkbox.Group
} from 'antd';
import {
    HomeOutlined,
    BookOutlined,
    CalendarOutlined,
    PlusCircleOutlined,
    SearchOutlined,
    FilterOutlined,
    RedoOutlined,
    UnorderedListOutlined,
    ExclamationCircleOutlined,
} from '@ant-design/icons';

// API 服务和类型
import {
    Novel,
    Event as EventInfo,
    PlotVersion,
    Character,
    getEventsByNovelId,
    deleteEvent as apiDeleteEvent,
    createEvent as apiCreateEvent,
    updateEvent as apiUpdateEvent,
    getNovelById,
    getPlotVersionsByNovelId,
    getCharactersByNovelId as apiGetCharactersForSelect,
    PaginatedResponse,
    GetEventsParams,
    SortDirectionEnum,
    EventCreate,
    EventUpdate,
} from '../services/api';

// 从 constants.ts 导入新的选项列表
import { EVENT_TYPES_OPTIONS, EVENT_IMPORTANCE_LEVELS_OPTIONS } from '../constants';

// 子组件 EventList (纯展示)
import EventList from '../components/EventList'; // 确保路径正确
import type { SortableEventFieldsList } from '../components/EventList'; // 确保路径正确

// 样式
import pageStyles from './PageStyles.module.css';
import styles from './EventListPage.module.css';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;
const { Panel } = Collapse;

const ITEMS_PER_PAGE_OPTIONS = ['10', '20', '50', '100']; // AntD Table pageSizeOptions 需要字符串数组

const EventListPage: React.FC = () => {
    const { novelId: novelIdParam } = useParams<{ novelId: string }>();
    const navigate = useNavigate();
    const novelId = novelIdParam ? parseInt(novelIdParam, 10) : null;

    const [novel, setNovel] = useState<Novel | null>(null);
    const [events, setEvents] = useState<EventInfo[]>([]);
    const [plotVersions, setPlotVersions] = useState<PlotVersion[]>([]);
    const [plotVersionsMap, setPlotVersionsMap] = useState<Record<number, string>>({});
    const [charactersForSelect, setCharactersForSelect] = useState<Character[]>([]);

    const [isLoading, setIsLoading] = useState<boolean>(true); // 主加载状态
    const [isModalLoading, setIsModalLoading] = useState<boolean>(false); // 模态框内操作的加载状态
    const [error, setError] = useState<string | null>(null);

    const [isModalVisible, setIsModalVisible] = useState<boolean>(false);
    const [editingEvent, setEditingEvent] = useState<EventInfo | null>(null);
    const [form] = Form.useForm<Omit<EventCreate, 'event_timestamp' | 'tags' | 'involved_character_ids' | 'related_event_ids'> & { 
        event_timestamp?: moment.Moment | null; 
        tags?: string; // 表单中tags用逗号分隔字符串
        involved_character_ids?: string[]; // 表单中用字符串ID数组
        related_event_ids?: string[];    // 表单中用字符串ID数组
    }>();


    const [filters, setFilters] = useState({
        summary: '',
        // tags: [] as string[], // 标签筛选暂时移除简化，如有需要可加回
        event_types: [] as string[],
        importance_level: null as number | null,
        plot_version_id: null as number | null,
        dateRange: null as [moment.Moment | null, moment.Moment | null] | null,
    });
    const [debouncedSummaryFilter, setDebouncedSummaryFilter] = useState<string>('');
    const [currentSortField, setCurrentSortField] = useState<SortableEventFieldsList>('event_timestamp');
    const [currentSortDirection, setCurrentSortDirection] = useState<SortDirectionEnum>(SortDirectionEnum.DESC);
    const [pagination, setPagination] = useState<TablePaginationConfig>({
        current: 1,
        pageSize: parseInt(ITEMS_PER_PAGE_OPTIONS[1], 10),
        total: 0,
        showSizeChanger: true,
        pageSizeOptions: ITEMS_PER_PAGE_OPTIONS,
        showTotal: (total, range) => `${range[0]}-${range[1]} 共 ${total} 项`,
    });

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSummaryFilter(filters.summary);
        }, 500);
        return () => clearTimeout(handler);
    }, [filters.summary]);

    const fetchNovelAndRelatedData = useCallback(async () => {
        if (!novelId) return;
        setIsLoading(true); // 开始加载时，设置主加载状态
        try {
            const promises = [];
            if (!novel) {
                promises.push(getNovelById(novelId));
            } else {
                promises.push(Promise.resolve(novel)); // 如果已存在，则直接解析
            }
            promises.push(getPlotVersionsByNovelId(novelId, { page: 1, page_size: 1000 }));
            promises.push(apiGetCharactersForSelect(novelId, { page: 1, page_size: 1000 }));

            const [novelData, versionsData, charsData] = await Promise.all(promises as [Promise<Novel>, Promise<PaginatedResponse<PlotVersion>>, Promise<PaginatedResponse<Character>>]);

            if (!novel) setNovel(novelData);
            setPlotVersions(versionsData.items || []);
            const map: Record<number, string> = {};
            (versionsData.items || []).forEach(v => { if(v.id && v.name) map[v.id] = v.name; });
            setPlotVersionsMap(map);
            setCharactersForSelect(charsData.items || []);

        } catch (err) {
            toast.error("加载小说、剧情版本或角色基础信息失败。");
            console.error("Error fetching novel related data:", err);
            setError("加载基础数据失败，请重试。");
        } finally {
            // fetchEvents 会在依赖更新后被调用，它会设置 setIsLoading(false)
        }
    }, [novelId, novel]);

    const fetchEvents = useCallback(async (
        page: number = pagination.current || 1,
        size: number = pagination.pageSize || parseInt(ITEMS_PER_PAGE_OPTIONS[1], 10),
        showToast: boolean = false
    ) => {
        if (!novelId) { setError("无效的小说ID。"); setIsLoading(false); return; }
        setIsLoading(true); setError(null);
        if (showToast) toast.info("刷新事件列表...", { autoClose: 1200 });

        const params: GetEventsParams = {
            page: page,
            page_size: size,
            summary: debouncedSummaryFilter.trim() || undefined,
            // tags: filters.tags.length > 0 ? filters.tags.join(',') : undefined, // 标签筛选暂时移除
            event_types: filters.event_types.length > 0 ? filters.event_types.join(',') : undefined,
            importance_level: filters.importance_level !== null ? filters.importance_level : undefined,
            plot_version_id: filters.plot_version_id !== null ? filters.plot_version_id : undefined,
            start_timestamp: filters.dateRange?.[0]?.toISOString() || undefined,
            end_timestamp: filters.dateRange?.[1]?.toISOString() || undefined,
            sort_by: currentSortField,
            sort_dir: currentSortDirection,
        };

        try {
            const response = await getEventsByNovelId(novelId, params);
            setEvents(response.items || []);
            setPagination(prev => ({
                ...prev,
                current: response.page,
                pageSize: response.page_size,
                total: response.total_count,
            }));
        } catch (err: any) {
            const errorMsg = err.response?.data?.detail || err.message || `加载事件列表失败。`;
            setError(errorMsg); toast.error(errorMsg);
            setEvents([]); setPagination(prev => ({ ...prev, total: 0, current: 1 }));
        } finally {
            setIsLoading(false);
        }
    }, [
        novelId, pagination.current, pagination.pageSize, debouncedSummaryFilter,
        filters, currentSortField, currentSortDirection
    ]);

    useEffect(() => {
        if (novelId) {
            fetchNovelAndRelatedData(); // 这个函数本身应该只在novelId变化时调用，或者如果novel是空的
        }
    }, [novelId, fetchNovelAndRelatedData]); // 确保 fetchNovelAndRelatedData 包含在依赖中，且其自身依赖正确

    useEffect(() => {
        // 确保基础数据加载完成后再获取事件列表
        if (novelId && novel && (plotVersions.length > 0 || !filters.plot_version_id) && (charactersForSelect.length > 0 || (editingEvent && isModalVisible))) {
             fetchEvents(pagination.current, pagination.pageSize, false);
        } else if (novelId && novel && !filters.plot_version_id && charactersForSelect.length > 0) {
             fetchEvents(pagination.current, pagination.pageSize, false);
        }
    }, [
        novelId, novel, plotVersions, charactersForSelect, // 确保这些数据存在
        pagination.current, pagination.pageSize,
        debouncedSummaryFilter, filters, currentSortField, currentSortDirection, fetchEvents
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
        const newSortField = sorter.field as SortableEventFieldsList || 'event_timestamp';
        const newSortOrder = sorter.order === 'ascend' ? SortDirectionEnum.ASC : sorter.order === 'descend' ? SortDirectionEnum.DESC : SortDirectionEnum.DESC;
        setCurrentSortField(newSortField);
        setCurrentSortDirection(newSortOrder);
        setPagination(prev => ({
            ...prev,
            current: newPagination.current || 1,
            pageSize: newPagination.pageSize || parseInt(ITEMS_PER_PAGE_OPTIONS[1], 10),
        }));
    };

    const handleOpenModal = (event?: EventInfo) => {
        if (event) {
            setEditingEvent(event);
            form.setFieldsValue({
                ...event,
                event_timestamp: event.event_timestamp ? moment(event.event_timestamp) : null,
                tags: event.tags?.join(', ') || '',
                involved_character_ids: event.involved_character_ids?.map(String) || [], // 转为字符串数组
                related_event_ids: event.related_event_ids?.map(String) || [],     // 转为字符串数组
            });
        } else {
            setEditingEvent(null);
            form.resetFields();
            if (filters.plot_version_id) {
                form.setFieldsValue({ plot_version_id: filters.plot_version_id });
            }
        }
        setIsModalVisible(true);
    };

    const handleModalCancel = () => {
        setIsModalVisible(false);
        setEditingEvent(null);
        form.resetFields();
    };

    const handleModalSave = async () => {
        if (!novelId) { toast.error("小说ID无效。"); return; }
        try {
            const values = await form.validateFields();
            setIsModalLoading(true); // 使用模态框专属加载状态

            const eventDataPayload: Partial<EventCreate | EventUpdate> = {
                ...values,
                event_timestamp: values.event_timestamp ? values.event_timestamp.toISOString() : null,
                tags: values.tags ? String(values.tags).split(',').map((t: string) => t.trim()).filter(Boolean) : [],
                involved_character_ids: values.involved_character_ids?.map(idStr => parseInt(idStr,10)).filter(id => !isNaN(id)) || [],
                related_event_ids: values.related_event_ids?.map(idStr => parseInt(idStr,10)).filter(id => !isNaN(id)) || [],
            };
            // 移除表单临时字段
            delete (eventDataPayload as any).involved_character_ids_str;
            delete (eventDataPayload as any).related_event_ids_str;


            if (editingEvent && editingEvent.id) {
                await apiUpdateEvent(novelId, editingEvent.id, eventDataPayload as EventUpdate);
                toast.success(`事件 "${values.summary}" 更新成功！`);
            } else {
                await apiCreateEvent(novelId, eventDataPayload as EventCreate);
                toast.success(`事件 "${values.summary}" 添加成功！`);
            }
            fetchEvents(1, pagination.pageSize, true); // 刷新到第一页
            handleModalCancel();
        } catch (err: any) {
            const errorMsg = err.response?.data?.detail || err.message || "保存事件信息失败。";
            if (err.errorFields) {
                 toast.error("表单校验失败，请检查输入。");
            } else {
                toast.error(errorMsg);
            }
        } finally {
            setIsModalLoading(false);
        }
    };

    const handleDeleteEvent = async (eventId: number) => {
        if (!novelId) return;
        // Popconfirm 的 onConfirm 内部调用此函数
        setIsLoading(true); // 可以使用主加载状态，因为会影响列表
        try {
            await apiDeleteEvent(novelId, eventId);
            toast.success(`事件 (ID: ${eventId}) 删除成功！`);
            if (events.length === 1 && (pagination.current || 1) > 1) {
                // 如果删除的是当前页最后一条，且不是第一页，则跳转到前一页
                setPagination(prev => ({...prev, current: (prev.current || 2) - 1}));
            } else {
                // 否则，刷新当前页
                fetchEvents(pagination.current, pagination.pageSize, true);
            }
        } catch (err: any) {
            toast.error(err.response?.data?.detail || err.message || "删除事件失败。");
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading && events.length === 0 && !novel && !error) { // 更精确的初始加载判断
        return <div className={pageStyles.pageLoadingContainer}><Spin size="large" tip="加载事件数据..." /></div>;
    }
    if (error && !novel && !isLoading) { // 仅当错误且小说信息也未加载时显示全局错误
        return (<Layout className={pageStyles.pageLayout}><Content className={pageStyles.pageContent}><Alert message="错误" description={error} type="error" showIcon action={<Button onClick={() => fetchNovelAndRelatedData()} icon={<RedoOutlined />}>重试基础数据</Button>} /></Content></Layout>);
    }
    if (!novel && !isLoading) { // 小说信息加载失败或不存在
        return (<Layout className={pageStyles.pageLayout}><Content className={pageStyles.pageContent}><Alert message="提示" description="未找到相关小说信息或加载失败。" type="info" showIcon action={<Button onClick={() => navigate("/novels")}>返回小说列表</Button>}/></Content></Layout>);
    }


    return (
        <Layout className={pageStyles.pageLayout}>
            <Breadcrumb className={pageStyles.breadcrumb}>
                <Breadcrumb.Item><RouterLink to="/"><HomeOutlined /> 首页</RouterLink></Breadcrumb.Item>
                <Breadcrumb.Item><RouterLink to="/novels"><BookOutlined /> 小说管理</RouterLink></Breadcrumb.Item>
                {novel && <Breadcrumb.Item><RouterLink to={`/novels/${novel.id}`}>《{novel.title}》</RouterLink></Breadcrumb.Item>}
                <Breadcrumb.Item>事件列表</Breadcrumb.Item>
            </Breadcrumb>

            <Content className={pageStyles.pageContent}>
                <div className={pageStyles.titleBar}>
                    <Title level={2} className={pageStyles.pageTitle}><CalendarOutlined style={{marginRight: 8}}/> 事件管理 {novel && `- 《${novel.title}》`}</Title>
                    <Button type="primary" icon={<PlusCircleOutlined />} onClick={() => handleOpenModal()}>
                        添加新事件
                    </Button>
                </div>

                <Collapse ghost className={styles.filterCollapse} defaultActiveKey={['1']}>
                    <Panel header={<Space><FilterOutlined />筛选与搜索选项</Space>} key="1">
                        <Form layout="vertical" className={styles.filterFormAntd}>
                            <Row gutter={16}>
                                <Col xs={24} sm={12} md={6}>
                                    <Form.Item label="搜索摘要/描述">
                                        <Input
                                            placeholder="关键词..."
                                            value={filters.summary}
                                            onChange={(e: ReactChangeEvent<HTMLInputElement>) => handleFilterChange({ summary: e.target.value })}
                                            prefix={<SearchOutlined />} allowClear disabled={isLoading}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12} md={6}>
                                    <Form.Item label="事件类型">
                                        <Select
                                            mode="multiple" value={filters.event_types}
                                            onChange={(values) => handleFilterChange({ event_types: values })}
                                            placeholder="选择事件类型" options={EVENT_TYPES_OPTIONS} // 使用常量
                                            allowClear disabled={isLoading}
                                            maxTagCount="responsive" // 响应式标签数量
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12} md={6}>
                                    <Form.Item label="重要性级别">
                                        <Select
                                            value={filters.importance_level}
                                            onChange={(value) => handleFilterChange({ importance_level: value })}
                                            placeholder="所有级别" options={EVENT_IMPORTANCE_LEVELS_OPTIONS} // 使用常量
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
                                <Col xs={24} sm={24} md={12}>
                                    <Form.Item label="发生日期范围">
                                        <RangePicker
                                            value={filters.dateRange}
                                            onChange={(dates) => handleFilterChange({ dateRange: dates as [moment.Moment | null, moment.Moment | null] | null })}
                                            style={{ width: '100%' }} disabled={isLoading} showTime
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} style={{ textAlign: 'right', marginTop: 8 }}>
                                    <Space>
                                        <Button onClick={() => {
                                            setFilters({ summary: '', tags: [], event_types: [], importance_level: null, plot_version_id: null, dateRange: null });
                                            setCurrentSortField('event_timestamp'); // 重置排序
                                            setCurrentSortDirection(SortDirectionEnum.DESC);
                                            setPagination(prev => ({...prev, current:1})); // 重置分页到第一页
                                            // fetchEvents 将因 filters 或 pagination 变化而触发
                                        }} disabled={isLoading}>
                                            重置所有筛选
                                        </Button>
                                         <Button type="primary" onClick={() => fetchEvents(1, pagination.pageSize, true)} icon={<RedoOutlined />} loading={isLoading}>
                                            应用筛选并刷新
                                        </Button>
                                    </Space>
                                </Col>
                            </Row>
                        </Form>
                    </Panel>
                </Collapse>

                {error && events.length === 0 && ( // 仅当列表为空且有错误时显示
                    <Alert message="数据加载错误" description={error} type="error" showIcon closable onClose={() => setError(null)} style={{ marginBottom: 16 }}/>
                )}

                <EventList
                    events={events}
                    isLoading={isLoading && events.length > 0} // 列表内部loading状态
                    novelId={novelId} // 确保novelId传递正确
                    plotVersionsMap={plotVersionsMap}
                    onDeleteEvent={handleDeleteEvent}
                    onEditEvent={handleOpenModal}
                    pagination={pagination}
                    onTableChange={handleTableChange}
                />
            </Content>

            <Modal
                title={editingEvent ? `编辑事件: ${editingEvent.summary.substring(0,30)}...` : "添加新事件"}
                open={isModalVisible}
                onOk={handleModalSave}
                onCancel={handleModalCancel}
                confirmLoading={isModalLoading} // 使用模态框专属加载状态
                destroyOnClose
                maskClosable={false}
                width={720}
            >
                <Form form={form} layout="vertical" name="event_form_modal">
                    <Form.Item name="summary" label="事件摘要" rules={[{ required: true, message: '请输入事件摘要!' }]}>
                        <Input placeholder="简要描述事件核心内容" />
                    </Form.Item>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item name="event_type" label="事件类型">
                                <Select placeholder="选择事件类型" options={EVENT_TYPES_OPTIONS} allowClear/>
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                             <Form.Item name="importance_level" label="重要性级别 (数字1-5)">
                                <Select placeholder="选择重要性" options={EVENT_IMPORTANCE_LEVELS_OPTIONS} allowClear/>
                            </Form.Item>
                        </Col>
                    </Row>
                     <Form.Item name="event_timestamp" label="发生时间 (可选)">
                        <DatePicker showTime format="YYYY-MM-DD HH:mm:ss" style={{width:'100%'}} placeholder="选择事件发生的大致时间"/>
                    </Form.Item>
                    <Form.Item name="location" label="发生地点 (可选)">
                        <Input placeholder="事件发生的具体地点或场景"/>
                    </Form.Item>
                    <Form.Item name="plot_version_id" label="关联剧情版本 (可选)">
                        <Select placeholder="选择此事件所属的剧情版本" allowClear loading={plotVersions.length === 0 && isLoading}>
                            {plotVersions.map(pv => <Option key={pv.id} value={pv.id}>{pv.name}</Option>)}
                        </Select>
                    </Form.Item>
                    <Form.Item name="description" label="详细描述 (可选)">
                        <TextArea rows={4} placeholder="详细描述事件的起因、经过、结果和影响等。" />
                    </Form.Item>
                    <Form.Item name="tags" label="标签 (可选, 逗号分隔的字符串)">
                        <Input placeholder="例如：关键转折, 角色冲突, 阴谋" />
                    </Form.Item>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item name="involved_character_ids" label="涉及角色 (可选)">
                                <Select
                                    mode="multiple"
                                    allowClear
                                    style={{ width: '100%' }}
                                    placeholder="选择涉及的角色"
                                    options={charactersForSelect.map(char => ({label: char.name, value: String(char.id)}))}
                                    filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                                    loading={isLoading && charactersForSelect.length === 0}
                                />
                            </Form.Item>
                        </Col>
                         <Col span={12}>
                            <Form.Item name="related_event_ids" label="关联事件 (可选)">
                                 <Select
                                    mode="multiple"
                                    allowClear
                                    style={{ width: '100%' }}
                                    placeholder="选择关联的事件"
                                    options={events
                                        .filter(e => !editingEvent || e.id !== editingEvent.id)
                                        .map(evt => ({label: `${evt.summary.substring(0,25)}... (ID: ${evt.id})`, value: String(evt.id)}))
                                    }
                                    filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                                    loading={isLoading && events.length === 0} // 当事件列表也为空时可以显示加载
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>
        </Layout>
    );
};

export default EventListPage;