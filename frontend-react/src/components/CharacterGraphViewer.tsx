// frontend-react/src/components/CharacterGraphViewer.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo, CSSProperties, ChangeEvent } from 'react';
// 明确导入 vis-network 的核心类和类型
import { Network, DataSet, Edge as VisEdgeOriginal, Node as VisNodeOriginal, Options as VisOptions, Data as VisData } from 'vis-network/standalone/esm/vis-network';
import 'vis-network/styles/vis-network.css'; // 导入 vis-network 的样式

// 从 API 服务导入核心类型和函数
import {
    Character,
    CharacterRelationship,
    RelationshipTypeEnum, // 关系类型枚举
    getCharactersByNovelId,
    getCharacterRelationshipsByNovelId,
    // Novel, // 如果需要在工具提示或详情中显示小说信息
} from '../services/api';
import styles from './CharacterGraphViewer.module.css'; // 组件特定样式

// 导入 lucide-react 图标 (与您上传的文件一致)
import {
    Loader, AlertTriangle, Users2 as CharacterGraphIcon, Link2, Maximize2, RefreshCw, HelpCircle,
    UserCircle, X as CloseIcon, Users, Briefcase, Heart, ShieldOff, UserCheck, UserCog, Filter,
    LayoutGrid, Rows, Eye, MessageSquare, ChevronsUpDown
} from 'lucide-react';
import { toast } from 'react-toastify';

// --- vis-network 节点和边的扩展类型定义 ---
// 扩展 vis-network 的 Node 类型以包含应用特定的角色数据
interface CharVisNode extends VisNodeOriginal {
    id: number; // 对应 Character 的 ID
    label: string; // 节点上显示的文本 (角色名)
    title?: string; // HTML 格式的工具提示内容
    group?: string; // 用于节点分组，例如按角色类型 (protagonist, antagonist, supporting)
    shape?: string; // 节点形状
    image?: string; // 角色头像URL (如果 Character 类型中有 avatar_url 字段)
    color?: string | { border: string; background: string; highlight?: { border: string; background: string; }; hover?: { border: string; background: string; } };
    originalCharacter: Character; // 存储原始角色数据
    hidden?: boolean; // 控制节点是否可见 (用于筛选)
    level?: number; // 用于层次布局 (如果适用)
}

// 扩展 vis-network 的 Edge 类型以包含应用特定的关系数据
interface CharVisEdge extends VisEdgeOriginal {
    id: string; // 边的唯一ID (例如: "char1Id-char2Id-type" 或关系ID)
    from: number; // 起始角色节点的 ID
    to: number;   // 目标角色节点的 ID
    label?: string; // 边上显示的文本 (关系类型)
    title?: string; // HTML 格式的工具提示内容
    arrows?: string; // 箭头样式
    color?: string | { color?: string; highlight?: string; hover?: string; inherit?: boolean | string; opacity?: number; };
    dashes?: boolean | number[]; // 虚线样式
    originalRelationship: CharacterRelationship; // 存储原始关系数据
    hidden?: boolean; // 控制边是否可见
}

// 角色详情模态框的 Props 接口
interface CharacterDetailModalProps {
    character: Character | null; // 当前选中的角色
    isOpen: boolean;             // 模态框是否打开
    onClose: () => void;         // 关闭模态框的回调
    allCharacters: Character[];  // 所有角色，用于查找关联角色的名称
    allRelationships: CharacterRelationship[]; // 所有关系，用于显示与此角色相关的关系
    onNavigateToCharacter?: (characterId: number) => void; // 点击关联角色时的导航回调
}


