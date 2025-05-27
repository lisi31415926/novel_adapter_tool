// frontend-react/src/constants.ts

import {
    // 从 services/api 导入权威类型
    ApiRuleStepParameterDefinition, // 注意：这里是完整的定义类型
    ApiParameterTypeEnum,           // 使用后端同步的枚举名
    // 如果 ApiRuleStepParameterDefinition 包含了 value，我们需要 Omit<ApiRuleStepParameterDefinition, 'value'>
    // 但通常后端 schema 定义的参数结构本身不包含运行时值，所以直接用 ApiRuleStepParameterDefinition 作为定义的类型是合适的。
    // StepParameterValueType, // 这个是参数值的类型，TASK_PARAMETER_DEFINITIONS 中定义的是结构，不含当前值
} from './services/api'; // 调整路径以匹配您的项目结构

// --- 核心枚举定义 (与 backend/app/schemas.py 中的枚举严格对应) ---

/**
 * @enum PredefinedTaskEnum
 * @description 预定义的文本处理任务类型。
 */
export enum PredefinedTaskEnum {
    SUMMARIZE_TEXT = "summarize_text",
    REWRITE_TEXT = "rewrite_text",
    EXPAND_TEXT = "expand_text",
    CHANGE_PERSPECTIVE = "change_perspective",
    EXTRACT_MAIN_EVENT = "extract_main_event",
    EXTRACT_ROLES = "extract_roles",
    IDENTIFY_EVENTS = "identify_events",
    SUMMARIZE_CHAPTER = "summarize_chapter",
    ANALYZE_CHAPTER_THEME = "analyze_chapter_theme",
    SENTIMENT_ANALYSIS_CHAPTER = "sentiment_analysis_chapter",
    RAG_GENERATION = "rag_generation",
    ANALYZE_EVENT_RELATIONSHIPS = "analyze_event_relationships",
    ANALYZE_CHARACTER_RELATIONSHIPS = "analyze_character_relationships",
    EXTRACT_CORE_CONFLICTS = "extract_core_conflicts",
    ENHANCE_SCENE_DESCRIPTION = "enhance_scene_description",
    WHAT_IF_PLOT_DERIVATION = "what_if_plot_derivation",
    GENERATE_PLOT_POINTS = "generate_plot_points",
    PLOT_SUGGESTION = "plot_suggestion",
    PLANNING_PARSE_GOAL = "planning_parse_goal",
    PLANNING_GENERATE_DRAFT = "planning_generate_draft",
    CUSTOM_INSTRUCTION = "custom_instruction",
}

/**
 * @enum PostProcessingRuleEnum
 * @description 预定义的后处理规则。
 */
export enum PostProcessingRuleEnum {
    STRIP = "strip",
    TO_JSON = "to_json",
    EXTRACT_JSON_FROM_MARKDOWN = "extract_json_from_markdown",
    REMOVE_EXTRA_SPACES = "remove_extra_spaces",
    CAPITALIZE_SENTENCES = "capitalize_sentences",
    NORMALIZE_CHINESE_PUNCTUATION_FULL_WIDTH = "normalize_chinese_punctuation_full_width",
    NORMALIZE_ENGLISH_PUNCTUATION_HALF_WIDTH = "normalize_english_punctuation_half_width",
}

/**
 * @enum SentimentConstraintEnum
 * @description 生成内容的情感约束。
 */
export enum SentimentConstraintEnum {
    POSITIVE = "positive",
    NEGATIVE = "negative",
    NEUTRAL = "neutral",
}

/**
 * @enum OutputFormatConstraintEnum
 * @description 生成内容的输出格式约束。
 */
export enum OutputFormatConstraintEnum {
    PARAGRAPH = "paragraph",
    BULLET_LIST = "bullet_list",
    JSON_OBJECT = "json_object",
    MARKDOWN_TABLE = "markdown_table",
    XML_STRUCTURE = "xml_structure",
    NUMBERED_LIST = "numbered_list",
}

/**
 * @enum RelationshipTypeEnum
 * @description 角色关系类型。
 */
