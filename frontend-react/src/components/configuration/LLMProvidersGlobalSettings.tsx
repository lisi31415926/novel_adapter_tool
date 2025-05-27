// frontend-react/src/components/configuration/LLMProvidersGlobalSettings.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { Form, Input, InputNumber, Switch, Tooltip, Collapse, Tag, Alert, Button } from 'antd';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { LLMProviderConfig, UserDefinedLLMConfig } from '../../services/api'; // 导入核心类型
import styles from './LLMProvidersGlobalSettings.module.css'; // 引入组件特定样式
import sharedFormStyles from './SharedSettingsForm.module.css'; // 引入共享表单样式
import { InfoCircleOutlined, CloudServerOutlined, EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons'; // 引入 Ant Design 图标

const { Panel } = Collapse;
const { Password } = Input;

// --- 单个 Provider 配置的 Zod Schema ---
// 用于 react-hook-form 的表单校验
const providerConfigSchema = z.object({
    enabled: z.boolean(),
    api_key: z.string().optional().nullable(), // API Key 是可选的
    api_timeout_seconds: z.number().int().min(0, "超时不能为负").nullable().optional(),
    max_retries: z.number().int().min(0, "重试次数不能为负").nullable().optional(),
});

// 从 Zod Schema 推断出表单数据的 TypeScript 类型
type ProviderFormData = z.infer<typeof providerConfigSchema>;

// React Select/AntD Select 选项的类型
interface ModelSelectOption {
    value: string;
    label: string;
}

// --- 内部子组件：单个LLM提供商的设置表单 ---
// 定义子组件的 Props 接口
interface LLMProviderSingleSettingProps {
    providerTag: string; // 提供商的唯一标签，如 'openai'
    config: LLMProviderConfig; // 该提供商当前的配置
    onSettingChange: (providerTag: string, updates: Partial<LLMProviderConfig>) => void; // 当设置变更时调用的回调
}

const LLMProviderSingleSetting: React.FC<LLMProviderSingleSettingProps> = ({ providerTag, config, onSettingChange }) => {
    // --- State 定义 ---
    const [apiKeyVisible, setApiKeyVisible] = useState(false); // 控制 API Key 是否可见

    // --- react-hook-form 初始化 ---
    const { control, reset, setValue } = useForm<ProviderFormData>({
        resolver: zodResolver(providerConfigSchema), // 使用Zod进行校验
        defaultValues: { // 设置表单默认值
            enabled: config.enabled,
            api_key: config.api_key || '', // API Key 可能为 null
            api_timeout_seconds: config.api_timeout_seconds,
            max_retries: config.max_retries,
        },
    });

    // --- 状态同步 ---
    // 当父组件传入的 config 更新时，重置表单以同步最新数据
    useEffect(() => {
        reset({
            enabled: config.enabled,
            api_key: config.api_key || '',
            api_timeout_seconds: config.api_timeout_seconds,
            max_retries: config.max_retries,
        });
    }, [config, reset]);

    // --- 事件处理 ---
    // 类型安全的字段变更处理函数
    const handleFieldChange = <K extends keyof ProviderFormData>(name: K, value: ProviderFormData[K]) => {
        setValue(name, value, { shouldValidate: true, shouldDirty: true });
        // 调用父组件的 onSettingChange 回调，传递提供商标签和部分更新
        onSettingChange(providerTag, { [name]: value });
    };

    return (
        <Form layout="vertical" className={styles.singleProviderForm}>
            {/* 启用开关 */}
            <Form.Item label="启用此提供商">
                <Controller
                    name="enabled"
                    control={control}
                    render={({ field }) => (
                        <Switch {...field} checked={field.value} onChange={(checked) => handleFieldChange('enabled', checked)} />
                    )}
                />
            </Form.Item>
            {/* API Key 输入框 */}
            <Form.Item
                label="API Key"
                tooltip="如果为空，系统将尝试从环境变量中读取。"
            >
                <Controller
                    name="api_key"
                    control={control}
                    render={({ field }) => (
                        <Password
                            {...field}
                            placeholder="留空则使用环境变量"
                            visibilityToggle={{ visible: apiKeyVisible, onVisibleChange: setApiKeyVisible }}
                            iconRender={visible => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
                            onChange={(e) => handleFieldChange('api_key', e.target.value)}
                        />
                    )}
                />
            </Form.Item>
            {/* API 超时和重试次数 */}
            <div className={sharedFormStyles.formRow}>
                <Form.Item label="API 超时 (秒)" tooltip="针对此提供商的API请求超时时间。留空则使用全局设置。">
                    <Controller
                        name="api_timeout_seconds"
                        control={control}
                        render={({ field }) => (
                            <InputNumber {...field} placeholder="全局默认" onChange={(value) => handleFieldChange('api_timeout_seconds', value)} style={{ width: '100%' }} />
                        )}
                    />
                </Form.Item>
                <Form.Item label="API 重试次数" tooltip="针对此提供商的API请求失败重试次数。留空则使用全局设置。">
                    <Controller
                        name="max_retries"
                        control={control}
                        render={({ field }) => (
                            <InputNumber {...field} placeholder="全局默认" onChange={(value) => handleFieldChange('max_retries', value)} style={{ width: '100%' }} />
                        )}
                    />
                </Form.Item>
            </div>
             {/* API Key 来源提示 */}
             {config.api_key_source && (
                 <Alert
                    message={<span>API Key 来源: <Tag color="blue">{config.api_key_source}</Tag></span>}
                    description="如果此处为空，这表示当前有效的API Key是从服务器环境变量或配置文件中加载的。在此处输入新值将覆盖它。"
                    type="info"
                    showIcon
                    className={styles.apiKeySourceAlert}
                />
             )}
        </Form>
    );
};


// --- 主组件：LLM 提供商全局设置 ---
// 定义主组件的 Props 接口
interface LLMProvidersGlobalSettingsProps {
    settings: Record<string, LLMProviderConfig>; // 从父组件接收的提供商配置集合
    providerTags: string[]; // 所有可用的提供商标签列表
    onUpdate: (updates: Partial<Record<string, LLMProviderConfig>>) => void; // 回调函数，用于将整个提供商配置的更新传递回父组件
}

const LLMProvidersGlobalSettings: React.FC<LLMProvidersGlobalSettingsProps> = ({ settings, providerTags, onUpdate }) => {

    // --- 事件处理 ---
    // 处理来自子组件 LLMProviderSingleSetting 的配置变更
    const handleProviderConfigChange = (
        providerTag: string, 
        providerUpdates: Partial<LLMProviderConfig>
    ) => {
        // 获取该提供商当前的完整配置
        const currentProviderConfig = settings[providerTag] || {};
        // 将新的变更合并到当前配置上
        const updatedProviderConfig = { ...currentProviderConfig, ...providerUpdates };

        // 构造一个只包含被修改的提供商的更新对象
        const updatePayload: Partial<Record<string, LLMProviderConfig>> = {
            [providerTag]: updatedProviderConfig,
        };

        // 调用父组件的 onUpdate 回调，传递这个更新对象
        onUpdate(updatePayload);
    };

    // --- 渲染逻辑 ---
    return (
        <div className={sharedFormStyles.settingsForm}>
            <p className={sharedFormStyles.formDescription}>
                管理各个大语言模型（LLM）提供商的全局设置。您可以在这里启用/禁用特定的提供商，并配置它们的API密钥及其他参数。
            </p>
            <div className={styles.providersContainer}>
                {/* 使用 Collapse 组件来组织每个提供商的设置 */}
                <Collapse accordion defaultActiveKey={providerTags[0] || ''}>
                    {providerTags.map(providerTag => {
                        const config = settings[providerTag];
                        // 如果某个提供商在配置中不存在，则不渲染（或显示错误）
                        if (!config) {
                            return (
                                <Panel header={`${providerTag} - 配置缺失`} key={providerTag} disabled>
                                    <Alert message={`未能加载提供商 "${providerTag}" 的配置。`} type="warning" />
                                </Panel>
                            );
                        }
                        return (
                            <Panel
                                header={
                                    <span className={styles.panelHeader}>
                                        <CloudServerOutlined style={{ marginRight: 8, color: config.enabled ? '#52c41a' : '#8c8c8c' }} />
                                        {providerTag.charAt(0).toUpperCase() + providerTag.slice(1)} 全局设置
                                        <Tag color={config.enabled ? "green" : "red"} style={{ marginLeft: 10 }}>
                                            {config.enabled ? '已启用' : '已禁用'}
                                        </Tag>
                                    </span>
                                }
                                key={providerTag}
                                className={styles.providerPanel}
                            >
                                {/* 渲染单个提供商的设置表单子组件 */}
                                <LLMProviderSingleSetting
                                    providerTag={providerTag}
                                    config={config}
                                    onSettingChange={handleProviderConfigChange}
                                />
                            </Panel>
                        );
                    })}
                </Collapse>
            </div>
        </div>
    );
};

export default LLMProvidersGlobalSettings;