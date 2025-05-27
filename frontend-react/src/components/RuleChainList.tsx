// frontend-react/src/components/RuleChainList.tsx
import React, { useEffect, useState, useCallback } from 'react'; // 导入 React 及其 Hooks
import { Table, Button, Space, Popconfirm, message, Tag, Tooltip } from 'antd'; // 从 Ant Design 导入 UI 组件
import { EditOutlined, DeleteOutlined, PlayCircleOutlined, QuestionCircleOutlined, CopyOutlined } from '@ant-design/icons'; // 从 Ant Design 导入图标
import { RuleChain, getRuleChains, deleteRuleChain } from '../services/api'; // 导入 API 服务和 RuleChain 类型
import { useNavigate } from 'react-router-dom'; // 从 React Router 导入用于导航的 Hook
import styles from './RuleChainList.module.css'; // 导入组件的 CSS Module 样式
import type { ColumnsType } from 'antd/es/table'; // 明确导入 Ant Design Table 的列类型，以增强类型安全

// RuleChainList 组件的 Props 接口定义 (目前此组件自管理数据，故为空)
interface RuleChainListProps {
  // 可以根据需要添加 props，例如从父组件接收筛选条件
}

const RuleChainList: React.FC<RuleChainListProps> = () => {
  const [ruleChains, setRuleChains] = useState<RuleChain[]>([]); // 存储规则链列表的状态，明确类型为 RuleChain[]
  const [loading, setLoading] = useState<boolean>(true); // 控制表格数据加载状态
  const navigate = useNavigate(); // 获取 navigate 函数用于编程式导航

  // 定义获取规则链列表的异步函数
  // 使用 useCallback 优化，仅当其依赖项发生变化时才重新创建此函数
  const fetchRuleChains = useCallback(async () => {
    setLoading(true); // 开始加载，设置 loading 为 true
    try {
      const data = await getRuleChains(); // 调用 API 服务获取数据
      setRuleChains(data || []); // 更新状态，若数据为 null 或 undefined，则设为空数组
    } catch (error) {
      message.error('获取规则链列表失败'); // 显示错误提示
      console.error('获取规则链列表失败:', error); // 在控制台打印详细错误
    } finally {
      setLoading(false); // 加载结束（无论成功或失败），设置 loading 为 false
    }
  }, []); // 空依赖数组表示此回调函数仅在组件挂载时创建一次

  // React Hook: useEffect 在组件首次挂载后执行 fetchRuleChains 函数
  useEffect(() => {
    fetchRuleChains();
  }, [fetchRuleChains]); // 依赖于 fetchRuleChains 回调函数

  // 处理删除规则链的操作
  const handleDelete = async (chainId: number) => {
    try {
      await deleteRuleChain(chainId); // 调用 API 删除指定 ID 的规则链
      message.success('规则链删除成功'); // 显示成功提示
      fetchRuleChains(); // 删除成功后，重新获取列表以更新UI
    } catch (error) {
      message.error('删除规则链失败');
      console.error('删除规则链失败:', error);
    }
  };

  // 处理编辑规则链的操作：导航到规则链编辑页面
  const handleEdit = (chainId: number) => {
    navigate(`/rule-chains/edit/${chainId}`); // 跳转到编辑页，URL中包含链ID
  };

  // 处理执行规则链的操作 (当前为占位逻辑)
  const handleExecuteChain = (chainId: number, chainName: string) => {
    // 实际应用中，这里可能会打开一个模态框让用户选择输入数据，或者直接跳转到执行页面
    console.log(`准备执行规则链: ${chainName} (ID: ${chainId})`);
    message.info(`执行规则链 "${chainName}" 的功能正在开发中。`);
    // navigate(`/rule-chains/execute/${chainId}`); // 未来可能的导航路径
  };
  
  // 处理从规则链创建新规则链（复制功能）
  const handleCreateFromChain = (chainId: number) => {
    // 导航到新建页面，并通过路由 state 传递用作模板的规则链 ID
    navigate('/rule-chains/edit/new', { state: { fromChainId: chainId } });
    message.loading('正在加载规则链数据以创建副本...', 1.5);
  };

  // 定义 Ant Design Table 的列配置
  // 使用 ColumnsType<RuleChain> 确保列定义与 RuleChain 数据类型严格匹配
  const columns: ColumnsType<RuleChain> = [
    {
      title: 'ID', // 列标题
      dataIndex: 'id', // 对应数据记录中的 'id' 字段
      key: 'id', // React key
      sorter: (a, b) => a.id - b.id, // 按 ID 排序
      width: 80,
    },
    {
      title: '规则链名称',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name), // 按名称字符串排序
      ellipsis: true, // 内容过长时显示省略号
      render: (name: string, record: RuleChain) => (
        <Tooltip title={name}>
          <a onClick={() => handleEdit(record.id)}>{name}</a>
        </Tooltip>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true, // 内容过长时显示省略号
      render: (description: string | null) => (
        <Tooltip title={description || '无描述'}>
          {description || <span style={{ color: '#999' }}>无</span>}
        </Tooltip>
      ),
    },
    {
      title: '步骤数',
      dataIndex: 'steps',
      key: 'steps',
      align: 'center',
      width: 100,
      sorter: (a, b) => (a.steps?.length || 0) - (b.steps?.length || 0), // 按步骤数量排序
      render: (steps: RuleChain['steps']) => ( // 参数类型为 RuleChain['steps']
        <Tag color="blue">{steps?.length || 0}</Tag>
      ),
    },
    {
      title: '模板',
      dataIndex: 'is_template',
      key: 'is_template',
      align: 'center',
      width: 90,
      render: (isTemplate: boolean) => // 参数类型为 boolean
        isTemplate ? <Tag color="success">是</Tag> : <Tag color="default">否</Tag>,
    },
    {
      title: '关联小说ID',
      dataIndex: 'novel_id',
      key: 'novel_id',
      align: 'center',
      width: 130,
      render: (novelId: number | null) => novelId ? <Tag color="purple">{novelId}</Tag> : '无',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      sorter: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      render: (text: string) => new Date(text).toLocaleString(), // 格式化日期时间显示
    },
    {
      title: '操作',
      key: 'action',
      align: 'center',
      width: 280, // 为多个操作按钮提供足够宽度
      render: (_: any, record: RuleChain) => ( // record 参数类型为 RuleChain
        <Space size="small">
          <Tooltip title="执行此规则链（开发中）">
            <Button
              icon={<PlayCircleOutlined />}
              onClick={() => handleExecuteChain(record.id, record.name)}
              size="small"
            >
              执行
            </Button>
          </Tooltip>
          <Tooltip title="编辑此规则链">
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record.id)}
              size="small"
            >
              编辑
            </Button>
          </Tooltip>
           <Tooltip title="以此规则链为模板创建新的规则链">
            <Button
              icon={<CopyOutlined />}
              onClick={() => handleCreateFromChain(record.id)}
              size="small"
            >
              复制
            </Button>
          </Tooltip>
          {/* Popconfirm 用于删除操作前的二次确认 */}
          <Popconfirm
            title={`确定要删除规则链 "${record.name}" 吗？`}
            description="此操作不可撤销。"
            onConfirm={() => handleDelete(record.id)} // 确认删除时调用 handleDelete
            okText="确定删除"
            cancelText="取消"
            placement="topRight"
            icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
          >
            <Tooltip title="删除此规则链">
              <Button type="primary" danger icon={<DeleteOutlined />} size="small">
                删除
              </Button>
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 返回 Ant Design Table 组件
  return (
    <Table<RuleChain> // 明确 Table 的数据记录类型为 RuleChain
      columns={columns} // 表格列配置
      dataSource={ruleChains} // 表格数据源
      loading={loading} // 表格加载状态
      rowKey="id" // 指定每行的唯一 key 为记录的 id 字段
      pagination={{ // 分页配置
        pageSize: 10,
        showSizeChanger: true,
        pageSizeOptions: ['10', '20', '50', '100'],
        showTotal: (total, range) => `显示 ${range[0]}-${range[1]} 条，共 ${total} 条规则链`,
      }}
      scroll={{ x: 'max-content' }} // 当内容超出时，允许表格横向滚动
      className={styles.chainTable}
    />
  );
};

export default RuleChainList; // 导出组件