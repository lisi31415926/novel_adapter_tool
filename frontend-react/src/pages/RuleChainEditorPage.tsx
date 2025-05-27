// frontend-react/src/pages/RuleChainEditorPage.tsx
import React, { useEffect, useState, useContext, useCallback } from 'react'; // 导入 React 及其 Hooks
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'; // 导入 React Router 的 Hooks
import {
  Layout,
  Typography,
  Breadcrumb,
  Spin, // 加载指示器
  Alert, // 错误提示
  message, // 全局消息提示
} from 'antd';
import {
  HomeOutlined,
  ApartmentOutlined, // 用于规则链列表的图标
  EditOutlined,
  PlusCircleOutlined,
} from '@ant-design/icons';

// 从核心编辑器组件导入
import RuleChainEditor from '../components/RuleChainEditor';
// 从 API 服务导入核心类型和函数
import {
  RuleChain,
  RuleChainCreate,
  RuleChainUpdate,
  getRuleChain, // 与您上传代码中使用的 API 函数名保持一致
  createRuleChain,
  updateRuleChain,
  ApplicationConfig, // 新增：用于类型提示
  UserDefinedLLMConfig, // 新增：用于类型提示
} from '../services/api';
// 导入全局上下文，以获取应用配置和模型列表
import { useWorkbenchContext } from '../contexts/WorkbenchContext'; // 修改为 useWorkbenchContext

import pageStyles from './PageStyles.module.css'; // 导入通用页面样式
// import styles from './RuleChainEditorPage.module.css'; // 如果有特定于此页面的样式

const { Content } = Layout;
const { Title } = Typography;

