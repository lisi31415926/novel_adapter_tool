// frontend-react/src/components/configuration/UserDefinedLLMConfigList.tsx
import React, { useState } from 'react';
import { Table, Button, Tag, Popconfirm, Tooltip, Typography, Space } from 'antd';
import { ColumnsType } from 'antd/es/table';
import { EditOutlined, DeleteOutlined, PlusOutlined, QuestionCircleOutlined } from '@ant-design/icons';

// 从 API 服务导入核心类型
import {
    LLMSettingsConfig,
    UserDefinedLLMConfig,
} from '../../services/api'; //
import UserDefinedLLMConfigForm from './UserDefinedLLMConfigForm'; // 导入表单组件
import sharedFormStyles from './SharedSettingsForm.module.css'; // 导入共享样式

const { Title, Text } = Typography;

// 定义列表组件的 Props 接口
interface UserDefinedLLMConfigListProps {
    settings: LLMSettingsConfig; // 包含 available_models 数组的全局LLM配置
    providerTags: string[];      // 可用的提供商标签列表
    onUpdate: (updates: Partial<LLMSettingsConfig>) => void; // 当列表内容发生变化时（增、删、改）的回调函数
}

const UserDefinedLLMConfigList: React.FC<UserDefinedLLMConfigListProps> = ({ settings, providerTags, onUpdate }) => {
    // --- State 定义 ---
    const [isModalOpen, setIsModalOpen] = useState(false); // 控制表单模态框的可见性
    // 存储当前正在编辑的模型对象。如果为 null，表示正在创建新模型。
    const [editingModel, setEditingModel] = useState<UserDefinedLLMConfig | null>(null);
    const [isLoading, setIsLoading] = useState(false); // 用于在模拟保存操作时显示加载状态

    // --- 事件处理 ---
    // 打开“添加模型”模态框
    const handleAddModel = () => {
        setEditingModel(null); // 清空编辑对象，表示是新建操作
        setIsModalOpen(true);
    };

    // 打开“编辑模型”模态框
    const handleEditModel = (model: UserDefinedLLMConfig) => {
        setEditingModel(model); // 设置当前正在编辑的模型
        setIsModalOpen(true);
    };

    // 关闭模态框
    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingModel(null); // 清理状态
    };

    // 处理删除模型
    const handleDeleteModel = (modelToDelete: UserDefinedLLMConfig) => {
        // 从当前模型列表中过滤掉要删除的模型
        const updatedModels = settings.available_models?.filter(
            m => m.user_given_id !== modelToDelete.user_given_id
        ) || [];
        // 通过 onUpdate 回调将更新后的整个 available_models 数组传递给父组件
        onUpdate({ available_models: updatedModels });
    };

    // 处理表单保存（新建或更新）
    const handleSaveModel = (modelToSave: UserDefinedLLMConfig, isNew: boolean) => {
        setIsLoading(true);
        let updatedModels: UserDefinedLLMConfig[];

        if (isNew) {
            // 如果是新建，将新模型添加到现有列表的末尾
            updatedModels = [...(settings.available_models || []), modelToSave];
        } else {
            // 如果是编辑，找到旧模型并替换为新模型
            updatedModels = (settings.available_models || []).map(m =>
                m.user_given_id === modelToSave.user_given_id ? modelToSave : m
            );
        }

        // 通过 onUpdate 回调将更新后的整个 available_models 数组传递给父组件
        onUpdate({ available_models: updatedModels });

        // 模拟保存延迟后关闭模态框
        setTimeout(() => {
            setIsLoading(false);
            handleCloseModal();
        }, 300);
    };
    
    // --- Ant Design Table 的列定义 ---
    // 使用 ColumnsType<UserDefinedLLMConfig> 来确保列定义与数据类型的匹配
    const columns: ColumnsType<UserDefinedLLMConfig> = [
        {
            title: '启用',
            dataIndex: 'enabled',
            key: 'enabled',
            width: 80,
            render: (enabled: boolean) => (
                <Tag color={enabled ? 'green' : 'red'}>{enabled ? '是' : '否'}</Tag>
            ),
        },
        {
            title: '用户定义ID',
            dataIndex: 'user_given_id',
            key: 'user_given_id',
            sorter: (a, b) => a.user_given_id.localeCompare(b.user_given_id),
        },
        {
            title: '用户定义名称',
            dataIndex: 'user_given_name',
            key: 'user_given_name',
            sorter: (a, b) => a.user_given_name.localeCompare(b.user_given_name),
        },
        {
            title: '提供商',
            dataIndex: 'provider_tag',
            key: 'provider_tag',
            filters: providerTags.map(tag => ({ text: tag, value: tag })),
            onFilter: (value, record) => record.provider_tag === value,
            render: (tag: string) => <Tag>{tag}</Tag>,
        },
        {
            title: '模型API标识符',
            dataIndex: 'model_identifier_for_api',
            key: 'model_identifier_for_api',
            render: (text: string) => <Tooltip title={text}><Text style={{ maxWidth: 200 }} ellipsis>{text}</Text></Tooltip>,
        },
        {
            title: '操作',
            key: 'action',
            width: 120,
            render: (_, record: UserDefinedLLMConfig) => (
                <Space size="small">
                    <Tooltip title="编辑">
                        <Button icon={<EditOutlined />} onClick={() => handleEditModel(record)} size="small" />
                    </Tooltip>
                    <Popconfirm
                        title={`确定要删除模型 "${record.user_given_name}" 吗？`}
                        onConfirm={() => handleDeleteModel(record)}
                        okText="确认删除"
                        cancelText="取消"
                        icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
                    >
                        <Tooltip title="删除">
                            <Button icon={<DeleteOutlined />} danger size="small" />
                        </Tooltip>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    // --- 渲染逻辑 ---
    return (
        <div className={sharedFormStyles.settingsForm}>
            <div className={sharedFormStyles.formHeaderFlex}>
                <div>
                    <Title level={4}>自定义LLM模型配置</Title>
                    <p className={sharedFormStyles.formDescription}>
                        在这里添加和管理可供系统使用的具体LLM模型。您可以为同一个提供商添加多个不同的模型配置。
                    </p>
                </div>
                <Button type="primary" icon={<PlusOutlined />} onClick={handleAddModel}>
                    添加新模型
                </Button>
            </div>
            
            {/* 模型列表表格 */}
            <Table
                columns={columns}
                dataSource={settings.available_models || []}
                rowKey="user_given_id"
                pagination={{ pageSize: 10, size: 'small' }}
                size="small"
                className={sharedFormStyles.antdTable}
            />

            {/* 模型编辑/创建表单模态框 */}
            <UserDefinedLLMConfigForm
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onSave={handleSaveModel}
                initialData={editingModel}
                providerTags={providerTags}
                // 在编辑模式下，当前模型的ID不应被视为“已存在”
                existingIds={(settings.available_models || []).map(m => m.user_given_id).filter(id => id !== editingModel?.user_given_id)}
                isLoading={isLoading}
            />
        </div>
    );
};

export default UserDefinedLLMConfigList;