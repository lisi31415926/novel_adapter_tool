// frontend-react/src/components/SentimentChart.tsx
import React, { useMemo } from 'react'; // 引入 React 和 useMemo Hook
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Label
} from 'recharts'; // 从 recharts 库导入所需组件
import { Chapter as ChapterInfo } from '../services/api'; // 从 API 服务导入章节类型定义
import styles from './SentimentChart.module.css'; // 引入 CSS Modules 样式
import { BarChart2, AlertTriangle, Info as InfoIcon, Smile, Frown, Meh } from 'lucide-react'; // 引入图标

// 定义图表使用的数据点格式
interface ChartDataPoint {
  name: string;             // X轴显示的名称 (例如 "第 N 章" 或章节标题缩写)
  sentimentScore: number | null; // Y轴的情感得分值 (null 表示数据缺失或无效)
  chapterIndex: number;     // 原始章节索引，用于Tooltip或交互
  fullTitle: string;        // 完整的章节标题，用于Tooltip显示
}

interface SentimentChartProps {
  chapters: ChapterInfo[] | undefined | null; // 包含情感得分的章节数据数组
  novelTitle?: string; // 可选的小说标题，用于图表标题的一部分
  // 可选的回调函数，当用户与图表交互时（例如点击数据点）触发
  onDataPointClick?: (dataPoint: ChartDataPoint) => void;
}

// 自定义Tooltip的内容和样式
const CustomTooltip: React.FC<any> = ({ active, payload, label }) => {
  // active: 布尔值，指示Tooltip是否可见 (鼠标是否悬停在数据点上)
  // payload: 数组，包含当前悬停数据点的信息
  // label: 当前悬停数据点在X轴上的标签 (即 ChartDataPoint.name)
  if (active && payload && payload.length) {
    const data: ChartDataPoint = payload[0].payload; // 获取原始数据点对象
    const score = data.sentimentScore;
    let sentimentLabel = "未知";
    let SentimentIcon = InfoIcon; // 默认图标
    if (score !== null) {
        // 根据情感得分判断情感标签和图标 (与ChapterList中的逻辑类似或可复用)
        if (score > 0.65) { sentimentLabel = "积极"; SentimentIcon = Smile; }
        else if (score < 0.35) { sentimentLabel = "消极"; SentimentIcon = Frown; }
        else { sentimentLabel = "中性"; SentimentIcon = Meh; }
    }

    return (
      <div className={styles.customTooltip}> {/* 应用自定义Tooltip样式 */}
        <p className={styles.tooltipTitle}>{data.fullTitle || label}</p> {/* 显示完整章节标题或X轴标签 */}
        {score !== null ? ( // 如果情感得分有效
          <p className={styles.tooltipScore}>
            情感倾向值: <strong className={styles[`sentiment${sentimentLabel}`]}>{score.toFixed(3)}</strong> ({sentimentLabel} <SentimentIcon size={14} style={{verticalAlign: 'middle', marginLeft: '3px'}}/>)
          </p>
        ) : ( // 如果情感得分无效或缺失
          <p className={styles.tooltipScore}>情感倾向值: N/A (数据缺失)</p>
        )}
        <p className={styles.tooltipExtraInfo}>章节索引: {data.chapterIndex + 1}</p> {/* 显示1-based的章节索引 */}
      </div>
    );
  }
  return null; // 如果Tooltip不可见，则不渲染任何内容
};


