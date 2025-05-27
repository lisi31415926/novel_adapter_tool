// frontend-react/src/components/configuration/CostEstimationTiersForm.tsx
import React, { useEffect, useMemo } from 'react';
import { Form, InputNumber, Select, Button, Tooltip, Divider, Typography, Space, Alert, Popconfirm } from 'antd';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { CostEstimationTiers, TokenCostInfo, UserDefinedLLMConfig } from '../../services/api'; // 导入核心类型
import styles from './SharedSettingsForm.module.css'; // 复用共享样式
import { InfoCircleOutlined, DollarCircleOutlined, PlusOutlined, DeleteOutlined, QuestionCircleOutlined } from '@ant-design/icons'; // 引入 Ant Design 图标

const { Title } = Typography;
const { Option } = Select;

// --- 使用 Zod 定义表单的校验 Schema ---

// Token 成本信息子 Schema (对应 api.ts 中的 TokenCostInfo)
const tokenCostInfoSchema = z.object({
    input_per_million: z.number().nonnegative("输入成本不能为负。").nullable().optional(),
    output_per_million: z.number().nonnegative("输出成本不能为负。").nullable().optional(),
});

// 主 Schema (对应 api.ts 中的 CostEstimationTiers)
const costEstimationTiersSchema = z.object({
    low_max_tokens: z.number().int("必须为整数。").positive("Token数必须为正。"),
    medium_max_tokens: z.number().int("必须为整数。").positive("Token数必须为正。"),
    // 使用 z.array(z.object(...)) 来适配 useFieldArray，之后再转换为 record
    token_cost_per_model_array: z.array(z.object({
        model_id: z.string().min(1, "模型ID不能为空。"),
        costs: tokenCostInfoSchema,
    })).optional(),
    avg_tokens_per_rag_chunk_array: z.array(z.object({
        model_id: z.string().min(1, "模型ID不能为空。"), // 假设这里的 key 也是模型ID
        avg_tokens: z.number().int("必须为整数。").positive("平均Token数必须为正。").nullable().optional(),
    })).optional(),
}).refine(data => data.medium_max_tokens > data.low_max_tokens, {
    message: "中等Token阈值必须大于等于低等Token阈值。",
    path: ["medium_max_tokens"], // 错误关联到 medium_max_tokens 字段
});

// 从 Zod Schema 推断出表单数据的 TypeScript 类型
type CostEstimationFormData = z.infer<typeof costEstimationTiersSchema>;

// 定义组件的 Props 接口
interface CostEstimationTiersFormProps {
    settings: CostEstimationTiers; // 从父组件接收的成本预估配置
    userDefinedModels: UserDefinedLLMConfig[]; // 可用的用户定义模型列表，用于下拉选择
    onSettingChange: <K extends keyof CostEstimationTiers>(
        key: K,
        value: CostEstimationTiers[K]
    ) => void;
    isSaving?: boolean; // 可选，用于指示保存状态
}

