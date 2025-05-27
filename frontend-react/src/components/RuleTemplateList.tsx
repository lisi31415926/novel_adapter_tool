// frontend-react/src/components/RuleTemplateList.tsx
import React, { useEffect, useState, useCallback } from 'react'; // 导入 React 及其 Hooks
import { Table, Button, Space, Popconfirm, message, Tag, Tooltip } from 'antd'; // 从 Ant Design 导入 UI 组件
import { EditOutlined, DeleteOutlined, EyeOutlined, QuestionCircleOutlined } from '@ant-design/icons'; // 从 Ant Design 导入图标
import { RuleTemplate, getRuleTemplates, deleteRuleTemplate } from '../services/api'; // 导入 API 服务和 RuleTemplate 类型
import { useNavigate } from 'react-router-dom'; // 从 React Router 导入用于导航的 Hook
import styles from './RuleTemplateList.module.css'; // 导入组件的 CSS Module 样式
import { ColumnsType } from 'antd/es/table'; // 导入 Ant Design Table 的列类型

// RuleTemplateList 组件的 Props 接口定义
interface RuleTemplateListProps {
  // 此组件目前设计为自行获取和管理数据，因此不从父组件接收模板数据或加载状态。
  // 如果未来需要由父组件控制数据，可以在此添加相应的 props。
  // 例如:
  // templatesData?: RuleTemplate[];
  // isLoading?: boolean;
  // onRefreshRequired?: () => void;
}

