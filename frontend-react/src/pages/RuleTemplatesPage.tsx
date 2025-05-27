// frontend-react/src/pages/RuleTemplatesPage.tsx
import React from 'react';
import { Layout, Typography, Button, Breadcrumb, Space } from 'antd';
import { PlusOutlined, DatabaseOutlined, HomeOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import RuleTemplateList from '../components/RuleTemplateList'; // 导入规则模板列表子组件
import styles from './RuleTemplatesPage.module.css'; // 页面特定样式
import pageStyles from './PageStyles.module.css';   // 通用页面样式

const { Content } = Layout;
const { Title } = Typography;

// 规则模板库页面组件
const RuleTemplatesPage: React.FC = () => {
  const navigate = useNavigate(); // 用于编程式导航

  // 处理“新建规则模板”按钮点击事件
  const handleCreateNewTemplate = () => {
    navigate('/rule-templates/new'); // 导航到模板创建/编辑页面，路径为 /rule-templates/new
  };

  return (
    <Layout className={pageStyles.pageLayout}>
      {/* 面包屑导航 */}
      <Breadcrumb className={pageStyles.breadcrumb}>
        <Breadcrumb.Item>
          <Link to="/">
            <HomeOutlined />
            <span>首页</span>
          </Link>
        </Breadcrumb.Item>
        <Breadcrumb.Item>
          <DatabaseOutlined /> {/* 模板库图标 */}
          <span>规则模板库</span> {/* 当前页面名称 */}
        </Breadcrumb.Item>
      </Breadcrumb>

      {/* 主要内容区 */}
      <Content className={`${pageStyles.pageContent} ${styles.ruleTemplatesPageContainer || ''}`}>
        {/* 页面标题栏，包含标题和操作按钮 */}
        <div className={pageStyles.titleBar}>
          <Title level={2} className={pageStyles.pageTitle}>
            <DatabaseOutlined style={{ marginRight: '10px' }} /> {/* 标题图标，调整间距 */}
            规则模板库
          </Title>
          <Space> {/* Space 组件用于自动处理按钮间距 */}
            <Button
              type="primary" // 主按钮样式
              icon={<PlusOutlined />} // “加号”图标
              onClick={handleCreateNewTemplate} // 点击事件处理器
              size="middle" // 适中的按钮大小
            >
              新建规则模板
            </Button>
          </Space>
        </div>
        
        <Paragraph className={pageStyles.pageDescriptionText}> {/* 使用新的段落样式类 */}
          管理和维护可重用的规则模板。这些模板定义了AI文本处理任务的基本行为和参数结构，可以在不同的规则链中被引用和实例化。
        </Paragraph>

        {/* 规则模板列表组件实例 */}
        {/* RuleTemplateList 组件负责获取、展示和管理规则模板数据 */}
        <div className={styles.listContainer}> {/* 为列表添加一个容器以便更好地控制样式 */}
          <RuleTemplateList />
        </div>

      </Content>
    </Layout>
  );
};

export default RuleTemplatesPage;