// frontend-react/src/components/ConflictList.tsx
import React from 'react';
import { Table, Button, Space, Popconfirm, Tag, Tooltip, Typography, message } from 'antd';
import { EditOutlined, DeleteOutlined, ThunderboltOutlined, ApartmentOutlined, UserOutlined, CalendarOutlined, QuestionCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig, SorterResult } from 'antd/es/table';
import { Conflict as ConflictInfo, SortDirectionEnum, InvolvedEntity, ConflictLevelEnum, ConflictStatusEnum } from '../services/api'; //

// 从 constants.ts 导入转换后的枚举选项
import { CONFLICT_LEVEL_OPTIONS, CONFLICT_STATUS_OPTIONS } from '../constants'; //

import styles from './ConflictList.module.css';

const { Text, Link: AntLink } = Typography;

// 定义可排序的冲突字段类型列表
export type SortableConflictFieldsList =
  | 'id'
  | 'description'
  | 'level' // 对应后端的 conflict_level
  | 'status'
  | 'intensity_level'
  | 'plot_version_id'
  | 'created_at'
  | 'updated_at';

// ConflictList 组件的 Props 接口定义
interface ConflictListProps {
  conflicts: ConflictInfo[];
  isLoading: boolean;
  novelId: number | null;
  plotVersionsMap: Record<number, string>;
  charactersMap: Record<number, string>;
  eventsMap: Record<number, string>;
  onDeleteConflict: (conflictId: number) => Promise<void>;
  onEditConflict: (conflict: ConflictInfo) => void;
  pagination: TablePaginationConfig;
  onTableChange: (
    newPagination: TablePaginationConfig,
    filters: Record<string, (React.Key | boolean)[] | null>,
    sorter: SorterResult<ConflictInfo> | SorterResult<ConflictInfo>[]
  ) => void;
}

// 辅助函数：将后端枚举值映射到显示的标签和颜色
const getConflictLevelDisplay = (levelValue: ConflictLevelEnum | string | null): { label: string; color?: string } => {
    const option = CONFLICT_LEVEL_OPTIONS.find(opt => opt.value === levelValue); //
    return { label: option?.label || String(levelValue) || '未知', color: option?.color }; //
};

const getConflictStatusDisplay = (statusValue: ConflictStatusEnum | string | null): { label: string; color?: string } => {
    const option = CONFLICT_STATUS_OPTIONS.find(opt => opt.value === statusValue); //
    return { label: option?.label || String(statusValue) || '未知', color: option?.color }; //
};


