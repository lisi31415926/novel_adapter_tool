// frontend-react/src/components/CharacterRelationshipList.tsx
import React from 'react';
import { Table, Button, Space, Popconfirm, Tag, Tooltip, Typography, message } from 'antd';
import { EditOutlined, DeleteOutlined, TeamOutlined, UserOutlined, LinkOutlined, EyeOutlined, QuestionCircleOutlined, ApartmentOutlined, ReadOutlined } from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig, SorterResult } from 'antd/es/table';
import { CharacterRelationship, SortDirectionEnum, RelationshipTypeEnum, RelationshipStatusEnum, DynamicChange } from '../services/api'; //

// 从 constants.ts 或直接使用转换后的枚举选项
// 假设 OptionType 和转换后的枚举选项已在 constants.ts 定义或在此处处理
// (如果 mapEnumToOptionsForDisplay 移到 constants.ts 或 utils，则从那里导入)
import { OptionType } from '../constants'; //

import styles from './CharacterRelationshipList.module.css'; // 可选，用于微调样式

const { Text, Paragraph, Link: AntLink } = Typography;

// 定义可排序的字段类型列表
export type SortableRelationshipFields =
  | 'id'
  | 'character_a_id' // 后端通常按ID排序，前端可以显示名称
  | 'character_b_id'
  | 'relationship_type'
  | 'status'
  | 'start_chapter_index'
  | 'end_chapter_index'
  | 'plot_version_id'
  | 'created_at'
  | 'updated_at';

interface CharacterRelationshipListProps {
  relationships: CharacterRelationship[];
  isLoading: boolean;
  novelId: number | null;
  characterMap: Record<number, string>; // 角色ID到名称的映射
  plotVersionsMap: Record<number, string>; // 剧情版本ID到名称的映射
  // 用于将枚举值转换为显示标签和颜色
  relationshipTypeDisplayMap: Record<string, { label: string; color?: string }>;
  relationshipStatusDisplayMap: Record<string, { label: string; color?: string }>;
  onDeleteRelationship: (relationshipId: number) => Promise<void>;
  onEditRelationship: (relationship: CharacterRelationship) => void;
  pagination: TablePaginationConfig;
  onTableChange: (
    newPagination: TablePaginationConfig,
    filters: Record<string, (React.Key | boolean)[] | null>,
    sorter: SorterResult<CharacterRelationship> | SorterResult<CharacterRelationship>[]
  ) => void;
}