const SentimentChart: React.FC<SentimentChartProps> = ({
  chapters,
  novelTitle,
  onDataPointClick
}) => {
  // --- 数据处理与准备 ---
  // 使用 useMemo 缓存处理后的图表数据，仅当 chapters prop 变化时才重新计算
  const chartData: ChartDataPoint[] = useMemo(() => {
    if (!chapters || chapters.length === 0) {
      return []; // 如果没有章节数据，返回空数组
    }
    // 转换章节数据为图表所需格式
    return chapters
      .map((chapter, index) => {
        let score: number | null = null; // 默认为null (数据缺失)
        if (chapter.sentiment_score !== null && chapter.sentiment_score !== undefined) {
          const parsedScore = parseFloat(chapter.sentiment_score); // 将字符串得分转换为数字
          if (!isNaN(parsedScore)) { // 确保转换成功
            score = parsedScore;
          }
        }
        // 为X轴创建标签，优先使用章节标题，如果过长则截断或使用“第N章”
        let xAxisName = chapter.title || `第 ${chapter.chapter_index + 1} 章`;
        if (xAxisName.length > 15) { // 如果标题过长，截断并添加省略号
            xAxisName = `${xAxisName.substring(0, 12)}... (第 ${chapter.chapter_index + 1} 章)`;
        } else {
            xAxisName = `${xAxisName} (第 ${chapter.chapter_index + 1} 章)`;
        }

        return {
          name: xAxisName, // X轴显示的标签
          sentimentScore: score, // Y轴的情感得分 (可能为null)
          chapterIndex: chapter.chapter_index, // 原始章节索引
          fullTitle: chapter.title || `第 ${chapter.chapter_index + 1} 章 (无标题)`, // Tooltip中显示的完整标题
        };
      })
      .sort((a, b) => a.chapterIndex - b.chapterIndex); // 确保数据点按章节顺序排列
  }, [chapters]); // 依赖于 chapters prop

  // --- 渲染逻辑 ---

  // 状态一：正在加载或数据未就绪 (父组件控制 isLoading，这里通过 chapters 是否有效来判断)
  if (chapters === undefined) { // undefined 通常表示父组件仍在加载小说详情
    return (
      <div className={`${styles.chartContainer} ${styles.loadingState}`}>
        <Loader size={22} className="spinning-icon" />
        <span>情感走势图数据加载中...</span>
      </div>
    );
  }

  // 状态二：没有有效的章节数据或所有章节都没有情感得分
  if (chartData.length === 0 || chartData.every(d => d.sentimentScore === null)) {
    return (
      <div className={`${styles.chartContainer} ${styles.noDataState}`}>
        <AlertTriangle size={20} style={{marginRight: 'var(--spacing-sm)'}} />
        <span>暂无有效的章节情感数据可供分析和展示。可能是分析尚未完成或所有章节内容无法进行情感评估。</span>
      </div>
    );
  }

  // 动态计算X轴刻度间隔，以避免标签过于密集
  // 目标：大约显示 10-15 个刻度标签
  const xAxisTickInterval = chartData.length > 15 ? Math.floor(chartData.length / 10) : 0; // 0表示自动处理

  // 主图表渲染
  return (
    <div className={styles.chartContainer}>
      <h4 className={styles.chartTitle}> {/* 图表标题 */}
        <BarChart2 size={18} style={{ marginRight: 'var(--spacing-sm)' }} aria-hidden="true"/>
        小说情感走势分析 {novelTitle && ` - 《${novelTitle}》`}
      </h4>
      <ResponsiveContainer width="100%" height={300}> {/* 使用 ResponsiveContainer 使图表自适应容器大小 */}
        <LineChart
          data={chartData} // 传入处理后的图表数据
          margin={{ top: 5, right: 30, left: 0, bottom: 25 }} // 图表边距，为X轴标签留出空间
          onClick={(chartState) => { // 处理图表点击事件 (可选)
            if (chartState && chartState.activePayload && chartState.activePayload.length > 0 && onDataPointClick) {
              // chartState.activePayload[0].payload 包含被点击的数据点对象
              onDataPointClick(chartState.activePayload[0].payload as ChartDataPoint);
            }
          }}
        >
          {/* X轴配置 */}
          <XAxis
            dataKey="name" // X轴使用数据点中的 'name' 字段
            angle={-25} // X轴标签倾斜角度，以容纳更长的标签
            textAnchor="end" // 倾斜标签的锚点设为末尾
            height={60} // 增加X轴高度以容纳倾斜标签
            interval={xAxisTickInterval} // 动态设置刻度间隔，或 "preserveStartEnd"
            tick={{ fontSize: '0.75rem', fill: 'var(--color-muted)' }} // 刻度标签样式
            axisLine={{ stroke: 'var(--border-color-axis)' }} // X轴线样式
            tickLine={{ stroke: 'var(--border-color-axis)' }} // X轴刻度线样式
          >
            <Label value="章节顺序" offset={10} position="insideBottom" style={{ fill: 'var(--color-muted)', fontSize: '0.8rem'}} />
          </XAxis>
          {/* Y轴配置 */}
          <YAxis
            domain={[0, 1]} // Y轴数据范围固定为0到1 (假设情感得分在此区间)
            allowDataOverflow={false} // 不允许数据点超出定义的domain
            tick={{ fontSize: '0.75rem', fill: 'var(--color-muted)' }} // 刻度标签样式
            axisLine={{ stroke: 'var(--border-color-axis)' }} // Y轴线样式
            tickLine={{ stroke: 'var(--border-color-axis)' }} // Y轴刻度线样式
          >
            <Label value="情感倾向值" angle={-90} position="insideLeft" style={{ textAnchor: 'middle', fill: 'var(--color-muted)', fontSize: '0.8rem' }} />
          </YAxis>
          {/* 笛卡尔坐标网格线 */}
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color-grid)" /> {/* 使用虚线网格和特定颜色 */}
          {/* Tooltip (鼠标悬停提示) 配置 */}
          <Tooltip
            content={<CustomTooltip />} // 使用自定义的Tooltip组件
            cursor={{ stroke: 'var(--color-primary)', strokeWidth: 1, strokeDasharray: '3 3' }} // 悬停时显示垂直虚线光标
            wrapperStyle={{ outline: 'none' }} // 移除Tooltip包裹层的默认轮廓
          />
          {/* 图例 (Legend) - 对于单条折线，通常可以不显示图例 */}
          {/* <Legend verticalAlign="top" height={36}/> */}
          {/* 折线 (Line) 配置 */}
          <Line
            type="monotone" // 线条类型 (例如 monotone, linear, step)
            dataKey="sentimentScore" // Y轴数据使用 'sentimentScore' 字段
            name="情感倾向值" // 在Tooltip和Legend中显示的名称
            stroke="var(--color-primary)" // 线条颜色 (使用应用主色调)
            strokeWidth={2} // 线条粗细
            dot={{ r: 4, strokeWidth: 1, fill: 'var(--color-primary-light)' }} // 数据点的样式 (半径, 边框宽度, 填充色)
            activeDot={{ r: 6, stroke: 'var(--color-primary-dark)', fill: 'var(--background-color-card)' }} // 鼠标悬停在数据点上时的活动点样式
            connectNulls={true} // 是否连接包含null值的数据点之间的线段 (true表示连接，false表示断开)
                               // 设为true可以避免因个别章节无情感得分导致图表断裂，但可能误导
                               // 设为false则更真实反映数据缺失，但图表可能不连续
                               // 这里选择 true 以保持图表视觉上的连续性，Tooltip会提示数据缺失
          />
          {/* 可选：添加参考线，例如在Y=0.5处表示中性情感 */}
          {/* <ReferenceLine y={0.5} label={{ value: "中性", position: "insideTopRight", fill: 'var(--color-muted)', fontSize: '0.7rem' }} stroke="var(--color-warning)" strokeDasharray="4 4" /> */}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SentimentChart;