const ConflictList: React.FC<ConflictListProps> = ({
  conflicts,
  isLoading,
  novelId,
  plotVersionsMap,
  charactersMap,
  eventsMap,
  onDeleteConflict,
  onEditConflict,
  pagination,
  onTableChange,
}) => {

  const columns: ColumnsType<ConflictInfo> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 70,
      sorter: true,
      align: 'center',
    },
    {
      title: '冲突描述',
      dataIndex: 'description',
      key: 'description',
      sorter: true,
      ellipsis: { showTitle: false }, // AntD Tooltip 会处理长文本
      render: (description: string, record: ConflictInfo) => (
        <Tooltip title={description}>
          <AntLink onClick={() => onEditConflict(record)} style={{whiteSpace: 'normal', textAlign: 'left' }}>
            {description}
          </AntLink>
        </Tooltip>
      ),
    },
    {
      title: '级别',
      dataIndex: 'level', // 后端字段是 level
      key: 'level',
      width: 130,
      sorter: true,
      align: 'center',
      render: (level: ConflictLevelEnum | string | null) => {
        const display = getConflictLevelDisplay(level); //
        return <Tag color={display.color || 'default'}>{display.label}</Tag>; //
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      sorter: true,
      align: 'center',
      render: (status: ConflictStatusEnum | string | null) => {
        const display = getConflictStatusDisplay(status); //
        return <Tag color={display.color || 'default'}>{display.label}</Tag>; //
      },
    },
    {
      title: '激烈程度',
      dataIndex: 'intensity_level',
      key: 'intensity_level',
      width: 110,
      sorter: true,
      align: 'center',
      render: (intensity: number | null) => intensity !== null ? `${intensity}/10` : <Text type="secondary" italic>N/A</Text>,
    },
    {
      title: '涉及实体',
      dataIndex: 'involved_entities',
      key: 'involved_entities',
      width: 220,
      ellipsis: true,
      render: (entities: InvolvedEntity[] | undefined) => { //
        if (!entities || entities.length === 0) return <Text type="secondary" italic>无</Text>;
        return (
          <Tooltip title={entities.map(entity => { //
            if (entity.entity_type === 'character') return `角色: ${charactersMap[entity.entity_id as number] || `ID ${entity.entity_id}`}`; //
            if (entity.entity_type === 'event') return `事件: ${(eventsMap[entity.entity_id as number] || `ID ${entity.entity_id}`).substring(0,30)}...`; //
            return `${entity.entity_type}:${entity.entity_id}`; //
          }).join('; ')}
          >
            <Space wrap size={[4, 4]}>
                {entities.slice(0, 3).map((entity, index) => { //
                    let entityDisplay = `${entity.entity_type}:${entity.entity_id}`; //
                    let icon = <InfoCircleOutlined />; //
                    let color = "default"; //

                    if (entity.entity_type === 'character') { //
                        entityDisplay = charactersMap[entity.entity_id as number] || `角色ID ${entity.entity_id}`; //
                        icon = <UserOutlined />; //
                        color = "blue"; //
                    } else if (entity.entity_type === 'event') { //
                        const summary = eventsMap[entity.entity_id as number] || `事件ID ${entity.entity_id}`; //
                        entityDisplay = summary.length > 15 ? `${summary.substring(0,12)}...` : summary; //
                        icon = <CalendarOutlined />; //
                        color = "green"; //
                    }
                    return <Tag key={`${entity.entity_type}-${entity.entity_id}-${index}`} icon={icon} color={color}>{entityDisplay}</Tag>; //
                })}
                {entities.length > 3 && <Tag>...</Tag>}
            </Space>
          </Tooltip>
        );
      }
    },
    {
      title: '剧情版本',
      dataIndex: 'plot_version_id',
      key: 'plot_version_id',
      width: 160,
      sorter: true,
      render: (plotVersionId: number | null) => {
        const versionName = plotVersionId ? (plotVersionsMap[plotVersionId] || `版本ID: ${plotVersionId}`) : null;
        return versionName ? <Tag color="purple">{versionName}</Tag> : <Text type="secondary" italic>通用冲突</Text>;
      }
    },
    {
      title: '解决方式 (摘要)',
      dataIndex: 'resolution_details',
      key: 'resolution_details',
      ellipsis: true,
      render: (resolution: string | null) => resolution || <Text type="secondary" italic>未解决/无详情</Text>,
    },
    {
      title: '操作',
      key: 'action',
      align: 'center',
      width: 100,
      fixed: 'right',
      render: (_: any, record: ConflictInfo) => (
        <Space size="small">
          <Tooltip title="编辑此冲突">
            <Button icon={<EditOutlined />} onClick={() => onEditConflict(record)} size="small" type="text" />
          </Tooltip>
          <Popconfirm
            title={<Text>确定要删除冲突 <Text strong>“{(record.description || '').substring(0,25)}{(record.description || '').length > 25 ? '...' : ''}”</Text> 吗？</Text>}
            description="此操作不可撤销。"
            onConfirm={async () => {
              if (!novelId) { message.error("小说ID无效，无法删除。"); return; }
              onDeleteConflict(record.id);
            }}
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
          >
            <Tooltip title="删除此冲突">
              <Button icon={<DeleteOutlined />} danger type="text" size="small" />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className={styles.conflictListContainerAntd}>
      <Table<ConflictInfo>
        columns={columns}
        dataSource={conflicts}
        loading={isLoading}
        rowKey="id"
        pagination={pagination}
        onChange={onTableChange}
        scroll={{ x: 1400, y: 'calc(100vh - 460px)' }}
        size="middle"
        bordered
        className={styles.conflictTableAntd}
        locale={{ emptyText: <Empty description="暂无冲突数据或未匹配到结果。" /> }}
      />
    </div>
  );
};

export default ConflictList;