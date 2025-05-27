// frontend-react/src/components/EventGraphViewer.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo, CSSProperties } from 'react';
// 明确导入 vis-network 的核心类和类型
import { Network, DataSet, Edge as VisEdgeOriginal, Node as VisNodeOriginal, Options as VisOptions, Data as VisData } from 'vis-network/standalone/esm/vis-network';
import 'vis-network/styles/vis-network.css'; // 导入 vis-network 的样式

// 从 API 服务导入核心类型和函数
import {
    Event as NovelEvent, // 后端 Event schema，在前端用 NovelEvent 别名
    EventRelationship,   // 事件关系类型
    Character,           // 角色类型 (如果事件详情中需要显示)
    Chapter,             // 章节类型 (用于筛选和节点分组)
    getEventsByNovelId,
    getAllEventRelationshipsByNovelId,
    EventRelationshipTypeEnum, // 事件关系类型枚举
} from '../services/api';
import styles from './EventGraphViewer.module.css'; // 组件特定样式

// 导入 lucide-react 图标 (与您上传的文件一致)
import {
    Loader, AlertTriangle, Zap, Link2, Maximize2, RefreshCw, HelpCircle, Share2, X as CloseIcon,
    Users, CalendarDays, MapPin, FileText as DescriptionIcon, BookOpen, Star, Filter, Layers, ArrowRightCircle, ArrowLeftCircle,
    LayoutGrid, Rows, Eye, ChevronsUpDown
} from 'lucide-react';
import { toast } from 'react-toastify';

// --- vis-network 节点和边的扩展类型定义 ---
// 扩展 vis-network 的 Node 类型以包含应用特定的数据
interface VisNode extends VisNodeOriginal {
    id: number; // 对应 NovelEvent 的 ID
    label: string; // 节点上显示的文本
    title?: string; // HTML 格式的工具提示内容
    group?: string | number; // 用于节点分组，例如按章节 ID
    shape?: string; // 节点形状
    color?: string | { border: string; background: string; highlight?: { border: string; background: string; }; hover?: { border: string; background: string; } }; // 节点颜色
    originalEvent: NovelEvent; // 存储原始事件数据，方便在点击等事件中使用
    hidden?: boolean; // 控制节点是否可见 (用于筛选)
    level?: number; // 用于层次布局
}

// 扩展 vis-network 的 Edge 类型以包含应用特定的数据
interface VisEdge extends VisEdgeOriginal {
    id: string; // 边的唯一ID (例如: "fromId-toId-type" 或关系ID)
    from: number; // 起始事件节点的 ID
    to: number;   // 目标事件节点的 ID
    label?: string; // 边上显示的文本 (关系类型)
    title?: string; // HTML 格式的工具提示内容
    arrows?: string; // 箭头样式
    color?: string | { color?: string; highlight?: string; hover?: string; inherit?: boolean | string; opacity?: number; };
    dashes?: boolean | number[]; // 虚线样式
    originalRelationship?: EventRelationship; // 存储原始关系数据
    hidden?: boolean; // 控制边是否可见 (用于筛选)
}

// 事件详情模态框的 Props 接口
interface EventDetailModalProps {
    event: NovelEvent | null; // 当前选中的事件
    isOpen: boolean;          // 模态框是否打开
    onClose: () => void;      // 关闭模态框的回调
    chapterMap: Map<number, Chapter>; // 章节 ID 到章节对象的映射，用于显示章节名
    allEvents: NovelEvent[]; // 所有事件，用于查找关联事件的名称
    allRelationships: EventRelationship[]; // 所有关系，用于显示与此事件相关的关系
    onNavigateToEvent?: (eventId: number) => void; // 点击关联事件时的导航回调
}

