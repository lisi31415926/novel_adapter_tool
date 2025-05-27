// frontend-react/src/components/configuration/PlanningSettingsForm.tsx
import React, { useEffect } from 'react';
import { Form, InputNumber, Checkbox, Tooltip, Alert } from 'antd';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlanningServiceSettingsConfig } from '../../services/api'; // 导入核心类型
import styles from './SharedSettingsForm.module.css'; // 复用共享样式
import { InfoCircleOutlined, ScheduleOutlined } from '@ant-design/icons'; // 引入 Ant Design 图标

// --- 使用 Zod 定义表单的校验 Schema ---
// 这个 schema 确保了表单数据在提交前的有效性和类型正确性
const planningSettingsSchema = z.object({
    use_semantic_recommendation: z.boolean().optional().default(true), // 默认为 true
    semantic_score_weight: z.number()
        .min(0, "权重不能为负数。")
        .max(5, "权重不宜过高 (建议0-5之间)。") // 示例：添加一个上限
        .nullable() // 允许用户清空此字段，后端应有默认值处理
        .optional(),
    max_recommendations: z.number()
        .int("必须为整数。")
        .min(1, "至少推荐1条规则链。")
        .max(20, "推荐数量不宜过多 (建议1-20之间)。") // 示例：添加一个上限
        .nullable()
        .optional(),
    plot_suggestion_context_max_tokens: z.number()
        .int("必须为整数。")
        .min(0, "Token数不能为负。") // 允许为0，表示不限制或使用其他逻辑
        .nullable()
        .optional(),
    plot_suggestion_max_tokens: z.number()
        .int("必须为整数。")
        .min(0, "Token数不能为负。")
        .nullable()
        .optional(),
});

// 从 Zod Schema 推断出表单数据的 TypeScript 类型
type PlanningFormData = z.infer<typeof planningSettingsSchema>;

// 定义组件的 Props 接口
interface PlanningSettingsFormProps {
    settings: PlanningServiceSettingsConfig | null | undefined; // 从父组件接收的AI规划配置，允许为null或undefined
    // onSettingChange 回调函数，用于将特定字段的更新传递回父组件
    onSettingChange: <K extends keyof PlanningServiceSettingsConfig>(
        key: K,
        value: PlanningServiceSettingsConfig[K] | null // 允许传递null来清空可选字段
    ) => void;
    isSaving?: boolean; // 可选，如果此表单有独立的保存按钮，则用于指示保存状态
}

