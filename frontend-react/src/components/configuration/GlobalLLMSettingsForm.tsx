// frontend-react/src/components/configuration/GlobalLLMSettingsForm.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Form, Input, InputNumber, Select, Checkbox, Button, Tooltip, Divider, Space, Tag, Popconfirm, Typography } from 'antd';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'react-toastify';
import { InfoCircleOutlined, PlusOutlined, DeleteOutlined, QuestionCircleOutlined } from '@ant-design/icons';

// 从 API 服务导入必要的类型和函数
import {
    LLMSettingsConfig,
    PredefinedTaskEnum,
    getPredefinedTasks,
    PredefinedTask,
} from '../../services/api'; //

// 导入共享样式
import sharedFormStyles from './SharedSettingsForm.module.css'; //

const { Title } = Typography;

// --- 使用 Zod 定义表单的校验 Schema ---
// 这确保了表单数据与后端期望的类型一致
const taskModelPreferenceSchema = z.object({
    task_type: z.nativeEnum(PredefinedTaskEnum, {
        errorMap: () => ({ message: "必须选择一个有效的预定义任务类型。" }),
    }),
    model_id_or_alias: z.string().min(1, "模型ID或别名不能为空。"),
});

const llmSettingsSchema = z.object({
    default_model_id: z.string().nullable().optional(),
    default_llm_fallback: z.string().min(1, "全局回退模型ID不能为空。").nullable().optional(),
    api_timeout: z.number().int().positive("超时时间必须是正整数。").min(10, "超时时间至少为10秒。"),
    api_retries: z.number().int().min(0, "重试次数不能为负。").max(5, "重试次数最多为5次。"),
    content_safety_check: z.boolean(),
    task_model_preference: z.array(taskModelPreferenceSchema).optional(),
});

// 从 Zod Schema 推断出表单数据的 TypeScript 类型
type LLMSettingsFormData = z.infer<typeof llmSettingsSchema>;

// 定义组件的 Props 接口
interface GlobalLLMSettingsFormProps {
    settings: LLMSettingsConfig; // 从父组件接收的全局LLM配置
    // onUpdate 回调函数，用于将部分更新传递回父组件
    onUpdate: (updates: Partial<LLMSettingsConfig>) => void;
}

// React Select 选项的类型，用于模型选择下拉框
interface ModelSelectOption {
    value: string; // 模型ID或别名
    label: string; // 显示的标签
}