export enum RelationshipTypeEnum {
    FAMILY = "family",
    FRIENDSHIP = "friendship",
    ROMANCE = "romance",
    ANTAGONISTIC = "antagonistic",
    ALLIANCE = "alliance",
    MENTORSHIP = "mentorship",
    PROFESSIONAL = "professional",
    RIVALRY = "rivalry",
    ENMITY = "enmity",
    OTHER = "other",
}

/**
 * @enum RelationshipStatusEnum
 * @description 角色关系状态。
 */
export enum RelationshipStatusEnum {
    ACTIVE = "active",
    PAST = "past",
    STRAINED = "strained",
    UNKNOWN = "unknown",
}

/**
 * @enum ConflictLevelEnum
 * @description 冲突级别。
 */
export enum ConflictLevelEnum {
    MAJOR = "major",
    MINOR = "minor",
    CHARACTER_INTERNAL = "character_internal",
}

/**
 * @enum ConflictStatusEnum
 * @description 冲突状态。
 */
export enum ConflictStatusEnum {
    OPEN = "open",
    RESOLVED = "resolved",
    ONGOING = "ongoing",
    UNKNOWN = "unknown",
}

/**
 * @enum EventRelationshipTypeEnum
 * @description 事件关系类型。
 */
export enum EventRelationshipTypeEnum {
    CAUSES = "causes",
    LEADS_TO = "leads_to",
    PRECEDES = "precedes",
    FOLLOWS = "follows",
    INFLUENCES = "influences",
    SUB_EVENT_OF = "sub_event_of",
    SUPER_EVENT_OF = "super_event_of",
    RELATED_TO = "related_to",
}

/**
 * @enum PlotBranchTypeEnum
 * @description 剧情分支类型。
 */
export enum PlotBranchTypeEnum {
    MAJOR_BRANCH = "major_branch",
    MINOR_CHOICE = "minor_choice",
    ENDING_PATH = "ending_path",
}

/**
 * @enum PlotVersionStatusEnum
 * @description 剧情版本状态。
 */
export enum PlotVersionStatusEnum {
    DRAFT = "draft",
    ACTIVE = "active",
    ARCHIVED = "archived",
    FINALIZED = "finalized",
}

/**
 * @enum StepInputSourceEnum
 * @description 规则步骤的输入来源。
 */
export enum StepInputSourceEnum {
    ORIGINAL = "original",
    PREVIOUS_STEP = "previous_step",
}

/**
 * @enum TokenCostLevelEnum
 * @description Token消耗级别（用于预估）。
 */
export enum TokenCostLevelEnum {
    LOW = "low",
    MEDIUM = "medium",
    HIGH = "high",
    UNKNOWN = "unknown",
}

/**
 * @enum SortDirectionEnum
 * @description 排序方向。
 */
export enum SortDirectionEnum {
    ASC = "asc",
    DESC = "desc",
}

/**
 * @enum NovelAnalysisStatusEnum
 * @description 小说（通用）分析状态。
 */
export enum NovelAnalysisStatusEnum {
    PENDING = "pending",
    IN_PROGRESS = "in_progress",
    COMPLETED = "completed",
    FAILED = "failed",
    COMPLETED_WITH_ERRORS = "completed_with_errors",
    UNKNOWN = "unknown",
}

/**
 * @enum NovelVectorizationStatusEnum
 * @description 小说向量化专用状态。
 */
export enum NovelVectorizationStatusEnum {
    PENDING = "pending",
    IN_PROGRESS = "in_progress",
    COMPLETED = "completed",
    FAILED = "failed",
    COMPLETED_NO_CONTENT = "completed_no_content",
    UNKNOWN = "unknown",
}
// --- 事件相关选项 ---
export interface OptionType {
    label: string;
    value: string | number;
    description?: string;
    color?: string; // Ant Design Tag 组件支持的颜色值
  }
  
  // --- 事件相关选项 ---
