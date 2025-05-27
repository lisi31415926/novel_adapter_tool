// frontend-react/src/components/configuration/SentimentThresholdsForm.tsx
import React, { useEffect } from 'react';
import { Form, InputNumber, Tooltip, Alert } from 'antd';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { SentimentThresholds } from '../../services/api'; // 导入核心类型
import styles from './SharedSettingsForm.module.css'; // 复用共享样式
import { InfoCircleOutlined, SmileOutlined } from '@ant-design/icons'; // 引入 Ant Design 图标

// --- 使用 Zod 定义表单的校验 Schema ---
// 与 backend/app/schemas.py 中的 SentimentThresholdsSchema 保持一致
const sentimentThresholdsSchema = z.object({
    positive_min_score: z.number()
        .min(0.0, "积极情感最小分值不能小于0.0。") // 根据 schemas.py, ge=0.0
        .max(1.0, "积极情感最小分值不能大于1.0。") // 根据 schemas.py, le=1.0
        .default(0.65), // 与 schemas.py 默认值一致
    negative_max_score: z.number()
        .min(0.0, "消极情感最大分值不能小于0.0。") // 根据 schemas.py, ge=0.0
        .max(1.0, "消极情感最大分值不能大于1.0。") // 根据 schemas.py, le=1.0
        .default(0.35), // 与 schemas.py 默认值一致
}).refine(data => data.positive_min_score > data.negative_max_score, {
    // 跨字段校验：确保积极分数的最小阈值大于消极分数的最大阈值
    message: "“积极情感最小分值”必须大于“消极情感最大分值”，以确保存在中性区间。",
    path: ["positive_min_score"], // 将错误关联到 positive_min_score 字段，或选择一个更通用的路径
});

// 从 Zod Schema 推断出表单数据的 TypeScript 类型
type SentimentFormData = z.infer<typeof sentimentThresholdsSchema>;

// 定义组件的 Props 接口
interface SentimentThresholdsFormProps {
    settings: SentimentThresholds | null | undefined; // 从父组件接收的情感阈值配置，允许为null或undefined
    // onSettingChange 回调函数，用于将特定字段的更新传递回父组件
    onSettingChange: <K extends keyof SentimentThresholds>(
        key: K,
        value: SentimentThresholds[K] // 值必须与 SentimentThresholds 中对应键的类型匹配
    ) => void;
    isSaving?: boolean; // 可选，如果此表单有独立的保存按钮，则用于指示保存状态
}

