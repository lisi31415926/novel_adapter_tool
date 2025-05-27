// frontend-react/src/components/RuleChainEditor.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Form as AntForm,
  Input as AntInput,
  Button as AntButton,
  Select as AntSelect,
  Checkbox as AntCheckbox,
  Space as AntSpace,
  Card as AntCard,
  List as AntList,
  Typography as AntTypography,
  Modal as AntModal,
  message as antMessage,
  Row as AntRow,
  Col as AntCol,
  Tooltip as AntTooltip,
  Tag as AntTag,
  Dropdown as AntDropdown,
  MenuProps as AntMenuProps,
  Spin as AntSpin,
  InputNumber as AntInputNumber,
  Alert as AntAlert, // 确保 Alert 已导入
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  CopyOutlined,
  SaveOutlined,
  QuestionCircleOutlined,
  DatabaseOutlined,
  CodeOutlined,
  MoreOutlined,
  AppstoreAddOutlined,
  HolderOutlined,
  InfoCircleOutlined,
  ChevronDownOutlined,
  CloseCircleOutlined,
  DeploymentUnitOutlined, // 用于规则链图标
} from '@ant-design/icons';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'react-toastify';

// 从 api.ts 导入核心类型和 API 函数
import {
  RuleChain,
  RuleChainCreate,
  RuleChainUpdate,
  RuleStepCreatePrivate, // 后端期望的私有步骤创建类型
  RuleTemplateReferenceCreate, // 后端期望的模板引用创建类型
  RuleTemplate,
  RuleStepParameterDefinition as ApiRuleStepParameterDefinition, // 权威类型
  StepParameterValueType as ApiStepParameterValueType,       // 权威类型
  ParameterTypeEnum as ApiParameterTypeEnum,                // 权威枚举
  ApplicationConfig,
  UserDefinedLLMConfig,
  GenerationConstraintsSchema,
  getRuleTemplates,
  getRuleTemplate,
  // getNovelById, // 导入 getNovelById
  Novel,        // 导入 Novel 类型
} from '../services/api';

// 从 constants.ts 导入枚举和预定义选项
import {
  StepInputSourceEnum,
  PredefinedTaskEnum,
  PostProcessingRuleEnum,
  PREDEFINED_TASK_DETAILS_MAP,
  TASK_PARAMETER_DEFINITIONS, // 包含详细参数定义的映射表
  POST_PROCESSING_RULE_OPTIONS,
  STEP_INPUT_SOURCE_OPTIONS,
} from '../constants';

import styles from './RuleChainEditor.module.css';
// 导入 TaskSpecificParamsInput (它内部已适配权威类型)
import TaskSpecificParamsInput from './TaskSpecificParamsInput';
// AddStepModal 已移至 RuleChainEditorPage.tsx 管理

const { Option } = AntSelect;
const { Title, Text, Paragraph } = AntTypography;

// --- 类型定义 (保持与父组件 RuleChainEditorPage.tsx 一致或根据需要调整) ---
type TempId = string; // 用于前端临时唯一ID

// 前端UI层使用的私有步骤类型，parameters 的值是实际值，而不是完整的定义对象
interface RuleStepPrivateUIData {
  task_type: string;
  parameters: Record<string, ApiStepParameterValueType | undefined>; // 存储实际参数值
  custom_instruction?: string | null;
  post_processing_rules: PostProcessingRuleEnum[];
  input_source: StepInputSourceEnum;
  model_id?: string | null;
  llm_override_parameters?: Record<string, any> | null;
  generation_constraints?: Partial<GenerationConstraintsSchema> | null;
  output_variable_name?: string | null;
  description?: string | null;
}

// 前端UI层代表一个已配置的私有步骤 (包含前端临时ID和数据库ID)
interface RuleStepPublicFE extends RuleStepPrivateUIData {
  id?: number; // 数据库中的ID (如果是已保存的)
  tempId: TempId;
  uiType: 'private';
  is_enabled: boolean;
  step_order: number; // UI 内部的顺序
}

// 前端UI层代表一个引用的模板步骤 (包含前端临时ID和模板元数据)
interface RuleTemplateInChainPublicFE extends RuleTemplate {
  tempId: TempId;
  uiType: 'template';
  step_order: number;
  is_enabled: boolean;
  template_id: number; // 确保 template_id 存在，它是 RuleTemplate.id
}

export type EditableStep = RuleStepPublicFE | RuleTemplateInChainPublicFE;
// --- 结束类型定义 ---


// --- 可排序步骤项组件 (SortableStep) ---
interface SortableStepItemProps {
  step: EditableStep;
  onEditStep: (tempId: TempId) => void;
  onRemoveStep: (tempId: TempId) => void;
  onDuplicateStep: (tempId: TempId) => void;
  index: number;
}

const SortableStep: React.FC<SortableStepItemProps> = React.memo(({
  step, onEditStep, onRemoveStep, onDuplicateStep, index
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.tempId });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1000 : 'auto',
    opacity: isDragging ? 0.7 : 1,
    boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.15)' : undefined,
  };

  const stepMenuItems: AntMenuProps['items'] = [
    { key: 'edit', label: '编辑详情', icon: <EditOutlined />, onClick: () => onEditStep(step.tempId) },
    { key: 'duplicate', label: '复制此步骤', icon: <CopyOutlined />, onClick: () => onDuplicateStep(step.tempId) },
    { type: 'divider' },
    { key: 'remove', label: '删除此步骤', icon: <DeleteOutlined />, danger: true, onClick: () => onRemoveStep(step.tempId) },
  ];

  const stepTypeIcon = step.uiType === 'private'
    ? <AntTooltip title="私有步骤（此链专属）"><CodeOutlined className={styles.stepIcon} /></AntTooltip>
    : <AntTooltip title="模板步骤（引用自模板库）"><DatabaseOutlined className={styles.stepIcon} /></AntTooltip>;

  const stepNameDisplay = step.uiType === 'private'
    ? PREDEFINED_TASK_DETAILS_MAP[step.task_type as PredefinedTaskEnum]?.label || step.task_type
    : `引用模板: ${step.name || `ID: ${step.template_id}`}`;

  const stepDescriptionDisplay = step.uiType === 'private'
    ? step.description
    : `模板描述: ${step.description || '无'}`;

  return (
    <AntList.Item
      ref={setNodeRef}
      style={style}
      className={`${styles.stepItemBase} ${isDragging ? styles.stepItemDragging : ''} ${step.uiType === 'template' ? styles.templateStepItem : styles.privateStepItem}`}
      aria-label={`规则链步骤 ${index + 1}: ${stepNameDisplay}, 类型: ${step.uiType === 'private' ? '私有' : '模板'}`}
    >
      <AntSpace align="center" style={{ width: '100%', cursor: 'default' /* 避免覆盖拖拽手柄的cursor */ }}>
        <span {...attributes} {...listeners} className={styles.dragHandle} title="拖拽排序此步骤" role="button" aria-label="拖拽手柄">
          <HolderOutlined />
        </span>
        {stepTypeIcon}
        <div className={styles.stepContent}>
          <Text strong className={styles.stepOrderText}>步骤 {index + 1}: </Text>
          <Text className={styles.stepName} title={stepNameDisplay}>{stepNameDisplay}</Text>
          {!step.is_enabled && <AntTag color="orange" style={{marginLeft: 8}}>已禁用</AntTag>}
          {stepDescriptionDisplay && (
            <Paragraph ellipsis={{ rows: 1, expandable: true, symbol: '详情' }} type="secondary" className={styles.stepDescription}>
              {stepDescriptionDisplay}
            </Paragraph>
          )}
        </div>
      </AntSpace>
      <AntDropdown menu={{ items: stepMenuItems }} trigger={['click']}>
        <AntButton type="text" icon={<MoreOutlined />} className={styles.stepActionsButton} aria-label={`步骤 ${index + 1} 的更多操作`} />
      </AntDropdown>
    </AntList.Item>
  );
});