const PlanningSettingsForm: React.FC<PlanningSettingsFormProps> = ({
    settings,
    onSettingChange,
    isSaving, // 当前版本未使用，但保留以便未来可能的独立保存逻辑
}) => {
    // --- 为可选的 settings 对象及其内部可选字段提供默认值 ---
    // 这确保了即使 settings 为 null 或某些字段未定义，表单也能正确初始化
    const defaultValues: PlanningFormData = { //
        use_semantic_recommendation: settings?.use_semantic_recommendation ?? true, //
        semantic_score_weight: settings?.semantic_score_weight ?? 1.5, //
        max_recommendations: settings?.max_recommendations ?? 5, //
        plot_suggestion_context_max_tokens: settings?.plot_suggestion_context_max_tokens ?? undefined, // InputNumber 为 undefined 时显示空
        plot_suggestion_max_tokens: settings?.plot_suggestion_max_tokens ?? undefined, //
    };

    // --- react-hook-form 初始化 ---
    const {
        control,
        reset, // 用于在 props 更新时重置表单
        watch, // 用于观察特定字段的值以实现条件逻辑
        formState: { errors } // 用于显示校验错误
    } = useForm<PlanningFormData>({
        resolver: zodResolver(planningSettingsSchema), // 使用Zod进行校验
        defaultValues: defaultValues, // 使用上面定义的默认值初始化表单
    });

    // 观察 'use_semantic_recommendation' 字段的值，以动态启用/禁用其他相关字段
    const useSemantic = watch('use_semantic_recommendation'); //

    // --- 状态同步 ---
    // 当父组件传入的 settings 更新时，重置表单以同步最新数据
    useEffect(() => {
        // 重新计算默认值并重置，确保 settings 为 null 或 undefined 时表单也能正确显示
        reset({ //
            use_semantic_recommendation: settings?.use_semantic_recommendation ?? true, //
            semantic_score_weight: settings?.semantic_score_weight ?? 1.5, //
            max_recommendations: settings?.max_recommendations ?? 5, //
            plot_suggestion_context_max_tokens: settings?.plot_suggestion_context_max_tokens ?? undefined, //
            plot_suggestion_max_tokens: settings?.plot_suggestion_max_tokens ?? undefined, //
        });
    }, [settings, reset]);

    // --- 渲染逻辑 ---
    // 父组件 ConfigurationPage 统一处理保存逻辑。
    // 此处表单的 onChange 事件会直接调用 onSettingChange 将数据更新到父组件的 updatedConfig 状态中。
    return (
        <Form layout="vertical" className={styles.antdFormContainer}> {/* 使用共享的 antd 表单容器样式 */}
            {/* 提示信息区域 */}
            <Alert
                message="AI规划服务设置"
                description="配置与AI辅助规划相关的功能，例如规则链模板的推荐算法参数、AI生成剧情版本建议时的Token限制等。"
                type="info"
                showIcon
                icon={<ScheduleOutlined />} // 使用 ScheduleOutlined 图标代表规划
                style={{ marginBottom: 24 }} // 与其他表单保持一致的间距
            />
            
            {/* 表单项网格布局 */}
            <div className={styles.formGrid}>
                {/* 表单项：启用语义推荐 */}
                <Form.Item
                    label="规则链推荐设置" // 作为一个整体的标签
                    className={`${styles.formItemAntd} ${styles.fullWidthField}`} // 占满整行
                    valuePropName="checked" // 对于 Controller 包裹 Checkbox，需要此 prop
                >
                    <Controller
                        name="use_semantic_recommendation"
                        control={control}
                        render={({ field }) => (
                            <Checkbox
                                {...field} // react-hook-form 提供的字段属性
                                checked={field.value} // useForm 会根据 defaultValues 提供初始值
                                onChange={(e) => {
                                    field.onChange(e.target.checked); // 更新 react-hook-form 内部状态
                                    // 直接调用父组件的 onSettingChange 方法，将变更实时传递上去
                                    onSettingChange('use_semantic_recommendation', e.target.checked);
                                }}
                            >
                                启用基于语义相似度的规则链模板推荐
                                <Tooltip title="勾选后，在为改编目标推荐规则链模板时，除了关键词匹配，还会计算模板与目标的语义相关度。需要正确配置嵌入模型。">
                                    <InfoCircleOutlined className={styles.tooltipIconAntd} /> {/* 使用 AntD 风格的 Tooltip 图标 */}
                                </Tooltip>
                            </Checkbox>
                        )}
                    />
                </Form.Item>

                {/* 表单项：语义评分权重 */}
                <Form.Item
                    label={
                        <Tooltip title="当启用语义推荐时，此权重用于调整语义评分在总推荐分中的占比。">
                            语义相似度评分权重 <InfoCircleOutlined className={styles.tooltipIconAntd} />
                        </Tooltip>
                    }
                    validateStatus={errors.semantic_score_weight ? 'error' : ''} // 根据校验错误状态显示
                    help={errors.semantic_score_weight?.message} // 显示校验错误信息
                    className={styles.formItemAntd} // 使用共享的 AntD 表单项样式
                >
                    <Controller
                        name="semantic_score_weight"
                        control={control}
                        render={({ field }) => (
                            <InputNumber
                                {...field}
                                min={0} // 根据 Zod schema
                                max={5} // 根据 Zod schema
                                step={0.1} // 步长
                                style={{ width: '100%' }}
                                placeholder="例如 1.5"
                                disabled={!useSemantic} // 当不使用语义推荐时禁用此字段
                                onChange={(value) => { // InputNumber 返回 value | null
                                    field.onChange(value);
                                    onSettingChange('semantic_score_weight', value === null ? null : Number(value)); // 确保传递数字或null
                                }}
                                value={field.value ?? undefined} // 确保传递给 InputNumber 的是数字或 undefined
                            />
                        )}
                    />
                </Form.Item>

                {/* 表单项：最大推荐规则链数量 */}
                <Form.Item
                    label="最大推荐规则链数量"
                    validateStatus={errors.max_recommendations ? 'error' : ''}
                    help={errors.max_recommendations?.message}
                    className={styles.formItemAntd}
                >
                    <Controller
                        name="max_recommendations"
                        control={control}
                        render={({ field }) => (
                            <InputNumber
                                {...field}
                                min={1} // 根据 Zod schema
                                max={20} // 根据 Zod schema
                                style={{ width: '100%' }}
                                placeholder="例如 5"
                                onChange={(value) => {
                                    field.onChange(value);
                                    onSettingChange('max_recommendations', value === null ? null : Number(value));
                                }}
                                value={field.value ?? undefined}
                            />
                        )}
                    />
                </Form.Item>
                
                {/* 表单项：剧情建议 - 上下文最大Token */}
                <Form.Item
                    label={
                        <Tooltip title="AI生成剧情版本建议时，从小说中提取并参考的上下文（如小说摘要、分支描述、父版本内容等）的最大Token数。留空则使用LLM的默认限制或全局限制。">
                            剧情建议 - 上下文最大Token <InfoCircleOutlined className={styles.tooltipIconAntd} />
                        </Tooltip>
                    }
                    validateStatus={errors.plot_suggestion_context_max_tokens ? 'error' : ''}
                    help={errors.plot_suggestion_context_max_tokens?.message}
                    className={styles.formItemAntd}
                >
                    <Controller
                        name="plot_suggestion_context_max_tokens"
                        control={control}
                        render={({ field }) => (
                            <InputNumber
                                {...field}
                                min={0} // 根据 Zod schema
                                style={{ width: '100%' }}
                                placeholder="例如 1000 或 2000"
                                onChange={(value) => {
                                    field.onChange(value);
                                    onSettingChange('plot_suggestion_context_max_tokens', value === null ? null : Number(value));
                                }}
                                value={field.value ?? undefined}
                            />
                        )}
                    />
                </Form.Item>

                {/* 表单项：剧情建议 - 最大生成Token */}
                <Form.Item
                    label={
                        <Tooltip title="AI生成剧情版本建议时，LLM自身输出内容的最大Token数限制。留空则使用LLM的默认限制或全局限制。">
                            剧情建议 - 最大生成Token <InfoCircleOutlined className={styles.tooltipIconAntd} />
                        </Tooltip>
                    }
                    validateStatus={errors.plot_suggestion_max_tokens ? 'error' : ''}
                    help={errors.plot_suggestion_max_tokens?.message}
                    className={styles.formItemAntd}
                >
                    <Controller
                        name="plot_suggestion_max_tokens"
                        control={control}
                        render={({ field }) => (
                            <InputNumber
                                {...field}
                                min={0} // 根据 Zod schema
                                style={{ width: '100%' }}
                                placeholder="例如 1500 或 3000"
                                onChange={(value) => {
                                    field.onChange(value);
                                    onSettingChange('plot_suggestion_max_tokens', value === null ? null : Number(value));
                                }}
                                value={field.value ?? undefined}
                            />
                        )}
                    />
                </Form.Item>
            </div>
        </Form>
    );
};

export default PlanningSettingsForm;