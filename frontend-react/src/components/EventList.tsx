// frontend-react/src/components/EventList.tsx
import React from 'react';
import { Table, Button, Space, Popconfirm, Tag, Tooltip, Typography, message } from 'antd';
import { EditOutlined, DeleteOutlined, CalendarOutlined, UnorderedListOutlined, TagsOutlined, InfoCircleOutlined, QuestionCircleOutlined, ApartmentOutlined } from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig, SorterResult } from 'antd/es/table';
import { Event as EventInfo, SortDirectionEnum } from '../services/api'; // 确保 Event 类型名称正确
import moment from 'moment'; // 用于格式化日期

// 从 constants.ts 导入事件类型和重要性级别选项
import { EVENT_TYPES_OPTIONS, EVENT_IMPORTANCE_LEVELS_OPTIONS } from '../constants';

import styles from './EventList.module.css'; // 可以保留或移除，主要用于微调

const { Text, Link: AntLink } = Typography; // 使用 AntD Link

// 定义可排序的事件字段类型列表
export type SortableEventFieldsList =
  | 'id'
  | 'summary'
  | 'event_type'
  | 'event_timestamp'
  | 'location'
  | 'importance_level'
  | 'plot_version_id'
  | 'created_at'
  | 'updated_at';

// EventList 组件的 Props 接口定义
interface EventListProps {
  events: EventInfo[];                          // 事件数据数组
  isLoading: boolean;                         // 指示数据是否正在加载
  novelId: number | null;                     // 当前小说ID, 用于操作时的校验或传递
  plotVersionsMap: Record<number, string>;    // 剧情版本ID到名称的映射，用于显示
  onDeleteEvent: (eventId: number) => Promise<void>; // 删除事件的回调 (父组件处理API和toast)
  onEditEvent: (event: EventInfo) => void;        // 编辑事件的回调 (通常是打开编辑模态框)
  pagination: TablePaginationConfig;          // Ant Design Table 的分页配置对象
  // 当表格的排序、筛选、分页发生变化时的回调
  onTableChange: (
    newPagination: TablePaginationConfig,
    filters: Record<string, (React.Key | boolean)[] | null>,
    sorter: SorterResult<EventInfo> | SorterResult<EventInfo>[]
  ) => void;
}