// --- RuleChainEditor Props 定义 ---
interface RuleChainEditorProps {
  initialData?: RuleChain | null;
  initialDraft?: RuleChainCreate | null;
  onSubmit: (data: RuleChainCreate | RuleChainUpdate, isEditMode: boolean) => Promise<void>;
  onCancel: () => void;
  appConfig: ApplicationConfig | null; // 从父组件接收应用配置
  availableLLMModels: UserDefinedLLMConfig[]; // 从父组件接收可用的LLM模型列表
  isSaving?: boolean; // 接收父组件的全局保存状态
}

// --- RuleChainEditor 主组件 ---
const RuleChainEditor: React.FC<RuleChainEditorProps> = ({
  initialData: initialDataFromProps,
  initialDraft: initialDraftFromLocation,
  onSubmit: onSubmitToParent,
  onCancel: onCancelEditing,
  appConfig,
  availableLLMModels,
  isSaving: isSavingFromParent,
}) => {
  const [form] = AntForm.useForm<RuleChainCreate | RuleChainUpdate>(); // 主表单实例
  const [unifiedSteps, setUnifiedSteps] = useState<EditableStep[]>([]); // UI层统一管理的步骤列表

  const isEditMode = useMemo(() => !!(initialDataFromProps && initialDataFromProps.id), [initialDataFromProps]);
  const [isLoadingEditor, setIsLoadingEditor] = useState<boolean>(true); // 编辑器数据加载状态
  const [isSubmittingEditorForm, setIsSubmittingEditorForm] = useState<boolean>(false); // 表单提交加载状态

  // 步骤编辑模态框相关状态
  const [editingStepInfo, setEditingStepInfo] = useState<(EditableStep & { originalIndexInList: number }) | null>(null);
  const [isStepModalOpen, setIsStepModalOpen] = useState<boolean>(false);

  // 模板库选择模态框相关状态
  const [isTemplateLibraryModalOpen, setIsTemplateLibraryModalOpen] = useState<boolean>(false);
  const [availableTemplatesInLibrary, setAvailableTemplatesInLibrary] = useState<RuleTemplate[]>([]);
  const [selectedTemplateIdInModal, setSelectedTemplateIdInModal] = useState<number | null>(null);
  const [isTemplateLibraryLoading, setIsTemplateLibraryLoading] = useState<boolean>(false);

  // DND Kit 传感器配置
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), // 拖拽激活距离
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  
  // 将后端步骤数据转换为前端UI可编辑的步骤列表
  const convertBackendChainToEditableSteps = useCallback((
    chainData: RuleChain | RuleChainCreate | null
  ): EditableStep[] => {
    if (!chainData) return [];
    const tempStepsToSort: Array<{
        order: number;
        uiType: 'private' | 'template';
        data: any; // 临时存储原始后端数据
        is_enabled: boolean;
    }> = [];

    // RuleChain (从数据库读取的，包含嵌套的 steps 和 template_associations.template 对象)
    if ('id' in chainData && chainData.steps) {
        (chainData.steps).forEach(stepOrm => {
            tempStepsToSort.push({
                order: stepOrm.step_order,
                uiType: 'private',
                data: stepOrm,
                is_enabled: stepOrm.is_enabled,
            });
        });
        (chainData.template_associations || []).forEach(assocOrm => {
            if (assocOrm.template) { // 确保模板数据已预加载
                tempStepsToSort.push({
                    order: assocOrm.step_order,
                    uiType: 'template',
                    data: assocOrm.template, // data 是 RuleTemplate 对象
                    is_enabled: assocOrm.is_enabled,
                });
            } else {
                antMessage.warn(`规则链中的一个模板引用 (顺序: ${assocOrm.step_order}) 缺少模板详情，可能无法正确显示。`);
            }
        });
    }
    // RuleChainCreate (用于新建或从API草稿创建，steps是私有步骤定义，template_associations是引用定义)
    else if (!('id' in chainData) && (chainData.steps || chainData.template_associations)) {
        (chainData.steps || []).forEach(stepCreatePrivate => {
            tempStepsToSort.push({
                order: stepCreatePrivate.step_order,
                uiType: 'private',
                data: stepCreatePrivate,
                is_enabled: stepCreatePrivate.is_enabled ?? true,
            });
        });
        (chainData.template_associations || []).forEach(templateRefCreate => {
            // 对于新建的引用，我们只有 template_id，需要后续填充模板详情
            tempStepsToSort.push({
                order: templateRefCreate.step_order,
                uiType: 'template',
                data: { id: templateRefCreate.template_id, template_id: templateRefCreate.template_id, name: `模板ID: ${templateRefCreate.template_id}` /* 临时名称 */ },
                is_enabled: templateRefCreate.is_enabled ?? true,
            });
        });
    }

    tempStepsToSort.sort((a, b) => a.order - b.order);

    return tempStepsToSort.map((item, index): EditableStep => {
        const baseEditablePart = { tempId: uuidv4(), step_order: index, is_enabled: item.is_enabled };
        if (item.uiType === 'private') {
            const privateStepData = item.data as RuleStepCreatePrivate; // 或 models.RuleStep
            // 构建 RuleStepPublicFE
            const uiStepParams: Record<string, ApiStepParameterValueType | undefined> = {};
            if (privateStepData.parameters) {
                Object.entries(privateStepData.parameters).forEach(([pKey, pDef]) => {
                    uiStepParams[pKey] = pDef.value; // 只存储参数值
                });
            }
            return {
                ...baseEditablePart,
                uiType: 'private',
                id: (privateStepData as any).id, // SQLModel 的 RuleStep 会有 id
                task_type: privateStepData.task_type,
                parameters: uiStepParams, // 前端存储的是参数【值】
                custom_instruction: privateStepData.custom_instruction,
                post_processing_rules: privateStepData.post_processing_rules || [],
                input_source: privateStepData.input_source || StepInputSourceEnum.PREVIOUS_STEP,
                model_id: privateStepData.model_id,
                llm_override_parameters: privateStepData.llm_override_parameters,
                generation_constraints: privateStepData.generation_constraints,
                output_variable_name: privateStepData.output_variable_name,
                description: privateStepData.description,
            };
        } else { // uiType === 'template'
            const templateBaseData = item.data as RuleTemplate; // 或 { id: number, name?: string } 结构
            return {
                ...templateBaseData, // 包含模板的 name, description, task_type, parameters (定义) 等
                tempId: baseEditablePart.tempId,
                uiType: 'template',
                step_order: baseEditablePart.step_order,
                is_enabled: baseEditablePart.is_enabled,
                template_id: templateBaseData.id, // RuleTemplate.id 就是 template_id
                // parameters 字段来自 RuleTemplate，已经是参数【定义】
            };
        }
    });
  }, []);

  // 如果模板步骤缺少详细信息（例如从草稿创建时），则异步获取
  const fetchTemplateDetailsForMissingSteps = useCallback(async (currentSteps: EditableStep[]): Promise<EditableStep[]> => {
    let didUpdateDetails = false;
    const stepsNeedingDetails = currentSteps.filter(step =>
        step.uiType === 'template' &&
        step.template_id &&
        (!step.name || Object.keys(step.parameters || {}).length === 0) // 如果没有名称或参数定义
    );

    if (stepsNeedingDetails.length === 0) {
        return currentSteps;
    }

    antMessage.loading({ content: `正在加载 ${stepsNeedingDetails.length} 个模板步骤的详细信息...`, key: 'fetchTemplateDetails', duration: 0 });

    const updatedStepsPromises = currentSteps.map(async (step) => {
        if (step.uiType === 'template' && step.template_id && (!step.name || Object.keys(step.parameters || {}).length === 0)) {
            try {
                const templateFullData = await getRuleTemplate(step.template_id);
                didUpdateDetails = true;
                return { // 合并，保留 tempId, is_enabled, step_order, uiType
                    ...(step as RuleTemplateInChainPublicFE), // 保留现有前端状态
                    ...(templateFullData as Omit<RuleTemplate, 'id'>), // 用API数据覆盖模板固有字段
                    parameters: templateFullData.parameters || {}, // 确保参数定义存在
                    template_id: templateFullData.id, // 确保 template_id 正确
                };
            } catch (error) {
                console.error(`加载模板ID ${step.template_id} 的详情失败:`, error);
                antMessage.warning(`模板ID ${step.template_id} 的详情加载失败。`, 4);
                return { ...step, name: step.name || `模板ID ${step.template_id} (加载失败)`, parameters: {} };
            }
        }
        return step;
    });

    const resolvedSteps = await Promise.all(updatedStepsPromises);
    antMessage.destroy('fetchTemplateDetails');
    if (didUpdateDetails) {
        antMessage.success('所有模板步骤的详细信息已加载。');
        return reorderAndNormalizeStepOrders(resolvedSteps);
    }
    return currentSteps;
  }, []);


  // 初始化 Effect Hook: 加载数据或设置表单默认值
  useEffect(() => {
    let dataToInitializeFrom: RuleChain | RuleChainCreate | null = null;
    if (isEditMode && initialDataFromProps) {
        dataToInitializeFrom = initialDataFromProps;
    } else if (!isEditMode && initialDraftFromLocation) { // 从模板复制或API草稿
        dataToInitializeFrom = initialDraftFromLocation;
    }

    if (dataToInitializeFrom) {
        setIsLoadingEditor(true);
        // 从 dataToInitializeFrom 中排除 steps 和 template_associations，这些将由 unifiedSteps 管理
        const { steps: backendSteps, template_associations: backendTemplateAssocs, ...chainMetaData } = dataToInitializeFrom;

        form.setFieldsValue({
            ...chainMetaData,
            // novel_id 需要特殊处理，因为它可能是null，而AntD InputNumber可能不接受null
            novel_id: (dataToInitializeFrom as RuleChain).novel_id ?? (dataToInitializeFrom as RuleChainCreate).novel_id ?? undefined,
            global_llm_override_parameters: chainMetaData.global_llm_override_parameters ? JSON.stringify(chainMetaData.global_llm_override_parameters, null, 2) : '{}',
            global_generation_constraints: chainMetaData.global_generation_constraints ? JSON.stringify(chainMetaData.global_generation_constraints, null, 2) : '{}',
        });

        const initialEditableSteps = convertBackendChainToEditableSteps(dataToInitializeFrom);
        fetchTemplateDetailsForMissingSteps(initialEditableSteps)
            .then(stepsWithDetails => {
                setUnifiedSteps(reorderAndNormalizeStepOrders(stepsWithDetails));
            })
            .finally(() => {
                setIsLoadingEditor(false);
            });

    } else if (!isEditMode) { // 完全新建模式
        form.resetFields();
        form.setFieldsValue({
            name: `新规则链 @ ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`,
            description: '', is_template: false,
            novel_id: undefined, // 对于新建，novel_id 初始可以为 undefined
            global_model_id: null, global_llm_override_parameters: '{}', global_generation_constraints: '{}',
        });
        setUnifiedSteps([]);
        setIsLoadingEditor(false);
    }
  }, [initialDataFromProps, isEditMode, initialDraftFromLocation, form, convertBackendChainToEditableSteps, fetchTemplateDetailsForMissingSteps]);


  // 重新排序并标准化步骤顺序
  const reorderAndNormalizeStepOrders = (currentSteps: EditableStep[]): EditableStep[] => {
    return currentSteps.map((step, index) => ({ ...step, step_order: index }));
  };

  // 打开步骤编辑器模态框 (用于编辑现有步骤或创建新的私有步骤)
  const openStepEditorModalForEditOrCreate = (tempIdToEdit?: TempId) => {
    if (tempIdToEdit) { // 编辑现有步骤
      const stepIndex = unifiedSteps.findIndex(s => s.tempId === tempIdToEdit);
      if (stepIndex !== -1) {
        setEditingStepInfo({ ...unifiedSteps[stepIndex], originalIndexInList: stepIndex });
      } else {
        antMessage.error("未能找到要编辑的步骤。");
        return;
      }
    } else { // 创建新的私有步骤
      setEditingStepInfo(null); // 清空编辑信息，表示是新建
    }
    setIsStepModalOpen(true);
  };
  // 快捷函数：专门用于“添加新私有步骤”按钮
  const handleInitiateNewPrivateStep = () => {
    openStepEditorModalForEditOrCreate(); // 不传递 tempId 即为新建
  };

  // 打开模板库选择模态框
  const handleOpenTemplateLibraryModal = async () => {
    setIsTemplateLibraryModalOpen(true);
    setIsTemplateLibraryLoading(true);
    try {
      const templatesPaginatedData = await getRuleTemplates({ page: 1, page_size: 1000 }); // 获取所有模板
      setAvailableTemplatesInLibrary(templatesPaginatedData.items || []);
    } catch (error) {
      antMessage.error('加载规则模板库失败，请稍后重试。');
      console.error("加载模板库失败:", error);
    } finally {
      setIsTemplateLibraryLoading(false);
    }
  };

  // 处理从模板库选择并添加模板步骤
  const handleConfirmAddTemplateStepFromModal = async () => {
    if (selectedTemplateIdInModal) {
      try {
        // 确保我们有模板的完整数据（包括参数定义）
        let selectedTemplateFullData = availableTemplatesInLibrary.find(t => t.id === selectedTemplateIdInModal);
        if (!selectedTemplateFullData || Object.keys(selectedTemplateFullData.parameters || {}).length === 0) {
            antMessage.info({ content: `正在获取模板ID ${selectedTemplateIdInModal} 的最新详细参数定义...`, key: 'fetchingFullTemplate', duration: 0 });
            selectedTemplateFullData = await getRuleTemplate(selectedTemplateIdInModal);
            antMessage.destroy('fetchingFullTemplate');
        }
        
        const newTemplateStep: RuleTemplateInChainPublicFE = {
          ...(selectedTemplateFullData as RuleTemplate), // 展开 RuleTemplate 的所有属性
          tempId: uuidv4(), // 新的临时唯一ID
          uiType: 'template',
          step_order: unifiedSteps.length, // 临时顺序，会被 reorderAndNormalizeStepOrders 修正
          is_enabled: true, // 默认启用
          template_id: selectedTemplateFullData.id, // 确保 template_id 正确
          // RuleTemplate 自身已经包含 parameters: Record<string, ApiRuleStepParameterDefinition>
        };
        setUnifiedSteps(prevSteps => reorderAndNormalizeStepOrders([...prevSteps, newTemplateStep]));
        setIsTemplateLibraryModalOpen(false);
        setSelectedTemplateIdInModal(null); // 重置选择
        antMessage.success(`模板 "${selectedTemplateFullData.name}" 已添加到规则链。`);
      } catch (error) {
        antMessage.error(`加载所选模板 (ID: ${selectedTemplateIdInModal}) 的详情时出错，添加失败。`);
        console.error("添加模板步骤时加载模板详情失败:", error);
      }
    } else {
      antMessage.warn('请先从列表中选择一个模板。');
    }
  };
  
  // 保存从模态框编辑的私有步骤数据
  const handleSavePrivateStepDataFromModal = (privateStepDataFromModal: RuleStepCreatePrivate) => {
    // privateStepDataFromModal.parameters 来自 TaskSpecificParamsInput，应该是 Record<string, ApiStepParameterValueType | undefined>
    // 我们需要将其转换为后端期望的 Record<string, ApiRuleStepParameterDefinition> (即包含定义和值)
    const parametersForBackend: Record<string, ApiRuleStepParameterDefinition> = {};
    const definitionsUsed = TASK_PARAMETER_DEFINITIONS[privateStepDataFromModal.task_type as PredefinedTaskEnum] || {};
    
    Object.entries(definitionsUsed).forEach(([paramKey, paramDefSchema]) => {
      parametersForBackend[paramKey] = {
        ...paramDefSchema, // 包含 param_type, label, description, config, schema
        value: privateStepDataFromModal.parameters[paramKey], // 从传入的参数值中获取 value
      };
    });

    const stepDataWithFullParams: RuleStepPrivateUIData = {
      ...privateStepDataFromModal,
      parameters: parametersForBackend, // 使用转换后的参数
    };

    let updatedStepsList: EditableStep[];
    if (editingStepInfo && editingStepInfo.uiType === 'private') { // 编辑现有私有步骤
      updatedStepsList = unifiedSteps.map((s) =>
        s.tempId === editingStepInfo.tempId 
        ? { ...s, ...stepDataWithFullParams, tempId: s.tempId, uiType: 'private' } as RuleStepPublicFE
        : s
      );
    } else { // 创建新的私有步骤
      const newCompletePrivateStep: RuleStepPublicFE = {
        ...(stepDataWithFullParams as RuleStepPrivateUIData), // 确保类型匹配
        tempId: uuidv4(),
        step_order: unifiedSteps.length, // 临时顺序
        uiType: 'private',
        is_enabled: true, // 默认启用 (来自 formValues.is_enabled)
      };
      updatedStepsList = [...unifiedSteps, newCompletePrivateStep];
    }
    setUnifiedSteps(reorderAndNormalizeStepOrders(updatedStepsList));
    setIsStepModalOpen(false);
    setEditingStepInfo(null); // 清理编辑状态
    antMessage.success(editingStepInfo ? "私有步骤已更新。" : "新私有步骤已添加。");
  };
  
  // 保存从模态框编辑的模板引用步骤数据 (仅启用/禁用状态)
  const handleSaveTemplateReferenceStepDataFromModal = (templateRefDataFromModal: RuleTemplateReferenceCreate & { tempId: TempId }) => {
     if(editingStepInfo && editingStepInfo.uiType === 'template'){
        const updatedStepsList = unifiedSteps.map(s =>
            s.tempId === editingStepInfo.tempId
            ? { ...s, is_enabled: templateRefDataFromModal.is_enabled } as RuleTemplateInChainPublicFE // 只更新启用状态
            : s
        );
        setUnifiedSteps(reorderAndNormalizeStepOrders(updatedStepsList));
        setIsStepModalOpen(false);
        setEditingStepInfo(null); // 清理编辑状态
        antMessage.success("模板步骤的启用状态已更新。");
     } else {
        antMessage.error("保存模板引用步骤时出错：未找到正在编辑的步骤或步骤类型不匹配。");
     }
  };

  // 从列表中移除一个步骤
  const handleRemoveStepFromList = (tempIdToRemove: TempId) => {
    AntModal.confirm({
        title: '确认删除步骤',
        content: '您确定要从规则链中移除这个步骤吗？此操作不可撤销。',
        okText: '确认删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => {
            const newStepsList = unifiedSteps.filter(step => step.tempId !== tempIdToRemove);
            setUnifiedSteps(reorderAndNormalizeStepOrders(newStepsList));
            antMessage.success('步骤已成功从规则链中移除。');
        }
    });
  };

  // 复制一个步骤到列表末尾
  const handleDuplicateStepInList = (tempIdToDuplicate: TempId) => {
    const stepToDuplicate = unifiedSteps.find(s => s.tempId === tempIdToDuplicate);
    if (stepToDuplicate) {
      // 深拷贝步骤数据，并生成新的tempId
      const newDuplicatedStep: EditableStep = {
        ...JSON.parse(JSON.stringify(stepToDuplicate)), // 确保深拷贝所有嵌套对象
        tempId: uuidv4(), // 新的唯一临时ID
        step_order: unifiedSteps.length, // 初始顺序为列表末尾
        // 如果是私有步骤，其数据库 id 应该在复制时移除 (如果有的话)，表示这是一个新的未保存的步骤
        // 如果是模板步骤，其 template_id 和其他模板元数据应该保留
      };
      if (newDuplicatedStep.uiType === 'private') {
        (newDuplicatedStep as RuleStepPublicFE).id = undefined; // 清除数据库ID
      }

      setUnifiedSteps(prevSteps => reorderAndNormalizeStepOrders([...prevSteps, newDuplicatedStep]));
      antMessage.success(`步骤 "${stepToDuplicate.uiType === 'private' ? stepToDuplicate.task_type : stepToDuplicate.name}" 已成功复制。`);
    }
  };

  // 处理拖拽结束事件
  const handleDragEndEvent = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setUnifiedSteps((currentStepsList) => {
        const oldIndex = currentStepsList.findIndex(s => s.tempId === active.id);
        const newIndex = currentStepsList.findIndex(s => s.tempId === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
          return reorderAndNormalizeStepOrders(arrayMove(currentStepsList, oldIndex, newIndex));
        }
        return currentStepsList; // 如果索引无效，则不改变
      });
    }
  };

  // 主表单提交处理
  const handleMainFormSubmit = async () => {
    setIsSubmittingEditorForm(true);
    try {
      const ruleChainMetaData = await form.validateFields(); // 获取主表单的元数据
      const privateStepsToSubmit: RuleStepCreatePrivate[] = [];
      const templateAssociationsToSubmit: RuleTemplateReferenceCreate[] = [];

      // 遍历 UI 步骤列表，转换为后端期望的格式
      unifiedSteps.forEach((editableStep, index) => {
        const currentStepOrder = index; // 确保后端 step_order 从0开始且连续
        if (editableStep.uiType === 'private') {
          // 私有步骤：从 RuleStepPublicFE 转换为 RuleStepCreatePrivate
          // editableStep.parameters 此时是 Record<string, ApiStepParameterValueType | undefined>
          // 后端期望的是 Record<string, ApiRuleStepParameterDefinition>
          const parametersForApi: Record<string, ApiRuleStepParameterDefinition> = {};
          const definitionsForThisTask = TASK_PARAMETER_DEFINITIONS[editableStep.task_type as PredefinedTaskEnum] || {};
          
          Object.entries(definitionsForThisTask).forEach(([paramKey, paramDefSchema]) => {
            parametersForApi[paramKey] = {
              ...paramDefSchema, // 包含类型、标签、描述、配置、schema等定义部分
              value: editableStep.parameters[paramKey], // 从UI状态获取实际值
            };
          });

          privateStepsToSubmit.push({
            step_type: 'private', // 明确步骤类型
            step_order: currentStepOrder,
            is_enabled: editableStep.is_enabled,
            task_type: editableStep.task_type,
            parameters: parametersForApi, // 转换后的参数对象
            custom_instruction: editableStep.custom_instruction,
            post_processing_rules: editableStep.post_processing_rules || [],
            input_source: editableStep.input_source,
            model_id: editableStep.model_id,
            llm_override_parameters: editableStep.llm_override_parameters,
            generation_constraints: editableStep.generation_constraints,
            output_variable_name: editableStep.output_variable_name,
            description: editableStep.description,
          });
        } else if (editableStep.uiType === 'template') {
          // 模板引用步骤：转换为 RuleTemplateReferenceCreate
          templateAssociationsToSubmit.push({
            step_type: 'template', // 明确步骤类型
            template_id: editableStep.template_id, // RuleTemplateInChainPublicFE 有 template_id
            step_order: currentStepOrder,
            is_enabled: editableStep.is_enabled,
          });
        }
      });

      const payloadForApi: RuleChainCreate | RuleChainUpdate = {
        ...(isEditMode && initialDataFromProps ? { id: initialDataFromProps.id } : {}), // 如果是编辑模式，包含ID
        ...ruleChainMetaData, // name, description, is_template, novel_id 等
        // novel_id 从表单获取，如果表单中没有，则尝试从 initialData 中获取
        novel_id: ruleChainMetaData.novel_id ?? (initialDataFromProps?.novel_id ?? undefined),
        // JSON字符串字段需要安全解析
        global_llm_override_parameters: ruleChainMetaData.global_llm_override_parameters && typeof ruleChainMetaData.global_llm_override_parameters === 'string' && ruleChainMetaData.global_llm_override_parameters.trim()
            ? JSON.parse(ruleChainMetaData.global_llm_override_parameters) : {},
        global_generation_constraints: ruleChainMetaData.global_generation_constraints && typeof ruleChainMetaData.global_generation_constraints === 'string' && ruleChainMetaData.global_generation_constraints.trim()
            ? JSON.parse(ruleChainMetaData.global_generation_constraints) : null,
        steps: privateStepsToSubmit,
        template_associations: templateAssociationsToSubmit,
      };
      
      await onSubmitToParent(payloadForApi, isEditMode);
      // 成功提示已在父组件 RuleChainEditorPage 中处理
    } catch (errorInfo: any) {
        console.error('规则链主表单验证或提交准备失败:', errorInfo);
        if (typeof errorInfo === 'string') { antMessage.error(errorInfo); }
        else if (errorInfo.errorFields && Array.isArray(errorInfo.errorFields) && errorInfo.errorFields.length > 0) {
            const firstError = errorInfo.errorFields[0].errors[0] || '请检查表单输入。';
            antMessage.error(`表单校验失败: ${firstError}`);
        } else { antMessage.error('保存规则链失败，请检查表单内容和网络连接。'); }
        // 对于Promise.reject的情况，这里不需要再次抛出，因为父组件会处理
    } finally {
        setIsSubmittingEditorForm(false);
    }
  };
  
  // 添加步骤的下拉菜单项
  const addStepDropdownMenuItems: AntMenuProps['items'] = [
    { key: 'add_private_step', label: '创建新的私有步骤', icon: <CodeOutlined />, onClick: handleInitiateNewPrivateStep, },
    { key: 'add_template_step', label: '从模板库添加步骤', icon: <DatabaseOutlined />, onClick: handleOpenTemplateLibraryModal, },
  ];

  // 渲染加载状态
  if (isLoadingEditor && isEditMode) {
    return <div className={styles.editorContainer} style={{display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px'}}><AntSpin size="large" tip="加载规则链数据中..." /></div>;
  }

  return (
    <div className={styles.editorContainer}>
      {/* 主表单 */}
      <AntForm form={form} layout="vertical" onFinish={handleMainFormSubmit} className={styles.ruleChainForm} disabled={isSavingFromParent || isLoadingEditor}>
        {/* 规则链基本信息卡片 */}
        <AntCard title="规则链基本信息" className={styles.formCard}>
            {/* ... (名称、小说ID、描述、是否模板等表单项，与您之前代码一致，确保AntD Form.Item包裹) ... */}
             <AntRow gutter={16}>
                <AntCol xs={24} md={12}>
                    <AntForm.Item name="name" label="规则链名称" rules={[{ required: true, message: '请输入规则链的名称!' }]}>
                        <AntInput placeholder="例如：章节摘要与主题分析链" />
                    </AntForm.Item>
                </AntCol>
                <AntCol xs={24} md={12}>
                    <AntForm.Item name="novel_id" label={ <AntSpace>关联小说ID <AntTooltip title="（可选）如果此规则链是为特定小说设计的，请填写其ID。"> <QuestionCircleOutlined /> </AntTooltip> </AntSpace> }>
                        <AntInputNumber style={{ width: '100%' }} placeholder="填写小说ID（如果适用）" disabled={(initialDataFromProps?.novel_id !== undefined && initialDataFromProps?.novel_id !== null)} />
                    </AntForm.Item>
                </AntCol>
            </AntRow>
            <AntForm.Item name="description" label="规则链描述">
                <AntInput.TextArea rows={2} placeholder="简要描述此规则链的用途、目标和主要处理流程。" />
            </AntForm.Item>
            <AntForm.Item name="is_template" valuePropName="checked" tooltip="如果勾选，此规则链可以作为模板被其他规则链引用。">
                <AntCheckbox>标记为模板</AntCheckbox>
            </AntForm.Item>
        </AntCard>

        {/* 全局LLM配置卡片 */}
        <AntCard title="全局LLM配置 (可选)" className={styles.formCard}>
            {/* ... (全局模型ID、覆盖参数、生成约束等表单项，与您之前代码一致) ... */}
            <AntRow gutter={16}>
            <AntCol xs={24} md={12}>
              <AntForm.Item name="global_model_id" label="全局默认模型ID (用户定义)" tooltip="选择一个用户定义的LLM配置作为此链中所有步骤的默认模型。步骤可以单独覆盖此设置。" >
                <AntSelect placeholder="选择或输入用户定义的模型ID" allowClear showSearch optionFilterProp="label" disabled={!availableLLMModels || availableLLMModels.length === 0}
                  filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                >
                    {availableLLMModels.map(model => (
                        <Option key={model.user_given_id} value={model.user_given_id} label={model.user_given_name}>
                            {model.user_given_name} <AntTag color="blue" style={{marginLeft: '8px'}}>{model.provider_tag}</AntTag>
                        </Option>
                    ))}
                </AntSelect>
              </AntForm.Item>
            </AntCol>
          </AntRow>
          <AntRow gutter={16}>
            <AntCol xs={24} md={12}>
                <AntForm.Item name="global_llm_override_parameters" label="全局LLM覆盖参数 (JSON)" tooltip="以JSON对象格式提供。这些参数将应用于链中所有步骤，除非步骤有自己的覆盖设置。" rules={[{ validator: async (_, value: string) => { if (value && value.trim() !== "" && value.trim() !== "{}") { try { JSON.parse(value); } catch (e) { throw new Error('必须是有效的JSON对象格式！若无特定参数，请留空或填 {}'); }} return Promise.resolve(); }}]} >
                    <AntInput.TextArea rows={3} placeholder='例如：{ "temperature": 0.5 }'/>
                </AntForm.Item>
            </AntCol>
            <AntCol xs={24} md={12}>
                <AntForm.Item name="global_generation_constraints" label="全局生成内容约束 (JSON)" tooltip="以JSON对象格式提供，结构需符合 GenerationConstraintsSchema。这些约束将应用于链中所有步骤，除非步骤有自己的约束设置。" rules={[{ validator: async (_, value: string) => { if (value && value.trim() !== "" && value.trim() !== "{}") { try { JSON.parse(value); } catch (e) { throw new Error('必须是有效的JSON对象格式！若无特定约束，请留空或填 {}'); }} return Promise.resolve(); }}]} >
                    <AntInput.TextArea rows={3} placeholder='例如：{ "min_length": 50, "output_format": "paragraph" }'/>
                </AntForm.Item>
            </AntCol>
          </AntRow>
        </AntCard>

        {/* 规则步骤编排卡片 */}
        <AntCard
          title="规则步骤编排 (可拖拽排序)"
          className={styles.formCard}
          extra={
            <AntDropdown menu={{ items: addStepDropdownMenuItems }} trigger={['click']}>
              <AntButton type="dashed" icon={<AppstoreAddOutlined />} disabled={isSubmittingEditorForm || isSavingFromParent}>
                添加步骤 <ChevronDownOutlined />
              </AntButton>
            </AntDropdown>
          }
        >
          {unifiedSteps.length === 0 ? (
            <div className={styles.emptyStepsPlaceholder}>
              <InfoCircleOutlined style={{fontSize: '24px', color: '#999'}}/>
              <Text type="secondary" style={{marginTop: 8}}>暂无步骤。请点击右上角的“添加步骤”按钮开始构建您的规则链。</Text>
            </div>
          ) : (
            <DndContext sensors={dndSensors} onDragEnd={handleDragEndEvent} collisionDetection={closestCenter}>
              <SortableContext items={unifiedSteps.map(s => s.tempId)} strategy={verticalListSortingStrategy}>
                <AntList
                    itemLayout="horizontal"
                    dataSource={unifiedSteps}
                    className={styles.stepsList}
                    renderItem={(step, index) => (
                        <SortableStep
                            key={step.tempId}
                            step={step}
                            index={index}
                            onEditStep={openStepEditorModalForEditOrCreate}
                            onRemoveStep={handleRemoveStepFromList}
                            onDuplicateStep={handleDuplicateStepInList}
                        />
                    )}
                />
              </SortableContext>
            </DndContext>
          )}
        </AntCard>

        {/* 表单操作按钮 */}
        <AntForm.Item wrapperCol={{ span: 24 }} className={styles.formActionsContainer}>
          <AntSpace>
            <AntButton type="primary" htmlType="submit" icon={<SaveOutlined />} loading={isSubmittingEditorForm} disabled={isLoadingEditor || isSavingFromParent}>
                {isEditMode ? '保存规则链更改' : '创建此规则链'}
            </AntButton>
            <AntButton icon={<CloseCircleOutlined />} onClick={onCancelEditing} disabled={isSubmittingEditorForm || isSavingFromParent}>
                取消
            </AntButton>
          </AntSpace>
        </AntForm.Item>
      </AntForm>

      {/* 步骤编辑器模态框 */}
      {isStepModalOpen && (
        <StepEditorInternalModal
          visible={isStepModalOpen}
          onCancel={() => { setIsStepModalOpen(false); setEditingStepInfo(null); }}
          onSavePrivateStep={handleSavePrivateStepDataFromModal}
          onSaveTemplateReferenceStep={handleSaveTemplateReferenceStepDataFromModal}
          stepBeingEdited={editingStepInfo} // 传递编辑的步骤信息
          existingStepOrder={editingStepInfo ? editingStepInfo.originalIndexInList : unifiedSteps.length} // 传递原始顺序或新步骤的顺序
          appConfig={appConfig}
          availableLLMModels={availableLLMModels || []}
          novelId={(form.getFieldValue('novel_id') as number | undefined) || (initialDataFromProps?.novel_id)}
        />
      )}

      {/* 从模板库添加步骤的模态框 */}
      <AntModal
        title={ <AntSpace> <DatabaseOutlined /> 从模板库添加步骤 </AntSpace> }
        open={isTemplateLibraryModalOpen}
        onOk={handleConfirmAddTemplateStepFromModal}
        onCancel={() => { setIsTemplateLibraryModalOpen(false); setSelectedTemplateIdInModal(null); }}
        width={800} // 模态框宽度
        okText="确认添加选中模板"
        cancelText="取消选择"
        confirmLoading={isTemplateLibraryLoading || (selectedTemplateIdInModal === null)} // 当模板ID未选择时，禁用确认按钮
        okButtonProps={{disabled: selectedTemplateIdInModal === null}}
      >
        <AntSpin spinning={isTemplateLibraryLoading} tip="加载模板列表中...">
          {availableTemplatesInLibrary.length === 0 && !isTemplateLibraryLoading && (
            <Text type="secondary">模板库中暂无可用模板，或加载失败。</Text>
          )}
          <AntList // 使用 AntD List 组件显示模板库
            itemLayout="horizontal"
            dataSource={availableTemplatesInLibrary}
            className={styles.templateSelectionList} // 应用自定义列表样式
            renderItem={(templateItem) => (
              <AntList.Item // 每个列表项
                onClick={() => setSelectedTemplateIdInModal(templateItem.id)}
                className={`${styles.templateListItemAntd} ${selectedTemplateIdInModal === templateItem.id ? styles.selectedTemplateItemAntd : ''}`}
                actions={[ // 列表项右侧的操作按钮
                  <AntButton
                    type={selectedTemplateIdInModal === templateItem.id ? 'primary' : 'default'}
                    onClick={(e) => { e.stopPropagation(); setSelectedTemplateIdInModal(templateItem.id); }}
                    size="small"
                  >
                    {selectedTemplateIdInModal === templateItem.id ? '已选择' : '选择此模板'}
                  </AntButton>,
                ]}
              >
                <AntList.Item.Meta // 列表项的元数据（标题、描述等）
                  avatar={<DatabaseOutlined style={{fontSize: '20px', color: '#1677ff'}}/>} // 图标
                  title={<Text strong>{templateItem.name} (ID: {templateItem.id})</Text>} // 标题
                  description={ // 描述内容
                    <>
                      <AntTag>{templateItem.task_type}</AntTag> {/* 任务类型标签 */}
                      <Paragraph ellipsis={{ rows: 2 }} type="secondary">{templateItem.description || '暂无详细描述'}</Paragraph> {/* 描述文本，过长则省略 */}
                    </>
                  }
                />
              </AntList.Item>
            )}
            pagination={{ pageSize: 5, size:"small", hideOnSinglePage: true }} // 列表分页配置
          />
        </AntSpin>
      </AntModal>
    </div>
  );
};


// ==============================================================================
// === 内部步骤编辑器模态框 (StepEditorInternalModal) 定义 ===
// ==============================================================================
interface StepEditorInternalModalProps {
  visible: boolean;
  onCancel: () => void;
  onSavePrivateStep: (stepData: RuleStepCreatePrivate) => void; // 保存私有步骤的回调
  onSaveTemplateReferenceStep: (stepData: RuleTemplateReferenceCreate & { tempId: TempId }) => void; // 保存模板引用步骤的回调
  stepBeingEdited: (EditableStep & { originalIndexInList: number }) | null; // 当前正在编辑的步骤信息
  existingStepOrder: number; // 步骤在链中的顺序
  appConfig: ApplicationConfig | null;
  availableLLMModels: UserDefinedLLMConfig[];
  novelId?: number | null; // 当前规则链关联的小说ID
}

const StepEditorInternalModal: React.FC<StepEditorInternalModalProps> = ({
  visible, onCancel, onSavePrivateStep, onSaveTemplateReferenceStep,
  stepBeingEdited, existingStepOrder, appConfig, availableLLMModels, novelId
}) => {
  const [form] = AntForm.useForm(); // 模态框内部表单实例
  const currentEditingStepType = stepBeingEdited?.uiType || 'private'; // 判断是编辑私有步骤还是模板引用

  // TaskSpecificParamsInput 相关状态
  const [currentDynamicParamsDef, setCurrentDynamicParamsDef] = useState<Record<string, Omit<ApiRuleStepParameterDefinition, 'value'>>>({});
  const [currentDynamicParamsValues, setCurrentDynamicParamsValues] = useState<Record<string, ApiStepParameterValueType | undefined>>({});
  const [isLoadingParamDefs, setIsLoadingParamDefs] = useState<boolean>(false);


  // 根据任务类型更新参数定义和值的核心函数
  const updateParameterDefinitionsForTask = useCallback((taskType: string, existingParamsValues?: Record<string, ApiStepParameterValueType | undefined>) => {
    setIsLoadingParamDefs(true);
    const definitionsFromConstant = TASK_PARAMETER_DEFINITIONS[taskType as PredefinedTaskEnum] || {};
    
    const newParamDefs: Record<string, Omit<ApiRuleStepParameterDefinition, 'value'>> = {};
    const newParamValues: Record<string, ApiStepParameterValueType | undefined> = {};

    Object.entries(definitionsFromConstant).forEach(([paramKey, paramDefSchema]) => {
        newParamDefs[paramKey] = paramDefSchema; // paramDefSchema已经是Omit<..., 'value'>

        // 优先使用传入的现有值（例如编辑时），其次是定义中的默认值，最后是类型默认值
        if (existingParamsValues && existingParamsValues[paramKey] !== undefined) {
            newParamValues[paramKey] = existingParamsValues[paramKey];
        } else if (paramDefSchema.config?.defaultValue !== undefined) {
            newParamValues[paramKey] = paramDefSchema.config.defaultValue;
        } else {
            // 根据参数类型设置合理的默认空值
            switch (paramDefSchema.param_type) {
                case ApiParameterTypeEnum.STATIC_BOOLEAN: newParamValues[paramKey] = false; break;
                case ApiParameterTypeEnum.STATIC_NUMBER: newParamValues[paramKey] = undefined; break; // 或者 0，取决于需求
                case ApiParameterTypeEnum.USER_INPUT_CHOICE: newParamValues[paramKey] = paramDefSchema.config?.isMulti ? [] : undefined; break;
                case ApiParameterTypeEnum.PARAMETER_TYPE_OBJECT:
                    const nestedDefaults: Record<string, ApiStepParameterValueType | undefined> = {};
                    if (paramDefSchema.schema) {
                        Object.entries(paramDefSchema.schema).forEach(([nestedKey, nestedParamDef]) => {
                            if (nestedParamDef.config?.defaultValue !== undefined) {
                                nestedDefaults[nestedKey] = nestedParamDef.config.defaultValue;
                            } else { 
                                switch (nestedParamDef.param_type) {
                                    case ApiParameterTypeEnum.STATIC_BOOLEAN: nestedDefaults[nestedKey] = false; break;
                                    // ... 其他嵌套类型的默认值 ...
                                    default: nestedDefaults[nestedKey] = ''; break;
                                }
                            }
                        });
                    }
                    newParamValues[paramKey] = nestedDefaults;
                    break;
                default: newParamValues[paramKey] = ''; break;
            }
        }
    });
    setCurrentDynamicParamsDef(newParamDefs);
    setCurrentDynamicParamsValues(newParamValues);
    setIsLoadingParamDefs(false);
  }, []);


  // 初始化模态框表单 Effect
  useEffect(() => {
    if (visible) {
      if (stepBeingEdited) { // 编辑模式
        if (stepBeingEdited.uiType === 'private') {
          form.setFieldsValue({ // 填充私有步骤的通用字段
            ...stepBeingEdited,
            // JSON对象参数需要转为字符串以便TextArea编辑
            llm_override_parameters: stepBeingEdited.llm_override_parameters ? JSON.stringify(stepBeingEdited.llm_override_parameters, null, 2) : '{}',
            generation_constraints: stepBeingEdited.generation_constraints ? JSON.stringify(stepBeingEdited.generation_constraints, null, 2) : '{}',
          });
          // 加载并设置该任务类型的特定参数定义和值
          updateParameterDefinitionsForTask(stepBeingEdited.task_type, stepBeingEdited.parameters);
        } else { // 编辑模板引用步骤 (通常只改启用状态)
          form.setFieldsValue({
            is_enabled: stepBeingEdited.is_enabled,
            // 显示模板信息（只读）
            template_name: stepBeingEdited.name,
            template_description: stepBeingEdited.description,
            template_task_type: stepBeingEdited.task_type,
          });
          // 模板的参数定义是固定的，从模板对象中获取
          const templateParamDefs: Record<string, Omit<ApiRuleStepParameterDefinition, 'value'>> = {};
          const templateParamValues: Record<string, ApiStepParameterValueType | undefined> = {};
          if (stepBeingEdited.parameters && typeof stepBeingEdited.parameters === 'object') {
            Object.entries(stepBeingEdited.parameters).forEach(([key, defWithValue]) => {
              const { value, ...defOnly } = defWithValue as ApiRuleStepParameterDefinition; // 断言类型
              templateParamDefs[key] = defOnly;
              templateParamValues[key] = value; // 模板参数的值通常是其默认值
            });
          }
          setCurrentDynamicParamsDef(templateParamDefs);
          setCurrentDynamicParamsValues(templateParamValues); // 这些值在模板步骤中通常是只读的
        }
      } else { // 新建私有步骤模式
        form.resetFields();
        const defaultTask = PredefinedTaskEnum.CUSTOM_INSTRUCTION;
        form.setFieldsValue({ // 设置新步骤的默认值
          is_enabled: true, input_source: StepInputSourceEnum.PREVIOUS_STEP,
          llm_override_parameters: '{}', generation_constraints: '{}',
          post_processing_rules: [], step_order: existingStepOrder, task_type: defaultTask,
          description: '', output_variable_name: '', model_id: null, custom_instruction: '',
        });
        updateParameterDefinitionsForTask(defaultTask); // 加载默认任务的参数
      }
    }
  }, [visible, stepBeingEdited, form, existingStepOrder, updateParameterDefinitionsForTask]);

  // 处理动态参数表单的值变化回调
  const handleDynamicParamsChange = (newParamValues: Record<string, ApiStepParameterValueType | undefined>) => {
    setCurrentDynamicParamsValues(newParamValues); // 更新模态框内部的参数值状态
  };

  // 当任务类型在模态框中变化时，更新动态参数的定义和值
  const handleTaskTypeChangeForModal = (newTaskType: string) => {
    form.setFieldsValue({ task_type: newTaskType }); // 更新表单中的任务类型字段
    // 重新加载参数定义，并尝试保留现有参数值（如果新旧任务有同名参数）
    // 或者，简单起见，直接用新任务的默认值重置（如下）
    updateParameterDefinitionsForTask(newTaskType, {}); // 使用空对象重置为默认值
  };

  // 保存步骤（处理模态框的OK按钮点击）
  const handleModalOk = () => {
    form.validateFields()
      .then((formValues) => { // formValues 包含了表单中所有通用字段的值
        if (currentEditingStepType === 'private') {
          // 对于私有步骤，需要合并通用字段和动态参数值
          const privateStepDataToSave: RuleStepCreatePrivate = {
            step_type: 'private',
            step_order: stepBeingEdited?.step_order ?? existingStepOrder,
            is_enabled: formValues.is_enabled,
            task_type: formValues.task_type,
            parameters: currentDynamicParamsValues, // 传递 TaskSpecificParamsInput 管理的【值】
            custom_instruction: formValues.custom_instruction,
            post_processing_rules: formValues.post_processing_rules || [],
            input_source: formValues.input_source,
            model_id: formValues.model_id,
            llm_override_parameters: formValues.llm_override_parameters && formValues.llm_override_parameters.trim() ? JSON.parse(formValues.llm_override_parameters) : null,
            generation_constraints: formValues.generation_constraints && formValues.generation_constraints.trim() ? JSON.parse(formValues.generation_constraints) as GenerationConstraintsSchema : null,
            output_variable_name: formValues.output_variable_name,
            description: formValues.description,
          };
          onSavePrivateStep(privateStepDataToSave); // 调用父组件传递的保存回调
        } else if (currentEditingStepType === 'template' && stepBeingEdited) { // 模板步骤，只保存启用状态
           const templateRefDataToSave: RuleTemplateReferenceCreate & { tempId: TempId } = {
            tempId: stepBeingEdited.tempId, // 必须传递 tempId 以便父组件知道更新哪个UI项
            step_type: 'template', // 明确类型
            template_id: stepBeingEdited.template_id,
            step_order: stepBeingEdited.step_order,
            is_enabled: formValues.is_enabled, // 从表单获取启用状态
          };
          onSaveTemplateReferenceStep(templateRefDataToSave);
        }
        form.resetFields(); // 清空表单
        setCurrentDynamicParamsDef({}); // 清空动态参数定义
        setCurrentDynamicParamsValues({}); // 清空动态参数值
        // onCancel(); // 关闭模态框的操作由父组件在 onSave 回调成功后处理
      })
      .catch((validationErrorSummary) => {
        console.warn('步骤编辑器表单校验失败:', validationErrorSummary);
        antMessage.error("请检查步骤表单中的输入项是否符合要求！");
      });
  };
  
  // 模态框标题
  const modalTitleText = stepBeingEdited
    ? (currentEditingStepType === 'private' ? `编辑私有步骤 (顺序 ${stepBeingEdited.originalIndexInList + 1})` : `配置引用的模板步骤 (顺序 ${stepBeingEdited.originalIndexInList + 1}) - ${stepBeingEdited.name || `模板ID: ${stepBeingEdited.template_id}`}`)
    : `新建私有步骤 (将作为步骤 ${existingStepOrder + 1})`;

  return (
    <AntModal
        title={modalTitleText}
        open={visible} // 使用 AntD Modal 的 open prop
        onOk={handleModalOk}
        onCancel={() => { form.resetFields(); setCurrentDynamicParamsDef({}); setCurrentDynamicParamsValues({}); onCancel(); }}
        width={currentEditingStepType === 'private' ? 900 : 600} // 私有步骤编辑器可以更宽
        maskClosable={false} // 防止点击遮罩层关闭
        destroyOnClose // 关闭时销毁内部组件状态
        okText="保存此步骤"
        cancelText="取消更改"
    >
      <AntForm form={form} layout="vertical" name="step_editor_internal_form_instance">
        {/* 步骤启用状态 */}
        <AntForm.Item name="is_enabled" valuePropName="checked" label="是否启用此步骤">
          <AntCheckbox />
        </AntForm.Item>

        {/* 根据步骤类型显示不同表单内容 */}
        {currentEditingStepType === 'private' ? (
          <>
            {/* 私有步骤的通用配置项 */}
            <AntRow gutter={16}>
              <AntCol span={12}>
                <AntForm.Item name="task_type" label="任务类型" rules={[{ required: true, message: '请选择或输入此私有步骤的任务类型!' }]} >
                  <AntSelect
                    placeholder="选择或输入任务类型"
                    showSearch
                    onChange={handleTaskTypeChangeForModal} // 任务类型变化时更新参数定义
                    filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                  >
                    {Object.entries(PREDEFINED_TASK_DETAILS_MAP).map(([enumVal, taskDesc]) => (
                        <Option key={enumVal} value={enumVal} title={taskDesc.description} label={`${taskDesc.label} (${enumVal})`}>
                            {taskDesc.label} ({enumVal})
                        </Option>
                    ))}
                  </AntSelect>
                </AntForm.Item>
              </AntCol>
              <AntCol span={12}>
                 <AntForm.Item name="input_source" label="输入来源" rules={[{ required: true, message: '请选择此私有步骤的输入来源!' }]} >
                    <AntSelect options={STEP_INPUT_SOURCE_OPTIONS} />
                </AntForm.Item>
              </AntCol>
            </AntRow>
            <AntForm.Item name="description" label="步骤描述 (可选)">
              <AntInput.TextArea rows={2} placeholder="简要描述这个私有步骤的具体作用、输入输出预期等。" />
            </AntForm.Item>
            <AntForm.Item name="output_variable_name" label="输出变量名 (可选)" tooltip="此步骤的执行结果将在后续步骤中以此名称被引用。例如：extracted_entities。如果留空，将使用默认命名规则。" >
              <AntInput placeholder="例如：chapter_summary" />
            </AntForm.Item>
            
            {/* 任务特定参数 (使用 TaskSpecificParamsInput 组件) */}
            <AntCard title="任务特定参数 (动态表单)" size="small" className={styles.formCard} style={{marginBottom: 16}}>
                {isLoadingParamDefs ? <div style={{textAlign: 'center', padding: '20px'}}><AntSpin tip="加载参数定义..." /></div> :
                (Object.keys(currentDynamicParamsDef).length > 0 ? (
                    <TaskSpecificParamsInput
                        parametersDef={currentDynamicParamsDef} // 传递参数【定义】
                        currentValues={currentDynamicParamsValues} // 传递参数【值】
                        onValuesChange={handleDynamicParamsChange} // 值变化回调
                        novelId={novelId} // 传递小说ID
                        appConfig={appConfig} // 传递应用配置
                        availableLLMModels={availableLLMModels || []} // 传递可用模型列表
                        disabled={form.getFieldValue('is_enabled') === false} // 如果步骤禁用，则参数也禁用
                    />
                ) : (
                    <AntTypography.Text type="secondary">
                        当前选择的任务类型 “{PREDEFINED_TASK_DETAILS_MAP[form.getFieldValue('task_type') as PredefinedTaskEnum]?.label || form.getFieldValue('task_type')}”
                        没有预定义的参数，或参数定义未加载。
                    </AntTypography.Text>
                ))}
            </AntCard>
            
            {/* 其他私有步骤配置项 (自定义指令、后处理、模型ID、LLM覆盖、生成约束) */}
            <AntForm.Item name="custom_instruction" label="自定义指令 (可选)" tooltip="如果任务类型支持或为“自定义指令”类型，在此处填写给大语言模型的具体指令文本。" >
              <AntInput.TextArea rows={3} placeholder="例如：请将以下文本 {text} 改写为更生动的儿童故事风格..." />
            </AntForm.Item>
             <AntForm.Item name="post_processing_rules" label="后处理规则 (可选)" tooltip="选择一个或多个规则，在LLM生成内容后按顺序应用于其输出结果。" >
              <AntSelect mode="tags" placeholder="选择或输入后处理规则" tokenSeparators={[',']} options={POST_PROCESSING_RULE_OPTIONS.map(opt => ({label: opt.label, value: opt.value}))} />
            </AntForm.Item>
            <AntRow gutter={16}> {/* 模型ID 和 LLM参数覆盖/生成约束 可以并排 */}
                <AntCol span={12}>
                    <AntForm.Item name="model_id" label="特定模型ID (可选)" tooltip="为此私有步骤指定一个特定的用户自定义LLM配置ID。将覆盖规则链的全局模型设置。" >
                        <AntSelect
                            placeholder="选择或输入用户定义的模型ID"
                            allowClear
                            showSearch
                            optionFilterProp="label" // 根据标签（包含名称和提供商）进行搜索
                            filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                            disabled={!availableLLMModels || availableLLMModels.length === 0}
                        >
                           {availableLLMModels.map(model => ( // 使用全局可用的模型列表
                               <Option key={model.user_given_id} value={model.user_given_id} label={`${model.user_given_name} (${model.provider_tag})`}>
                                   {model.user_given_name} <AntTag color="blue" style={{marginLeft: '8px'}}>{model.provider_tag}</AntTag>
                                </Option>
                            ))}
                        </AntSelect>
                    </AntForm.Item>
                </AntCol>
            </AntRow>
            <AntRow gutter={16}>
                <AntCol span={12}>
                    <AntForm.Item name="llm_override_parameters" label="LLM调用覆盖参数 (JSON, 可选)" tooltip="以JSON对象格式提供，用于覆盖此步骤LLM调用的特定参数。" rules={[{ validator: async (_, value: string) => { if (value && value.trim() !== "" && value.trim() !== "{}") { try { JSON.parse(value); } catch (e) { return Promise.reject('必须是有效的JSON对象格式！'); }} return Promise.resolve(); } }]} >
                        <AntInput.TextArea rows={3} placeholder='例如：{ "temperature": 0.75 }' />
                    </AntForm.Item>
                </AntCol>
                <AntCol span={12}>
                    <AntForm.Item name="generation_constraints" label="生成内容约束 (JSON, 可选)" tooltip="为此步骤的LLM输出设定具体约束。" rules={[{ validator: async (_, value: string) => { if (value && value.trim() !== "" && value.trim() !== "{}") { try { JSON.parse(value); } catch (e) { return Promise.reject('必须是有效的JSON对象格式！');}} return Promise.resolve(); } }]} >
                        <AntInput.TextArea rows={3} placeholder='例如：{ "max_length": 200 }' />
                    </AntForm.Item>
                </AntCol>
            </AntRow>
          </>
        ) : (stepBeingEdited && currentEditingStepType === 'template' && // 模板步骤（只读信息，只编辑启用状态）
          <AntCard size="small" type="inner" title="引用的模板信息 (只读)">
            <p><Text strong>模板ID: </Text>{stepBeingEdited.template_id}</p>
            <p><Text strong>模板名称: </Text>{stepBeingEdited.name || '加载中...'}</p>
            <p><Text strong>模板任务类型: </Text>{stepBeingEdited.task_type || '加载中...'}</p>
            {/* 模板的参数定义可以在此只读显示 (如果需要) */}
            {stepBeingEdited.parameters && Object.keys(stepBeingEdited.parameters).length > 0 && (
                <details style={{marginTop: '8px'}}>
                    <summary style={{cursor: 'pointer', fontWeight: 'bold'}}>查看模板参数定义</summary>
                    <pre style={{ maxHeight: '150px', overflowY: 'auto', background: '#f5f5f5', padding: '8px', borderRadius: '4px', fontSize: '12px' }}>
                        {JSON.stringify(stepBeingEdited.parameters, null, 2)}
                    </pre>
                </details>
            )}
            <Paragraph ellipsis={{ rows: 3, expandable: true, symbol: '展开描述' }} type="secondary" style={{marginTop: '8px'}}>
                <Text strong>模板描述: </Text>{stepBeingEdited.description || '加载中...'}
            </Paragraph>
            <Paragraph type="secondary" style={{marginTop: 10}}>
              <InfoCircleOutlined style={{marginRight: 4}}/>
              模板的原始内容请前往“规则模板库”进行编辑。此处仅能修改此步骤在当前规则链中的“是否启用”状态。
            </Paragraph>
          </AntCard>
        )}
      </AntForm>
    </AntModal>
  );
};

export default RuleChainEditor;