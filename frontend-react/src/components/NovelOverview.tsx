// frontend-react/src/components/NovelOverview.tsx
import React, { useState, useEffect, useCallback, FormEvent, useMemo } from 'react';
import { toast } from 'react-toastify';
import {
    Typography,
    Button,
    Spin,
    Alert,
    Tag,
    Descriptions,
    Card,
    Input,
    Form,
    Modal, // 用于编辑表单
    Space,
    Row,
    Col,
    List, // 用于展示冲突列表
    Tooltip,
} from 'antd'; // 导入 Ant Design 组件
import {
    BookOutlined,
    UserOutlined,
    TagOutlined,
    EditOutlined,
    SaveOutlined,
    InfoCircleOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    SyncOutlined,
    SearchOutlined,
    FileTextOutlined,
    AlertTriangleOutlined,
    SettingsOutlined, // 用于世界观设置
    LinkOutlined, // 用于跳转链接
    ThunderboltOutlined, // 用于冲突
} from '@ant-design/icons'; // 使用 Ant Design 图标

import {
    Novel,
    NovelUpdate, // 用于更新小说元数据
    updateNovel as apiUpdateNovel,
    searchSimilarChunksInNovel,
    SimilaritySearchResultItem,
    SimilaritySearchQuery,
    NovelAnalysisStatusEnum,
    getAnalysisStatusInfoTextAndIcon, // 之前版本中的辅助函数，需要确保其存在或重新实现
    startNovelAnalysis as apiStartNovelAnalysis, // API 触发分析
    retryFailedAnalysis as apiRetryAnalysis, // API 重试分析
    updateNovelWorldviewSettings, // API 更新世界观
    Conflict, // 冲突类型
    ConflictLevelEnum, // 冲突级别枚举
} from '../services/api';

// 导入子组件
import SentimentChart from './SentimentChart'; // 情感图表组件
import SimilaritySearchResultsDisplay from './SimilaritySearchResultsDisplay'; // 相似性搜索结果展示组件
import WorldviewEditModal from './WorldviewEditModal'; // 世界观编辑模态框

// 样式
import pageStyles from '../pages/PageStyles.module.css'; // 通用页面样式
import styles from './NovelOverview.module.css'; // 组件特定样式

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

// NovelOverview 组件 Props 定义
interface NovelOverviewProps {
    novel: Novel | null; // 当前小说对象
    onNovelUpdate: () => void; // 小说数据更新后的回调
}

// 将Novel数据转换为表单可用的数据结构
interface NovelFormData {
    title: string;
    author: string | null;
    summary: string | null;
    genre: string | null;
    target_audience_profile: string | null;
    keywords: string; // 关键词以逗号分隔的字符串形式编辑
}