// 定义 RuleChainEditorPage 组件
const RuleChainEditorPage: React.FC = () => {
  // 从路由参数中获取 chainId，它可以是数字字符串或 "new"
  const { chainId: chainIdParam } = useParams<{ chainId?: string }>();
  const navigate = useNavigate(); // 用于编程式导航
  const location = useLocation(); // 用于获取路由 state (例如，从哪个链复制)

  // 从 WorkbenchContext 获取全局状态
  // 注意：您之前版本使用了 WorkbenchContext，确保其导出方式正确，这里改为使用自定义 hook
  const { appConfig, availableLLMModels } = useWorkbenchContext();

  // 页面级状态管理
  const [initialData, setInitialData] = useState<RuleChain | null>(null); // 存储编辑模式下的初始规则链数据
  const [initialDraft, setInitialDraft] = useState<RuleChainCreate | null>(null); // 存储从模板复制时的草稿数据，使用RuleChainCreate类型
  const [isLoadingPage, setIsLoadingPage] = useState<boolean>(true); // 页面主要数据加载状态
  const [pageError, setPageError] = useState<string | null>(null); // 页面级错误信息状态

  // 解析路由参数，判断当前模式
  const chainId = chainIdParam && !isNaN(parseInt(chainIdParam)) ? parseInt(chainIdParam) : 'new';
  const isEditMode = chainId !== 'new';
  
  // 从 location.state 获取用于复制的源规则链ID
  const sourceChainIdToCopy = location.state?.fromChainId as number | undefined;

  // React Hook: useEffect 用于根据路由参数加载数据
  const loadInitialData = useCallback(async () => {
    setIsLoadingPage(true);
    setPageError(null);
    setInitialData(null);
    setInitialDraft(null);

    try {
      // 确保 appConfig 和 availableLLMModels 已经从 Context 加载完成
      // 如果 WorkbenchContext 中没有这些数据，应在此处添加加载逻辑或显示等待提示
      if (!appConfig || !availableLLMModels) {
        // 在实际应用中，Context 应该确保这些数据已准备好，或者提供加载状态
        // 这里可以加一个延迟重试，或依赖Context的加载状态
        console.warn("RuleChainEditorPage: 应用配置或模型列表尚未从 WorkbenchContext 加载。");
        // 可以设置一个定时器稍后重试，或者等待 Context 更新
        // 为简单起见，这里假设它们最终会由Context提供，否则子组件RuleChainEditor会处理其缺失的情况
      }

      // 场景一：编辑现有规则链
      if (isEditMode && typeof chainId === 'number') {
        const data = await getRuleChain(chainId);
        setInitialData(data);
      }
      // 场景二：从现有规则链复制（创建新链）
      else if (sourceChainIdToCopy) {
        const dataToCopy = await getRuleChain(sourceChainIdToCopy);
        // 清除ID和创建/更新时间，并重置名称，使其成为一个新草稿
        // 将复制的数据转换为 RuleChainCreate 类型
        const { id, created_at, updated_at, novel, steps: stepsFromCopy, template_associations: templateAssocFromCopy, ...restOfDataToCopy } = dataToCopy;
        const draftData: RuleChainCreate = {
            ...restOfDataToCopy,
            name: `${dataToCopy.name} (副本)`, // 修改名称以示区分
            is_template: dataToCopy.is_template, // 保持模板状态
            novel_id: dataToCopy.novel_id,     // 保持关联小说ID (如果适用)
            // 转换步骤
            steps: (stepsFromCopy || []).map(step => {
                const { id: stepId, created_at: stepCreatedAt, updated_at: stepUpdatedAt, chain_id: stepChainId, ...restOfStep } = step;
                return { ...restOfStep, step_type: 'private' } as RuleStepCreatePrivate; // 明确类型
            }),
            template_associations: (templateAssocFromCopy || []).map(assoc => ({
                template_id: assoc.template_id,
                step_order: assoc.step_order,
                is_enabled: assoc.is_enabled,
                step_type: 'template' // 明确类型
            }) as RuleTemplateReferenceCreate),
        };
        setInitialDraft(draftData);
      }
      // 场景三：完全新建 (无需从API加载，由RuleChainEditor组件处理默认状态)
      else {
        // 可以在这里为 initialDraft 设置一个基础的空 RuleChainCreate 结构
        setInitialDraft({
            name: `新规则链 @ ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`,
            is_template: false,
            steps: [],
            template_associations: [],
            // 其他 RuleChainCreate 必需的字段（如果有默认值）
            global_llm_override_parameters: {},
        });
      }
    } catch (err: any) {
      const specificError = isEditMode ? `加载规则链 (ID: ${chainId}) 失败` : (sourceChainIdToCopy ? `加载用于复制的规则链 (ID: ${sourceChainIdToCopy}) 失败` : "初始化新规则链页面失败");
      const errorMessage = err.message || `${specificError}。请确认该规则链存在并稍后重试。`;
      console.error(`${specificError}:`, err);
      setPageError(errorMessage);
    } finally {
      setIsLoadingPage(false);
    }
  }, [chainId, isEditMode, sourceChainIdToCopy, appConfig, availableLLMModels]); // 依赖项更新

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]); // 确保 loadInitialData 稳定或正确处理其依赖

  // 处理 RuleChainEditor 组件提交的数据 (此函数作为 onSave prop 传递给子组件)
  const handleSubmitFromEditor = async (
    dataFromEditor: RuleChainCreate | RuleChainUpdate, // 子组件将传递符合这些类型的数据
    isCurrentlyEditing: boolean // 子组件将告知当前是编辑还是新建模式
  ) => {
    // isSubmitting 状态应由 RuleChainEditor 内部的保存按钮控制，或由父组件统一管理
    // 此处假设父组件 (RuleChainEditorPage) 控制顶层的保存状态，例如导航前
    // 但实际的 API 调用和加载状态应由 RuleChainEditor 组件处理，并通过 onSave 的 Promise 返回结果

    try {
      let savedOrCreatedChain: RuleChain;
      if (isCurrentlyEditing && typeof chainId === 'number') {
        // 更新现有规则链
        savedOrCreatedChain = await updateRuleChain(chainId, dataFromEditor as RuleChainUpdate);
        message.success(`规则链 "${savedOrCreatedChain.name}" 更新成功！`);
      } else {
        // 创建新规则链
        savedOrCreatedChain = await createRuleChain(dataFromEditor as RuleChainCreate);
        message.success(`规则链 "${savedOrCreatedChain.name}" 创建成功！`);
        // 创建成功后，导航到编辑页面，以便用户继续配置或查看
        navigate(`/rule-chains/edit/${savedOrCreatedChain.id}`, { replace: true });
      }
      // 可选：如果更新/创建后需要刷新父列表或其他操作，可以在这里触发
      // 例如，如果列表页使用 context 或全局状态，可以在此更新
    } catch (apiError: any) {
      console.error('保存规则链失败 (来自 RuleChainEditorPage):', apiError);
      const errorMessage = apiError.response?.data?.detail || apiError.message || '保存失败，请检查数据或联系管理员。';
      // message.error(`保存失败: ${errorMessage}`); // 错误提示已在 RuleChainEditor 内部处理
      // 将错误信息 Promise reject 出去，以便 RuleChainEditor 组件中的提交按钮可以结束 loading 状态
      return Promise.reject(new Error(errorMessage));
    }
  };

  // 取消编辑，返回列表页
  const handleCancelEditing = () => {
    navigate('/rule-chains');
  };

  // 根据加载和错误状态渲染不同内容
  const renderContent = () => {
    if (isLoadingPage) {
      return (
        <div className={pageStyles.pageLoadingContainer}>
          <Spin size="large" tip="正在加载规则链编辑器..." />
        </div>
      );
    }

    if (pageError) {
      return <Alert message="加载错误" description={pageError} type="error" showIcon 
                action={
                    <Button type="link" onClick={() => loadInitialData()}>
                        重试加载
                    </Button>
                }
             />;
    }
    
    // 确保 appConfig 和 availableLLMModels 已加载
    // RuleChainEditor 组件内部也应有对其 props 的检查
    if (!appConfig || !availableLLMModels) {
        return (
            <div className={pageStyles.pageLoadingContainer}>
                <Spin size="large" tip="正在等待应用核心配置加载完成..." />
            </div>
        );
    }
    
    // 传递给 RuleChainEditor 的数据
    // 如果是编辑模式，传递 initialData；如果是新建（包括从模板复制），传递 initialDraft
    const dataForEditor = isEditMode ? initialData : initialDraft;

    return (
      <RuleChainEditor
        key={isEditMode && typeof chainId === 'number' ? chainId : (sourceChainIdToCopy || 'new')} // 当从模板复制或新建时，也应有不同的 key 以确保组件重新挂载
        initialData={isEditMode ? dataForEditor as RuleChain : null} // 编辑模式传递 RuleChain
        initialDraft={!isEditMode ? dataForEditor as RuleChainCreate : null} // 新建模式传递 RuleChainCreate
        onSubmit={handleSubmitFromEditor} // 传递保存回调函数
        onCancel={handleCancelEditing} // 传递取消回调函数
        // ruleChainIdParam prop 似乎在 RuleChainEditor 中未使用，可考虑移除
        // appConfig 和 availableLLMModels 已通过 context 提供，但如果 RuleChainEditor 直接接收它们作为 props，则保留
        appConfig={appConfig}
        availableLLMModels={availableLLMModels}
      />
    );
  };

  return (
    <Layout className={pageStyles.pageLayout}>
      {/* 面包屑导航 */}
      <Breadcrumb className={pageStyles.breadcrumb}>
        <Breadcrumb.Item>
          <Link to="/"><HomeOutlined /><span>首页</span></Link>
        </Breadcrumb.Item>
        <Breadcrumb.Item>
          <Link to="/rule-chains"><ApartmentOutlined /><span>规则链管理</span></Link>
        </Breadcrumb.Item>
        <Breadcrumb.Item>
          {isEditMode ? (
            <><EditOutlined /><span>编辑规则链</span></>
          ) : (
            <><PlusCircleOutlined /><span>{sourceChainIdToCopy ? '基于模板创建新链' : '新建规则链'}</span></>
          )}
        </Breadcrumb.Item>
      </Breadcrumb>

      {/* 主要内容区域 */}
      <Content className={pageStyles.pageContent}>
        <Title level={2} className={pageStyles.pageTitle}>
          {isEditMode && typeof chainId === 'number' ? (
            <><EditOutlined style={{ marginRight: '8px' }} />编辑规则链 (ID: {chainId})</>
          ) : (
            <><PlusCircleOutlined style={{ marginRight: '8px' }} />
              {sourceChainIdToCopy ? `基于模板 (ID: ${sourceChainIdToCopy}) 创建新链` : '新建规则链'}
            </>
          )}
        </Title>
        {/* 渲染主要内容 */}
        {renderContent()}
      </Content>
    </Layout>
  );
};

export default RuleChainEditorPage;