export const EVENT_TYPES_OPTIONS: OptionType[] = [
    { label: '关键转折', value: 'KEY_TURNING_POINT', color: 'volcano', description: '对剧情走向产生重大改变的事件。' },
    { label: '角色发展', value: 'CHARACTER_DEVELOPMENT', color: 'geekblue', description: '显著影响角色性格、动机或关系的事件。' },
    { label: '情节推进', value: 'PLOT_ADVANCEMENT', color: 'cyan', description: '推动主线或重要支线情节发展的事件。' },
    { label: '背景设定', value: 'WORLD_BUILDING', color: 'purple', description: '揭示或构建世界观、历史背景的事件。' },
    { label: '冲突升级', value: 'CONFLICT_ESCALATION', color: 'red', description: '加剧现有冲突或引入新冲突的事件。' },
    { label: '冲突解决', value: 'CONFLICT_RESOLUTION', color: 'green', description: '主要冲突得到解决或缓和的事件。' },
    { label: '伏笔铺垫', value: 'FORESHADOWING', color: 'orange', description: '为后续情节埋下线索或暗示的事件。' },
    { label: '高潮', value: 'CLIMAX', color: 'magenta', description: '剧情达到顶点，最具张力的事件。' },
    { label: '日常/过渡', value: 'DAILY_LIFE_TRANSITION', color: 'lime', description: '描述角色日常生活或情节间的过渡。' },
    { label: '回忆闪回', value: 'FLASHBACK_MEMORY', color: 'gold', description: '通过回忆展现过去发生的事情。' },
    { label: '其他', value: 'OTHER', color: 'default', description: '不属于以上主要类型的事件。' },
    // 您可以根据实际需要调整或从后端获取这些值
];
  
export const EVENT_IMPORTANCE_LEVELS_OPTIONS: OptionType[] = [
    { label: '极高 (S)', value: 5, color: '#f5222d' },
    { label: '高 (A)', value: 4, color: '#fa8c16' },
    { label: '中 (B)', value: 3, color: '#1890ff' },
    { label: '低 (C)', value: 2, color: '#52c41a' },
    { label: '极低 (D)', value: 1, color: '#bfbfbf' },
    // value 对应后端存储的实际值，例如 1-5 的数字
];
  
  // --- 角色相关选项 (示例，如果需要) ---
export const ROLE_TYPE_OPTIONS: OptionType[] = [
      { label: "主角", value: "PROTAGONIST", color: "gold"},
      { label: "配角", value: "SUPPORTING_CHARACTER", color: "lime"},
      { label: "反派", value: "ANTAGONIST", color: "red"},
      { label: "导师", value: "MENTOR", color: "purple"},
      { label: "次要角色", value: "MINOR_CHARACTER", color: "geekblue"},
      { label: "未知", value: "UNKNOWN", color: "default"},
];

export const CONFLICT_LEVEL_OPTIONS: OptionType[] = [
    { label: '主要冲突', value: 'MAJOR', color: 'red' },
    { label: '次要冲突', value: 'MINOR', color: 'orange' },
    { label: '内部冲突', value: 'INTERNAL', color: 'blue' },
    { label: '人际冲突', value: 'INTERPERSONAL', color: 'geekblue' },
    { label: '社会冲突', value: 'SOCIETAL', color: 'purple' },
];
  
  // 示例：假设后端 ConflictStatusEnum 是字符串类型
export const CONFLICT_STATUS_OPTIONS: OptionType[] = [
    { label: '酝酿中', value: 'BREWING', color: 'gold' },
    { label: '发展中', value: 'DEVELOPING', color: 'lime' },
    { label: '已激化', value: 'ESCALATED', color: 'volcano' },
    { label: '已解决', value: 'RESOLVED', color: 'green' },
    { label: '持续存在', value: 'ONGOING', color: 'cyan' },
];
  

// --- 任务特定参数定义 (核心映射表) ---
// ParameterDefinitionSchema 是 Omit<ApiRuleStepParameterDefinition, 'value'>
// 因为 ApiRuleStepParameterDefinition (来自后端 schemas.py) 已经包含了参数的定义和【值】
// 在这里，我们为 TASK_PARAMETER_DEFINITIONS 定义的是参数的【结构和元数据】，不包含运行时的【值】。
// 【值】将在 StepEditorInternalModal 中与这些定义分离管理，并通过 currentDynamicParamsValues 传递给 TaskSpecificParamsInput。
export type ParameterDefinitionSchema = Omit<ApiRuleStepParameterDefinition, 'value'>;

