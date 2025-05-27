// frontend-react/src/components/AddStepModal.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Radio, Select, List, Typography, Spin, Tag, message as antMessage, Space } from 'antd';
import { CodeOutlined, DatabaseOutlined, PlusCircleOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { v4 as uuidv4 } from 'uuid';

// 从 services/api.ts 导入权威类型和 API 函数
import {
    RuleTemplate,
    PredefinedTaskEnum, // 用于默认私有步骤
    StepInputSourceEnum, // 用于默认私有步骤
    PostProcessingRuleEnum, // 确保导入，因为 RuleStepPrivateUIData 使用
    getRuleTemplates, // API 函数
} from '../services/api';

// 从 constants.ts 导入任务详情映射，用于显示模板的任务类型
import { PREDEFINED_TASK_DETAILS_MAP } from '../constants';

// 共享的 EditableStep 类型定义 (理想情况下从共享类型文件导入)
// 为保持此文件相对独立，这里重新声明，确保与 RuleChainEditor.tsx 中的定义同步
type TempId = string;

interface RuleStepPrivateUIData {
  task_type: string;
  parameters: Record<string, any>; // 在此模态框中，新私有步骤的参数通常为空，后续编辑
  custom_instruction?: string | null;
  post_processing_rules: PostProcessingRuleEnum[]; // 使用导入的枚举
  input_source: StepInputSourceEnum; // 使用导入的枚举
  model_id?: string | null;
  llm_override_parameters?: Record<string, any> | null;
  generation_constraints?: Record<string, any> | null;
  output_variable_name?: string | null;
  description?: string | null;
}

interface RuleStepPublicFE extends RuleStepPrivateUIData {
  id?: number;
  tempId: TempId;
  uiType: 'private';
  is_enabled: boolean;
  step_order: number;
}

interface RuleTemplateInChainPublicFE extends RuleTemplate {
  tempId: TempId;
  uiType: 'template';
  step_order: number;
  is_enabled: boolean;
  template_id: number; // RuleTemplate.id 即为 template_id
}

export type EditableStep = RuleStepPublicFE | RuleTemplateInChainPublicFE;
// --- END: 类型定义 ---

import styles from './AddStepModal.module.css'; // 组件特定样式

const { Text, Paragraph } = Typography;

interface AddStepModalProps {
    isVisible: boolean;
    onClose: () => void;
    onAddSteps: (newSteps: EditableStep[]) => void; // 回调函数，接收新步骤数组
    // currentStepCount: number; // 用于设置新步骤的初始 step_order，现在由父组件重新计算
}

const AddStepModal: React.FC<AddStepModalProps> = ({
    isVisible,
    onClose,
    onAddSteps,
    // currentStepCount,
}) => {
    const [addType, setAddType] = useState<'private' | 'template'>('private'); // 添加步骤的类型
    const [availableTemplates, setAvailableTemplates] = useState<RuleTemplate[]>([]); // 模板库列表
    const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null); // 用户选择的模板ID
    const [isLoadingTemplates, setIsLoadingTemplates] = useState<boolean>(false); // 模板加载状态

    // 当选择从模板添加时，或者模态框首次对模板类型可见时，加载模板列表
    useEffect(() => {
        if (isVisible && addType === 'template') {
            setIsLoadingTemplates(true);
            getRuleTemplates({ page: 1, page_size: 1000 }) // 获取前1000个模板，假设足够
                .then(data => {
                    setAvailableTemplates(data.items || []);
                })
                .catch(error => {
                    antMessage.error('加载规则模板库失败，请稍后重试。');
                    console.error("加载模板库失败:", error);
                    setAvailableTemplates([]); // 出错时清空
                })
                .finally(() => {
                    setIsLoadingTemplates(false);
                });
        }
    }, [isVisible, addType]);

    // 处理点击“确认添加”按钮
    const handleOk = () => {
        let newStepToAdd: EditableStep | null = null;

        if (addType === 'private') {
            // 创建一个默认的私有步骤对象
            newStepToAdd = {
                tempId: uuidv4(), // 生成唯一临时ID
                uiType: 'private',
                task_type: PredefinedTaskEnum.CUSTOM_INSTRUCTION, // 默认任务类型
                parameters: {}, // 新步骤的参数默认为空，在主编辑器中配置
                is_enabled: true, // 默认启用
                step_order: 0, // 临时顺序，最终顺序由 RuleChainEditor 在添加后重新计算和标准化
                post_processing_rules: [], // 默认后处理规则为空
                input_source: StepInputSourceEnum.PREVIOUS_STEP, // 默认输入来源
                // 其他可选字段使用 undefined 或 null
                custom_instruction: null,
                model_id: null,
                llm_override_parameters: null,
                generation_constraints: null,
                output_variable_name: null,
                description: '新的私有步骤，请编辑详细配置。', // 默认描述
            } as RuleStepPublicFE; // 类型断言
            antMessage.info('已添加一个默认的“自定义指令”私有步骤。请在规则链编辑器中配置其详情。');
        } else if (addType === 'template') {
            if (selectedTemplateId) {
                const selectedTemplate = availableTemplates.find(t => t.id === selectedTemplateId);
                if (selectedTemplate) {
                    // 基于选中的模板创建模板引用步骤对象
                    newStepToAdd = {
                        ...selectedTemplate, // 展开 RuleTemplate 的所有属性 (name, description, parameters 定义等)
                        tempId: uuidv4(),
                        uiType: 'template',
                        template_id: selectedTemplate.id, // 确保 template_id 对应于 RuleTemplate.id
                        is_enabled: true, // 默认启用
                        step_order: 0, // 临时顺序，由 RuleChainEditor 重新计算
                    } as RuleTemplateInChainPublicFE; // 类型断言
                } else {
                    antMessage.error('无法添加：选择的模板在库中未找到。');
                    return;
                }
            } else {
                antMessage.warn('请从列表中选择一个模板，或切换到创建私有步骤。');
                return;
            }
        }

        if (newStepToAdd) {
            onAddSteps([newStepToAdd]); // 将新步骤（包裹在数组中）传递给父组件
        }
        handleCancel(); // 关闭并重置模态框
    };

    // 处理模态框关闭/取消
    const handleCancel = () => {
        onClose();
        // 重置模态框内部状态，以便下次打开时是干净的
        setAddType('private');
        setSelectedTemplateId(null);
        // availableTemplates 不需要在此重置，因为它会在 addType === 'template' 且模态框可见时重新加载
    };

    return (
        <Modal
            title={
                <Space> {/* 使用 AntD Space 布局标题和图标 */}
                    <PlusCircleOutlined /> 添加新步骤到规则链
                </Space>
            }
            open={isVisible} // AntD Modal 使用 open prop 控制可见性
            onOk={handleOk}
            onCancel={handleCancel}
            okText="确认添加"
            cancelText="取消"
            width={addType === 'template' ? 800 : 520} // 模板选择时模态框可以更宽
            className={styles.addStepModal} // 应用自定义的模态框根样式
            // 确认按钮的禁用条件：如果是模板类型，且模板列表正在加载，或者没有选择任何模板（但列表不为空）
            okButtonProps={{
                 disabled: addType === 'template' && (isLoadingTemplates || (!selectedTemplateId && availableTemplates.length > 0))
            }}
        >
            {/* 步骤类型选择 (私有 vs 模板) */}
            <Radio.Group
                onChange={(e) => setAddType(e.target.value)}
                value={addType}
                style={{ marginBottom: 20 }}
                buttonStyle="solid" // 按钮式单选组
            >
                <Radio.Button value="private"><CodeOutlined /> 创建新私有步骤</Radio.Button>
                <Radio.Button value="template"><DatabaseOutlined /> 从模板库选择</Radio.Button>
            </Radio.Group>

            {/* 根据选择的步骤类型显示不同内容 */}
            {addType === 'private' && (
                <Paragraph type="secondary"> {/* 使用 AntD Paragraph 显示提示信息 */}
                    将添加一个默认的“自定义指令”类型的私有步骤。您可以在主编辑器中修改其任务类型、参数和详细配置。
                </Paragraph>
            )}

            {addType === 'template' && (
                <Spin spinning={isLoadingTemplates} tip="加载模板列表中...">
                    {availableTemplates.length === 0 && !isLoadingTemplates ? (
                        <Text type="secondary">模板库中暂无可用模板，或加载失败。</Text>
                    ) : (
                        <div className={styles.templateSelectionContainer}>
                            <Paragraph type="secondary">
                                从下方列表中选择一个预定义的规则模板。模板的参数等详细配置请在“规则模板库”中管理。
                                添加到规则链后，您仅能修改其在链中的启用/禁用状态及顺序。
                            </Paragraph>
                            <List // 使用 AntD List 组件显示模板库
                                itemLayout="horizontal"
                                dataSource={availableTemplates}
                                className={styles.templateSelectList} // 应用自定义列表样式
                                renderItem={(template) => (
                                    <List.Item // 每个列表项
                                        onClick={() => setSelectedTemplateId(template.id)}
                                        // 根据是否被选中应用不同样式
                                        className={`${styles.templateListItem} ${selectedTemplateId === template.id ? styles.selectedTemplateListItem : ''}`}
                                    >
                                        <List.Item.Meta // 列表项的元数据（标题、描述等）
                                            avatar={<DatabaseOutlined style={{ fontSize: '20px', color: selectedTemplateId === template.id ? '#0958d9' : '#1677ff' }} />} // 图标
                                            title={<Text strong>{template.name} (ID: {template.id})</Text>} // 标题
                                            description={ // 描述内容
                                                <>
                                                    <Tag>{PREDEFINED_TASK_DETAILS_MAP[template.task_type as PredefinedTaskEnum]?.label || template.task_type}</Tag> {/* 任务类型标签 */}
                                                    <Paragraph ellipsis={{ rows: 2 }} type="secondary">
                                                        {template.description || '暂无详细描述'}
                                                    </Paragraph> {/* 描述文本，过长则省略 */}
                                                </>
                                            }
                                        />
                                        {/* 如果当前模板被选中，显示一个“已选择”的图标 */}
                                        {selectedTemplateId === template.id && <CheckCircleOutlined style={{color: '#52c41a', fontSize: '18px'}}/>}
                                    </List.Item>
                                )}
                                pagination={{ pageSize: 5, size: "small", hideOnSinglePage: true }} // 列表分页配置
                            />
                        </div>
                    )}
                </Spin>
            )}
        </Modal>
    );
};

export default AddStepModal;