// --- 子组件：事件详情模态框 (与您上传的文件一致，仅更新类型) ---
const EventDetailModal: React.FC<EventDetailModalProps> = ({
    event, isOpen, onClose, chapterMap, allEvents, allRelationships, onNavigateToEvent
}) => {
    if (!isOpen || !event) return null;

    // 查找与当前事件相关的输入和输出关系
    const incomingRelationships = allRelationships.filter(rel => rel.to_event_id === event.id);
    const outgoingRelationships = allRelationships.filter(rel => rel.from_event_id === event.id);

    // 获取关联事件的名称
    const getEventNameById = (id: number): string => allEvents.find(e => e.id === id)?.name || `事件ID ${id}`;

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h3><Zap size={20} className="me-2"/>事件详情: {event.name}</h3>
                    <button onClick={onClose} className={styles.modalCloseButton} title="关闭详情">
                        <CloseIcon size={22} />
                    </button>
                </div>
                <div className={styles.modalBody}>
                    <p><strong>ID:</strong> {event.id}</p>
                    <p><strong>描述:</strong> {event.description || "无"}</p>
                    <p><strong>章节:</strong> {event.chapter_id ? (chapterMap.get(event.chapter_id)?.title || `章节ID ${event.chapter_id}`) : "未指定"}</p>
                    <p><strong>发生时间/顺序:</strong> {event.timestamp || event.sequence_in_chapter?.toString() || "未指定"}</p>
                    <p><strong>地点:</strong> {event.location || "未指定"}</p>
                    <p><strong>涉及角色 (IDs):</strong> {event.involved_character_ids && event.involved_character_ids.length > 0 ? event.involved_character_ids.join(', ') : "无"}</p>
                    <p><strong>重要性:</strong> {event.significance || "未指定"}</p>

                    {incomingRelationships.length > 0 && (
                        <div className={styles.relatedEventsSection}>
                            <strong>前置事件/原因:</strong>
                            <ul>
                                {incomingRelationships.map(rel => (
                                    <li key={`in-${rel.id}`}>
                                        <ArrowLeftCircle size={12} className="me-1" />
                                        <span className={styles.relatedEventLink} onClick={() => onNavigateToEvent?.(rel.from_event_id)} title={`点击查看事件: ${getEventNameById(rel.from_event_id)}`}>
                                            {getEventNameById(rel.from_event_id)}
                                        </span>
                                        <span className={styles.relationshipTypeTag}>({rel.relationship_type})</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {outgoingRelationships.length > 0 && (
                        <div className={styles.relatedEventsSection}>
                            <strong>后续事件/影响:</strong>
                            <ul>
                                {outgoingRelationships.map(rel => (
                                    <li key={`out-${rel.id}`}>
                                        <ArrowRightCircle size={12} className="me-1" />
                                        <span className={styles.relatedEventLink} onClick={() => onNavigateToEvent?.(rel.to_event_id)} title={`点击查看事件: ${getEventNameById(rel.to_event_id)}`}>
                                            {getEventNameById(rel.to_event_id)}
                                        </span>
                                        <span className={styles.relationshipTypeTag}>({rel.relationship_type})</span>
                                    </li>
                                ))}
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


// --- 主组件：EventGraphViewer ---
interface EventGraphViewerProps {
    novelId: number; // 当前小说的ID
    chapters: Chapter[]; // 当前小说的所有章节列表 (用于筛选和分组)
    initialChapterIdFilter?: number | 'all'; // 初始章节筛选器
    onNodeClick?: (event: NovelEvent) => void; // 节点点击回调 (可选)
    height?: string; // 图谱容器高度 (可选)
}

const EventGraphViewer: React.FC<EventGraphViewerProps> = ({
    novelId,
    chapters,
    initialChapterIdFilter = 'all',
    onNodeClick,
    height = '600px' // 默认高度
}) => {
    // --- Refs ---
    const networkRef = useRef<HTMLDivElement>(null); // 图谱容器的 DOM 引用
    const visNetworkInstanceRef = useRef<Network | null>(null); // vis-network 实例的引用
    const allEventsRef = useRef<NovelEvent[]>([]); // 存储从API获取的所有事件数据
    const allRelationshipsRef = useRef<EventRelationship[]>([]); // 存储从API获取的所有关系数据

    // --- State ---
    const [nodes, setNodes] = useState<DataSet<VisNode>>(new DataSet<VisNode>([])); // 图谱节点
    const [edges, setEdges] = useState<DataSet<VisEdge>>(new DataSet<VisEdge>([])); // 图谱边
    const [isLoading, setIsLoading] = useState<boolean>(true); // 加载状态
    const [error, setError] = useState<string | null>(null);   // 错误信息

    // 交互和UI状态
    const [selectedEventForModal, setSelectedEventForModal] = useState<NovelEvent | null>(null); // 模态框中显示的事件
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false); // 控制模态框显示
    const [currentChapterFilter, setCurrentChapterFilter] = useState<number | 'all'>(initialChapterIdFilter); // 章节筛选
    const [layoutMode, setLayoutMode] = useState<'hierarchical' | 'forceDirected'>('hierarchical'); // 布局模式

    // 将章节列表转换为 Map 方便查找
    const chapterMap = useMemo(() => {
        const map = new Map<number, Chapter>();
        chapters.forEach(chapter => map.set(chapter.id, chapter));
        return map;
    }, [chapters]);

    // --- 数据转换函数 ---
    // 将 NovelEvent[] 转换为 VisNode[]
    const eventsToVisNodes = useCallback((novelEvents: NovelEvent[], chapterFilter: number | 'all'): VisNode[] => {
        return novelEvents.map(event => {
            const chapter = event.chapter_id ? chapterMap.get(event.chapter_id) : null;
            const isVisible = chapterFilter === 'all' || (event.chapter_id === chapterFilter);
            
            // 截断长标签
            const label = event.name.length > 25 ? event.name.substring(0, 22) + '...' : event.name;
            
            // 构建工具提示的HTML内容 (使用DOMPurify清理)
            let tooltipContent = `<strong>${DOMPurify.sanitize(event.name)}</strong><br/>`;
            tooltipContent += `ID: ${event.id}<br/>`;
            if (chapter) tooltipContent += `章节: ${DOMPurify.sanitize(chapter.title || `ID ${chapter.id}`)}<br/>`;
            if (event.timestamp) tooltipContent += `时间: ${DOMPurify.sanitize(event.timestamp)}<br/>`;
            if (event.location) tooltipContent += `地点: ${DOMPurify.sanitize(event.location)}<br/>`;
            if (event.description) tooltipContent += `描述: ${DOMPurify.sanitize(event.description.substring(0,100) + (event.description.length > 100 ? '...' : ''))}<br/>`;

            return {
                id: event.id,
                label: label,
                title: tooltipContent, // vis-network 会自动处理HTML title
                group: event.chapter_id?.toString() || 'unknown_chapter',
                shape: 'box', // 可以根据事件类型或其他属性改变形状
                color: chapter ? (chapter.color || undefined) : '#97C2FC', // 按章节使用不同颜色 (如果章节有颜色属性)
                originalEvent: event, // 存储原始事件对象
                hidden: !isVisible, // 根据筛选条件隐藏节点
                level: event.sequence_in_chapter ?? undefined, // 用于层次布局
            };
        });
    }, [chapterMap]);

    // 将 EventRelationship[] 转换为 VisEdge[]
    const relationshipsToVisEdges = useCallback((eventRelationships: EventRelationship[], currentNodes: VisNode[]): VisEdge[] => {
        const nodeIds = new Set(currentNodes.map(n => n.id)); // 获取当前所有可见节点的ID集合
        return eventRelationships
            .filter(rel => nodeIds.has(rel.from_event_id) && nodeIds.has(rel.to_event_id)) // 仅保留两端节点都存在的边
            .map(rel => {
                let edgeColor = '#848484'; // 默认颜色
                let arrows = 'to';
                let dashes = false; // 默认为实线

                switch (rel.relationship_type) {
                    case EventRelationshipTypeEnum.CAUSES:
                        edgeColor = '#FF69B4'; // 深粉色
                        arrows = 'to'; break;
                    case EventRelationshipTypeEnum.LEADS_TO:
                        edgeColor = '#32CD32'; // 酸橙绿
                        arrows = 'to'; break;
                    case EventRelationshipTypeEnum.PRECEDES:
                        edgeColor = '#1E90FF'; // 道奇蓝
                        arrows = 'to'; dashes = true; break; // 虚线表示较弱的顺序
                    case EventRelationshipTypeEnum.FOLLOWS: // 在图中与PRECEDES方向相反
                        edgeColor = '#1E90FF';
                        arrows = 'from'; dashes = true; break;
                    case EventRelationshipTypeEnum.RELATED_TO:
                        edgeColor = '#FFA500'; // 橙色
                        arrows = ''; break; // 无箭头表示双向或一般相关
                    default:
                        // 对于自定义的字符串类型，可以保留默认样式或添加逻辑
                        break;
                }
                return {
                    id: `rel-${rel.from_event_id}-${rel.to_event_id}-${rel.relationship_type}-${rel.id || Math.random()}`, // 确保ID唯一
                    from: rel.from_event_id,
                    to: rel.to_event_id,
                    label: rel.relationship_type,
                    title: `关系: ${rel.relationship_type}<br>描述: ${rel.description || '无'}`,
                    arrows: arrows,
                    color: { color: edgeColor, highlight: '#FF0000', hover: '#D3D3D3' },
                    dashes: dashes,
                    originalRelationship: rel, // 存储原始关系对象
                    // hidden 根据两端节点是否可见来决定 (已在 filter 中处理)
                };
        });
    }, []);

    // --- 数据加载与图谱更新 ---
    const loadGraphData = useCallback(async () => {
        if (!novelId) return;
        setIsLoading(true); setError(null);
        try {
            const [eventsData, relationshipsData] = await Promise.all([
                getEventsByNovelId(novelId),
                getAllEventRelationshipsByNovelId(novelId)
            ]);
            allEventsRef.current = eventsData || [];
            allRelationshipsRef.current = relationshipsData || [];
            
            updateGraphVisualization(allEventsRef.current, allRelationshipsRef.current, currentChapterFilter, layoutMode);

        } catch (err: any) {
            const msg = `加载事件图谱数据失败: ${err.message || '未知错误'}`;
            setError(msg); toast.error(msg);
        } finally {
            setIsLoading(false);
        }
    }, [novelId, currentChapterFilter, layoutMode, eventsToVisNodes, relationshipsToVisEdges]); // 添加 layoutMode

    // 更新图谱显示 (节点、边、布局)
    const updateGraphVisualization = useCallback((
        currentEvents: NovelEvent[],
        currentRelationships: EventRelationship[],
        chapterFilter: number | 'all',
        currentLayoutMode: 'hierarchical' | 'forceDirected'
    ) => {
        const visNodesArray = eventsToVisNodes(currentEvents, chapterFilter);
        const visibleVisNodes = visNodesArray.filter(n => !n.hidden); // 只处理可见节点

        const visEdgesArray = relationshipsToVisEdges(currentRelationships, visibleVisNodes); // 边只连接可见节点
        
        // 更新 DataSet，vis-network 会自动处理差异渲染
        setNodes(new DataSet<VisNode>(visNodesArray)); // 更新全部节点，通过 hidden 控制可见性
        setEdges(new DataSet<VisEdge>(visEdgesArray)); // 边数据

        // 更新图谱布局选项
        if (visNetworkInstanceRef.current) {
            visNetworkInstanceRef.current.setOptions(getGraphOptions(currentLayoutMode));
            // visNetworkInstanceRef.current.setData({ nodes: new DataSet<VisNode>(visNodesArray), edges: new DataSet<VisEdge>(visEdgesArray) });
            visNetworkInstanceRef.current.fit(); // 适应视图
        }
    }, [eventsToVisNodes, relationshipsToVisEdges, getGraphOptions]); // getGraphOptions 依赖 layoutMode

    useEffect(() => {
        loadGraphData();
    }, [loadGraphData]); // 首次加载或 novelId 变化时

    // 监听筛选条件变化，并重新生成节点和边 (主要更新节点的 hidden 属性和边的可见性)
    useEffect(() => {
        if (allEventsRef.current.length > 0 || allRelationshipsRef.current.length > 0) { // 确保有数据后再更新
             updateGraphVisualization(allEventsRef.current, allRelationshipsRef.current, currentChapterFilter, layoutMode);
        }
    }, [currentChapterFilter, layoutMode, updateGraphVisualization]); // 添加 layoutMode


    // --- 图谱配置选项 ---
    const getGraphOptions = useCallback((currentLayout: 'hierarchical' | 'forceDirected'): VisOptions => {
        const commonPhysicsOptions = {
            solver: 'barnesHut',
            barnesHut: {
                gravitationalConstant: -8000,
                springConstant: 0.03,
                springLength: 150,
                damping: 0.09,
                avoidOverlap: 0.1
            },
            stabilization: { iterations: 150 }
        };
        
        let layoutSpecificOptions: VisOptions['layout'] = {};
        if (currentLayout === 'hierarchical') {
            layoutSpecificOptions = {
                hierarchical: {
                    enabled: true,
                    direction: 'UD', // Up-Down
                    sortMethod: 'directed', // 按照边的方向排序
                    levelSeparation: 150,
                    nodeSpacing: 200,
                    treeSpacing: 250,
                },
            };
        } else { // forceDirected
            // 力导向布局不需要显式配置 hierarchical: false
        }

        return {
            autoResize: true,
            nodes: {
                borderWidth: 1,
                borderWidthSelected: 2,
                font: { size: 12, face: 'Arial', color: '#333' },
                shapeProperties: { useBorderWithImage: true },
                shadow: { enabled: true, color: 'rgba(0,0,0,0.2)', size:5, x:2, y:2},
            },
            edges: {
                width: 1,
                font: { size: 10, align: 'middle', color: '#555' },
                smooth: { type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.4 },
                arrows: { to: { enabled: true, scaleFactor: 0.7 } },
                color: { inherit: false }, // 不继承节点颜色
            },
            physics: currentLayout === 'forceDirected' ? commonPhysicsOptions : { enabled: false }, // 层次布局时禁用物理引擎
            layout: layoutSpecificOptions,
            interaction: {
                hover: true, // 鼠标悬停高亮
                dragNodes: true,
                dragView: true,
                zoomView: true,
                tooltipDelay: 200,
                navigationButtons: false, // 可以自定义导航按钮
                keyboard: { enabled: true },
            },
            groups: { // 定义不同组的样式 (例如不同章节)
                // ... 可以根据 chapterId 动态生成或预定义组样式 ...
                // 'unknown_chapter': { color: { background: '#ECEFF1', border: '#90A4AE' }, shape: 'ellipse' }
            },
        };
    }, []); // 空依赖，因为它不直接依赖外部状态，通过参数传入

    // --- vis-network 实例初始化与事件绑定 ---
    useEffect(() => {
        if (networkRef.current && nodes.get().length > 0) { // 确保有节点数据后再初始化
            if (!visNetworkInstanceRef.current) { // 仅在实例未创建时创建
                const data: VisData = { nodes, edges };
                const options = getGraphOptions(layoutMode);
                const network = new Network(networkRef.current, data, options);
                visNetworkInstanceRef.current = network;

                // --- 事件监听 ---
                network.on('selectNode', (params) => {
                    if (params.nodes.length > 0) {
                        const selectedNodeId = params.nodes[0] as number; // vis-network 的节点ID是 number 或 string
                        const eventData = allEventsRef.current.find(e => e.id === selectedNodeId);
                        if (eventData) {
                            setSelectedEventForModal(eventData);
                            setIsModalOpen(true);
                            onNodeClick?.(eventData); // 调用外部传入的回调
                        }
                    }
                });

                network.on("stabilizationIterationsDone", () => {
                    network.fit(); // 稳定后适应视图
                });
                
                network.on("afterDrawing", () => {
                    // 可以进行一些绘制完成后的操作
                });


            } else { // 如果实例已存在，仅更新数据和选项
                visNetworkInstanceRef.current.setData({ nodes, edges });
                visNetworkInstanceRef.current.setOptions(getGraphOptions(layoutMode));
            }
        }
        // 清理函数：组件卸载时销毁 Network 实例
        return () => {
            if (visNetworkInstanceRef.current) {
                visNetworkInstanceRef.current.destroy();
                visNetworkInstanceRef.current = null;
            }
        };
    }, [nodes, edges, layoutMode, getGraphOptions, onNodeClick]); // 依赖节点、边、布局模式和选项生成函数

    // --- UI 控制函数 ---
    const handleRefreshGraph = () => {
        loadGraphData(); // 重新加载所有数据
        toast.info("正在刷新事件图谱...");
    };

    const fitGraphToView = () => {
        if (visNetworkInstanceRef.current) {
            visNetworkInstanceRef.current.fit(); // 将图谱缩放到适合视口
        }
    };
    
    const handleCloseModal = () => setIsModalOpen(false);

    // 当点击模态框中的关联事件时，聚焦到图谱中的对应节点
    const navigateAndFocusNode = (eventId: number) => {
        setIsModalOpen(false); // 先关闭当前模态框
        if (visNetworkInstanceRef.current) {
            visNetworkInstanceRef.current.focus(eventId, { scale: 1.2, animation: true }); // 聚焦到节点并放大
            visNetworkInstanceRef.current.selectNodes([eventId]); // 选中节点，会触发 selectNode 事件进而打开新模态框
        }
    };
    
    // 检查在当前筛选条件下是否没有数据
    const noDataAfterFilter = useMemo(() => {
        if (isLoading || !allEventsRef.current) return false;
        const visibleNodes = eventsToVisNodes(allEventsRef.current, currentChapterFilter).filter(n => !n.hidden);
        return visibleNodes.length === 0 && allEventsRef.current.length > 0; // 有原始数据但筛选后为空
    }, [isLoading, currentChapterFilter, eventsToVisNodes]);

    const trulyNoData = !isLoading && allEventsRef.current.length === 0; // 确实没有数据


    return (
      <div className={styles.graphViewerContainer} style={{ height }}>
        {/* 工具栏：筛选、布局切换、刷新、帮助等 */}
        <div className={styles.toolbar}>
            <div className={styles.filterControls}>
                <Filter size={16} className={styles.toolbarIcon}/>
                <label htmlFor="chapterFilterGraph" className={styles.toolbarLabel}>筛选章节:</label>
                <select
                    id="chapterFilterGraph"
                    value={currentChapterFilter}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setCurrentChapterFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                    className={styles.toolbarSelect}
                    disabled={isLoading}
                >
                    <option value="all">所有章节</option>
                    {chapters.map(chap => (
                        <option key={chap.id} value={chap.id}>{chap.title || `章节 ${chap.chapter_index + 1}`}</option>
                    ))}
                </select>
            </div>
            <div className={styles.layoutControls}>
                <Layers size={16} className={styles.toolbarIcon}/>
                <label htmlFor="layoutModeGraph" className={styles.toolbarLabel}>布局模式:</label>
                <select
                    id="layoutModeGraph"
                    value={layoutMode}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setLayoutMode(e.target.value as 'hierarchical' | 'forceDirected')}
                    className={styles.toolbarSelect}
                    disabled={isLoading}
                >
                    <option value="hierarchical">层次结构</option>
                    <option value="forceDirected">力导向</option>
                </select>
            </div>
            <div className={styles.actionButtons}>
                <button onClick={handleRefreshGraph} className="btn btn-xs btn-icon" title="刷新图谱数据" disabled={isLoading}><RefreshCw size={14} className={isLoading ? "spinning-icon" : ""} /></button>
                <button onClick={fitGraphToView} className="btn btn-xs btn-icon" title="自适应缩放图谱到视口" disabled={!visNetworkInstanceRef.current || nodes.get().length === 0 || isLoading}><Maximize2 size={14} /></button>
                <HelpCircle size={16} className={styles.helpIconGraph} title="交互提示：拖拽节点调整布局，滚轮缩放视图。点击节点可查看详情。" />
            </div>
        </div>
      {isLoading && allEventsRef.current.length === 0 && ( <div className={styles.fullPageLoadingGraph}> <Loader size={28} className="spinning-icon" /> 正在加载事件图谱... </div> )}
      {error && ( <div className={styles.fullPageErrorGraph}> <AlertTriangle size={28} className="me-2" /> {error} </div> )}
      
      {/* vis-network 图谱的容器 */}
      <div ref={networkRef} className={styles.networkCanvas} style={{ height: `calc(${height} - 40px)` }}> {/* 减去工具栏高度 */}
        {noDataAfterFilter && !isLoading && <div className={styles.emptyGraphPlaceholder}><Filter size={24} className="mb-2"/>当前筛选条件下无事件可显示。请尝试选择“所有章节”或检查数据。</div>}
        {trulyNoData && !isLoading && !noDataAfterFilter && <div className={styles.emptyGraphPlaceholder}><Info size={24} className="mb-2"/>暂无事件数据可供展示。请先在小说中添加事件。</div>}
        {/* vis-network 会在此 div 中渲染 */}
      </div>

      {/* 事件详情模态框 */}
      <EventDetailModal
        event={selectedEventForModal}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        chapterMap={chapterMap}
        allEvents={allEventsRef.current} // 传递所有事件用于查找关联事件名称
        allRelationships={allRelationshipsRef.current} // 传递所有关系用于显示
        onNavigateToEvent={navigateAndFocusNode} // 传递导航回调
      />
    </div>
    );
};

export default EventGraphViewer;