export const TASK_PARAMETER_DEFINITIONS: Record<string, Record<string, ParameterDefinitionSchema>> = {
  [PredefinedTaskEnum.SUMMARIZE_TEXT]: {
    max_length: {
      param_type: ApiParameterTypeEnum.STATIC_NUMBER,
      label: '最大长度 (tokens)',
      description: '摘要内容的目标最大 token 数量。如果留空，将使用模型或任务的默认设置。',
      required: false,
      config: { min: 20, step: 10, defaultValue: 150, placeholder: "例如：200" },
    },
    min_length: {
      param_type: ApiParameterTypeEnum.STATIC_NUMBER,
      label: '最小长度 (tokens)',
      description: '摘要内容的目标最小 token 数量。',
      required: false,
      config: { min: 10, step: 5, defaultValue: 50, placeholder: "例如：30" },
    },
    output_style_hint: {
        param_type: ApiParameterTypeEnum.STATIC_TEXTAREA,
        label: "摘要风格提示 (可选)",
        description: "对摘要的风格、侧重点等进行说明，例如“提取关键论点”、“概括主要情节”、“保持原文语气”。",
        required: false,
        config: { rows: 2, placeholder: "例如：请以客观、简洁的风格概括要点。" }
    }
  },
  [PredefinedTaskEnum.REWRITE_TEXT]: {
    rewrite_goal: {
      param_type: ApiParameterTypeEnum.STATIC_TEXTAREA,
      label: '改写目标/指令',
      description: '详细描述改写的具体要求。例如：“将以下文本改写得更简洁”、“将这段描述从第三人称改为第一人称（主角李明）”、“将这段对话改写得更符合古代言情小说的风格”。',
      required: true,
      config: { rows: 3, placeholder: "例如：请将文本改写为现代青少年口吻，增加幽默感。" },
    },
    preserve_meaning: {
        param_type: ApiParameterTypeEnum.STATIC_BOOLEAN,
        label: "保持核心意义不变",
        description: "勾选此项以指示AI在改写时应尽量保持原文的核心意义和信息。",
        required: false,
        config: { defaultValue: true }
    },
    strength: {
        param_type: ApiParameterTypeEnum.USER_INPUT_CHOICE,
        label: "改写强度 (可选)",
        description: "控制改写的幅度。强度越高，与原文的差异可能越大。",
        required: false,
        options: [
            {label: "轻微调整", value: "slight"},
            {label: "中等改写", value: "moderate"},
            {label: "大幅重塑", value: "significant"},
        ],
        config: {defaultValue: "moderate"}
    }
  },
  [PredefinedTaskEnum.EXPAND_TEXT]: {
    expansion_points: {
        param_type: ApiParameterTypeEnum.STATIC_TEXTAREA,
        label: '扩展方向或要点',
        description: '提供希望文本扩展的具体方向、要点或需要补充细节的部分。例如：“详细描写主角的心理活动”、“补充战斗场景的细节”、“围绕这个观点提供更多论据”。',
        required: true,
        config: { rows: 3, placeholder: "例如：详细描写角色A在得知真相后的震惊与不信。" }
    },
    target_expansion_length_ratio: {
        param_type: ApiParameterTypeEnum.STATIC_NUMBER,
        label: '目标扩展比例 (可选)',
        description: '期望文本扩展后的长度相对于原文的比例，例如输入1.5表示期望扩展到原文的1.5倍长。仅供参考，AI可能无法精确控制。',
        required: false,
        config: { min: 1.1, step: 0.1, defaultValue: 1.5, placeholder: "例如：1.5" }
    }
  },
  [PredefinedTaskEnum.CHANGE_PERSPECTIVE]: {
    source_perspective: {
      param_type: ApiParameterTypeEnum.STATIC_STRING,
      label: '源视角描述',
      description: '文本当前的叙述视角，例如“第一人称（我）”、“第三人称（主角A）”、“上帝视角”。',
      required: true,
      config: { placeholder: "例如：第三人称（李雷）" }
    },
    target_perspective: {
      param_type: ApiParameterTypeEnum.STATIC_STRING,
      label: '目标视角描述',
      description: '希望文本转换成的叙述视角，例如“第一人称（韩梅梅）”、“第三人称（旁观者）”。',
      required: true,
      config: { placeholder: "例如：第一人称（韩梅梅）" }
    },
    key_character_for_perspective: { // 确保 TaskSpecificParamsInput 中为此类型加载角色列表
        param_type: ApiParameterTypeEnum.NOVEL_ELEMENT_CHARACTER_ID,
        label: "目标视角关键角色 (可选)",
        description: "如果目标视角是某个特定角色的第一人称，请选择该角色。这有助于AI更好地代入角色。",
        required: false,
    }
  },
  [PredefinedTaskEnum.ENHANCE_SCENE_DESCRIPTION]: {
    // 场景描述增强任务可能没有固定参数，而是依赖 Custom Instruction 和 Generation Constraints
    // 但也可以定义一些指导性参数
    enhancement_focus_areas: {
      param_type: ApiParameterTypeEnum.USER_INPUT_CHOICE,
      label: '增强侧重点 (可选)',
      description: '选择希望场景增强的方面，可多选。',
      required: false,
      options: [
        { label: '环境与氛围', value: 'environment_atmosphere' },
        { label: '感官细节 (视觉/听觉/嗅觉等)', value: 'sensory_details' },
        { label: '角色动作与表情', value: 'character_action_expression' },
        { label: '角色内心活动与情感', value: 'character_internal_emotion' },
        { label: '对话描写', value: 'dialogue_portrayal' },
        { label: '节奏与张力', value: 'pace_tension' },
      ],
      config: { isMulti: true, defaultValue: ["environment_atmosphere", "sensory_details"] }
    },
    desired_mood: {
        param_type: ApiParameterTypeEnum.STATIC_STRING,
        label: "期望场景基调 (可选)",
        description: "例如：紧张、浪漫、悬疑、宁静、史诗感等。",
        required: false,
        config: { placeholder: "例如：紧张悬疑" }
    },
    // 如果需要更结构化，可以使用 GenerationConstraintsSchema (PARAMETER_TYPE_GENERATION_CONSTRAINTS)
    // 但这通常在步骤的通用字段中配置，而不是作为任务特定参数
  },
  [PredefinedTaskEnum.RAG_GENERATION]: {
    // RAG 的核心 query 通常是步骤的输入文本，或由 custom_instruction 动态生成
    // 因此，这里的参数主要用于配置检索和生成过程
    retrieval_config: {
      param_type: ApiParameterTypeEnum.PARAMETER_TYPE_OBJECT,
      label: '检索配置',
      description: '配置RAG过程中的向量检索参数。',
      required: false, // 允许使用全局默认配置
      schema: {
        top_k_results: { // 避免与通用 top_k 冲突
          param_type: ApiParameterTypeEnum.STATIC_NUMBER,
          label: '检索Top-K结果数',
          description: '从向量数据库中检索的最相关文档块的数量。',
          required: false, // 允许使用全局默认值
          config: { min: 1, max: 20, step: 1, defaultValue: 3, placeholder: "默认: 3" },
        },
        // source_collection_name: { // 这是一个例子，实际可能不需要用户直接选择
        //   param_type: ApiParameterTypeEnum.USER_INPUT_CHOICE,
        //   label: '来源集合名称 (可选)',
        //   description: '如果指定，仅从此向量集合中检索。否则使用小说默认集合。',
        //   required: false,
        //   options: [], // 动态加载或从 appConfig 配置
        // },
        similarity_threshold: {
            param_type: ApiParameterTypeEnum.STATIC_NUMBER,
            label: '相似度阈值 (可选)',
            description: '仅返回相似度得分高于此阈值的文档块。范围 0.0 - 1.0。',
            required: false,
            config: { min: 0.0, max: 1.0, step: 0.05, placeholder: "例如：0.7" }
        }
      },
      config: { defaultValue: { top_k_results: 3 } } // 顶级对象的默认值
    },
    // generation_prompt_template 已移至步骤的 custom_instruction 字段，或者通过LLM覆盖参数实现
  },
  [PredefinedTaskEnum.CUSTOM_INSTRUCTION]: {
    // 自定义指令的核心是步骤的 custom_instruction 字段。
    // 这里可以定义一些辅助性的、结构化的参数，如果 custom_instruction 中允许使用占位符引用它们。
    // 例如，如果 custom_instruction 是 "请扮演 {role} 并以 {tone} 的语气改写文本。"
    role_for_ai: {
        param_type: ApiParameterTypeEnum.STATIC_STRING,
        label: "AI 扮演的角色 (可选)",
        description: "指示AI在执行指令时扮演的角色，例如“小说编辑”、“文学评论家”。",
        required: false,
        config: { placeholder: "例如：资深编剧" }
    },
    tone_of_voice: {
        param_type: ApiParameterTypeEnum.STATIC_STRING,
        label: "输出语气 (可选)",
        description: "期望AI生成内容时采用的语气，例如“正式”、“幽默”、“批判性”。",
        required: false,
        config: { placeholder: "例如：风趣幽默" }
    },
    // 示例：允许用户提供额外的上下文文本片段
    additional_context_snippet: {
        param_type: ApiParameterTypeEnum.STATIC_TEXTAREA,
        label: "附加参考文本 (可选)",
        description: "提供一段额外的文本作为AI执行指令时的参考或背景信息。",
        required: false,
        config: { rows: 3, placeholder: "粘贴相关的背景资料或参考文本..." }
    }
  },
  // 其他任务类型 (EXTRACT_ROLES, IDENTIFY_EVENTS, SUMMARIZE_CHAPTER 等)
  // 也应该有它们各自的参数定义。
  // 例如，EXTRACT_ROLES 可能不需要特定参数，或者可以有一个参数指定提取角色的数量上限。
  // IDENTIFY_EVENTS 可能有一个参数用于指定事件的时间范围或重要性阈值。
  [PredefinedTaskEnum.EXTRACT_ROLES]: {
    max_roles_to_extract: {
        param_type: ApiParameterTypeEnum.STATIC_NUMBER,
        label: "最大提取角色数 (可选)",
        description: "限制提取的角色数量上限。留空则不限制。",
        required: false,
        config: { min: 1, step: 1, placeholder: "例如: 10" }
    }
  },
  // 对于许多任务，如果没有明确的、用户可配置的参数，
  // 它们的参数定义对象可以是空对象: {}
  [PredefinedTaskEnum.EXTRACT_MAIN_EVENT]: {},
  [PredefinedTaskEnum.SUMMARIZE_CHAPTER]: TASK_PARAMETER_DEFINITIONS[PredefinedTaskEnum.SUMMARIZE_TEXT], // 复用文本摘要参数
  [PredefinedTaskEnum.ANALYZE_CHAPTER_THEME]: {},
  [PredefinedTaskEnum.SENTIMENT_ANALYSIS_CHAPTER]: {}, // 可能有情感粒度等参数
  [PredefinedTaskEnum.ANALYZE_EVENT_RELATIONSHIPS]: {},
  [PredefinedTaskEnum.ANALYZE_CHARACTER_RELATIONSHIPS]: {},
  [PredefinedTaskEnum.EXTRACT_CORE_CONFLICTS]: {},
  [PredefinedTaskEnum.WHAT_IF_PLOT_DERIVATION]: {
    hypothetical_condition: {
        param_type: ApiParameterTypeEnum.STATIC_TEXTAREA,
        label: "假设条件/剧情转折点",
        description: "输入一个“如果...会怎样？”的假设条件，AI将基于此推演剧情。",
        required: true,
        config: {rows: 3, placeholder: "例如：如果主角A在关键时刻没有选择救援，而是逃跑了..."}
    },
    number_of_variations: {
        param_type: ApiParameterTypeEnum.STATIC_NUMBER,
        label: "推演变体数量 (可选)",
        description: "希望AI生成的不同剧情发展方向的数量。",
        required: false,
        config: {min: 1, max: 5, step: 1, defaultValue: 1}
    }
  },
  [PredefinedTaskEnum.GENERATE_PLOT_POINTS]: {
    topic_or_theme: {
        param_type: ApiParameterTypeEnum.STATIC_STRING,
        label: "主题或核心概念",
        description: "输入生成剧情点的核心主题、概念或关键词。",
        required: true,
        config: {placeholder: "例如：一个关于时间旅行的爱情悲剧"}
    },
    number_of_plot_points: {
        param_type: ApiParameterTypeEnum.STATIC_NUMBER,
        label: "剧情点数量",
        description: "期望生成的关键剧情点数量。",
        required: true,
        config: {min: 3, max: 20, step: 1, defaultValue: 5}
    },
    target_audience_style: {
        param_type: ApiParameterTypeEnum.STATIC_STRING,
        label: "目标读者与风格 (可选)",
        description: "例如：青少年读者，奇幻冒险风格。",
        required: false,
        config: {placeholder: "例如：成人读者，硬科幻风格"}
    }
  },
  [PredefinedTaskEnum.PLOT_SUGGESTION]: { // AI 剧情版本建议
      current_plot_summary: { // 通常这个会从当前编辑的 PlotVersion 自动填充
          param_type: ApiParameterTypeEnum.STATIC_TEXTAREA, // 或是一个特殊类型指向当前剧情版本内容
          label: "当前剧情梗概/进展",
          description: "AI将基于此信息给出后续发展建议。通常自动填充，也可手动修改。",
          required: true,
          config: {rows: 5}
      },
      user_goals_or_constraints: {
          param_type: ApiParameterTypeEnum.STATIC_TEXTAREA,
          label: "用户目标或约束 (可选)",
          description: "对AI生成的剧情建议有什么特定要求或不希望出现的内容。",
          required: false,
          config: {rows: 3, placeholder: "例如：希望剧情更紧张刺激，避免出现魔法元素。"}
      }
  },
  [PredefinedTaskEnum.PLANNING_PARSE_GOAL]: {}, // 通常无用户可配参数，输入是用户目标文本
  [PredefinedTaskEnum.PLANNING_GENERATE_DRAFT]: {}, // 通常无用户可配参数
};