const EventList: React.FC<EventListProps> = ({
  events,
  isLoading,
  novelId,
  plotVersionsMap,
  onDeleteEvent,
  onEditEvent,
  pagination,
  onTableChange,
}) => {

  // --- Ant Design Table 的列定义 ---
  const columns: ColumnsType<EventInfo> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 70,
      sorter: true, // 允许排序，具体排序逻辑由 onTableChange 在父组件处理
      align: 'center',
      defaultSortOrder: pagination.current === 1 && pagination.pageSize === (pagination.defaultPageSize || parseInt(ITEMS_PER_PAGE_OPTIONS[1],10)) && !pagination.sorter ? 'descend' : undefined,
    },
    {
      title: '事件摘要',
      dataIndex: 'summary',
      key: 'summary',
      sorter: true,
      ellipsis: { showTitle: false }, // AntD Tooltip 会处理长文本
      render: (summary: string, record: EventInfo) => (
        <Tooltip title={summary}>
          {/* 点击摘要可以触发编辑 */}
          <AntLink onClick={() => onEditEvent(record)} style={{whiteSpace: 'normal', textAlign: 'left' }}>
            {summary}
          </AntLink>
        </Tooltip>
      ),
    },
    {
      title: (
        <Space>
          <InfoCircleOutlined /> 类型
        </Space>
      ),
      dataIndex: 'event_type',
      key: 'event_type',
      width: 140,
      sorter: true,
      render: (type: string | null) => {
        const option = EVENT_TYPES_OPTIONS.find(opt => opt.value === type);
        return type ? <Tag color={option?.color || 'default'} title={option?.description || type}>{option?.label || type}</Tag> : <Text type="secondary" italic>未指定</Text>;
      },
      // 如果需要前端筛选（通常推荐后端筛选）:
      // filters: EVENT_TYPES_OPTIONS.map(opt => ({ text: opt.label, value: opt.value })),
      // onFilter: (value, record) => record.event_type === value,
    },
    {
      title: '重要性',
      dataIndex: 'importance_level',
      key: 'importance_level',
      width: 120,
      align: 'center',
      sorter: true,
      render: (level: number | null) => {
        const option = EVENT_IMPORTANCE_LEVELS_OPTIONS.find(opt => opt.value === level);
        return level !== null && level !== undefined ? (
          <Tag color={option?.color || 'default'}>{option?.label || `级别 ${level}`}</Tag>
        ) : (
          <Text type="secondary" italic>N/A</Text>
        );
      },
      // filters: EVENT_IMPORTANCE_LEVELS_OPTIONS.map(opt => ({ text: opt.label, value: opt.value })),
      // onFilter: (value, record) => record.importance_level === value,
    },
    {
      title: (
        <Space>
          <CalendarOutlined /> 发生时间
        </Space>
      ),
      dataIndex: 'event_timestamp',
      key: 'event_timestamp',
      width: 170,
      sorter: true,
      render: (timestamp: string | null) =>
        timestamp ? moment(timestamp).format('YYYY-MM-DD HH:mm') : <Text type="secondary" italic>未指定</Text>,
    },
    {
      title: '地点',
      dataIndex: 'location',
      key: 'location',
      width: 150,
      ellipsis: true,
      render: (location: string | null) => location || <Text type="secondary" italic>未指定</Text>,
    },
    {
      title: (
        <Space>
          <ApartmentOutlined /> 剧情版本
        </Space>
      ),
      dataIndex: 'plot_version_id',
      key: 'plot_version_id',
      width: 160,
      sorter: true,
      render: (plotVersionId: number | null) => {
        const versionName = plotVersionId ? (plotVersionsMap[plotVersionId] || `版本ID: ${plotVersionId}`) : null;
        return versionName ? <Tag color="purple">{versionName}</Tag> : <Text type="secondary" italic>通用事件</Text>;
      }
    },
    {
      title: (
        <Space>
          <TagsOutlined /> 标签
        </Space>
      ),
      dataIndex: 'tags',
      key: 'tags',
      width: 180,
      ellipsis: true,
      render: (tags: string[] | null) => {
        if (!tags || tags.length === 0) {
          return <Text type="secondary" italic>无标签</Text>;
        }
        return (
          <Space wrap size={[0, 8]}> {/* 允许标签换行 */}
            {tags.map((tag, index) => (
              <Tag key={`${tag}-${index}`}>{tag}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      align: 'center',
      width: 100, // 调整宽度以适应两个按钮
      fixed: 'right', // 固定操作列在右侧
      render: (_: any, record: EventInfo) => (
        <Space size="small">
          <Tooltip title="编辑此事件">
            <Button icon={<EditOutlined />} onClick={() => onEditEvent(record)} size="small" type="text" />
          </Tooltip>
          <Popconfirm
            title={<Text>确定要删除事件 <Text strong>“{record.summary.substring(0,25)}{record.summary.length > 25 ? '...' : ''}”</Text> 吗？</Text>}
            description="此操作不可撤销。"
            onConfirm={async () => {
              if (!novelId) { message.error("小说ID无效，无法删除。"); return; }
              // 父组件将处理实际的删除逻辑和toast消息
              onDeleteEvent(record.id);
            }}
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
            placement="topRight"
          >
            <Tooltip title="删除此事件">
              <Button icon={<DeleteOutlined />} danger type="text" size="small" />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className={styles.eventListContainerAntd}> {/* 可选：顶层容器样式 */}
      <Table<EventInfo>
        columns={columns}
        dataSource={events}
        loading={isLoading}
        rowKey="id"
        pagination={pagination} // 使用父组件传递的分页配置
        onChange={onTableChange} // 将 AntD Table 的 onChange 事件统一回调给父组件处理
        scroll={{ x: 1300, y: 'calc(100vh - 460px)' }} // 示例：设置横向和垂直滚动，y值需要根据实际页面布局调整
        size="middle"
        bordered
        className={styles.eventTableAntd} // 自定义表格样式 (如果需要)
        locale={{ emptyText: <Empty description="暂无事件数据或未匹配到结果。" /> }} // 自定义空状态提示
      />
    </div>
  );
};

export default EventList;