const SentimentThresholdsForm: React.FC<SentimentThresholdsFormProps> = ({
    settings,
    onSettingChange,
    isSaving, // 当前版本未使用，但保留以便未来可能的独立保存逻辑
}) => {
    // --- 为可选的 settings 对象及其内部可选字段提供默认值 ---
    // 这些默认值与 backend/app/schemas.py 中的 SentimentThresholdsSchema 保持一致
    const defaultValues: SentimentFormData = { //
        positive_min_score: settings?.positive_min_score ?? 0.65, //
        negative_max_score: settings?.negative_max_score ?? 0.35, //
    };

    // --- react-hook-form 初始化 ---
    const {
        control,
        reset, // 用于在 props 更新时重置表单
        formState: { errors } // 用于显示校验错误
    } = useForm<SentimentFormData>({
        resolver: zodResolver(sentimentThresholdsSchema), // 使用Zod进行校验
        defaultValues: defaultValues, // 设置表单的默认值
    });

    // --- 状态同步 ---
    // 当父组件传入的 settings 更新时，重置表单以同步最新数据
    useEffect(() => {
        reset({ //
             positive_min_score: settings?.positive_min_score ?? 0.65, //
             negative_max_score: settings?.negative_max_score ?? 0.35, //
        });
    }, [settings, reset]);

    // --- 渲染逻辑 ---
    // 父组件 ConfigurationPage 统一处理保存逻辑。
    // 此处表单的 onChange 事件会直接调用 onSettingChange 将数据更新到父组件的 updatedConfig 状态中。
    return (
        <Form layout="vertical" className={styles.antdFormContainer}> {/* 使用共享的 antd 表单容器样式 */}
            {/* 提示信息区域 */}
            <Alert
                message="情感分析阈值设置"
                description={
                    "当LLM对文本进行情感分析并返回数值评分时（通常在-1.0到1.0之间，经过归一化后可能在0.0到1.0之间），" +
                    "这些阈值用于将评分自动归类为“积极”、“消极”或“中性”。" +
                    "请确保“积极情感最小分值”大于“消极情感最大分值”，两者之间的区域将被视为“中性”。"
                }
                type="info"
                showIcon
                icon={<SmileOutlined />} // 使用 SmileOutlined 图标
                style={{ marginBottom: 24 }} // 与其他表单保持一致的间距
            />
            
            {/* 表单项网格布局 */}
            <div className={styles.formGrid}>
                {/* 表单项：积极情感最小分值 */}
                <Form.Item
                    label={
                        <Tooltip title="当LLM分析的情感评分（通常归一化到0-1范围）高于此值时，被认为是积极情感。有效范围：0.0 到 1.0。">
                            积极情感最小分值 <span className={styles.requiredStar}>*</span> {/* 必填星号 */}
                            <InfoCircleOutlined className={styles.tooltipIconAntd} /> {/* AntD 风格的 Tooltip 图标 */}
                        </Tooltip>
                    }
                    required // AntD Form.Item 的必填标记
                    validateStatus={errors.positive_min_score ? 'error' : ''} // 根据校验错误状态显示
                    help={errors.positive_min_score?.message} // 显示校验错误信息
                    className={styles.formItemAntd} // 使用共享的 AntD 表单项样式
                >
                    <Controller
                        name="positive_min_score"
                        control={control}
                        render={({ field }) => (
                            <InputNumber
                                {...field} // react-hook-form 提供的字段属性
                                min={0.0} // 根据 Zod schema
                                max={1.0} // 根据 Zod schema
                                step={0.01} // 步长
                                style={{ width: '100%' }}
                                placeholder="例如 0.65"
                                onChange={(value) => {
                                    field.onChange(value); // 更新 react-hook-form 内部状态
                                    // 直接调用父组件的 onSettingChange 方法，将变更实时传递上去
                                    // InputNumber 返回 number | null，确保传递 number
                                    onSettingChange('positive_min_score', Number(value ?? defaultValues.positive_min_score));
                                }}
                                value={field.value ?? undefined} // 确保 InputNumber 接收数字或undefined
                            />
                        )}
                    />
                </Form.Item>

                {/* 表单项：消极情感最大分值 */}
                <Form.Item
                    label={
                        <Tooltip title="当LLM分析的情感评分（通常归一化到0-1范围）低于此值时，被认为是消极情感。有效范围：0.0 到 1.0。此值必须小于“积极情感最小分值”。">
                            消极情感最大分值 <span className={styles.requiredStar}>*</span> {/* 必填星号 */}
                            <InfoCircleOutlined className={styles.tooltipIconAntd} /> {/* AntD 风格的 Tooltip 图标 */}
                        </Tooltip>
                    }
                    required // AntD Form.Item 的必填标记
                    validateStatus={errors.negative_max_score ? 'error' : ''} // 根据校验错误状态显示
                    help={errors.negative_max_score?.message} // 显示校验错误信息
                    className={styles.formItemAntd} // 使用共享的 AntD 表单项样式
                >
                    <Controller
                        name="negative_max_score"
                        control={control}
                        render={({ field }) => (
                            <InputNumber
                                {...field} // react-hook-form 提供的字段属性
                                min={0.0} // 根据 Zod schema
                                max={1.0} // 根据 Zod schema
                                step={0.01} // 步长
                                style={{ width: '100%' }}
                                placeholder="例如 0.35"
                                onChange={(value) => {
                                    field.onChange(value); // 更新 react-hook-form 内部状态
                                    // 直接调用父组件的 onSettingChange 方法，将变更实时传递上去
                                    onSettingChange('negative_max_score', Number(value ?? defaultValues.negative_max_score));
                                }}
                                value={field.value ?? undefined} // 确保 InputNumber 接收数字或undefined
                            />
                        )}
                    />
                </Form.Item>
            </div>
        </Form>
    );
};

export default SentimentThresholdsForm;