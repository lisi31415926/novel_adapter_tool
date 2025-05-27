// frontend-react/src/components/configuration/VectorStoreSettingsForm.tsx
import React, { useEffect } from 'react';
import { Form, Input, InputNumber, Select, Switch, Tooltip, Divider, Typography, Alert } from 'antd';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { InfoCircleOutlined } from '@ant-design/icons';

// 从 API 服务或常量文件导入核心类型
// 确保 VectorStoreTypeEnum 和 VectorStoreSettingsConfig 已更新
import { VectorStoreSettingsConfig, VectorStoreTypeEnum } from '../../services/api'; 

// 导入共享样式
import sharedFormStyles from './SharedSettingsForm.module.css';

const { Title } = Typography;
const { Option } = Select;

// --- 使用 Zod 定义表单的校验 Schema ---
// [修改] 在辨别联合 (discriminated union) 中添加 FAISS 的 schema
const vectorStoreSettingsSchema = z.discriminatedUnion("type", [
    // 当 type 为 'qdrant' 时的 schema
    z.object({
        type: z.literal(VectorStoreTypeEnum.QDRANT),
        qdrant_host: z.string().min(1, "Qdrant 主机地址不能为空。"),
        qdrant_port: z.number().int().positive("端口必须是正整数。"),
        qdrant_grpc_port: z.number().int().positive("gRPC端口必须是正整数。"),
        qdrant_prefer_grpc: z.boolean(),
        qdrant_api_key: z.string().optional(),
    }),
    // [新增] 当 type 为 'faiss' 时的 schema
    z.object({
        type: z.literal(VectorStoreTypeEnum.FAISS),
        faiss_persist_directory: z.string().min(1, "FAISS 持久化目录不能为空。"),
    }),
    // 当 type 为 'chromadb' 时的 schema (根据原始文件保留)
    z.object({
        type: z.literal(VectorStoreTypeEnum.CHROMA),
        chromadb_path: z.string().min(1, "ChromaDB 路径不能为空。"),
        chromadb_collection: z.string().min(1, "ChromaDB 集合名称不能为空。"),
    })
]).and(z.object({ // 通用字段
    enabled: z.boolean(),
    text_chunk_size: z.number().int().positive("分块大小必须为正整数。"),
    text_chunk_overlap: z.number().int().nonnegative("分块重叠不能为负数。")
      .refine((val, ctx) => {
          // 确保重叠小于分块大小
          const { text_chunk_size } = ctx.parent;
          if (typeof text_chunk_size === 'number') {
              return val < text_chunk_size;
          }
          return true;
      }, { message: "分块重叠必须小于分块大小。" }),
    default_tokenizer_model_for_chunking: z.string().optional(),
}));

interface VectorStoreSettingsFormProps {
  initialValues: VectorStoreSettingsConfig;
  onFormChange: (data: VectorStoreSettingsConfig, isValid: boolean) => void;
}

