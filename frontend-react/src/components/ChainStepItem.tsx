// frontend-react/src/components/ChainStepItem.tsx
import React from 'react';
import { List, Space, Typography, Tooltip, Tag, Dropdown, Button } from 'antd';
import type { MenuProps } from 'antd'; // 导入 MenuProps 类型
import {
  EditOutlined,
  CopyOutlined,
  DeleteOutlined,
  DatabaseOutlined,
  CodeOutlined,
  MoreOutlined,
  HolderOutlined,
} from '@ant-design/icons';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// 从 services/api.ts 导入 RuleTemplate 类型和 PredefinedTaskEnum 枚举
// 这些类型用于正确显示模板步骤信息和私有步骤的任务类型标签。
import { RuleTemplate, PredefinedTaskEnum } from '../services/api';
// 从 constants.ts 导入预定义任务的详情映射表
import { PREDEFINED_TASK_DETAILS_MAP } from '../constants';

// ---- START: 类型定义 (与 RuleChainEditor.tsx 中保持一致) ----
// 理想情况下，这些类型定义应从一个共享的 types 文件中导入，以避免重复。
// 为了此文件的独立性和清晰性，这里重新声明关键部分。
type TempId = string;

// 私有步骤在UI层的基础数据结构 (不含数据库ID, tempId, uiType, is_enabled, step_order)
// 主要用于表单编辑时的数据模型
interface RuleStepPrivateUIData {
  task_type: string; // 通常是 PredefinedTaskEnum 的值或自定义字符串
  // parameters 在此组件中通常不直接编辑，而是显示摘要或由编辑模态框处理
  // 为了类型完整性，可以保留，但此组件可能不直接使用其详细结构
  parameters: Record<string, any>; // 实际应为 Record<string, ApiRuleStepParameterDefinition 的值部分>
  custom_instruction?: string | null;
  post_processing_rules: PredefinedTaskEnum[]; // 这里可能应该是 PostProcessingRuleEnum[]
  input_source: string; // 通常是 StepInputSourceEnum 的值
  model_id?: string | null;
  llm_override_parameters?: Record<string, any> | null;
  generation_constraints?: Record<string, any> | null; // 通常是 Partial<GenerationConstraintsSchema>
  output_variable_name?: string | null;
  description?: string | null;
}

// 前端UI层代表一个已配置的私有步骤
interface RuleStepPublicFE extends RuleStepPrivateUIData {
  id?: number; // 数据库中的ID (如果是已保存的)
  tempId: TempId;
  uiType: 'private';
  is_enabled: boolean;
  step_order: number;
}

// 前端UI层代表一个引用的模板步骤 (扩展自API的RuleTemplate)
interface RuleTemplateInChainPublicFE extends RuleTemplate {
  tempId: TempId;
  uiType: 'template';
  step_order: number;
  is_enabled: boolean;
  template_id: number; // RuleTemplate.id 即为 template_id
}

// 编辑器中可拖拽的步骤项的联合类型
export type EditableStep = RuleStepPublicFE | RuleTemplateInChainPublicFE;
// ---- END: 类型定义 ----


// 引入 RuleChainEditor.module.css 中的样式
// 这些样式定义了步骤项的布局、颜色、拖拽手柄等视觉表现
import styles from './RuleChainEditor.module.css';

// ChainStepItem 组件的 Props 接口定义
interface ChainStepItemProps {
  step: EditableStep; // 当前步骤的数据对象
  index: number; // 步骤在列表中的实际显示顺序 (0-based)
  onEditStep: (tempId: TempId) => void; // 点击“编辑详情”时的回调函数
  onRemoveStep: (tempId: TempId) => void; // 点击“删除此步骤”时的回调函数
  onDuplicateStep: (tempId: TempId) => void; // 点击“复制此步骤”时的回调函数
}