const CharacterRelationshipList: React.FC<CharacterRelationshipListProps> = ({
  relationships,
  isLoading,
  novelId,
  characterMap,
  plotVersionsMap,
  relationshipTypeDisplayMap,
  relationshipStatusDisplayMap,
  onDeleteRelationship,
  onEditRelationship,
  pagination,
  onTableChange,
}) => {

  const columns: ColumnsType<CharacterRelationship> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 70,
      sorter: true,
      align: 'center',
    },
    {
      title: <Space><UserOutlined />角色 A</Space>,
      dataIndex: 'character_a_id',
      key: 'character_a_id',
      sorter: true,
      render: (character_a_id: number, record: CharacterRelationship) => (
        <Tooltip title={`角色ID: ${character_a_id}`}>
          <AntLink onClick={() => onEditRelationship(record)}>
            {characterMap[character_a_id] || `未知角色 (ID: ${character_a_id})`}
          </AntLink>
        </Tooltip>
      ),
    },
    {
      title: <Space><LinkOutlined />关系类型</Space>,
      dataIndex: 'relationship_type',
      key: 'relationship_type',
      width: 160,
      sorter: true,
      align: 'center',
      render: (type: RelationshipTypeEnum | string) => {
        const display = relationshipTypeDisplayMap[type as string] || { label: String(type), color: 'default' };
        return <Tag color={display.color}>{display.label}</Tag>;
      },
    },
    {
      title: <Space><UserOutlined />角色 B</Space>,
      dataIndex: 'character_b_id',
      key: 'character_b_id',
      sorter: true,
      render: (character_b_id: number, record: CharacterRelationship) => (
         <Tooltip title={`角色ID: ${character_b_id}`}>
          <AntLink onClick={() => onEditRelationship(record)}>
            {characterMap[character_b_id] || `未知角色 (ID: ${character_b_id})`}
          </AntLink>
        </Tooltip>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      sorter: true,
      align: 'center',
      render: (status: RelationshipStatusEnum | string) => {
        const display = relationshipStatusDisplayMap[status as string] || { label: String(status), color: 'default' };
        return <Tag color={display.color}>{display.label}</Tag>;
      },
    },
    {
      title: <Space><ReadOutlined />描述</Space>,
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (description: string | null) => (
        <Tooltip title={description || '无描述'}>
          {description || <Text type="secondary" italic>无</Text>}
        </Tooltip>
      ),
    },
    {
      title: '动态变化',
      dataIndex: 'dynamic_changes',
      key: 'dynamic_changes',
      width: 220,
      render: (changes: DynamicChange[] | undefined) => {
        if (!changes || changes.length === 0) return <Text type="secondary" italic>无动态变化</Text>;
        const displayChanges = changes.slice(0, 2); // 最多显示前两条
        const fullTooltipContent = (
            <div style={{maxWidth: 400, whiteSpace: 'pre-wrap'}}>
            {changes.map((change, index) => (
              <div key={index} style={{marginBottom: index < changes.length -1 ? 8 : 0}}>
                <Text strong>
                  {change.chapter_index !== null && change.chapter_index !== undefined ? `章节 ${change.chapter_index + 1}: ` : ''}
                  {change.event_trigger ? `(事件: ${change.event_trigger}) ` : ''}
                </Text>
                <Text>{change.change_description}</Text>
              </div>
            ))}
          </div>
        );

        return (
          <Tooltip
            placement="topLeft"
            title={fullTooltipContent}
          >
            <Paragraph ellipsis={{ rows: 2, expandable: false, symbol: () => <EyeOutlined/> }} style={{marginBottom:0}}>
                 {displayChanges.map(c => `[${c.chapter_index !== null ? `Ch.${c.chapter_index + 1}`:''}${c.event_trigger ? ` Evt:${c.event_trigger.substring(0,10)}...`:''}] ${c.change_description}`).join('; ')}
                 {changes.length > 2 && ' ...'}
            </Paragraph>
          </Tooltip>
        );
      }
    },
    {
      title: <Space><ApartmentOutlined />剧情版本</Space>,
      dataIndex: 'plot_version_id',
      key: 'plot_version_id',
      width: 150,
      sorter: true,
      render: (plotVersionId: number | null) => {
        const versionName = plotVersionId ? (plotVersionsMap[plotVersionId] || `版本ID: ${plotVersionId}`) : null;
        return versionName ? <Tag color="purple">{versionName}</Tag> : <Text type="secondary" italic>通用关系</Text>;
      }
    },
    {
      title: '操作',
      key: 'action',
      align: 'center',
      width: 100,
      fixed: 'right',
      render: (_: any, record: CharacterRelationship) => (
        <Space size="small">
          <Tooltip title="编辑此关系">
            <Button icon={<EditOutlined />} onClick={() => onEditRelationship(record)} size="small" type="text" />
          </Tooltip>
          <Popconfirm
            title={<Text>确定删除此人物关系吗？<br/>({characterMap[record.character_a_id] || '角色A'} - {relationshipTypeDisplayMap[record.relationship_type as string]?.label || record.relationship_type} - {characterMap[record.character_b_id] || '角色B'})</Text>}
            description="此操作不可撤销。"
            onConfirm={async () => {
              if (!novelId) { message.error("小说ID无效，无法删除。"); return; }
              onDeleteRelationship(record.id); // 父组件将处理实际的删除逻辑和toast
            }}
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
            placement="topRight"
          >
            <Tooltip title="删除此关系">
              <Button icon={<DeleteOutlined />} danger type="text" size="small" />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className={styles.relationshipListContainerAntd}> {/* 使用您定义的CSS模块类名 */}
      <Table<CharacterRelationship>
        columns={columns}
        dataSource={relationships}
        loading={isLoading}
        rowKey="id"
        pagination={pagination}
        onChange={onTableChange}
        scroll={{ x: 1600, y: 'calc(100vh - 460px)' }} // 根据列数和内容调整 x 值
        size="middle"
        bordered
        className={styles.relationshipTableAntd} // 使用您定义的CSS模块类名
        locale={{ emptyText: <Empty description="暂无人物关系数据或未匹配到结果。" /> }}
      />
    </div>
  );
};

export default CharacterRelationshipList;