const CostEstimationTiersForm: React.FC<CostEstimationTiersFormProps> = ({
    settings,
    userDefinedModels,
    onSettingChange,
    isSaving,
}) => {
    // --- 将 settings 中的 record 转换为 useFieldArray 期望的数组格式 ---
    const initialTokenCostArray = useMemo(() => { //
        return settings.token_cost_per_model
            ? Object.entries(settings.token_cost_per_model).map(([model_id, costs]) => ({ model_id, costs }))
            : [];
    }, [settings.token_cost_per_model]);

    const initialAvgTokensArray = useMemo(() => { //
        return settings.avg_tokens_per_rag_chunk
            ? Object.entries(settings.avg_tokens_per_rag_chunk).map(([model_id, avg_tokens]) => ({ model_id, avg_tokens: avg_tokens as number | null | undefined }))
            : [];
    }, [settings.avg_tokens_per_rag_chunk]);


    // --- react-hook-form 初始化 ---
    const {
        control,
        handleSubmit, // 用于触发表单校验，但实际的数据更新通过 onSettingChange 实现
        reset,
        formState: { errors },
        setValue, // 用于手动设置字段值
    } = useForm<CostEstimationFormData>({
        resolver: zodResolver(costEstimationTiersSchema), // 使用Zod进行校验
        defaultValues: { // 设置表单的默认值
            low_max_tokens: settings.low_max_tokens,
            medium_max_tokens: settings.medium_max_tokens,
            token_cost_per_model_array: initialTokenCostArray,
            avg_tokens_per_rag_chunk_array: initialAvgTokensArray,
        },
    });

    // 使用 useFieldArray 管理动态的“每模型Token成本”列表
    const {
        fields: tokenCostFields,
        append: appendTokenCost,
        remove: removeTokenCost,
        update: updateTokenCost, // 用于更新特定索引的条目
    } = useFieldArray({ //
        control,
        name: "token_cost_per_model_array",
    });

    // 使用 useFieldArray 管理动态的“每模型RAG块平均Token数”列表
    const {
        fields: avgTokensFields,
        append: appendAvgTokens,
        remove: removeAvgTokens,
        update: updateAvgTokens, // 用于更新特定索引的条目
    } = useFieldArray({ //
        control,
        name: "avg_tokens_per_rag_chunk_array",
    });


    // --- 状态同步 ---
    // 当父组件传入的 settings 更新时，重置表单以同步最新数据
    useEffect(() => {
        reset({ //
            low_max_tokens: settings.low_max_tokens,
            medium_max_tokens: settings.medium_max_tokens,
            token_cost_per_model_array: settings.token_cost_per_model
                ? Object.entries(settings.token_cost_per_model).map(([model_id, costs]) => ({ model_id, costs }))
                : [],
            avg_tokens_per_rag_chunk_array: settings.avg_tokens_per_rag_chunk
                ? Object.entries(settings.avg_tokens_per_rag_chunk).map(([model_id, avg_tokens]) => ({ model_id, avg_tokens: avg_tokens as number | null | undefined }))
                : [],
        });
    }, [settings, reset]);

    // --- 为 Select 组件准备模型选项 ---
    const modelOptions = useMemo(() => { //
        return userDefinedModels
            .filter(model => model.enabled) // 通常只为启用的模型配置成本
            .map(model => ({
                label: `${model.user_given_name} (${model.user_given_id})`,
                value: model.user_given_id,
            }));
    }, [userDefinedModels]);

    // --- 事件处理 ---
    // 处理表单主字段（非动态数组部分）的变更
    const handleMainFieldChange = <K extends keyof Pick<CostEstimationFormData, 'low_max_tokens' | 'medium_max_tokens'>>(
        name: K,
        value: CostEstimationFormData[K]
    ) => {
        setValue(name, value, { shouldValidate: true, shouldDirty: true });
        // onSettingChange 的类型是 <K extends keyof CostEstimationTiers>(key: K, value: CostEstimationTiers[K]) => void;
        // 需要确保传递的 name 和 value 符合 CostEstimationTiers 的类型
        onSettingChange(name as keyof CostEstimationTiers, value as CostEstimationTiers[keyof CostEstimationTiers]);
    };

    // 处理 token_cost_per_model_array 的变化，并将其转换为父组件期望的 Record 格式
    const handleTokenCostArrayChange = (updatedArray: CostEstimationFormData['token_cost_per_model_array']) => { //
        const newRecord: Record<string, TokenCostInfo> = {};
        (updatedArray || []).forEach(item => {
            if (item.model_id) { // 确保 model_id 存在
                newRecord[item.model_id] = item.costs;
            }
        });
        onSettingChange('token_cost_per_model', newRecord);
    };

    // 处理 avg_tokens_per_rag_chunk_array 的变化，并将其转换为父组件期望的 Record 格式
    const handleAvgTokensArrayChange = (updatedArray: CostEstimationFormData['avg_tokens_per_rag_chunk_array']) => { //
        const newRecord: Record<string, number | null> = {}; // 明确值的类型
        (updatedArray || []).forEach(item => {
            if (item.model_id) { // 确保 model_id 存在
                 // InputNumber 返回 null 如果输入为空，后端 schema 允许 null
                newRecord[item.model_id] = item.avg_tokens === undefined ? null : item.avg_tokens;
            }
        });
        onSettingChange('avg_tokens_per_rag_chunk', newRecord as Record<string, any>); // 后端 schema 的 value 是 Any, 前端这里是 number | null
    };


    // --- 渲染逻辑 ---
    return (
        <Form layout="vertical" className={styles.antdFormContainer}> {/* 使用共享的 antd 表单容器样式 */}
            {/* 提示信息区域 */}
            <Alert
                message="成本预估分层设置"
                description="配置不同成本级别（低、中）的Token数量阈值，以及各个模型的输入输出成本，用于大致预估AI任务的开销。"
                type="info"
                showIcon
                icon={<DollarCircleOutlined />} // 使用 DollarCircleOutlined 图标
                style={{ marginBottom: 24 }} // 与其他表单保持一致的间距
            />
            
            {/* 表单项网格布局 */}
            <div className={styles.formGrid}>
                {/* 低成本Token阈值 */}
                <Form.Item
                    label={
                        <Tooltip title="定义“低”成本任务的Token数上限。例如，摘要、简单问答等任务应落在此范围内。">
                            低成本任务Token阈值 <span className={styles.requiredStar}>*</span> <InfoCircleOutlined className={styles.tooltipIconAntd} />
                        </Tooltip>
                    }
                    required
                    validateStatus={errors.low_max_tokens ? 'error' : ''}
                    help={errors.low_max_tokens?.message}
                    className={styles.formItemAntd}
                >
                    <Controller
                        name="low_max_tokens"
                        control={control}
                        render={({ field }) => (
                            <InputNumber
                                {...field}
                                min={1} // 根据Zod schema
                                style={{ width: '100%' }}
                                placeholder="例如 2000"
                                onChange={(value) => handleMainFieldChange('low_max_tokens', value ?? 0)} // InputNumber 返回 value | null
                            />
                        )}
                    />
                </Form.Item>

                {/* 中等成本Token阈值 */}
                <Form.Item
                    label={
                        <Tooltip title="定义“中等”成本任务的Token数上限。超过此阈值的任务将被视为“高”成本。">
                            中等成本任务Token阈值 <span className={styles.requiredStar}>*</span> <InfoCircleOutlined className={styles.tooltipIconAntd} />
                        </Tooltip>
                    }
                    required
                    validateStatus={errors.medium_max_tokens ? 'error' : ''}
                    help={errors.medium_max_tokens?.message}
                    className={styles.formItemAntd}
                >
                    <Controller
                        name="medium_max_tokens"
                        control={control}
                        render={({ field }) => (
                            <InputNumber
                                {...field}
                                min={1} // 根据Zod schema
                                style={{ width: '100%' }}
                                placeholder="例如 8000"
                                onChange={(value) => handleMainFieldChange('medium_max_tokens', value ?? 0)}
                            />
                        )}
                    />
                </Form.Item>
            </div>

            <Divider>每模型Token成本 (美元/每百万Token)</Divider>
            {/* 每模型Token成本的动态列表 */}
            <div className={styles.dynamicListContainer}>
                {tokenCostFields.map((field, index) => ( //
                    <Space key={field.id} className={`${styles.dynamicListItem} ${styles.costModelItem}`} align="baseline">
                        <Form.Item
                            label="模型ID"
                            required
                            className={styles.dynamicFormItem}
                            validateStatus={errors.token_cost_per_model_array?.[index]?.model_id ? 'error' : ''}
                            help={errors.token_cost_per_model_array?.[index]?.model_id?.message}
                        >
                            <Controller
                                name={`token_cost_per_model_array.${index}.model_id`}
                                control={control}
                                render={({ field: controllerField }) => (
                                    <Select
                                        {...controllerField}
                                        style={{ minWidth: 220 }}
                                        showSearch
                                        optionFilterProp="label"
                                        placeholder="选择模型ID"
                                        options={modelOptions} // 使用已准备好的模型选项
                                        onChange={(value) => {
                                            updateTokenCost(index, { ...tokenCostFields[index], model_id: value }); // 更新 react-hook-form 状态
                                            // 构造新的数组并通知父组件
                                            const updatedArray = tokenCostFields.map((f, i) => i === index ? { ...f, model_id: value } : f);
                                            handleTokenCostArrayChange(updatedArray);
                                        }}
                                    />
                                )}
                            />
                        </Form.Item>
                        <Form.Item label="输入成本" className={styles.dynamicFormItem} validateStatus={errors.token_cost_per_model_array?.[index]?.costs?.input_per_million ? 'error' : ''} help={errors.token_cost_per_model_array?.[index]?.costs?.input_per_million?.message}>
                            <Controller
                                name={`token_cost_per_model_array.${index}.costs.input_per_million`}
                                control={control}
                                render={({ field: controllerField }) => (
                                    <InputNumber
                                        {...controllerField}
                                        style={{ width: '100%' }}
                                        min={0}
                                        step={0.01}
                                        placeholder="例如 0.50"
                                        onChange={(value) => {
                                            const currentCosts = tokenCostFields[index].costs;
                                            updateTokenCost(index, { ...tokenCostFields[index], costs: { ...currentCosts, input_per_million: value } });
                                            const updatedArray = tokenCostFields.map((f, i) => i === index ? { ...f, costs: { ...f.costs, input_per_million: value ?? null } } : f);
                                            handleTokenCostArrayChange(updatedArray);
                                        }}
                                    />
                                )}
                            />
                        </Form.Item>
                        <Form.Item label="输出成本" className={styles.dynamicFormItem} validateStatus={errors.token_cost_per_model_array?.[index]?.costs?.output_per_million ? 'error' : ''} help={errors.token_cost_per_model_array?.[index]?.costs?.output_per_million?.message}>
                            <Controller
                                name={`token_cost_per_model_array.${index}.costs.output_per_million`}
                                control={control}
                                render={({ field: controllerField }) => (
                                    <InputNumber
                                        {...controllerField}
                                        style={{ width: '100%' }}
                                        min={0}
                                        step={0.01}
                                        placeholder="例如 1.50"
                                        onChange={(value) => {
                                            const currentCosts = tokenCostFields[index].costs;
                                            updateTokenCost(index, { ...tokenCostFields[index], costs: { ...currentCosts, output_per_million: value } });
                                            const updatedArray = tokenCostFields.map((f, i) => i === index ? { ...f, costs: { ...f.costs, output_per_million: value ?? null } } : f);
                                            handleTokenCostArrayChange(updatedArray);
                                        }}
                                    />
                                )}
                            />
                        </Form.Item>
                        <Popconfirm
                            title="确定删除此模型成本配置吗？"
                            onConfirm={() => {
                                removeTokenCost(index);
                                handleTokenCostArrayChange(tokenCostFields.filter((_, i) => i !== index));
                            }}
                            okText="确认" cancelText="取消"
                            icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
                        >
                            <Button icon={<DeleteOutlined />} type="text" danger className={styles.deleteButtonSmallIconOnlyAntd} />
                        </Popconfirm>
                    </Space>
                ))}
                <Button
                    type="dashed"
                    onClick={() => {
                        appendTokenCost({ model_id: '', costs: { input_per_million: null, output_per_million: null } });
                        handleTokenCostArrayChange([...tokenCostFields, { model_id: '', costs: { input_per_million: null, output_per_million: null } }]);
                    }}
                    icon={<PlusOutlined />}
                    className={styles.addButtonDynamicAntd} // 使用共享的动态添加按钮样式
                >
                    添加模型成本
                </Button>
            </div>

            <Divider>每模型RAG块平均Token数</Divider>
            {/* 每模型RAG块平均Token数的动态列表 */}
            <div className={styles.dynamicListContainer}>
                {avgTokensFields.map((field, index) => ( //
                    <Space key={field.id} className={`${styles.dynamicListItem} ${styles.ragTokensItem}`} align="baseline">
                        <Form.Item
                            label="模型ID"
                            required
                            className={styles.dynamicFormItem}
                            validateStatus={errors.avg_tokens_per_rag_chunk_array?.[index]?.model_id ? 'error' : ''}
                            help={errors.avg_tokens_per_rag_chunk_array?.[index]?.model_id?.message}
                        >
                             <Controller
                                name={`avg_tokens_per_rag_chunk_array.${index}.model_id`}
                                control={control}
                                render={({ field: controllerField }) => (
                                    <Select
                                        {...controllerField}
                                        style={{ minWidth: 220 }}
                                        showSearch
                                        optionFilterProp="label"
                                        placeholder="选择模型ID"
                                        options={modelOptions}
                                        onChange={(value) => {
                                            updateAvgTokens(index, { ...avgTokensFields[index], model_id: value });
                                            const updatedArray = avgTokensFields.map((f, i) => i === index ? { ...f, model_id: value } : f);
                                            handleAvgTokensArrayChange(updatedArray);
                                        }}
                                    />
                                )}
                            />
                        </Form.Item>
                        <Form.Item
                            label="平均Token数"
                            className={styles.dynamicFormItem}
                            validateStatus={errors.avg_tokens_per_rag_chunk_array?.[index]?.avg_tokens ? 'error' : ''}
                            help={errors.avg_tokens_per_rag_chunk_array?.[index]?.avg_tokens?.message}
                        >
                            <Controller
                                name={`avg_tokens_per_rag_chunk_array.${index}.avg_tokens`}
                                control={control}
                                render={({ field: controllerField }) => (
                                    <InputNumber
                                        {...controllerField}
                                        style={{ width: '100%' }}
                                        min={1}
                                        placeholder="例如 200"
                                        onChange={(value) => {
                                            updateAvgTokens(index, { ...avgTokensFields[index], avg_tokens: value });
                                            const updatedArray = avgTokensFields.map((f, i) => i === index ? { ...f, avg_tokens: value ?? null } : f);
                                            handleAvgTokensArrayChange(updatedArray);
                                        }}
                                    />
                                )}
                            />
                        </Form.Item>
                        <Popconfirm
                            title="确定删除此RAG平均Token配置吗？"
                            onConfirm={() => {
                                removeAvgTokens(index);
                                handleAvgTokensArrayChange(avgTokensFields.filter((_, i) => i !== index));
                            }}
                            okText="确认" cancelText="取消"
                            icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
                        >
                             <Button icon={<DeleteOutlined />} type="text" danger className={styles.deleteButtonSmallIconOnlyAntd} />
                        </Popconfirm>
                    </Space>
                ))}
                <Button
                    type="dashed"
                    onClick={() => {
                        appendAvgTokens({ model_id: '', avg_tokens: null });
                        handleAvgTokensArrayChange([...avgTokensFields, { model_id: '', avg_tokens: null }]);
                    }}
                    icon={<PlusOutlined />}
                    className={styles.addButtonDynamicAntd}
                >
                    添加RAG平均Token数
                </Button>
            </div>
        </Form>
    );
};

export default CostEstimationTiersForm;