const ChainStepItem: React.FC<ChainStepItemProps> = React.memo(({
  step,
  index,
  onEditStep,
  onRemoveStep,
  onDuplicateStep,
}) => {
  // 使用 @dnd-kit/sortable 的 useSortable hook 获取拖拽所需属性和监听器
  const {
    attributes, // 应用到可拖拽元素上的HTML属性 (例如 role, aria-roledescription)
    listeners,  // 应用到拖拽手柄上的事件监听器
    setNodeRef, // 用于将DOM节点与拖拽项关联的ref
    transform,  // 拖拽过程中的CSS transform 值
    transition, // 拖拽过程中的CSS transition 值
    isDragging, // 指示当前项是否正在被拖拽的布尔值
  } = useSortable({ id: step.tempId }); // 使用步骤的临时ID作为拖拽项的唯一标识

  // 根据拖拽状态计算应用的CSS样式
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform), // 将transform对象转换为CSS字符串
    transition, // 应用过渡效果
    zIndex: isDragging ? 1000 : 'auto', // 拖拽时提高层级，避免被其他元素遮挡
    opacity: isDragging ? 0.7 : 1, // 拖拽时设置半透明效果
    boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.15)' : undefined, // 拖拽时添加阴影
  };

  // 定义步骤操作的下拉菜单项
  const stepMenuItems: MenuProps['items'] = [
    {
      key: 'edit',
      label: '编辑详情',
      icon: <EditOutlined />,
      onClick: () => onEditStep(step.tempId), // 编辑操作
    },
    {
      key: 'duplicate',
      label: '复制此步骤',
      icon: <CopyOutlined />,
      onClick: () => onDuplicateStep(step.tempId), // 复制操作
    },
    { type: 'divider' }, // 分割线
    {
      key: 'remove',
      label: '删除此步骤',
      icon: <DeleteOutlined />,
      danger: true, // 将此项标记为危险操作 (通常显示为红色)
      onClick: () => onRemoveStep(step.tempId), // 删除操作
    },
  ];

  // 根据步骤类型选择不同的图标
  const stepTypeIcon = step.uiType === 'private'
    ? <Tooltip title="私有步骤（此链专属）"><CodeOutlined className={styles.stepIcon} /></Tooltip>
    : <Tooltip title="模板步骤（引用自模板库）"><DatabaseOutlined className={styles.stepIcon} /></Tooltip>;

  // 根据步骤类型获取步骤名称或任务类型标签
  const stepNameDisplay = step.uiType === 'private'
    ? PREDEFINED_TASK_DETAILS_MAP[step.task_type as PredefinedTaskEnum]?.label || step.task_type // 私有步骤显示任务类型的友好标签
    : `引用模板: ${step.name || `ID: ${step.template_id}`}`; // 模板步骤显示模板名称

  // 获取步骤的描述信息，区分私有步骤和模板步骤
  const stepDescriptionDisplay = step.uiType === 'private'
    ? step.description
    : `模板描述: ${step.description || '无描述'}`; // 模板步骤的描述前添加“模板描述:”

  return (
    // 使用 Ant Design List.Item作为列表项容器
    <List.Item
      ref={setNodeRef} // 关联DOM节点以便拖拽
      style={style}    // 应用拖拽样式
      // 应用基础样式、拖拽时样式，以及根据步骤类型区分的样式
      className={`${styles.stepItemBase} ${isDragging ? styles.stepItemDragging : ''} ${step.uiType === 'template' ? styles.templateStepItem : styles.privateStepItem}`}
      // ARIA属性，提高可访问性
      aria-label={`规则链步骤 ${index + 1}: ${stepNameDisplay}, 类型: ${step.uiType === 'private' ? '私有' : '模板'}`}
    >
      {/* 步骤主要内容和拖拽手柄 */}
      <Space align="center" style={{ width: '100%', cursor: 'default' }}>
        {/* 拖拽手柄，应用拖拽事件监听器和属性 */}
        <span
          {...attributes}
          {...listeners}
          className={styles.dragHandle}
          title="拖拽排序此步骤"
          role="button" // ARIA角色
          aria-label="拖拽手柄"
          tabIndex={0} // 使其可通过键盘聚焦
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { /* 可选：允许键盘触发拖拽 */ } }}
        >
          <HolderOutlined /> {/* 拖拽图标 */}
        </span>
        {stepTypeIcon} {/* 步骤类型图标 */}
        {/* 步骤内容（序号、名称、描述） */}
        <div className={styles.stepContent}>
          <Typography.Text strong className={styles.stepOrderText}>步骤 {index + 1}: </Typography.Text>
          <Typography.Text className={styles.stepName} title={stepNameDisplay}>
            {stepNameDisplay}
          </Typography.Text>
          {/* 如果步骤被禁用，显示“已禁用”标签 */}
          {step.is_enabled === false && <Tag color="orange" style={{marginLeft: 8}}>已禁用</Tag>}
          
          {/* 步骤描述，如果存在且不为空则显示。使用 Typography.Paragraph 支持省略和展开。 */}
          {stepDescriptionDisplay && stepDescriptionDisplay.trim() && (
            <Typography.Paragraph
              ellipsis={{ rows: 1, expandable: true, symbol: '详情' }} // 最多显示1行，可展开查看“详情”
              type="secondary" // 使用次要文本样式
              className={styles.stepDescription}
            >
              {stepDescriptionDisplay}
            </Typography.Paragraph>
          )}
        </div>
      </Space>
      {/* 步骤操作的下拉菜单 */}
      <Dropdown menu={{ items: stepMenuItems }} trigger={['click']}>
        <Button
          type="text" // 文本按钮样式
          icon={<MoreOutlined />} // “更多操作”图标
          className={styles.stepActionsButton}
          aria-label={`步骤 ${index + 1} 的更多操作`} // ARIA标签
        />
      </Dropdown>
    </List.Item>
  );
});

export default ChainStepItem; // 导出组件