// --- 子组件：角色详情模态框 (与您上传的文件一致，仅更新类型和逻辑) ---
const CharacterDetailModal: React.FC<CharacterDetailModalProps> = ({
    character, isOpen, onClose, allCharacters, allRelationships, onNavigateToCharacter
}) => {
    if (!isOpen || !character) return null;

    // 查找与当前角色相关的关系
    const relatedRelationships = allRelationships.filter(
        rel => rel.character1_id === character.id || rel.character2_id === character.id
    );

    // 获取关联角色的名称
    const getCharacterNameById = (id: number): string => allCharacters.find(c => c.id === id)?.name || `角色ID ${id}`;
    // 获取关系类型的友好显示 (与 CharacterRelationshipList 中的一致)
    const getRelationshipTypeLabel = (type: RelationshipTypeEnum | string): string => {
        switch (type) {
            case RelationshipTypeEnum.FAMILY: return "亲情";
            case RelationshipTypeEnum.FRIENDSHIP: return "友情";
            case RelationshipTypeEnum.ROMANCE: return "爱情";
            case RelationshipTypeEnum.ALLIANCE: return "同盟";
            case RelationshipTypeEnum.RIVALRY: return "竞争";
            case RelationshipTypeEnum.MENTORSHIP: return "师徒";
            case RelationshipTypeEnum.ENMITY: return "敌对";
            default: return typeof type === 'string' ? type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : "其他";
        }
    };

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h3><UserCircle size={20} className="me-2"/>角色详情: {character.name}</h3>
                    <button onClick={onClose} className={styles.modalCloseButton} title="关闭详情">
                        <CloseIcon size={22} />
                    </button>
                </div>
                <div className={styles.modalBody}>
                    <p><strong>ID:</strong> {character.id}</p>
                    <p><strong>核心设定:</strong> {character.core_setting || "无"}</p>
                    <p><strong>角色类型/定位:</strong> {character.role_type || "未指定"}</p>
                    <p><strong>性格特点:</strong> {character.personality_traits || "未指定"}</p>
                    <p><strong>外貌描述:</strong> {character.appearance_description || "未指定"}</p>
                    <p><strong>背景故事:</strong> {character.background_story || "未指定"}</p>
                    <p><strong>标签:</strong> {(character.tags && character.tags.length > 0) ? character.tags.join(', ') : "无"}</p>

                    {relatedRelationships.length > 0 && (
                        <div className={styles.relatedItemsSection}>
                            <strong>相关角色关系:</strong>
                            <ul>
                                {relatedRelationships.map(rel => {
                                    const otherCharId = rel.character1_id === character.id ? rel.character2_id : rel.character1_id;
                                    const otherCharName = getCharacterNameById(otherCharId);
                                    return (
                                        <li key={`rel-${rel.id}`}>
                                            <Users size={12} className="me-1" />
                                            与
                                            <span className={styles.relatedEntityLink} onClick={() => onNavigateToCharacter?.(otherCharId)} title={`点击查看角色: ${otherCharName}`}>
                                                {otherCharName}
                                            </span>
                                            的关系:
                                            <span className={styles.relationshipTypeTag}>
                                                {getRelationshipTypeLabel(rel.relationship_type)}
                                            </span>
                                            {rel.description && <span className={styles.relationshipDescriptionModal}> ({rel.description})</span>}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
                </div>
                <div className={styles.modalFooter}>
                    <button className="btn btn-sm btn-secondary" onClick={onClose}>关闭</button>
                </div>
            </div>
        </div>
    );
};


// --- 主组件：CharacterGraphViewer ---
interface CharacterGraphViewerProps {
    novelId: number; // 当前小说的ID
    // 可选：小说中所有角色的列表，如果父组件已加载则传入，否则组件内部加载
    initialCharacters?: Character[];
    // 可选：小说中所有角色关系的列表，如果父组件已加载则传入，否则组件内部加载
    initialRelationships?: CharacterRelationship[];
    onNodeClick?: (character: Character) => void; // 节点点击回调 (可选)
    height?: string; // 图谱容器高度 (可选)
}

const CharacterGraphViewer: React.FC<CharacterGraphViewerProps> = ({
    novelId,
    initialCharacters,
    initialRelationships,
    onNodeClick,
    height = '600px' // 默认高度
}) => {
    // --- Refs ---
    const networkRef = useRef<HTMLDivElement>(null); // 图谱容器的 DOM 引用
    const visNetworkInstanceRef = useRef<Network | null>(null); // vis-network 实例的引用
    const allCharactersRef = useRef<Character[]>(initialCharacters || []); // 存储所有角色数据
    const allCharacterRelationshipsRef = useRef<CharacterRelationship[]>(initialRelationships || []); // 存储所有关系数据

    // --- State ---
    const [nodes, setNodes] = useState<DataSet<CharVisNode>>(new DataSet<CharVisNode>([]));
    const [edges, setEdges] = useState<DataSet<CharVisEdge>>(new DataSet<CharVisEdge>([]));
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    // 交互和UI状态
    const [selectedCharForModal, setSelectedCharForModal] = useState<Character | null>(null);
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    // 筛选：可以按角色类型 (role_type) 或其他 Character 属性进行筛选
    const [roleTypeFilter, setRoleTypeFilter] = useState<string>('all'); // 示例筛选器
    const [availableRoleTypes, setAvailableRoleTypes] = useState<string[]>([]); // 从角色数据中提取的可用类型
    const [layoutMode, setLayoutMode] = useState<'hierarchical' | 'forceDirected'>('forceDirected'); // 默认力导向

    // --- 数据转换函数 ---
    // 将 Character[] 转换为 CharVisNode[]
    const charactersToVisNodes = useCallback((characters: Character[], currentRoleFilter: string): CharVisNode[] => {
        return characters.map(char => {
            const isVisible = currentRoleFilter === 'all' || (char.role_type === currentRoleFilter);
            let nodeShape: string = 'ellipse'; // 默认形状
            let nodeColor = '#97C2FC'; // 默认颜色 (淡蓝色)
            
            // 根据角色类型设置不同形状和颜色 (示例)
            switch (char.role_type?.toLowerCase()) {
                case 'protagonist': case 'main_character': nodeShape = 'star'; nodeColor = '#FFD700'; break; // 主角 - 星形，金色
                case 'antagonist': nodeShape = 'hexagon'; nodeColor = '#DC143C'; break; // 反派 - 六边形，深红色
                case 'supporting_character': nodeShape = 'box'; nodeColor = '#87CEEB'; break; // 配角 - 方形，天蓝色
                case 'minor_character': nodeShape = 'dot'; nodeColor = '#D3D3D3'; break; // 次要角色 - 点，浅灰色
                default: break;
            }
            if (char.avatar_url) nodeShape = 'image'; // 如果有头像，则用图片形状

            const label = char.name.length > 15 ? char.name.substring(0, 12) + '...' : char.name;
            let tooltipContent = `<strong>${DOMPurify.sanitize(char.name)}</strong> (ID: ${char.id})<br/>`;
            if (char.role_type) tooltipContent += `类型: ${DOMPurify.sanitize(char.role_type)}<br/>`;
            if (char.core_setting) tooltipContent += `核心设定: ${DOMPurify.sanitize(char.core_setting.substring(0,100) + (char.core_setting.length > 100 ? '...' : ''))}<br/>`;

            return {
                id: char.id,
                label: label,
                title: tooltipContent,
                group: char.role_type || 'unknown_role',
                shape: nodeShape,
                image: char.avatar_url || undefined, // 如果是 image形状，则提供URL
                color: nodeShape === 'image' ? undefined : nodeColor, // 图片节点颜色由图片本身决定
                originalCharacter: char,
                hidden: !isVisible,
            };
        });
    }, []);

    // 将 CharacterRelationship[] 转换为 CharVisEdge[]
    const relationshipsToVisEdges = useCallback((relationships: CharacterRelationship[], currentNodes: CharVisNode[]): CharVisEdge[] => {
        const visibleNodeIds = new Set(currentNodes.filter(n => !n.hidden).map(n => n.id)); // 只连接可见节点
        return relationships
            .filter(rel => visibleNodeIds.has(rel.character1_id) && visibleNodeIds.has(rel.character2_id))
            .map(rel => {
                let edgeColor = '#848484'; // 默认关系颜色
                let arrows = ''; // 默认无箭头 (例如友情)
                let dashes = false; // 默认实线

                switch (rel.relationship_type) {
                    case RelationshipTypeEnum.FAMILY: edgeColor = '#2E8B57'; break; // 家庭 - 海绿色
                    case RelationshipTypeEnum.FRIENDSHIP: edgeColor = '#4682B4'; break; // 友情 - 钢蓝色
                    case RelationshipTypeEnum.ROMANCE: edgeColor = '#FF69B4'; arrows = 'to;from'; break; // 爱情 - 深粉色, 双箭头
                    case RelationshipTypeEnum.ALLIANCE: edgeColor = '#32CD32'; dashes = true; break; // 同盟 - 酸橙绿, 虚线
                    case RelationshipTypeEnum.RIVALRY: edgeColor = '#FF8C00'; arrows = 'to;from'; dashes = true; break; // 竞争 - 暗橙色, 双向虚线箭头
                    case RelationshipTypeEnum.MENTORSHIP: edgeColor = '#8A2BE2'; arrows = 'to'; break; // 师徒 - 蓝紫色, 单向箭头
                    case RelationshipTypeEnum.ENMITY: edgeColor = '#DC143C'; dashes = true; arrows = 'to;from'; break; // 敌对 - 深红色, 双向虚线
                    default: break;
                }
                return {
                    id: `charRel-${rel.character1_id}-${rel.character2_id}-${rel.relationship_type}-${rel.id || Math.random()}`,
                    from: rel.character1_id,
                    to: rel.character2_id,
                    label: rel.relationship_type.replace(/_/g, ' '),
                    title: `关系: ${rel.relationship_type}<br>描述: ${rel.description || '无'}`,
                    arrows: arrows,
                    color: { color: edgeColor, highlight: '#FF0000', hover: '#C0C0C0' },
                    dashes: dashes,
                    originalRelationship: rel,
                };
        });
    }, []);

    // --- 数据加载与图谱更新 ---
    const loadGraphData = useCallback(async () => {
        if (!novelId) return;
        setIsLoading(true); setError(null);
        try {
            // 如果 initialCharacters 和 initialRelationships 已提供，则使用它们
            let charactersData = initialCharacters;
            let relationshipsData = initialRelationships;

            if (!charactersData) {
                charactersData = await getCharactersByNovelId(novelId);
            }
            if (!relationshipsData) {
                relationshipsData = await getCharacterRelationshipsByNovelId(novelId);
            }
            
            allCharactersRef.current = charactersData || [];
            allCharacterRelationshipsRef.current = relationshipsData || [];

            // 从角色数据中提取所有唯一的角色类型用于筛选器
            const roleTypes = new Set(allCharactersRef.current.map(char => char.role_type).filter(Boolean) as string[]);
            setAvailableRoleTypes(Array.from(roleTypes).sort());
            
            updateGraphVisualization(allCharactersRef.current, allCharacterRelationshipsRef.current, roleTypeFilter, layoutMode);

        } catch (err: any) {
            const msg = `加载角色图谱数据失败: ${err.message || '未知错误'}`;
            setError(msg); toast.error(msg);
        } finally {
            setIsLoading(false);
        }
    }, [novelId, initialCharacters, initialRelationships, roleTypeFilter, layoutMode, charactersToVisNodes, relationshipsToVisEdges]); // 添加 layoutMode

    // 更新图谱显示 (节点、边、布局)
    const updateGraphVisualization = useCallback((
        currentCharacters: Character[],
        currentRelationships: CharacterRelationship[],
        currentRoleFilter: string,
        currentLayoutMode: 'hierarchical' | 'forceDirected'
    ) => {
        const visNodesArray = charactersToVisNodes(currentCharacters, currentRoleFilter);
        const visibleVisNodes = visNodesArray.filter(n => !n.hidden);
        const visEdgesArray = relationshipsToVisEdges(currentRelationships, visibleVisNodes);
        
        setNodes(new DataSet<CharVisNode>(visNodesArray));
        setEdges(new DataSet<CharVisEdge>(visEdgesArray));

        if (visNetworkInstanceRef.current) {
            visNetworkInstanceRef.current.setOptions(getGraphOptions(currentLayoutMode));
             // visNetworkInstanceRef.current.setData({ nodes: new DataSet<CharVisNode>(visNodesArray), edges: new DataSet<CharVisEdge>(visEdgesArray) });
            visNetworkInstanceRef.current.fit();
        }
    }, [charactersToVisNodes, relationshipsToVisEdges, getGraphOptions]); // getGraphOptions 依赖 layoutMode

    useEffect(() => {
        loadGraphData();
    }, [loadGraphData]);

    // 监听筛选或布局模式变化
    useEffect(() => {
        if (allCharactersRef.current.length > 0 || allCharacterRelationshipsRef.current.length > 0) {
             updateGraphVisualization(allCharactersRef.current, allCharacterRelationshipsRef.current, roleTypeFilter, layoutMode);
        }
    }, [roleTypeFilter, layoutMode, updateGraphVisualization]);


    // --- 图谱配置选项 ---
    const getGraphOptions = useCallback((currentLayout: 'hierarchical' | 'forceDirected'): VisOptions => {
        const commonInteractionOptions = {
            hover: true, dragNodes: true, dragView: true, zoomView: true,
            tooltipDelay: 200, navigationButtons: false, keyboard: { enabled: true },
        };
        const commonNodeOptions = {
            borderWidth: 1, borderWidthSelected: 3,
            font: { size: 12, face: 'Arial', color: '#333' },
            shapeProperties: { useBorderWithImage: true, interpolation: false }, // interpolation false for crisp images
            shadow: { enabled: true, color: 'rgba(0,0,0,0.2)', size:5, x:2, y:2},
        };
        const commonEdgeOptions = {
            width: 1, selectionWidth: w => w*2,
            font: { size: 10, align: 'middle', color: '#555', strokeWidth: 3, strokeColor: '#ffffff' }, // 添加描边以提高可读性
            smooth: { type: 'dynamic' }, // 力导向时用动态平滑
            color: { inherit: 'from' }, // 边颜色可以从起始节点继承部分特性
        };

        let layoutSpecificOptions: VisOptions['layout'] = {};
        let physicsSpecificOptions: VisOptions['physics'] = { enabled: false }; // 默认禁用物理引擎

        if (currentLayout === 'hierarchical') {
            layoutSpecificOptions = {
                hierarchical: {
                    enabled: true, direction: 'UD', sortMethod: 'hubsize', // 按连接数排序
                    levelSeparation: 150, nodeSpacing: 100, treeSpacing: 200,
                    blockShifting: true, edgeMinimization: true, parentCentralization: true,
                },
            };
            commonEdgeOptions.smooth = { type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.4 };
        } else { // forceDirected
            physicsSpecificOptions = {
                enabled: true,
                forceAtlas2Based: { // 使用更现代的力导向算法
                    gravitationalConstant: -50,
                    centralGravity: 0.01,
                    springLength: 100,
                    springConstant: 0.08,
                    damping: 0.4,
                    avoidOverlap: 0.5 // 避免节点重叠
                },
                solver: 'forceAtlas2Based', // 'barnesHut', 
                stabilization: { iterations: 200, fit: true },
            };
        }

        return {
            autoResize: true,
            nodes: commonNodeOptions,
            edges: commonEdgeOptions,
            physics: physicsSpecificOptions,
            layout: layoutSpecificOptions,
            interaction: commonInteractionOptions,
            groups: { // 可以为不同角色类型定义组样式
                protagonist: { color: { background: '#FFD700', border: '#DAA520' }, shape: 'star' },
                antagonist: { color: { background: '#DC143C', border: '#B22222' }, shape: 'hexagon' },
                supporting_character: { color: { background: '#87CEEB', border: '#4682B4' }, shape: 'box' },
                // ... 其他 role_type
                unknown_role: { color: { background: '#ECEFF1', border: '#90A4AE' }, shape: 'ellipse' }
            }
        };
    }, []);

    // --- vis-network 实例初始化与事件绑定 ---
    useEffect(() => {
        if (networkRef.current && nodes.get().length > 0) {
            if (!visNetworkInstanceRef.current) {
                const data: VisData = { nodes, edges };
                const options = getGraphOptions(layoutMode);
                const network = new Network(networkRef.current, data, options);
                visNetworkInstanceRef.current = network;

                network.on('selectNode', (params) => {
                    if (params.nodes.length > 0) {
                        const selectedNodeId = params.nodes[0] as number;
                        const charData = allCharactersRef.current.find(c => c.id === selectedNodeId);
                        if (charData) {
                            setSelectedCharForModal(charData);
                            setIsModalOpen(true);
                            onNodeClick?.(charData);
                        }
                    }
                });
                network.on("stabilizationIterationsDone", () => { network.fit(); });

            } else {
                visNetworkInstanceRef.current.setData({ nodes, edges });
                visNetworkInstanceRef.current.setOptions(getGraphOptions(layoutMode));
            }
        }
        return () => {
            if (visNetworkInstanceRef.current) {
                visNetworkInstanceRef.current.destroy();
                visNetworkInstanceRef.current = null;
            }
        };
    }, [nodes, edges, layoutMode, getGraphOptions, onNodeClick]);

    // --- UI 控制函数 ---
    const handleRefreshGraph = () => loadGraphData();
    const fitGraphToView = () => visNetworkInstanceRef.current?.fit();
    const handleCloseModal = () => setIsModalOpen(false);
    const navigateAndFocusNode = (characterId: number) => {
        setIsModalOpen(false);
        if (visNetworkInstanceRef.current) {
            visNetworkInstanceRef.current.focus(characterId, { scale: 1.5, animation: true });
            visNetworkInstanceRef.current.selectNodes([characterId]);
        }
    };

    const noDataAfterFilter = useMemo(() => {
        if (isLoading || !allCharactersRef.current) return false;
        const visibleNodes = charactersToVisNodes(allCharactersRef.current, roleTypeFilter).filter(n => !n.hidden);
        return visibleNodes.length === 0 && allCharactersRef.current.length > 0;
    }, [isLoading, roleTypeFilter, charactersToVisNodes]);
    const trulyNoData = !isLoading && allCharactersRef.current.length === 0;


    return (
        <div className={styles.graphViewerContainer} style={{ height }}>
            {/* 工具栏 */}
            <div className={styles.toolbar}>
                <div className={styles.filterControls}>
                    <Filter size={16} className={styles.toolbarIcon}/>
                    <label htmlFor="roleTypeFilterGraph" className={styles.toolbarLabel}>筛选角色类型:</label>
                    <select
                        id="roleTypeFilterGraph"
                        value={roleTypeFilter}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => setRoleTypeFilter(e.target.value)}
                        className={styles.toolbarSelect}
                        disabled={isLoading || availableRoleTypes.length === 0}
                    >
                        <option value="all">所有类型</option>
                        {availableRoleTypes.map(role => (
                            <option key={role} value={role}>{role.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>
                        ))}
                    </select>
                </div>
                 <div className={styles.layoutControls}>
                    <LayoutGrid size={16} className={styles.toolbarIcon}/>
                    <label htmlFor="layoutModeCharGraph" className={styles.toolbarLabel}>布局模式:</label>
                    <select
                        id="layoutModeCharGraph"
                        value={layoutMode}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => setLayoutMode(e.target.value as 'hierarchical' | 'forceDirected')}
                        className={styles.toolbarSelect}
                        disabled={isLoading}
                    >
                        <option value="forceDirected">力导向</option>
                        <option value="hierarchical">层次结构</option>
                    </select>
                </div>
                <div className={styles.actionButtons}>
                    <button onClick={handleRefreshGraph} className="btn btn-xs btn-icon" title="刷新图谱数据" disabled={isLoading}><RefreshCw size={14} className={isLoading ? "spinning-icon" : ""} /></button>
                    <button onClick={fitGraphToView} className="btn btn-xs btn-icon" title="自适应缩放图谱" disabled={!visNetworkInstanceRef.current || nodes.get().length === 0 || isLoading}><Maximize2 size={14} /></button>
                    <HelpCircle size={16} className={styles.helpIconGraph} title="拖拽节点调整布局，滚轮缩放。点击节点查看详情。" />
                </div>
            </div>
            {isLoading && allCharactersRef.current.length === 0 && ( <div className={styles.fullPageLoadingGraph}> <Loader size={28} className="spinning-icon" /> 正在加载角色图谱... </div> )}
            {error && ( <div className={styles.fullPageErrorGraph}> <AlertTriangle size={28} className="me-2" /> {error} </div> )}

            <div ref={networkRef} className={styles.networkCanvas} style={{ height: `calc(${height} - 40px)` }}>
                {noDataAfterFilter && !isLoading && <div className={styles.emptyGraphPlaceholder}><Filter size={24} className="mb-2"/>当前筛选条件下无角色可显示。</div>}
                {trulyNoData && !isLoading && !noDataAfterFilter && <div className={styles.emptyGraphPlaceholder}><Info size={24} className="mb-2"/>暂无角色数据可供展示。</div>}
            </div>

            <CharacterDetailModal
                character={selectedCharForModal}
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                allCharacters={allCharactersRef.current}
                allRelationships={allCharacterRelationshipsRef.current}
                onNavigateToCharacter={navigateAndFocusNode}
            />
        </div>
    );
};

export default CharacterGraphViewer;