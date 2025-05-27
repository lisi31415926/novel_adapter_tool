// frontend-react/src/components/configuration/UserDefinedLLMConfigForm.tsx
import React, { useEffect } from 'react';
import { useForm, Controller, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Modal, Form, Input, Select, Checkbox, Button, Tooltip, Typography, Space } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { UserDefinedLLMConfig } from '../../services/api'; // 导入核心类型
import sharedFormStyles from './SharedSettingsForm.module.css'; // 导入共享样式

const { Title } = Typography;
const { Option } = Select;

// --- 使用 Zod 定义表单的校验 Schema ---
// 这个 schema 确保了表单数据在提交前的有效性和类型正确性
const llmConfigSchema = z.object({
    user_given_id: z.string()
        .min(1, "用户定义的唯一ID不能为空。")
        .regex(/^[a-zA-Z0-9_.-]+$/, "ID只能包含字母、数字、下划线、点和短横线。"),
    user_given_name: z.string().min(1, "用户定义的名称不能为空。"),
    model_identifier_for_api: z.string().min(1, "模型API标识符不能为空。"),
    provider_tag: z.string().min(1, "必须选择一个提供商标签。"),
    enabled: z.boolean(),
    api_key: z.string().optional().nullable(),
    base_url: z.string().url("必须是一个有效的URL。").optional().nullable(),
    notes: z.string().optional().nullable(),
});

// 从 Zod Schema 推断出表单数据的 TypeScript 类型
type LLMConfigFormData = z.infer<typeof llmConfigSchema>;

// 定义组件的 Props 接口
interface UserDefinedLLMConfigFormProps {
    isOpen: boolean; // 模态框是否可见
    onClose: () => void; // 关闭模态框的回调
    onSave: (model: UserDefinedLLMConfig, isNew: boolean) => void; // 保存模型的回调
    initialData?: UserDefinedLLMConfig | null; // 编辑时传入的初始数据，为 null 或 undefined 表示新建
    providerTags: string[]; // 可用的提供商标签列表
    existingIds: string[]; // 已存在的模型ID列表，用于校验唯一性
    isLoading: boolean; // 指示外部操作（如保存）是否正在进行
}