const NovelOverview: React.FC<NovelOverviewProps> = ({ novel, onNovelUpdate }) => {
    const [isEditingMetadata, setIsEditingMetadata] = useState<boolean>(false); // 控制元数据编辑模态框的显示
    const [form] = Form.useForm<NovelFormData>(); // Ant Design 表单实例

    const [isWorldviewModalOpen, setIsWorldviewModalOpen] = useState<boolean>(false); // 控制世界观编辑模态框
    const [isSavingWorldview, setIsSavingWorldview] = useState<boolean>(false); // 世界观保存状态

    const [isSearching, setIsSearching] = useState<boolean>(false); // 相似性搜索加载状态
    const [searchQuery, setSearchQuery] = useState<string>(''); // 搜索查询词
    const [searchResults, setSearchResults] = useState<SimilaritySearchResultItem[]>([]); // 搜索结果
    const [searchError, setSearchError] = useState<string | null>(null); // 搜索错误
    const [lastExecutedQuery, setLastExecutedQuery] = useState<string | null>(null); // 上次执行的查询

    // 当 novel prop 更新时，用新数据重置表单
    useEffect(() => {
        if (novel) {
            form.setFieldsValue({
                title: novel.title,
                author: novel.author || null,
                summary: novel.summary || null,
                genre: novel.genre || null,
                target_audience_profile: novel.target_audience_profile || null,
                keywords: novel.keywords?.join(', ') || '',
            });
        }
    }, [novel, form, isEditingMetadata]); // 当 isEditingMetadata 变化（模态框打开）时也重置表单

    // 处理元数据编辑模态框的保存
    const handleSaveMetadata = async () => {
        if (!novel) return;
        try {
            const values = await form.validateFields();
            const novelUpdateData: Partial<NovelUpdate> = { // 使用 Partial<NovelUpdate>
                title: values.title,
                author: values.author || undefined, // 空字符串转 undefined
                summary: values.summary || undefined,
                genre: values.genre || undefined,
                target_audience_profile: values.target_audience_profile || undefined,
                keywords: values.keywords ? values.keywords.split(',').map(kw => kw.trim()).filter(Boolean) : [],
            };

            await apiUpdateNovel(novel.id, novelUpdateData as NovelUpdate); // 类型断言
            toast.success(`小说 "${values.title}" 的元数据已更新。`);
            setIsEditingMetadata(false);
            onNovelUpdate(); // 通知父组件刷新数据
        } catch (errorInfo: any) {
            console.error('保存元数据失败:', errorInfo);
            if (errorInfo.errorFields) {
                toast.error("表单校验失败，请检查输入。");
            } else {
                toast.error(`保存元数据失败: ${(errorInfo as Error).message || '未知错误'}`);
            }
        }
    };

    // 处理世界观设定的保存
    const handleSaveWorldview = async (newWorldviewData: Record<string, any>) => {
        if (!novel) { toast.error("小说数据未加载，无法保存世界观。"); return; }
        setIsSavingWorldview(true);
        try {
            await updateNovelWorldviewSettings(novel.id, newWorldviewData);
            toast.success("世界观设定已成功更新！");
            setIsWorldviewModalOpen(false);
            onNovelUpdate(); // 刷新父组件数据
        } catch (err: any) {
            toast.error(err.message || "保存世界观设定失败。");
        } finally {
            setIsSavingWorldview(false);
        }
    };

    // 触发小说分析或重试分析
    const triggerAnalysis = async (isRetry: boolean = false) => {
        if (!novel) return;
        const action = isRetry ? apiRetryAnalysis : apiStartNovelAnalysis;
        const actionText = isRetry ? "重试分析" : "开始分析";
        try {
            toast.info(`正在为小说《${novel.title}》${actionText}...`, { autoClose: 2000 });
            await action(novel.id);
            // 状态将在轮询中更新，这里可以给一个即时反馈
            onNovelUpdate(); // 触发父组件刷新，父组件的轮询会处理状态更新
        } catch (err: any) {
            toast.error(`${actionText}失败: ${err.message || '未知错误'}`);
        }
    };


    // 渲染分析状态的UI (AntD Tag 版本)
    const renderAnalysisStatusAntd = () => {
        if (!novel) return null;
        const { text, icon: IconComponent, color } = getAnalysisStatusInfoTextAndIcon(novel.analysis_status, novel.vectorization_status);
        return (
            <Tag icon={<IconComponent />} color={color} style={{ fontSize: '14px', padding: '4px 10px' }}>
                {text}
            </Tag>
        );
    };

    // 渲染主要剧情冲突
    const renderMainConflicts = () => {
        if (!novel || !novel.main_conflict_ids || novel.main_conflict_ids.length === 0) {
            return <Text type="secondary" italic>暂无主要剧情冲突信息。</Text>;
        }
        // 假设 novel.conflicts 数组已通过 novel 对象传递
        const mainConflictsDetails = novel.conflicts?.filter(c => novel.main_conflict_ids.includes(c.id)) || [];

        if (mainConflictsDetails.length === 0) {
            return <Text type="secondary" italic>主要冲突详情未加载或ID列表与实际冲突不匹配。</Text>;
        }

        return (
            <List
                itemLayout="vertical"
                dataSource={mainConflictsDetails.slice(0, 5)} // 最多显示5条
                renderItem={(conflict: Conflict) => (
                    <List.Item key={conflict.id} className={styles.mainConflictItemAntd}>
                        <List.Item.Meta
                            title={
                                <Space>
                                    <Text strong>{conflict.description.substring(0, 80)}{conflict.description.length > 80 ? '...' : ''}</Text>
                                    <Tag color={conflict.level === ConflictLevelEnum.MAJOR ? "error" : "warning"}>
                                        {conflict.level || 'N/A'}
                                    </Tag>
                                </Space>
                            }
                            description={<Text type="secondary">状态: {conflict.status || 'N/A'}</Text>}
                        />
                        {/* 可以添加更多冲突细节的展示 */}
                    </List.Item>
                )}
            />
        );
    };


    // 处理相似性搜索 (与之前版本逻辑类似)
    const handleSearchSubmit = async (e?: FormEvent<HTMLFormElement>) => {
        if (e) e.preventDefault();
        if (!novel) { toast.warn('小说数据尚未加载完成。'); return; }
        if (!searchQuery.trim()) { toast.info('请输入搜索关键词。'); return; }
        if (novel.vectorization_status !== NovelAnalysisStatusEnum.COMPLETED) {
            toast.warn('小说内容尚未完成向量化，无法进行相似性搜索。请先确保分析和向量化任务已完成。');
            return;
        }

        setIsSearching(true); setSearchError(null); setLastExecutedQuery(searchQuery);
        try {
            const requestParams: SimilaritySearchQuery = { query: searchQuery, top_n: 7 }; // 调整top_n
            const response = await searchSimilarChunksInNovel(novel.id, requestParams);
            setSearchResults(response.results || []);
            if (response.results && response.results.length > 0) {
                toast.success(`找到 ${response.results.length} 条与 "${searchQuery}" 相关的内容。`);
            } else {
                toast.info(`未能找到与 "${searchQuery}" 相关的相似内容。`);
            }
        } catch (err: any) {
            const errorMsg = err.message || "相似性搜索失败。";
            setSearchError(errorMsg); toast.error(`搜索失败: ${errorMsg}`);
        } finally {
            setIsSearching(false);
        }
    };

    if (!novel) { // novel 为 null 时，不应渲染此组件，由父组件 NovelDetailPage 处理加载和错误
        return <div className={pageStyles.pageLoadingContainer}><Spin tip="加载小说概览..." /></div>;
    }

    return (
        <div className={styles.novelOverviewContainerAntd}>
            <Row gutter={[24, 24]}>
                {/* 左侧：元数据与操作 */}
                <Col xs={24} md={12} lg={8}>
                    <Card
                        title={<Space><InfoCircleOutlined />基本信息与状态</Space>}
                        className={styles.overviewCardAntd}
                        extra={
                            <Space>
                                <Button icon={<EditOutlined />} onClick={() => setIsEditingMetadata(true)} size="small">
                                    编辑元数据
                                </Button>
                                {(novel.analysis_status === NovelAnalysisStatusEnum.FAILED || novel.analysis_status === NovelAnalysisStatusEnum.COMPLETED_WITH_ERRORS) && (
                                    <Button icon={<SyncOutlined />} onClick={() => triggerAnalysis(true)} size="small" danger>
                                        重试分析
                                    </Button>
                                )}
                                {(novel.analysis_status === NovelAnalysisStatusEnum.PENDING || novel.analysis_status === null ) && (
                                    <Button icon={<SyncOutlined />} onClick={() => triggerAnalysis(false)} size="small" type="primary">
                                        开始分析
                                    </Button>
                                )}
                            </Space>
                        }
                    >
                        <Descriptions bordered column={1} size="small">
                            <Descriptions.Item label="标题">{novel.title}</Descriptions.Item>
                            <Descriptions.Item label="作者">{novel.author || <Text type="secondary" italic>未提供</Text>}</Descriptions.Item>
                            <Descriptions.Item label="类型/风格">{novel.genre || <Text type="secondary" italic>未指定</Text>}</Descriptions.Item>
                            <Descriptions.Item label="目标读者">{novel.target_audience_profile || <Text type="secondary" italic>未指定</Text>}</Descriptions.Item>
                            <Descriptions.Item label="关键词">
                                {novel.keywords && novel.keywords.length > 0
                                    ? novel.keywords.map(kw => <Tag key={kw} color="blue">{kw}</Tag>)
                                    : <Text type="secondary" italic>无</Text>}
                            </Descriptions.Item>
                            <Descriptions.Item label="文件路径" contentStyle={{wordBreak: 'break-all'}}>{novel.file_path}</Descriptions.Item>
                            <Descriptions.Item label="分析状态">{renderAnalysisStatusAntd()}</Descriptions.Item>
                            <Descriptions.Item label="向量化状态">
                                <Tag color={getAnalysisStatusInfoTextAndIcon(novel.vectorization_status).color}>
                                    {getAnalysisStatusInfoTextAndIcon(novel.vectorization_status).text}
                                </Tag>
                            </Descriptions.Item>
                        </Descriptions>
                        {novel.analysis_errors && novel.analysis_errors.length > 0 && (
                            <Alert
                                message="分析错误"
                                description={<List size="small" dataSource={novel.analysis_errors} renderItem={item => <List.Item>{item}</List.Item>} />}
                                type="error"
                                showIcon style={{ marginTop: 16 }}
                            />
                        )}
                    </Card>

                    <Card title={<Space><SettingsOutlined />世界观设定</Space>} className={styles.overviewCardAntd} style={{marginTop: 24}}
                        extra={<Button icon={<EditOutlined />} onClick={() => setIsWorldviewModalOpen(true)} size="small">编辑设定</Button>}
                    >
                        {novel.worldview_settings && Object.keys(novel.worldview_settings).length > 0 ? (
                             <List
                                size="small"
                                dataSource={Object.entries(novel.worldview_settings).slice(0, 7)} // 最多显示7条
                                renderItem={([key, value]) => (
                                    <List.Item className={styles.worldviewListItemAntd}>
                                        <Text strong className={styles.worldviewKeyAntd}>{key}:</Text>
                                        <Text ellipsis={{tooltip: String(value)}} className={styles.worldviewValueAntd}>{String(value)}</Text>
                                    </List.Item>
                                )}
                            />
                        ) : ( <Text type="secondary" italic>暂无详细世界观设定，点击编辑添加。</Text> )}
                        {novel.worldview_settings && Object.keys(novel.worldview_settings).length > 7 && (
                            <Text type="secondary" italic style={{display:'block', textAlign:'right', marginTop:8}}>...等共 {Object.keys(novel.worldview_settings).length} 条设定。</Text>
                        )}
                    </Card>
                </Col>

                {/* 右侧：摘要、主要冲突、相似性搜索 */}
                <Col xs={24} md={12} lg={16}>
                    <Card title={<Space><FileTextOutlined />小说摘要</Space>} className={styles.overviewCardAntd}>
                        <Paragraph ellipsis={{ rows: 7, expandable: true, symbol: '展开' }} style={{whiteSpace:'pre-wrap'}}>
                            {novel.summary || <Text type="secondary" italic>暂无摘要信息。请先运行小说分析。</Text>}
                        </Paragraph>
                    </Card>

                    <Card title={<Space><ThunderboltOutlined />主要剧情冲突</Space>} className={styles.overviewCardAntd} style={{marginTop: 24}}
                        extra={novelId ? <Link to={`/novels/${novelId}/conflicts`}><Button size="small" icon={<LinkOutlined/>}>管理所有冲突</Button></Link> : null}
                    >
                        {renderMainConflicts()}
                    </Card>

                    <Card title={<Space><SearchOutlined />内容相似性搜索 (向量)</Space>} className={styles.overviewCardAntd} style={{marginTop: 24}}>
                        <Form onFinish={handleSearchSubmit} layout="inline" style={{ marginBottom: 16, display:'flex' }}>
                            <Form.Item style={{flexGrow:1}}>
                                <Input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="输入关键词搜索相关文本片段..."
                                    disabled={isSearching || novel.vectorization_status !== NovelAnalysisStatusEnum.COMPLETED}
                                />
                            </Form.Item>
                            <Form.Item>
                                <Button
                                    type="primary"
                                    htmlType="submit"
                                    loading={isSearching}
                                    disabled={isSearching || novel.vectorization_status !== NovelAnalysisStatusEnum.COMPLETED}
                                    title={novel.vectorization_status !== NovelAnalysisStatusEnum.COMPLETED ? '小说向量化未完成，无法搜索' : '执行搜索'}
                                >
                                    搜索
                                </Button>
                            </Form.Item>
                        </Form>
                         {novel.vectorization_status !== NovelAnalysisStatusEnum.COMPLETED && (
                            <Alert type="warning" showIcon message="提示：内容相似性搜索功能依赖于小说内容的向量化处理。当前小说的向量化未完成，此功能可能不可用或结果不准确。" style={{marginBottom:16}}/>
                        )}
                        <SimilaritySearchResultsDisplay
                            results={searchResults}
                            isLoading={isSearching}
                            error={searchError}
                            queryText={lastExecutedQuery}
                            novelId={novel.id}
                        />
                    </Card>
                </Col>
            </Row>

            {/* 元数据编辑模态框 */}
            <Modal
                title={<Space><EditOutlined />编辑小说元数据</Space>}
                open={isEditingMetadata}
                onOk={handleSaveMetadata}
                onCancel={() => setIsEditingMetadata(false)}
                confirmLoading={form.getFieldsError().some(field => field.errors.length > 0)} // 仅在校验通过时启用OK
                destroyOnClose
                maskClosable={false}
                okText="保存元数据"
                cancelText="取消"
                width={680}
            >
                <Form form={form} layout="vertical" name="novel_metadata_form">
                    <Form.Item name="title" label="小说标题" rules={[{ required: true, message: '请输入小说标题!' }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="author" label="作者">
                        <Input />
                    </Form.Item>
                    <Form.Item name="summary" label="内容摘要">
                        <TextArea rows={5} />
                    </Form.Item>
                    <Form.Item name="genre" label="类型/风格">
                        <Input placeholder="例如：玄幻, 都市, 科幻机甲" />
                    </Form.Item>
                    <Form.Item name="target_audience_profile" label="目标读者画像">
                        <TextArea rows={2} placeholder="例如：18-25岁男性, 喜爱快节奏爽文" />
                    </Form.Item>
                    <Form.Item name="keywords" label="关键词 (逗号分隔)">
                        <Input placeholder="例如：升级, 系统, 无敌" />
                    </Form.Item>
                </Form>
            </Modal>

            {/* 世界观编辑模态框 */}
            {novel && (
                <WorldviewEditModal
                    isOpen={isWorldviewModalOpen}
                    onClose={() => setIsWorldviewModalOpen(false)}
                    currentWorldview={novel.worldview_settings}
                    onSave={handleSaveWorldview}
                    isSaving={isSavingWorldview}
                />
            )}
        </div>
    );
};

export default NovelOverview;