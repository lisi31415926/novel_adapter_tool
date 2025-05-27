// frontend-react/src/components/CharacterList.tsx
import React from 'react';
import { Table, Button, Space, Popconfirm, Tag, Tooltip, Typography, message } from 'antd';
import { EditOutlined, DeleteOutlined, UserOutlined, TagOutlined, OrderedListOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table'; // SorterResult 已包含
import { Character, SortDirectionEnum } from '../services/api'; // 从 services/api 导入 Character 类型和枚举
// import styles from './CharacterList.module.css'; // AntD Table 自带良好样式，特定微调可选

const { Text } = Typography;

// 定义 CharacterList 组件的 Props 接口
interface CharacterListProps {
  characters: Character[];                 // 角色数据数组
  isLoading: boolean;                    // 指示数据是否正在加载
  novelId: number | null;                  // 当前小说ID, 用于操作时的校验或传递
  onDeleteCharacter: (characterId: number) => Promise<void>; // 删除角色时的回调函数，返回Promise
  onEditCharacter: (character: Character) => void;     // 编辑角色时的回调函数
  pagination: TablePaginationConfig;     // Ant Design Table 的分页配置对象
  // 当表格的排序、筛选、分页发生变化时的回调
  onTableChange: (
    newPagination: TablePaginationConfig,
    filters: Record<string, (React.Key | boolean)[] | null>, // 根据 AntD TableChange 类型
    sorter: any // SorterResult<Character> | SorterResult<Character>[] // 使用 any 避免 SorterResult 泛型问题
  ) => void;
}

const CharacterList: React.FC<CharacterListProps> = ({
  characters,
  isLoading,
  novelId, // novelId 在此组件中可能主要用于确认操作权限或传递给回调，具体看父组件实现
  onDeleteCharacter,
  onEditCharacter,
  pagination,
  onTableChange,
}) => {

  // --- Ant Design Table 的列定义 ---
  const columns: ColumnsType<Character> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 70, // 调整宽度
      sorter: true,
      align: 'center',
      // defaultSortOrder 已移至父组件 CharacterListPage.tsx 的 pagination 状态管理
    },
    {
      title: (
        <Space>
          <UserOutlined />
          角色名称
        </Space>
      ),
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      ellipsis: true, // 开启内容过长时显示省略号
      render: (name: string, record: Character) => (
        <Tooltip title={name}>
          {/* 角色名称可以设为链接，点击后导航到角色详情页或打开编辑模态框 */}
          <Button type="link" onClick={() => onEditCharacter(record)} style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign:'left' }}>
            {name}
          </Button>
        </Tooltip>
      ),
    },
    {
      title: (
        <Space>
          <TagOutlined />
          定位/身份
        </Space>
      ),
      dataIndex: 'role_type',
      key: 'role_type',
      sorter: true,
      width: 160, // 调整宽度
      render: (roleType: string | null | undefined) =>
        roleType ? <Tag color="blue">{roleType}</Tag> : <Text type="secondary" italic>未指定</Text>,
      // 筛选功能已移至父组件 CharacterListPage.tsx
    },
    {
      title: '描述 (片段)',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (description: string | null | undefined) => (
        <Tooltip title={description || '无描述信息'}>
          {description ? (description.length > 60 ? `${description.substring(0, 57)}...` : description) // 缩短预览长度
                       : <Text type="secondary" italic>无描述</Text>}
        </Tooltip>
      ),
    },
    {
      title: (
        <Space>
          <OrderedListOutlined />
          首次出场 (章)
        </Space>
      ),
      dataIndex: 'first_appearance_chapter_index',
      key: 'first_appearance_chapter_index',
      align: 'center',
      width: 140, // 调整宽度
      sorter: true,
      render: (index: number | null | undefined) =>
        (index !== null && index !== undefined && index >=0) ? index + 1 : <Text type="secondary" italic>未知</Text>, // 显示为1-based，确保index有效
    },
    {
      title: '操作',
      key: 'action',
      align: 'center',
      width: 120, // 根据按钮数量调整
      fixed: 'right', // 固定操作列在右侧，方便在表格有横向滚动条时操作
      render: (_: any, record: Character) => (
        <Space size="small">
          <Tooltip title="编辑此角色">
            <Button
              icon={<EditOutlined />}
              onClick={() => onEditCharacter(record)}
              size="small"
              type="text" // 使用文本按钮以节省空间
            />
          </Tooltip>
          <Popconfirm
            title={<Text>确定要删除角色 <Text strong>“{record.name}”</Text> 吗？</Text>} // 更友好的提示
            description="此操作不可撤销。"
            onConfirm={async () => {
                if (!novelId) { // 在执行操作前检查novelId
                    message.error("无法删除角色：小说ID未知。");
                    return;
                }
                // 父组件将处理实际的删除逻辑和toast消息
                onDeleteCharacter(record.id);
            }}
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }} // 强调删除按钮的危险性
            icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
            placement="topRight" // 调整气泡确认框位置
          >
            <Tooltip title="删除此角色">
              <Button icon={<DeleteOutlined />} danger type="text" size="small" />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div /*className={styles.characterListAntdTableContainer} // 可以移除或保留，如果CSS中有用*/>
      <Table<Character> // 明确Table的数据记录类型为Character
        columns={columns}
        dataSource={characters}
        loading={isLoading}
        rowKey="id"
        pagination={pagination} // 直接使用父组件传递的分页配置
        onChange={onTableChange} // 将AntD Table的onChange事件统一回调给父组件处理
        scroll={{ x: 'max-content', y: 'calc(100vh - 400px)' }} // 示例：设置横向滚动和垂直滚动，y值需要根据页面整体布局灵活调整
        size="middle" // 或 "small" 使表格更紧凑
        // bordered // 可选：添加边框
        // className={styles.characterTableAntd} // 可以移除或保留
      />
    </div>
  );
};

export default CharacterList;