const UserDefinedLLMConfigForm: React.FC<UserDefinedLLMConfigFormProps> = ({
    isOpen,
    onClose,
    onSave,
    initialData,
    providerTags,
    existingIds,
    isLoading,
}) => {
    // 判断当前是编辑模式还是新建模式
    const isNew = !initialData;

    // --- react-hook-form 初始化 ---
    const {
        control,
        handleSubmit,
        reset,
        formState: { errors },
    } = useForm<LLMConfigFormData>({
        resolver: zodResolver(llmConfigSchema.refine(data => {
            // 添加自定义校验：如果是新建模型，其ID不能与已存在的ID重复
            if (isNew) {
                return !existingIds.includes(data.user_given_id);
            }
            return true; // 编辑模式下不检查ID唯一性（因为ID不可编辑）
        }, {
            message: "此用户定义ID已存在，请使用其他ID。",
            path: ['user_given_id'], // 指定错误关联到哪个字段
        })),
    });

    // --- 状态同步 ---
    // 当模态框打开或初始数据变化时，重置表单以填充最新数据
    useEffect(() => {
        if (isOpen) {
            // 如果有初始数据（编辑模式），则使用它，否则使用默认空值（新建模式）
            reset(initialData || {
                user_given_id: '',
                user_given_name: '',
                model_identifier_for_api: '',
                provider_tag: providerTags.length > 0 ? providerTags[0] : '', // 默认选中第一个提供商
                enabled: true,
                api_key: '',
                base_url: '',
                notes: '',
            });
        }
    }, [isOpen, initialData, reset, providerTags]);

    // --- 事件处理 ---
    // 定义表单提交处理函数，类型为 SubmitHandler<LLMConfigFormData>
    const onSubmit: SubmitHandler<LLMConfigFormData> = (data) => {
        // 创建一个完整的 UserDefinedLLMConfig 对象
        // 如果是编辑，保留原始的 api_key_source 等只读字段
        const modelToSave: UserDefinedLLMConfig = {
            ...initialData, // 包含 id, api_key_source 等
            ...data, // 使用表单中经过校验的数据覆盖
            api_key: data.api_key || null, // 将空字符串转为 null
            base_url: data.base_url || null,
            notes: data.notes || null,
        };
        onSave(modelToSave, isNew);
    };

    // --- 渲染逻辑 ---
    return (
        <Modal
            title={
                <Title level={4} style={{ margin: 0 }}>
                    {isNew ? '添加新的自定义LLM模型' : `编辑模型: ${initialData?.user_given_name}`}
                </Title>
            }
            open={isOpen}
            onCancel={onClose}
            footer={[
                <Button key="back" onClick={onClose} disabled={isLoading}>
                    取消
                </Button>,
                <Button key="submit" type="primary" loading={isLoading} onClick={handleSubmit(onSubmit)}>
                    {isNew ? '添加模型' : '保存更改'}
                </Button>,
            ]}
            width={720}
            destroyOnClose // 关闭时销毁内部组件状态
        >
            <Form layout="vertical" onFinish={handleSubmit(onSubmit)} className={sharedFormStyles.settingsForm} style={{ paddingTop: 24 }}>
                {/* 唯一ID 和 名称 */}
                <Space align="start" wrap style={{ width: '100%' }}>
                    <Form.Item
                        label="用户定义ID (唯一)"
                        required
                        validateStatus={errors.user_given_id ? 'error' : ''}
                        help={errors.user_given_id?.message}
                        style={{ flex: 1 }}
                    >
                        <Controller
                            name="user_given_id"
                            control={control}
                            render={({ field }) => <Input {...field} placeholder="例如: my-gpt4-turbo" disabled={!isNew || isLoading} />}
                        />
                    </Form.Item>
                    <Form.Item
                        label="用户定义名称"
                        required
                        validateStatus={errors.user_given_name ? 'error' : ''}
                        help={errors.user_given_name?.message}
                        style={{ flex: 1 }}
                    >
                        <Controller
                            name="user_given_name"
                            control={control}
                            render={({ field }) => <Input {...field} placeholder="例如: 我的GPT-4 Turbo" disabled={isLoading}/>}
                        />
                    </Form.Item>
                </Space>

                {/* 提供商 和 API模型标识符 */}
                <Space align="start" wrap style={{ width: '100%' }}>
                    <Form.Item
                        label="提供商 (Provider)"
                        required
                        validateStatus={errors.provider_tag ? 'error' : ''}
                        help={errors.provider_tag?.message}
                        style={{ flex: 1 }}
                    >
                        <Controller
                            name="provider_tag"
                            control={control}
                            render={({ field }) => (
                                <Select {...field} placeholder="选择一个提供商" disabled={isLoading}>
                                    {providerTags.map(tag => <Option key={tag} value={tag}>{tag}</Option>)}
                                </Select>
                            )}
                        />
                    </Form.Item>
                    <Form.Item
                        label="模型API标识符"
                        required
                        tooltip="调用提供商API时使用的具体模型名称, 例如: gpt-4-turbo-preview"
                        validateStatus={errors.model_identifier_for_api ? 'error' : ''}
                        help={errors.model_identifier_for_api?.message}
                        style={{ flex: 1 }}
                    >
                        <Controller
                            name="model_identifier_for_api"
                            control={control}
                            render={({ field }) => <Input {...field} placeholder="gpt-4-turbo-preview" disabled={isLoading}/>}
                        />
                    </Form.Item>
                </Space>

                {/* API Key 和 Base URL */}
                <Space align="start" wrap style={{ width: '100%' }}>
                    <Form.Item
                        label="API Key (可选)"
                        tooltip="如果留空, 将使用对应提供商的全局API Key或环境变量。"
                        style={{ flex: 1 }}
                    >
                        <Controller
                            name="api_key"
                            control={control}
                            render={({ field }) => <Input.Password {...field} value={field.value || ''} placeholder="为此模型指定独立的API Key" disabled={isLoading}/>}
                        />
                    </Form.Item>
                    <Form.Item
                        label="Base URL (可选)"
                        tooltip="如果提供商支持(如Ollama, LM Studio), 在此指定API的基础URL。"
                        validateStatus={errors.base_url ? 'error' : ''}
                        help={errors.base_url?.message}
                        style={{ flex: 1 }}
                    >
                        <Controller
                            name="base_url"
                            control={control}
                            render={({ field }) => <Input {...field} value={field.value || ''} placeholder="http://localhost:1234/v1" disabled={isLoading}/>}
                        />
                    </Form.Item>
                </Space>

                {/* 启用开关 */}
                <Form.Item>
                    <Controller
                        name="enabled"
                        control={control}
                        render={({ field }) => <Checkbox {...field} checked={field.value}>启用此模型配置</Checkbox>}
                    />
                </Form.Item>

                {/* 备注 */}
                <Form.Item label="备注 (可选)">
                    <Controller
                        name="notes"
                        control={control}
                        render={({ field }) => <Input.TextArea {...field} value={field.value || ''} rows={2} placeholder="关于此模型配置的任何备注..." disabled={isLoading}/>}
                    />
                </Form.Item>
            </Form>
        </Modal>
    );
};

export default UserDefinedLLMConfigForm;