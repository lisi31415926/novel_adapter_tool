// frontend-react/src/pages/RuleChainsPage.tsx
import React, { useState, useEffect } from 'react'; // 导入 React 及其 Hooks
import {
  Layout,
  Typography,
  Button,
  Breadcrumb,
  Space,
  Modal, // 导入 Modal 组件用于批量执行
  Select, // 导入 Select 组件用于在模态框中选择规则链
  Form, // 导入 Form 组件
  message,
  InputNumber // 导入 InputNumber 用于小说ID输入
} from 'antd';
import { PlusOutlined, ApartmentOutlined, HomeOutlined, PlaySquareOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import RuleChainList from '../components/RuleChainList'; // 导入我们重构过的 RuleChainList 子组件
import pageStyles from './PageStyles.module.css'; // 导入通用的页面级别 CSS Module 样式
import { RuleChain, getRuleChains, batchExecuteChains } from '../services/api'; // 导入类型和 API 函数

const { Content } = Layout;
const { Title } = Typography;
const { Option } = Select;

// 定义 RuleChainsPage 组件
const RuleChainsPage: React.FC = () => {
  const navigate = useNavigate(); // 获取 React Router 的 navigate 函数
  const [isBatchModalVisible, setIsBatchModalVisible] = useState(false); // 控制批量执行模态框的显示状态
  const [availableChains, setAvailableChains] = useState<RuleChain[]>([]); // 存储所有可用的规则链，用于模态框中的选择器
  const [isSubmitting, setIsSubmitting] = useState(false); // 控制批量执行提交按钮的加载状态
  const [form] = Form.useForm(); // Ant Design 表单实例

  // 当点击“批量执行”时，获取最新的规则链列表以填充选择器
  useEffect(() => {
    if (isBatchModalVisible) {
      getRuleChains()
        .then(data => {
          // 过滤掉那些本身就是模板的规则链，因为它们通常不直接执行
          const executableChains = data.filter(chain => !chain.is_template);
          setAvailableChains(executableChains);
        })
        .catch(() => {
          message.error('获取可用规则链列表失败');
        });
    }
  }, [isBatchModalVisible]); // 依赖于模态框的显示状态

  // 处理“新建规则链”按钮点击事件
  const handleCreateNewChain = () => {
    navigate('/rule-chains/edit/new');
  };

  // 显示批量执行模态框
  const showBatchModal = () => {
    setIsBatchModalVisible(true);
  };

  // 处理批量执行模态框的“取消”操作
  const handleBatchModalCancel = () => {
    setIsBatchModalVisible(false);
    form.resetFields(); // 重置表单字段
  };

  // 定义批量执行表单的数据类型接口
  interface BatchExecuteFormValues {
    novel_id: number;
    chain_ids: number[];
  }
  
  // 处理批量执行模态框的“确认执行”操作
  const handleBatchModalOk = async () => {
    try {
      // 校验表单字段
      const values: BatchExecuteFormValues = await form.validateFields();
      setIsSubmitting(true); // 开始提交状态
      
      // 调用批量执行的 API
      await batchExecuteChains(values.novel_id, values.chain_ids);
      
      message.success(`已成功为小说 ID:${values.novel_id} 启动 ${values.chain_ids.length} 个规则链的批量执行任务。`);
      setIsBatchModalVisible(false); // 关闭模态框
      form.resetFields(); // 重置表单
    } catch (error) {
      console.error('批量执行规则链失败:', error);
      message.error('批量执行失败，请检查输入或查看控制台错误。');
    } finally {
      setIsSubmitting(false); // 结束提交状态
    }
  };


  return (
    <>
      <Layout className={pageStyles.pageLayout}>
        {/* 面包屑导航 */}
        <Breadcrumb className={pageStyles.breadcrumb}>
          <Breadcrumb.Item>
            <Link to="/"><HomeOutlined /><span>首页</span></Link>
          </Breadcrumb.Item>
          <Breadcrumb.Item>
            <ApartmentOutlined />
            <span>规则链管理</span>
          </Breadcrumb.Item>
        </Breadcrumb>

        {/* 主要内容区域 */}
        <Content className={pageStyles.pageContent}>
          {/* 页面标题和操作按钮 */}
          <div className={pageStyles.titleBar}>
            <Title level={2} className={pageStyles.pageTitle}>
              <ApartmentOutlined style={{ marginRight: '8px' }} />
              规则链管理
            </Title>
            <Space>
              {/* 批量执行按钮 */}
              <Button icon={<PlaySquareOutlined />} onClick={showBatchModal}>
                批量执行
              </Button>
              {/* 新建规则链按钮 */}
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleCreateNewChain}
              >
                新建规则链
              </Button>
            </Space>
          </div>
          
          {/* 规则链列表组件实例 */}
          <RuleChainList />
        </Content>
      </Layout>

      {/* 批量执行模态框 */}
      <Modal
        title="批量执行规则链"
        open={isBatchModalVisible} // 使用 open 属性控制显示
        onOk={handleBatchModalOk}
        onCancel={handleBatchModalCancel}
        confirmLoading={isSubmitting} // 确认按钮的加载状态
        okText="确认执行"
        cancelText="取消"
        destroyOnClose // 关闭时销毁内部组件状态
      >
        <Form
          form={form}
          layout="vertical"
          name="batch_execute_form"
        >
          <Form.Item
            name="novel_id"
            label="目标小说 ID"
            rules={[{ required: true, message: '请输入要执行规则链的目标小说 ID!' }]}
          >
            <InputNumber style={{ width: '100%' }} placeholder="例如: 1" />
          </Form.Item>
          <Form.Item
            name="chain_ids"
            label="选择要执行的规则链"
            rules={[{ required: true, message: '请至少选择一个规则链!' }]}
          >
            <Select
              mode="multiple" // 允许多选
              allowClear
              style={{ width: '100%' }}
              placeholder="请选择规则链（模板链已被过滤）"
              loading={availableChains.length === 0} // 加载数据时显示加载状态
            >
              {/* 从 availableChains 状态动态生成选项 */}
              {availableChains.map(chain => (
                <Option key={chain.id} value={chain.id}>
                  {chain.name} (ID: {chain.id})
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default RuleChainsPage; // 导出组件