const VectorStoreSettingsForm: React.FC<VectorStoreSettingsFormProps> = ({ initialValues, onFormChange }) => {
    
    const { control, watch, formState: { errors, isValid }, reset } = useForm<VectorStoreSettingsConfig>({
        resolver: zodResolver(vectorStoreSettingsSchema),
        defaultValues: initialValues,
        mode: 'onChange', // 在变化时触发校验
    });

    const watchedValues = watch();
    const selectedType = watch('type');

    useEffect(() => {
        reset(initialValues);
    }, [initialValues, reset]);
    
    useEffect(() => {
        onFormChange(watchedValues, isValid);
    }, [watchedValues, isValid, onFormChange]);

    // react-hook-form 的 Controller 会自动处理值的变更，无需手动 onChange
    // antd 的 Form 组件在这里仅用于布局和样式
    return (
        <Form
            layout="vertical"
            className={sharedFormStyles.formSection}
        >
            <Title level={4}>向量存储设置</Title>
            <Alert
              message="此部分设置将决定应用如何存储和检索从小说内容中提取的向量化数据，以支持RAG等功能。"
              type="info"
              showIcon
              style={{ marginBottom: '24px' }}
            />
            
            <Form.Item label="启用向量存储" help="是否启用向量存储功能。禁用后，RAG等依赖向量搜索的功能将不可用。">
                <Controller
                    name="enabled"
                    control={control}
                    render={({ field }) => <Switch {...field} checked={field.value} />}
                />
            </Form.Item>

            <Form.Item label="存储提供商" required help="选择用于存储小说内容的向量数据库。">
                <Controller
                    name="type"
                    control={control}
                    render={({ field }) => (
                        <Select {...field}>
                            {/* [修改] 新增 FAISS 选项 */}
                            <Option value={VectorStoreTypeEnum.FAISS}>FAISS (本地文件)</Option>
                            <Option value={VectorStoreTypeEnum.QDRANT}>Qdrant (服务器)</Option>
                            <Option value={VectorStoreTypeEnum.CHROMA}>ChromaDB (本地)</Option>
                        </Select>
                    )}
                />
            </Form.Item>

            {/* --- 条件渲染的配置项 --- */}

            {/* Qdrant 配置 */}
            {selectedType === VectorStoreTypeEnum.QDRANT && (
                <div className={sharedFormStyles.conditionalGroup}>
                    <Title level={5} style={{ marginBottom: 16 }}>Qdrant 设置</Title>
                    <Form.Item label="Qdrant 主机" required validateStatus={errors.qdrant_host ? 'error' : ''} help={errors.qdrant_host?.message}>
                        <Controller name="qdrant_host" control={control} render={({ field }) => <Input {...field} placeholder="例如: localhost" />} />
                    </Form.Item>
                    <Form.Item label="Qdrant 端口" required validateStatus={errors.qdrant_port ? 'error' : ''} help={errors.qdrant_port?.message}>
                        <Controller name="qdrant_port" control={control} render={({ field }) => <InputNumber {...field} style={{ width: '100%' }} placeholder="例如: 6333" />} />
                    </Form.Item>
                    {/* 其他 Qdrant 字段根据原始文件保留 */}
                    <Form.Item label="Qdrant gRPC 端口" required validateStatus={errors.qdrant_grpc_port ? 'error' : ''} help={errors.qdrant_grpc_port?.message}>
                        <Controller name="qdrant_grpc_port" control={control} render={({ field }) => <InputNumber {...field} style={{ width: '100%' }} placeholder="例如: 6334" />} />
                    </Form.Item>
                     <Form.Item label="优先使用 gRPC" valuePropName="checked" help="如果可用，优先使用 gRPC 接口进行通信，性能可能更好。">
                        <Controller name="qdrant_prefer_grpc" control={control} render={({ field }) => <Switch {...field} checked={field.value} />} />
                    </Form.Item>
                     <Form.Item label="Qdrant API 密钥 (可选)" validateStatus={errors.qdrant_api_key ? 'error' : ''} help={errors.qdrant_api_key?.message}>
                        <Controller name="qdrant_api_key" control={control} render={({ field }) => <Input.Password {...field} placeholder="如果 Qdrant 服务需要认证" />} />
                    </Form.Item>
                </div>
            )}
            
            {/* [新增] FAISS 配置 */}
            {selectedType === VectorStoreTypeEnum.FAISS && (
                <div className={sharedFormStyles.conditionalGroup}>
                    <Title level={5} style={{ marginBottom: 16 }}>FAISS 设置</Title>
                    <Form.Item
                        label="FAISS 索引持久化目录"
                        required
                        tooltip="用于在服务器上存储FAISS索引文件的基础目录路径。"
                        validateStatus={errors.faiss_persist_directory ? 'error' : ''}
                        help={errors.faiss_persist_directory?.message}
                    >
                         <Controller
                            name="faiss_persist_directory"
                            control={control}
                            render={({ field }) => <Input {...field} placeholder="例如: faiss_data/novel_indexes" />}
                        />
                    </Form.Item>
                </div>
            )}

            {/* ChromaDB 配置 */}
            {selectedType === VectorStoreTypeEnum.CHROMA && (
                 <div className={sharedFormStyles.conditionalGroup}>
                     <Title level={5} style={{ marginBottom: 16 }}>ChromaDB 设置</Title>
                     <Form.Item label="ChromaDB 存储路径" required validateStatus={errors.chromadb_path ? 'error' : ''} help={errors.chromadb_path?.message}>
                         <Controller name="chromadb_path" control={control} render={({ field }) => <Input {...field} placeholder="例如: ./chroma_db_store" />} />
                     </Form.Item>
                     <Form.Item label="ChromaDB 集合名称" required validateStatus={errors.chromadb_collection ? 'error' : ''} help={errors.chromadb_collection?.message}>
                         <Controller name="chromadb_collection" control={control} render={({ field }) => <Input {...field} placeholder="例如: novel_adaptation_store" />} />
                     </Form.Item>
                 </div>
            )}

            <Divider />

            {/* --- 通用配置项 --- */}
            <Title level={5} style={{ marginBottom: 16 }}>通用分块设置</Title>
             <Form.Item label="文本分块大小 (Tokens)" required tooltip="向量化时，每个文本块的目标Token数量。" validateStatus={errors.text_chunk_size ? 'error' : ''} help={errors.text_chunk_size?.message}>
                 <Controller name="text_chunk_size" control={control} render={({ field }) => <InputNumber {...field} style={{ width: '100%' }} min={50} step={10} />} />
            </Form.Item>
            <Form.Item label="文本分块重叠 (Tokens)" required tooltip="相邻文本块之间重叠的Token数量。" validateStatus={errors.text_chunk_overlap ? 'error' : ''} help={errors.text_chunk_overlap?.message}>
                 <Controller name="text_chunk_overlap" control={control} render={({ field }) => <InputNumber {...field} style={{ width: '100%' }} min={0} step={10} />} />
            </Form.Item>
            <Form.Item label="分块时参考的分词器模型ID (可选)" tooltip="留空则使用全局默认。指定一个模型ID（如 'gpt-4'）来更精确地估算token长度。">
                 <Controller name="default_tokenizer_model_for_chunking" control={control} render={({ field }) => <Input {...field} placeholder="例如: gpt-4-turbo" />} />
            </Form.Item>

            {/* [移除] "嵌入模型" 字段已从此组件中移除，它现在属于独立的 EmbeddingSettingsForm 组件，以匹配后端配置结构。 */}
        </Form>
    );
};

export default VectorStoreSettingsForm;