const GlobalLLMSettingsForm: React.FC<GlobalLLMSettingsFormProps> = ({ settings, onUpdate }) => {
    // --- State 定义 ---
    // 存储从API获取的预定义任务列表
    const [predefinedTasks, setPredefinedTasks] = useState<PredefinedTask[]>([]);
    // 任务列表加载状态
    const [tasksLoading, setTasksLoading] = useState<boolean>(true);

    // --- react-hook-form 初始化 ---
    const {
        control,
        reset,
        watch,
        setValue,
        formState: { errors },
    } = useForm<LLMSettingsFormData>({
        resolver: zodResolver(llmSettingsSchema), // 使用Zod进行校验
        defaultValues: settings, // 设置表单的默认值
    });
    
    // 使用 useFieldArray 管理动态的“任务模型偏好”列表
    const { fields: preferenceFields, append: appendPreference, remove: removePreference } = useFieldArray({
        control,
        name: "task_model_preference",
    });

    // --- 数据获取 ---
    // 组件加载时，从API获取预定义任务列表
    useEffect(() => {
        const fetchTasks = async () => {
            try {
                setTasksLoading(true);
                const tasks = await getPredefinedTasks(); //
                setPredefinedTasks(tasks || []);
            } catch (error) {
                toast.error("获取预定义任务列表失败。");
                console.error("Failed to fetch predefined tasks:", error);
            } finally {
                setTasksLoading(false);
            }
        };
        fetchTasks();
    }, []);

    // --- 状态同步 ---
    // 当父组件传入的 settings 更新时，重置表单以同步最新数据
    useEffect(() => {
        reset(settings);
    }, [settings, reset]);

    // --- 派生数据 (Derived Data) ---
    // 使用 useMemo 缓存用于下拉框的模型选项，避免不必要的重复计算
    const modelAndAliasOptions = useMemo((): ModelSelectOption[] => { //
        const models = settings.available_models?.map(m => ({ value: m.user_given_id, label: `${m.user_given_name} (ID: ${m.user_given_id})` })) || [];
        const aliases = settings.model_aliases?.map(a => ({ value: a.alias, label: `${a.alias} (别名)` })) || [];
        return [...models, ...aliases].sort((a,b) => a.label.localeCompare(b.label));
    }, [settings.available_models, settings.model_aliases]);
    
    // 用于“任务偏好”设置的下拉框选项，与上面相同
    const modelAndAliasOptionsForPreference = useMemo(() => modelAndAliasOptions, [modelAndAliasOptions]); //

    // --- 事件处理 ---
    // 类型安全的字段变更处理函数
    const handleFieldChange = <K extends keyof LLMSettingsFormData>(name: K, value: LLMSettingsFormData[K]) => {
        // 使用 react-hook-form 的 setValue 更新内部状态，并触发校验
        setValue(name, value, { shouldValidate: true, shouldDirty: true });
        // 调用父组件的 onUpdate 回调，传递部分更新
        // onUpdate 的类型签名保证了这里的类型安全
        onUpdate({ [name]: value });
    };

    // --- 渲染逻辑 ---
    return (
        <Form layout="vertical" className={sharedFormStyles.settingsForm}>
            <Title level={4}>全局大语言模型(LLM)设置</Title>
            <p className={sharedFormStyles.formDescription}>
                配置与大语言模型交互相关的全局默认参数。这些设置将作为所有LLM调用的基础。
            </p>
            <Divider />

            {/* 表单项：默认模型ID */}
            <Form.Item
                label="默认模型ID"
                tooltip="在未指定模型时，系统将默认使用此模型。可以是用户定义的模型ID或别名。"
                validateStatus={errors.default_model_id ? 'error' : ''}
                help={errors.default_model_id?.message}
            >
                <Controller
                    name="default_model_id"
                    control={control}
                    render={({ field }) => (
                        <Select
                            {...field}
                            allowClear
                            showSearch
                            placeholder="选择一个默认模型或别名"
                            optionFilterProp="label"
                            onChange={(value) => handleFieldChange('default_model_id', value)} // 使用类型安全的回调
                            options={modelAndAliasOptions} // 使用缓存的选项
                        />
                    )}
                />
            </Form.Item>

            {/* 表单项：全局回退模型ID */}
            <Form.Item
                label="全局回退模型ID"
                tooltip="当默认模型调用失败时，将尝试使用此模型。必须是一个有效的用户定义模型ID。"
                validateStatus={errors.default_llm_fallback ? 'error' : ''}
                help={errors.default_llm_fallback?.message}
            >
                 <Controller
                    name="default_llm_fallback"
                    control={control}
                    render={({ field }) => (
                         <Select
                            {...field}
                            allowClear
                            showSearch
                            placeholder="选择一个回退模型"
                            optionFilterProp="label"
                            onChange={(value) => handleFieldChange('default_llm_fallback', value)}
                            options={modelAndAliasOptions}
                        />
                    )}
                />
            </Form.Item>

            {/* 表单项：API超时和重试次数 */}
            <Space align="start" wrap>
                <Form.Item
                    label="API超时时间 (秒)"
                    tooltip="向LLM提供商发出请求的等待超时时间。"
                    validateStatus={errors.api_timeout ? 'error' : ''}
                    help={errors.api_timeout?.message}
                >
                    <Controller
                        name="api_timeout"
                        control={control}
                        render={({ field }) => (
                            <InputNumber {...field} min={10} max={300} onChange={(value) => handleFieldChange('api_timeout', value ?? 60)} style={{ width: 150 }} />
                        )}
                    />
                </Form.Item>

                <Form.Item
                    label="API重试次数"
                    tooltip="当请求失败时，自动重试的最大次数。"
                    validateStatus={errors.api_retries ? 'error' : ''}
                    help={errors.api_retries?.message}
                >
                    <Controller
                        name="api_retries"
                        control={control}
                        render={({ field }) => (
                            <InputNumber {...field} min={0} max={5} onChange={(value) => handleFieldChange('api_retries', value ?? 2)} style={{ width: 150 }} />
                        )}
                    />
                </Form.Item>
            </Space>

            {/* 表单项：内容安全检查 */}
            <Form.Item>
                <Controller
                    name="content_safety_check"
                    control={control}
                    render={({ field }) => (
                        <Checkbox {...field} checked={field.value} onChange={(e) => handleFieldChange('content_safety_check', e.target.checked)}>
                            启用内容安全检查
                            <Tooltip title="对LLM的输入和输出进行内容安全检查，可能会增加延迟。">
                                <InfoCircleOutlined style={{ marginLeft: 8, color: 'rgba(0,0,0,.45)' }} />
                            </Tooltip>
                        </Checkbox>
                    )}
                />
            </Form.Item>

            <Divider />

            {/* 动态表单项：任务模型偏好 */}
            <Title level={5}>任务模型偏好</Title>
            <p className={sharedFormStyles.formDescription}>
                为特定的预定义任务类型指定优先使用的模型。如果未指定，将使用全局默认模型。
            </p>
            <div className={sharedFormStyles.dynamicListContainer}>
                {preferenceFields.map((item, index) => (
                    <Space key={item.id} className={sharedFormStyles.dynamicListItem} align="baseline">
                        {/* 任务类型选择 */}
                        <Form.Item
                            validateStatus={errors.task_model_preference?.[index]?.task_type ? 'error' : ''}
                            help={errors.task_model_preference?.[index]?.task_type?.message}
                            style={{ flexGrow: 1 }}
                        >
                            <Controller
                                name={`task_model_preference.${index}.task_type`}
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        {...field}
                                        placeholder="选择任务类型"
                                        style={{ minWidth: 280 }}
                                        loading={tasksLoading}
                                        onChange={(value) => {
                                            const currentPrefs = watch('task_model_preference') || [];
                                            currentPrefs[index].task_type = value;
                                            handleFieldChange('task_model_preference', currentPrefs);
                                        }}
                                    >
                                        {predefinedTasks.map(task => (
                                            <Option key={task.task_type} value={task.task_type} title={task.description}>
                                                <Space>
                                                    {task.task_type}
                                                    <Tag color="blue">{task.label}</Tag>
                                                </Space>
                                            </Option>
                                        ))}
                                    </Select>
                                )}
                            />
                        </Form.Item>
                        {/* 模型ID/别名选择 */}
                        <Form.Item
                            validateStatus={errors.task_model_preference?.[index]?.model_id_or_alias ? 'error' : ''}
                            help={errors.task_model_preference?.[index]?.model_id_or_alias?.message}
                            style={{ flexGrow: 1 }}
                        >
                            <Controller
                                name={`task_model_preference.${index}.model_id_or_alias`}
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        {...field}
                                        style={{ minWidth: 280 }}
                                        placeholder="选择用户定义模型ID或别名"
                                        showSearch
                                        optionFilterProp="label"
                                        onChange={(value) => {
                                            const currentPrefs = watch('task_model_preference') || [];
                                            currentPrefs[index].model_id_or_alias = value;
                                            handleFieldChange('task_model_preference', currentPrefs);
                                        }}
                                        options={modelAndAliasOptionsForPreference}
                                    />
                                )}
                            />
                        </Form.Item>
                        {/* 删除按钮 */}
                         <Popconfirm title="删除此任务偏好？" onConfirm={() => { const currentPrefs = watch('task_model_preference')?.filter((_, i) => i !== index) || []; handleFieldChange('task_model_preference', currentPrefs); removePreference(index); }} okText="确认" cancelText="取消" icon={<QuestionCircleOutlined style={{ color: 'red' }} />}>
                            <Button icon={<DeleteOutlined />} type="text" danger className={sharedFormStyles.deleteButtonSmallIconOnly}/>
                        </Popconfirm>
                    </Space>
                ))}
                {/* 添加按钮 */}
                <Button type="dashed" onClick={() => appendPreference({ task_type: PredefinedTaskEnum.CUSTOM_INSTRUCTION, model_id_or_alias: '' })} icon={<PlusOutlined />} className={sharedFormStyles.addButtonDynamic}> 添加任务模型偏好 </Button>
            </div>
        </Form>
    );
};

export default GlobalLLMSettingsForm;