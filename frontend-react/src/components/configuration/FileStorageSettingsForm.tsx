// frontend-react/src/components/configuration/FileStorageSettingsForm.tsx
import React, { useEffect } from 'react';
import { Form, Input, Tooltip, Alert } from 'antd';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { FileStorageSettingsConfig } from '../../services/api'; // 导入核心类型
import styles from './SharedSettingsForm.module.css'; // 复用共享样式
import { InfoCircleOutlined, FolderOpenOutlined } from '@ant-design/icons'; // 引入 Ant Design 图标

// --- 使用 Zod 定义表单的校验 Schema ---
// upload_directory 期望是一个相对路径，不以斜杠开头或结尾，且不包含连续斜杠
const fileStorageSettingsSchema = z.object({
    upload_directory: z.string()
        .min(1, "上传目录不能为空。")
        .regex(/^(?!\/)(?!.*\/$)(?!.*\/\/)[a-zA-Z0-9_./-]+$/, "请输入有效的相对路径，例如 'user_uploads' 或 'data/files'。")
        .refine(value => !value.startsWith('/') && !value.endsWith('/'), {
            message: "路径不能以斜杠开头或结尾。",
        })
        .refine(value => !value.includes('//'), {
            message: "路径中不能包含连续的斜杠。",
        }),
});

// 从 Zod Schema 推断出表单数据的 TypeScript 类型
type FileStorageFormData = z.infer<typeof fileStorageSettingsSchema>;

// 定义组件的 Props 接口
interface FileStorageSettingsFormProps {
    settings: FileStorageSettingsConfig; // 从父组件接收的文件存储配置
    // onSettingChange 回调函数，用于将特定字段的更新传递回父组件
    // K 必须是 FileStorageSettingsConfig 的一个键，value 必须是该键对应的值类型
    onSettingChange: <K extends keyof FileStorageSettingsConfig>(
        key: K,
        value: FileStorageSettingsConfig[K]
    ) => void;
    isSaving?: boolean; // 可选，如果此表单有独立的保存按钮，则用于指示保存状态
}

const FileStorageSettingsForm: React.FC<FileStorageSettingsFormProps> = ({
    settings,
    onSettingChange,
    isSaving, // 当前版本未使用，但保留以便未来可能的独立保存逻辑
}) => {
    // --- react-hook-form 初始化 ---
    const {
        control,
        handleSubmit, // handleSubmit 用于触发表单校验，但实际的数据更新通过 onSettingChange 实现
        reset,
        formState: { errors }
    } = useForm<FileStorageFormData>({
        resolver: zodResolver(fileStorageSettingsSchema), // 使用Zod进行校验
        defaultValues: settings, // 设置表单的默认值
    });

    // --- 状态同步 ---
    // 当父组件传入的 settings 更新时，重置表单以同步最新数据
    useEffect(() => {
        reset(settings);
    }, [settings, reset]);

    // --- 渲染逻辑 ---
    // 父组件 ConfigurationPage 统一处理保存逻辑，
    // 此处表单的 onChange 事件会直接调用 onSettingChange 将数据更新到父组件的 updatedConfig 状态中。
    // 如果需要本表单独立校验后才更新父组件，则可以在 Input 的 onBlur 中结合 handleSubmit 调用 onSettingChange。
    // 目前的设计是实时更新，父组件在保存时统一处理所有变更。

    return (
        <Form layout="vertical" className={styles.antdFormContainer}> {/* 复用共享的 antdFormContainer 样式 */}
            {/* 提示信息区域 */}
            <Alert
                message="文件存储设置"
                description="配置应用中文件（如上传的小说原始文件、生成的素材等）在服务器上的存储位置。请确保后端服务对此目录具有写入和读取权限。"
                type="info"
                showIcon
                icon={<FolderOpenOutlined />} // 使用 FolderOpenOutlined 图标
                style={{ marginBottom: 24 }} // 与其他表单保持一致的间距
            />
            
            {/* 表单项：文件上传目录 */}
            {/* 使用 styles.formGrid 来允许未来可能的网格布局，当前为单列 */}
            <div className={styles.formGrid}>
                <Form.Item
                    label={
                        <Tooltip title="小说等文件上传后在服务器上存储的目录路径。推荐使用相对于应用后端工作目录的路径。例如 'user_uploads/novels'。">
                            文件上传目录 <span className={styles.requiredStar}>*</span> {/* 必填星号 */}
                            <InfoCircleOutlined className={styles.tooltipIconAntd} /> {/* AntD 风格的 Tooltip 图标 */}
                        </Tooltip>
                    }
                    required // AntD Form.Item 的必填标记
                    validateStatus={errors.upload_directory ? 'error' : ''} // 根据校验错误状态显示
                    help={errors.upload_directory?.message || "例如：user_uploads 或 data/novel_files"} // 帮助文本
                    className={`${styles.formItemAntd} ${styles.fullWidthField}`} // 使用共享的 AntD 表单项样式和全宽样式
                >
                    <Controller
                        name="upload_directory"
                        control={control}
                        render={({ field }) => (
                            <Input
                                {...field} // react-hook-form 提供的字段属性
                                placeholder="例如 user_uploads"
                                onChange={(e) => {
                                    field.onChange(e.target.value); // 更新 react-hook-form 内部状态
                                    // 直接调用父组件的 onSettingChange 方法，将变更实时传递上去
                                    onSettingChange('upload_directory', e.target.value);
                                }}
                                addonBefore={<FolderOpenOutlined />} // 在输入框前添加图标
                            />
                        )}
                    />
                </Form.Item>
            </div>

            {/* 如果每个配置区域有独立的保存按钮 (当前设计由父页面统一保存，故注释掉)
            <Form.Item style={{ marginTop: 24, textAlign: 'right' }}>
                <Button type="primary" onClick={handleSubmit(() => {})} loading={isSaving}>
                    保存文件存储设置
                </Button>
            </Form.Item>
            */}
        </Form>
    );
};

export default FileStorageSettingsForm;