const RuleTemplateList: React.FC<RuleTemplateListProps> = () => {
  const [templates, setTemplates] = useState<RuleTemplate[]>([]); // 存储规则模板列表的状态，明确类型为 RuleTemplate[]
  const [loading, setLoading] = useState<boolean>(true); // 控制表格数据加载状态
  const navigate = useNavigate(); // 获取 navigate 函数用于编程式导航

  // 定义获取规则模板列表的异步函数
  // 使用 useCallback 优化，仅当其依赖项发生变化时才重新创建此函数
  const fetchTemplates = useCallback(async () => {
    setLoading(true); // 开始加载数据，设置 loading 状态为 true
    try {
      const data = await getRuleTemplates(); // 调用 API 服务获取规则模板数据
      setTemplates(data || []); // 更新模板列表状态，如果 data 为 null 或 undefined，则设置为空数组
    } catch (error: any) { // 捕获任何在获取数据过程中发生的错误
      message.error('获取规则模板列表失败'); // 使用 Ant Design 的 message 组件显示错误提示
      console.error('获取规则模板列表失败:', error); // 在控制台打印详细错误信息
    } finally {
      setLoading(false); // 数据加载结束（无论成功或失败），设置 loading 状态为 false
    }
  }, []); // 空依赖数组表示此回调函数仅在组件挂载时创建一次

  // React Hook: useEffect 在组件首次挂载后执行 fetchTemplates 函数以初始化数据
  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]); // 依赖于 fetchTemplates 回调函数

  // 处理删除模板的操作
  const handleDelete = async (templateId: number) => {
    try {
      await deleteRuleTemplate(templateId); // 调用 API 服务删除指定 ID 的规则模板
      message.success('规则模板删除成功'); // 显示成功提示
      fetchTemplates(); // 删除成功后，重新获取模板列表以更新UI
    } catch (error: any) {
      // 尝试从后端响应中获取更具体的错误信息，否则显示通用错误消息
      const errorMessage = error.response?.data?.detail || `删除规则模板失败: ${error.message || '可能该模板正在被规则链使用。'}`;
      message.error(errorMessage);
      console.error('删除规则模板失败:', error);
    }
  };

  // 处理编辑模板的操作：导航到模板编辑页面
  const handleEdit = (templateId: number) => {
    // 使用编程式导航跳转到编辑页面，路由路径包含模板ID
    navigate(`/rule-templates/edit/${templateId}`);
  };

  // 处理查看模板详情的操作（当前为占位逻辑，未来可扩展）
  const handleViewDetails = (templateId: number) => {
    console.log('查看模板详情，ID:', templateId);
    // 实际应用中，这里可能会导航到详情页或打开一个模态框显示更多信息
    message.info(`查看模板 ID: ${templateId} 的详情 (此功能待进一步实现)`);
  };

  // 定义 Ant Design Table 的列配置
  // ColumnsType<RuleTemplate> 确保列定义与 RuleTemplate 数据类型严格匹配
  const columns: ColumnsType<RuleTemplate> = [
    {
      title: 'ID', // 列标题
      dataIndex: 'id', // 对应数据记录中的 'id' 字段
      key: 'id', // React key
      sorter: (a: RuleTemplate, b: RuleTemplate) => a.id - b.id, // 定义此列的排序逻辑
      width: 80, // 列宽度
    },
    {
      title: '模板名称',
      dataIndex: 'name',
      key: 'name',
      sorter: (a: RuleTemplate, b: RuleTemplate) => a.name.localeCompare(b.name), // 按名称字符串排序
      className: styles.nameCell, // 应用自定义CSS样式
      ellipsis: true, // 内容过长时显示省略号
      render: (name: string) => <Tooltip title={name}>{name}</Tooltip>, // 鼠标悬浮时显示完整名称
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true, // 内容过长时显示省略号
      className: styles.descriptionCell, // 应用自定义CSS样式
      render: (description: string | null | undefined) => ( // 处理可能为 null 或 undefined 的描述
        <Tooltip title={description || '无描述'}>
          {description || <span style={{ color: '#999' }}>无</span>}
        </Tooltip>
      ),
    },
    {
      title: '任务类型',
      dataIndex: 'task_type',
      key: 'task_type',
      render: (taskType: string) => <Tag className={styles.taskTypeTag}>{taskType}</Tag>, // 使用 Ant Design Tag 组件展示任务类型
      width: 180,
    },
    {
      title: '输出变量名',
      dataIndex: 'output_variable_name',
      key: 'output_variable_name',
      ellipsis: true,
      render: (name: string | null | undefined) => name || <span style={{ color: '#999' }}>默认</span>,
      width: 150,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => new Date(text).toLocaleString(), // 格式化日期时间显示
      sorter: (a: RuleTemplate, b: RuleTemplate) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(), // 按创建时间排序
      width: 180,
    },
    {
      title: '操作',
      key: 'action',
      align: 'center', // 操作列居中对齐
      width: 220, // 为操作按钮提供足够宽度
      render: (_: any, record: RuleTemplate) => ( // record 参数类型为 RuleTemplate
        // Space 组件用于自动处理其子元素之间的间距
        <Space size="small">
          <Tooltip title="查看模板详情 (待实现)">
            <Button
              icon={<EyeOutlined />}
              onClick={() => handleViewDetails(record.id)}
              size="small"
            >
              查看
            </Button>
          </Tooltip>
          <Tooltip title="编辑此规则模板">
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record.id)}
              size="small"
            >
              编辑
            </Button>
          </Tooltip>
          {/* Popconfirm 用于删除操作前进行二次确认 */}
          <Popconfirm
            title={`确定要删除模板 "${record.name}" 吗？`}
            description="此操作不可撤销。如果模板正被规则链使用，可能无法删除或会导致相关规则链出错。"
            onConfirm={() => handleDelete(record.id)}
            okText="确定删除"
            cancelText="取消"
            placement="topRight" // 气泡确认框的弹出位置
            icon={<QuestionCircleOutlined style={{ color: 'red' }} />} // 提示图标
          >
            <Tooltip title="删除此规则模板">
              <Button
                type="primary"
                danger // 设置为危险操作按钮样式 (红色)
                icon={<DeleteOutlined />}
                size="small"
              >
                删除
              </Button>
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 返回 Ant Design Table 组件用于展示列表
  return (
    <Table<RuleTemplate> // 明确 Table 的数据记录类型为 RuleTemplate
      columns={columns} // 表格列配置
      dataSource={templates} // 表格数据源
      loading={loading} // 表格加载状态
      rowKey="id" // 指定每行的唯一 key 为记录的 id 字段
      pagination={{ // 分页配置
        pageSize: 10, // 默认每页显示条数
        showSizeChanger: true, // 是否可以改变每页显示条数
        pageSizeOptions: ['10', '20', '50', '100'], // 可选的每页显示条数
        showTotal: (total, range) => `显示 ${range[0]}-${range[1]} 条，共 ${total} 条模板`, // 显示总记录数
      }}
      scroll={{ x: 'max-content' }} // 当内容超出时，允许表格横向滚动
      className={styles.templateTable} // 可以为 Table 本身添加一个类名，用于更细致的样式控制 (如果需要)
    />
  );
};

export default RuleTemplateList; // 导出组件