// --- UI 显示相关的常量 ---
export interface TaskDetail {
  label: string;
  description: string;
  // keyParams 现在可以从 TASK_PARAMETER_DEFINITIONS 动态派生，或者保持用于简单提示
  // 如果 TaskSpecificParamsInput 完全依赖 TASK_PARAMETER_DEFINITIONS，则 PREDEFINED_TASK_DETAILS_MAP 中的 keyParams 不再是必需的
}

export const PREDEFINED_TASK_DETAILS_MAP: Record<PredefinedTaskEnum, TaskDetail> = {
  [PredefinedTaskEnum.SUMMARIZE_TEXT]: { label: "文本摘要", description: "对输入文本进行摘要，可控制摘要长度和风格。" },
  [PredefinedTaskEnum.REWRITE_TEXT]: { label: "文本改写", description: "根据特定目标（如改变语气、简化、增强等）重写文本。" },
  [PredefinedTaskEnum.EXPAND_TEXT]: { label: "文本扩展", description: "基于输入文本进行内容扩展或细节补充。" },
  [PredefinedTaskEnum.CHANGE_PERSPECTIVE]: { label: "视角转换", description: "将文本从一个叙述视角转换为另一个视角。" },
  [PredefinedTaskEnum.EXTRACT_MAIN_EVENT]: { label: "主要事件提取", description: "从文本中识别并提取核心事件或主要情节。" },
  [PredefinedTaskEnum.EXTRACT_ROLES]: { label: "角色提取", description: "从文本中识别并列出主要角色及其基本信息。" },
  [PredefinedTaskEnum.IDENTIFY_EVENTS]: { label: "事件识别(列表)", description: "识别并列出文本中的所有事件及其要素。" },
  [PredefinedTaskEnum.SUMMARIZE_CHAPTER]: { label: "章节摘要(独立)", description: "为小说章节内容生成独立摘要，突出核心情节和角色变化。" },
  [PredefinedTaskEnum.ANALYZE_CHAPTER_THEME]: { label: "章节主题分析", description: "分析并总结章节的主要主题、象征意义等。" },
  [PredefinedTaskEnum.SENTIMENT_ANALYSIS_CHAPTER]: { label: "章节情感分析(独立)", description: "对章节文本进行情感分析并返回结构化结果。" },
  [PredefinedTaskEnum.RAG_GENERATION]: { label: "RAG检索增强生成", description: "结合从知识库检索到的上下文信息来回答问题或生成文本。" },
  [PredefinedTaskEnum.ANALYZE_EVENT_RELATIONSHIPS]: { label: "事件关系分析", description: "分析文本中事件之间的因果、时序等相互关系。" },
  [PredefinedTaskEnum.ANALYZE_CHARACTER_RELATIONSHIPS]: { label: "人物关系分析", description: "分析文本中角色之间的情感、社会等相互关系。" },
  [PredefinedTaskEnum.EXTRACT_CORE_CONFLICTS]: { label: "核心冲突提取", description: "从文本中识别和提取核心的矛盾冲突点及其参与方。" },
  [PredefinedTaskEnum.ENHANCE_SCENE_DESCRIPTION]: { label: "场景描写增强", description: "根据特定侧重点（如环境、感官、氛围）增强场景的描写，使其更生动、具体。" },
  [PredefinedTaskEnum.WHAT_IF_PLOT_DERIVATION]: { label: "What-If剧情推演", description: "基于给定的假设条件，推演剧情的多种可能发展。" },
  [PredefinedTaskEnum.GENERATE_PLOT_POINTS]: { label: "剧情点生成", description: "基于主题、背景或已有情节生成若干关键剧情点或大纲。" },
  [PredefinedTaskEnum.PLOT_SUGGESTION]: { label: "AI剧情版本建议", description: "AI根据当前剧情发展和用户目标，给出新的剧情版本走向建议。" },
  [PredefinedTaskEnum.PLANNING_PARSE_GOAL]: { label: "规划-解析目标", description: "解析用户输入的自然语言改编目标，提取关键意图和要素。" },
  [PredefinedTaskEnum.PLANNING_GENERATE_DRAFT]: { label: "规划-生成草稿", description: "根据解析的改编目标，自动生成一个初步的规则链草稿。" },
  [PredefinedTaskEnum.CUSTOM_INSTRUCTION]: { label: "自定义指令 (LLM)", description: "根据用户提供的详细指令直接与大语言模型交互，处理文本。" },
};

