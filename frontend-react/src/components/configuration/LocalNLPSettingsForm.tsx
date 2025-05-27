// frontend-react/src/components/configuration/LocalNLPSettingsForm.tsx
import React, { useEffect } from 'react';
import { Form, Input, Select, Switch, Tooltip, Divider, Typography } from 'antd';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { InfoCircleOutlined } from '@ant-design/icons';

// 从 API 服务导入核心类型
import { LocalNLPSettingsConfig, LocalNLPSentenceSplitterModelEnum, LocalNLPSentimentModelEnum, LocalNLPDeviceEnum } from '../../services/api';

// 导入共享样式
import sharedFormStyles from './SharedSettingsForm.module.css';

const { Title } = Typography;
const { Option } = Select;

// --- 使用 Zod 定义表单的校验 Schema ---
// 这确保了表单数据与后端期望的类型一致
const localNLPSettingsSchema = z.object({
    enabled: z.boolean(),
    device: z.nativeEnum(LocalNLPDeviceEnum, {
        errorMap: () => ({ message: "必须选择一个有效的设备。" }),
    }),
    sentence_splitter_model: z.nativeEnum(LocalNLPSentenceSplitterModelEnum, {
        errorMap: () => ({ message: "必须选择一个有效的句子分割模型。" }),
    }),
    sentiment_model: z.nativeEnum(LocalNLPSentimentModelEnum, {
        errorMap: () => ({ message: "必须选择一个有效的情感分析模型。" }),
    }),
});

// 从 Zod Schema 推断出表单数据的 TypeScript 类型
type LocalNLPFormData = z.infer<typeof localNLPSettingsSchema>;

// 定义组件的 Props 接口
interface LocalNLPSettingsFormProps {
    settings: LocalNLPSettingsConfig; // 从父组件接收的本地NLP配置
    // onUpdate 回调函数，用于将部分更新传递回父组件
    onUpdate: (updates: Partial<LocalNLPSettingsConfig>) => void;
}

const LocalNLPSettingsForm: React.FC<LocalNLPSettingsFormProps> = ({ settings, onUpdate }) => {
    // --- react-hook-form 初始化 ---
    const {
        control,
        reset,
        setValue,
        formState: { errors },
    } = useForm<LocalNLPFormData>({
        resolver: zodResolver(localNLPSettingsSchema), // 使用Zod进行校验
        defaultValues: settings, // 设置表单的默认值
    });

    // --- 状态同步 ---
    // 当父组件传入的 settings 更新时，重置表单以同步最新数据
    useEffect(() => {
        reset(settings);
    }, [settings, reset]);

    // --- 事件处理 ---
    // 类型安全的字段变更处理函数
    const handleFieldChange = <K extends keyof LocalNLPFormData>(name: K, value: LocalNLPFormData[K]) => {
        // 使用 react-hook-form 的 setValue 更新内部状态，并触发校验
        setValue(name, value, { shouldValidate: true, shouldDirty: true });
        // 调用父组件的 onUpdate 回调，传递部分更新
        // onUpdate 的类型签名保证了这里的类型安全
        onUpdate({ [name]: value });
    };

    // --- 渲染逻辑 ---
    return (
        <Form layout="vertical" className={sharedFormStyles.settingsForm}>
            <Title level={4}>本地NLP服务设置</Title>
            <p className={sharedFormStyles.formDescription}>
                配置用于句子分割、情感分析等任务的本地自然语言处理服务。这些任务在您的本地机器上运行，不依赖外部API。
            </p>
            <Divider />

            {/* 表单项：启用本地NLP服务 */}
            <Form.Item>
                <Controller
                    name="enabled"
                    control={control}
                    render={({ field }) => (
                        <Switch
                            {...field}
                            checked={field.value}
                            onChange={(checked) => handleFieldChange('enabled', checked)}
                        />
                    )}
                />
                <span className={sharedFormStyles.switchLabel}>启用本地NLP服务</span>
                <Tooltip title="启用后，系统将使用本地模型进行句子分割和情感分析，这可以提高处理速度并降低成本。首次启用可能需要下载模型文件。">
                    <InfoCircleOutlined className={sharedFormStyles.tooltipIcon} />
                </Tooltip>
            </Form.Item>

            {/* 表单项：运行设备 */}
            <Form.Item
                label="运行设备"
                tooltip="选择运行本地NLP模型的硬件设备。如果选择 'cuda' 但没有兼容的NVIDIA GPU，系统将自动回退到 'cpu'。"
                validateStatus={errors.device ? 'error' : ''}
                help={errors.device?.message}
            >
                <Controller
                    name="device"
                    control={control}
                    render={({ field }) => (
                        <Select
                            {...field}
                            onChange={(value) => handleFieldChange('device', value)}
                            style={{ width: 250 }}
                        >
                            {Object.values(LocalNLPDeviceEnum).map(device => (
                                <Option key={device} value={device}>
                                    {device.toUpperCase()}
                                </Option>
                            ))}
                        </Select>
                    )}
                />
            </Form.Item>

            {/* 表单项：句子分割模型 */}
            <Form.Item
                label="句子分割模型"
                tooltip="选择用于将文本分割成句子的模型。"
                validateStatus={errors.sentence_splitter_model ? 'error' : ''}
                help={errors.sentence_splitter_model?.message}
            >
                <Controller
                    name="sentence_splitter_model"
                    control={control}
                    render={({ field }) => (
                        <Select
                            {...field}
                            onChange={(value) => handleFieldChange('sentence_splitter_model', value)}
                            style={{ width: '100%' }}
                        >
                            {Object.values(LocalNLPSentenceSplitterModelEnum).map(model => (
                                <Option key={model} value={model}>{model}</Option>
                            ))}
                        </Select>
                    )}
                />
            </Form.Item>

            {/* 表单项：情感分析模型 */}
            <Form.Item
                label="情感分析模型"
                tooltip="选择用于分析文本情感倾向的模型。"
                validateStatus={errors.sentiment_model ? 'error' : ''}
                help={errors.sentiment_model?.message}
            >
                <Controller
                    name="sentiment_model"
                    control={control}
                    render={({ field }) => (
                        <Select
                            {...field}
                            onChange={(value) => handleFieldChange('sentiment_model', value)}
                            style={{ width: '100%' }}
                        >
                            {Object.values(LocalNLPSentimentModelEnum).map(model => (
                                <Option key={model} value={model}>{model}</Option>
                            ))}
                        </Select>
                    )}
                />
            </Form.Item>
        </Form>
    );
};

export default LocalNLPSettingsForm;