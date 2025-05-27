// frontend-react/src/pages/RuleTemplateEditorPage.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  Layout,
  Typography,
  Form,
  Input,
  Button,
  Select,
  message as antMessage, // 使用 antMessage 别名以区分 react-toastify (如果项目中并存)
  Spin,
  Breadcrumb,
  Card,
  Row,
  Col,
  Space,
  Tooltip,
} from 'antd';
import {
  SaveOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  HomeOutlined,
  EditOutlined,
  PlusCircleOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import { Link, useParams, useNavigate } from 'react-router-dom';

// 从 API 服务导入核心类型和函数
import {
  getRuleTemplate,
  createRuleTemplate,
  updateRuleTemplate,
  RuleTemplate,
  RuleTemplateCreate,
  RuleTemplateUpdate,
  // 从 api.ts 导入枚举类型，因为 constants.ts 中的枚举是从这里导出的
  PredefinedTaskEnum,
  StepInputSourceEnum,
  PostProcessingRuleEnum,
  // 如果需要 RuleStepParameterDefinition 等更详细的类型，也从这里导入
  // RuleStepParameterDefinition as ApiRuleStepParameterDefinition,
} from '../services/api';

// 从 constants.ts 导入枚举的选项列表和任务详情映射
import {
  PREDEFINED_TASK_DETAILS_MAP,
  POST_PROCESSING_RULE_OPTIONS,
  STEP_INPUT_SOURCE_OPTIONS,
} from '../constants';

import styles from './RuleTemplateEditorPage.module.css';
import pageStyles from './PageStyles.module.css';

const { Content } = Layout;
const { Title } = Typography;
const { Option } = Select;

// 表单数据类型，与后端 RuleTemplateBase 对应，但JSON字段为字符串
interface RuleTemplateFormData {
  name: string;
  description?: string | null;
  tags: string; // JSON string
  task_type: string; // PredefinedTaskEnum value or custom string
  parameters: string; // JSON string of Record<string, ApiRuleStepParameterDefinition>
  custom_instruction?: string | null;
  post_processing_rules: PostProcessingRuleEnum[];
  input_source: StepInputSourceEnum;
  model_id?: string | null;
  llm_override_parameters: string; // JSON string
  generation_constraints: string; // JSON string of Partial<GenerationConstraintsSchema>
  output_variable_name?: string | null;
}

// RuleTemplateEditorPage 组件定义
const RuleTemplateEditorPage: React.FC = () => {
  const { templateId: templateIdParam } = useParams<{ templateId?: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm<RuleTemplateFormData>(); // Ant Design Form 实例

  const [isLoadingPage, setIsLoadingPage] = useState<boolean>(false); // 页面初始数据加载状态
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false); // 表单提交加载状态
  const [currentTemplate, setCurrentTemplate] = useState<RuleTemplate | null>(null); // 编辑模式下当前模板数据

  const isEditMode = Boolean(templateIdParam && templateIdParam !== 'new');
  const templateId = isEditMode ? parseInt(templateIdParam as string, 10) : null;

  // Effect Hook: 加载数据或设置表单默认值
  useEffect(() => {
    const loadTemplateData = async () => {
      if (isEditMode && templateId) {
        setIsLoadingPage(true);
        try {
          const data = await getRuleTemplate(templateId);
          setCurrentTemplate(data);
          // 将对象/数组字段转换为格式化的JSON字符串以便在Input.TextArea中编辑
          form.setFieldsValue({
            ...data,
            parameters: data.parameters ? JSON.stringify(data.parameters, null, 2) : '{}',
            tags: data.tags ? JSON.stringify(data.tags, null, 2) : '{}',
            llm_override_parameters: data.llm_override_parameters
              ? JSON.stringify(data.llm_override_parameters, null, 2)
              : '{}',
            generation_constraints: data.generation_constraints
              ? JSON.stringify(data.generation_constraints, null, 2)
              : '{}',
            post_processing_rules: data.post_processing_rules || [],
          });
        } catch (error) {
          antMessage.error('加载规则模板详情失败，请重试。');
          console.error('加载规则模板失败:', error);
          navigate('/rule-templates');
        } finally {
          setIsLoadingPage(false);
        }
      } else { // 新建模式
        form.setFieldsValue({
          name: '',
          description: '',
          task_type: PredefinedTaskEnum.CUSTOM_INSTRUCTION,
          input_source: StepInputSourceEnum.PREVIOUS_STEP,
          post_processing_rules: [],
          parameters: '{}',
          tags: '{}',
          llm_override_parameters: '{}',
          generation_constraints: '{}',
          output_variable_name: '',
          model_id: '',
          custom_instruction: '',
        });
        setIsLoadingPage(false); // 新建模式下无需加载数据
      }
    };
    loadTemplateData();
  }, [isEditMode, templateId, form, navigate]);

  // 辅助函数：安全地解析JSON字符串
  const safeParseJson = (jsonString: string, fieldName: string, defaultValue: any = null) => {
    if (jsonString && jsonString.trim() !== "") {
      try {
        return JSON.parse(jsonString);
      } catch (e) {
        antMessage.error(`${fieldName} 字段包含无效的JSON格式。将使用默认值。错误: ${(e as Error).message}`);
        form.setFields([{ name: fieldName.toLowerCase().replace(/\s/g, '_'), errors: ['无效的JSON格式!'] }]); // 在表单上显示错误
        return defaultValue; // 出错时返回默认值
      }
    }
    return defaultValue; // 如果字符串为空，也返回默认值
  };


  // 表单提交处理函数
  const handleFormSubmit = async (values: RuleTemplateFormData) => {
    setIsSubmitting(true);
    try {
      // 准备提交给API的数据：将表单中的JSON字符串字段解析回对象/数组
      const parsedValues: RuleTemplateCreate | RuleTemplateUpdate = {
        ...values,
        parameters: safeParseJson(values.parameters, '任务参数', {}),
        tags: safeParseJson(values.tags, '标签', null), // 允许为null
        llm_override_parameters: safeParseJson(values.llm_override_parameters, 'LLM覆盖参数', null),
        generation_constraints: safeParseJson(values.generation_constraints, '生成内容约束', null),
        post_processing_rules: values.post_processing_rules || [], // 确保是数组
      };

      if (isEditMode && currentTemplate && templateId) {
        await updateRuleTemplate(templateId, parsedValues as RuleTemplateUpdate);
        antMessage.success('规则模板更新成功！');
      } else {
        await createRuleTemplate(parsedValues as RuleTemplateCreate);
        antMessage.success('规则模板创建成功！');
      }
      navigate('/rule-templates'); // 操作成功后导航回列表页
    } catch (error: any) {
      const errorMessage = error.response?.data?.detail || (isEditMode ? '更新模板失败' : '创建模板失败') + `: ${error.message || '未知错误，请检查所有字段，特别是JSON格式。'}`;
      antMessage.error(`操作失败: ${errorMessage}`);
      console.error('表单提交错误:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // JSON校验器，用于AntD Form.Item的rules
  const jsonValidator = (_: any, value: string) => {
    if (!value || value.trim() === "" || value.trim() === "{}") { // 允许空或空对象
      return Promise.resolve();
    }
    try {
      JSON.parse(value);
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(new Error('必须是有效的JSON对象格式！例如: {"key": "value"} 或留空/{}'));
    }
  };

  // 如果正在加载数据（编辑模式），显示加载指示器
  if (isLoadingPage) {
    return (
      <div className={pageStyles.pageLoadingContainer}>
        <Spin size="large" tip="正在加载模板数据..." />
      </div>
    );
  }

  return (
    <Layout className={pageStyles.pageLayout}>
      <Breadcrumb className={pageStyles.breadcrumb}>
        <Breadcrumb.Item><Link to="/"><HomeOutlined /><span>首页</span></Link></Breadcrumb.Item>
        <Breadcrumb.Item><Link to="/rule-templates"><DatabaseOutlined /><span>规则模板库</span></Link></Breadcrumb.Item>
        <Breadcrumb.Item>
          {isEditMode ? <><EditOutlined /><span>编辑模板</span></> : <><PlusCircleOutlined /><span>新建模板</span></>}
        </Breadcrumb.Item>
      </Breadcrumb>

      <Content className={`${pageStyles.pageContent} ${styles.editorPageContainer}`}>
        <Title level={2} className={pageStyles.pageTitle}>
          {isEditMode ? (
            <><EditOutlined style={{ marginRight: '10px' }} />编辑规则模板 {currentTemplate && `(ID: ${currentTemplate.id})`}</>
          ) : (
            <><PlusCircleOutlined style={{ marginRight: '10px' }} />新建规则模板</>
          )}
        </Title>

        <Form
          form={form}
          name="rule_template_editor_form"
          onFinish={handleFormSubmit}
          scrollToFirstError
          layout="vertical"
          disabled={isSubmitting} // 提交时禁用整个表单
        >
          <Card title="基本信息" className={styles.formCard}>
            <Row gutter={24}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="name"
                  label="模板名称"
                  rules={[{ required: true, message: '请输入模板名称!' }]}
                >
                  <Input placeholder="例如：总结章节核心内容" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="task_type"
                  label="任务类型"
                  rules={[{ required: true, message: '请输入或选择任务类型!' }]}
                  tooltip="定义此模板执行的核心操作类型。"
                >
                  <Select placeholder="选择或输入任务类型" showSearch
                    filterOption={(input, option) =>
                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                        (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                  >
                    {Object.entries(PREDEFINED_TASK_DETAILS_MAP).map(([enumValue, taskDetail]) => (
                      <Option key={enumValue} value={enumValue} title={taskDetail.description} label={`${taskDetail.label} (${enumValue})`}>
                        {taskDetail.label} ({enumValue})
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="description" label="模板描述">
              <Input.TextArea rows={3} placeholder="详细描述这个模板的功能、用途和预期效果。" />
            </Form.Item>
          </Card>

          <Card title="执行配置" className={styles.formCard}>
            <Row gutter={24}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="input_source"
                  label="输入来源"
                  rules={[{ required: true, message: '请选择输入来源!' }]}
                  tooltip="定义模板执行时默认从何处获取输入数据。"
                >
                  <Select options={STEP_INPUT_SOURCE_OPTIONS} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="output_variable_name"
                  label={
                    <Space>
                      输出变量名
                      <Tooltip title="此模板执行结果在后续步骤中被引用的名称。留空则为默认。">
                        <QuestionCircleOutlined />
                      </Tooltip>
                    </Space>
                  }
                >
                  <Input placeholder="例如：chapter_summary (可选)" />
                </Form.Item>
              </Col>
            </Row>
             <Form.Item
                name="post_processing_rules"
                label="后处理规则"
                tooltip="选择应用于此模板输出结果的后处理规则序列。"
              >
                <Select
                  mode="tags"
                  placeholder="选择或输入后处理规则"
                  tokenSeparators={[',']}
                  options={POST_PROCESSING_RULE_OPTIONS}
                />
              </Form.Item>
          </Card>

          <Card title="LLM 与指令" className={styles.formCard}>
            <Row gutter={24}>
              <Col xs={24} sm={12}>
                 <Form.Item
                  name="model_id"
                  label="特定模型ID (可选)"
                  tooltip="如果此模板需要特定LLM配置，请在此处填写用户定义的模型ID。将覆盖规则链的全局模型配置。"
                >
                  <Input placeholder="例如：my_gpt4_turbo_config" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="custom_instruction"
              label="自定义指令 (可选)"
              tooltip="提供给大语言模型的具体指令，如果任务类型是自定义指令，则此项通常必填。"
            >
              <Input.TextArea rows={5} placeholder="例如：请将以下文本改写为第三人称视角，并保持客观中立的语气..." />
            </Form.Item>
          </Card>
          
          <Card title="高级参数 (JSON格式)" className={styles.formCard}>
            <Paragraph type="secondary" style={{ marginBottom: '16px' }}>
              以下字段需要输入有效的JSON字符串。如果不需要特定配置，请保留为 <code>{}</code> (空对象) 或 <code>null</code> (对于可选字段)。
              对于 “任务参数”，其结构应为 <code>{"{{"}} "参数键名": {"{{"}} "param_type": "参数类型枚举值", "value": "参数值", "label": "UI标签", ... }}{{ "}}"}}{{"}}</code>。
              详细参数类型定义请参考相关文档或 TaskSpecificParamsInput 组件的内部逻辑。
            </Paragraph>
            <Row gutter={24}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="parameters"
                  label={
                    <Space>
                      任务参数 (JSON)
                       <Tooltip title='模板执行时传递给任务处理器的具体参数定义和默认值，必须是合法的JSON对象字符串。例如：{"max_words": {"param_type": "static_number", "value": 100, "label": "最大词数"}}'>
                        <QuestionCircleOutlined />
                      </Tooltip>
                    </Space>
                  }
                  rules={[{ validator: jsonValidator }]}
                >
                  <Input.TextArea rows={8} placeholder='例如：{ "max_words": {"param_type": "static_number", "value": 100, "label": "最大词数"} }' />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="llm_override_parameters"
                  label={
                    <Space>
                      LLM覆盖参数 (JSON, 可选)
                      <Tooltip title='覆盖LLM调用的默认参数，如temperature, top_p等。必须是合法的JSON对象字符串。'>
                        <QuestionCircleOutlined />
                      </Tooltip>
                    </Space>
                  }
                   rules={[{ validator: jsonValidator }]}
                >
                  <Input.TextArea rows={4} placeholder='例如：{ "temperature": 0.7, "max_tokens": 1000 }' />
                </Form.Item>
                 <Form.Item
                    name="generation_constraints"
                    label={
                        <Space>
                        生成内容约束 (JSON, 可选)
                        <Tooltip title='对LLM生成内容的具体约束，如长度、包含/排除关键词等。结构需符合GenerationConstraintsSchema。'>
                            <QuestionCircleOutlined />
                        </Tooltip>
                        </Space>
                    }
                    rules={[{ validator: jsonValidator }]}
                    >
                    <Input.TextArea rows={4} placeholder='例如：{ "max_length": 500, "style_hints": ["正式", "简洁"] }' />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={24}>
                <Col xs={24} md={12}>
                    <Form.Item
                        name="tags"
                        label={
                             <Space>
                            标签 (JSON, 可选)
                            <Tooltip title='用于分类和搜索的标签，必须是合法的JSON对象字符串。例如：{"category": "总结类", "domain": "通用"}'>
                                <QuestionCircleOutlined />
                            </Tooltip>
                            </Space>
                        }
                        rules={[{ validator: jsonValidator }]}
                        >
                        <Input.TextArea rows={3} placeholder='例如：{ "type": "summarization", "domain": "novel" }' />
                    </Form.Item>
                </Col>
            </Row>
          </Card>

          <Form.Item wrapperCol={{ span: 24 }} className={styles.formActions}>
            <Space>
              <Button type="primary" htmlType="submit" loading={isSubmitting} icon={<SaveOutlined />}>
                {isEditMode ? '保存更改' : '创建模板'}
              </Button>
              <Button icon={<CloseCircleOutlined />} onClick={() => navigate('/rule-templates')} disabled={isSubmitting}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Content>
    </Layout>
  );
};

export default RuleTemplateEditorPage;