// --- 其他常量 ---
export const POST_PROCESSING_RULE_OPTIONS = Object.values(PostProcessingRuleEnum).map(value => ({
  label: value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
  value: value,
}));

export const STEP_INPUT_SOURCE_OPTIONS = [
  { label: '规则链执行时的原始输入', value: StepInputSourceEnum.ORIGINAL },
  { label: '上一个步骤的输出结果', value: StepInputSourceEnum.PREVIOUS_STEP },
];

export const DEFAULT_API_TIMEOUT_MS = 120 * 1000;
export const MAX_FILE_SIZE_MB = 50;
export const SUPPORTED_FILE_TYPES = {
  'text/plain': ['.txt'],
  'application/epub+zip': ['.epub'],
};

// Quill 编辑器配置 (如果项目中使用)
export const QUILL_MODULES_CONFIG = {
  toolbar: [
    [{ 'header': [1, 2, 3, 4, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'color': [] }, { 'background': [] }],
    [{ 'script': 'sub'}, { 'script': 'super' }],
    [{ 'list': 'ordered'}, { 'list': 'bullet' }, { 'indent': '-1'}, { 'indent': '+1' }],
    [{ 'align': [] }],
    ['link', 'blockquote', 'code-block'],
    ['clean']
  ],
};
export const QUILL_FORMATS_CONFIG = [
  'header', 'bold', 'italic', 'underline', 'strike', 'color', 'background',
  'script', 'list', 'bullet', 'indent', 'align', 'link', 'blockquote', 'code-block'
];

// 工具函数
export const getPredefinedTaskLabel = (taskValue: PredefinedTaskEnum | string): string => {
    const detail = PREDEFINED_TASK_DETAILS_MAP[taskValue as PredefinedTaskEnum];
    return detail ? detail.label : taskValue.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

// 为了与 TaskSpecificParamsInput.tsx 中的 FeParameterTypeEnum 兼容 (如果它不能直接使用 ApiParameterTypeEnum)
// 理想情况下，TaskSpecificParamsInput.tsx 应直接使用从 services/api 导入的 ApiParameterTypeEnum
// 如果 FeParameterTypeEnum 在 TaskSpecificParamsInput.tsx 中有额外的前端特定成员，则保留其定义并做好映射
// 否则，可以直接在此处导出 ApiParameterTypeEnum 作为 ParameterTypeEnum
export { ApiParameterTypeEnum as ParameterTypeEnum }; // 推荐做法