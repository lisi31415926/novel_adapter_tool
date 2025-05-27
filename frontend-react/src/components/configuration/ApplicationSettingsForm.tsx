// frontend-react/src/components/configuration/ApplicationSettingsForm.tsx
import React, { useEffect } from 'react';
import { Form, Select, Checkbox, Button, Tooltip, Typography } from 'antd';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ApplicationGeneralSettingsConfig } from '../../services/api';
import styles from './SharedSettingsForm.module.css'; // 可以继续使用共享样式或创建新的
import { InfoCircleOutlined } from '@ant-design/icons';

const { Option } = Select;
const { Text } = Typography;

// Zod Schema for validation
const appSettingsSchema = z.object({
    log_level: z.enum(["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"], {
        errorMap: () => ({ message: "请选择一个有效的日志级别。" })
    }),
    allow_config_writes_via_api: z.boolean(),
});

type AppSettingsFormData = z.infer<typeof appSettingsSchema>;

interface ApplicationSettingsFormProps {
    settings: ApplicationGeneralSettingsConfig;
    onSettingChange: <K extends keyof ApplicationGeneralSettingsConfig>(
        key: K,
        value: ApplicationGeneralSettingsConfig[K]
    ) => void;
    isSaving: boolean; // 从父组件接收保存状态
}

const ApplicationSettingsForm: React.FC<ApplicationSettingsFormProps> = ({
    settings,
    onSettingChange,
    isSaving,
}) => {
    const { control, handleSubmit, reset, formState: { errors } } = useForm<AppSettingsFormData>({
        resolver: zodResolver(appSettingsSchema),
        defaultValues: settings,
    });

    useEffect(() => {
        reset(settings); // 当 props 中的 settings 更新时，重置表单
    }, [settings, reset]);

    // 由于 onSettingChange 是实时更新父组件状态的，
    // handleSubmit 在这里主要用于触发校验（如果需要整体校验后才更新父组件状态，逻辑会不同）
    // 当前设计是字段一变动就调用 onSettingChange 更新父组件的 appConfig state
    // 因此，"保存所有更改" 按钮在父组件中处理实际的API调用。
    // 如果希望此表单有独立的保存按钮，则需要调整。

    return (
        <Form layout="vertical" className={styles.antdFormContainer}>
            <Form.Item
                label="应用日志级别"
                help={errors.log_level?.message || "设置应用的全局日志记录级别。"}
                validateStatus={errors.log_level ? 'error' : ''}
                className={styles.formItemAntd}
            >
                <Controller
                    name="log_level"
                    control={control}
                    render={({ field }) => (
                        <Select
                            {...field}
                            style={{ width: '100%' }}
                            onChange={(value) => {
                                field.onChange(value);
                                onSettingChange('log_level', value);
                            }}
                        >
                            <Option value="DEBUG">DEBUG</Option>
                            <Option value="INFO">INFO</Option>
                            <Option value="WARNING">WARNING</Option>
                            <Option value="ERROR">ERROR</Option>
                            <Option value="CRITICAL">CRITICAL</Option>
                        </Select>
                    )}
                />
            </Form.Item>

            <Form.Item
                // label="允许通过API接口修改配置" // Checkbox 通常将label内联
                help={errors.allow_config_writes_via_api?.message || "此设置通常建议在后端 config.json 中手动修改以增强安全性。"}
                validateStatus={errors.allow_config_writes_via_api ? 'error' : ''}
                className={styles.formItemAntd}
                valuePropName="checked" // 对于 Ant Design Checkbox
            >
                <Controller
                    name="allow_config_writes_via_api"
                    control={control}
                    render={({ field }) => (
                        <Checkbox
                            {...field}
                            checked={field.value}
                            onChange={(e) => {
                                field.onChange(e.target.checked);
                                onSettingChange('allow_config_writes_via_api', e.target.checked);
                            }}
                            disabled // 通常此设置应在后端配置文件中手动更改以提高安全性
                        >
                            允许通过API接口修改配置 (仅限开发环境)
                            <Tooltip title="此设置的更改通常需要通过直接修改后端 config.json 文件并重启应用来生效，以确保生产环境的配置安全。">
                                <InfoCircleOutlined style={{ marginLeft: 8, color: 'rgba(0,0,0,.45)' }} />
                            </Tooltip>
                        </Checkbox>
                    )}
                />
            </Form.Item>
            {/* 如果每个配置区域有独立的保存按钮，可以添加：
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={isSaving}>
                  保存应用设置
                </Button>
              </Form.Item>
            */}
        </Form>
    );
};

export default ApplicationSettingsForm;