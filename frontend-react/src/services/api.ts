// frontend-react/src/services/api.ts
import axios, { AxiosError, AxiosInstance, AxiosProgressEvent } from 'axios';
import { toast } from 'react-toastify';

// 从 constants.ts 导入所有需要的枚举
import {
    NovelAnalysisStatusEnum,
    NovelVectorizationStatusEnum,
    PredefinedTaskEnum,
    PostProcessingRuleEnum,
    SentimentConstraintEnum,
    OutputFormatConstraintEnum,
    RelationshipTypeEnum,
    RelationshipStatusEnum, // 新增，对应后端 models.py CharacterRelationship
    ConflictLevelEnum,
    ConflictStatusEnum, // 新增，对应后端 models.py Conflict
    EventRelationshipTypeEnum,
    PlotBranchTypeEnum,
    PlotVersionStatusEnum,
    StepInputSourceEnum,
    TokenCostLevelEnum,
    SortDirectionEnum,
    ParameterTypeEnum, // 新增，对应后端 schemas.py ParameterTypeEnum
} from '../constants';

// API 基础URL
// 通常在 .env 文件中配置 VITE_API_BASE_URL，例如 VITE_API_BASE_URL=/api/v1
// vite.config.ts 中的 proxy 会将 /api 代理到后端
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

// 创建 Axios 实例
const apiClient: AxiosInstance = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// --- API错误处理 ---
interface ApiErrorDetailItem {
    loc?: (string | number)[];
    msg: string;
    type?: string;
}
interface ApiErrorResponse {
    detail?: string | ApiErrorDetailItem[];
}

const handleError = (error: AxiosError | Error, defaultMessage: string = '发生未知错误'): string => {
    let errorMessage = defaultMessage;
    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<ApiErrorResponse>;
        if (axiosError.response) {
            const errorData = axiosError.response.data;
            if (errorData) {
                if (typeof errorData.detail === 'string') {
                    errorMessage = errorData.detail;
                } else if (Array.isArray(errorData.detail)) {
                    errorMessage = errorData.detail
                        .map((err: ApiErrorDetailItem) => `${err.loc ? err.loc.join('.') + ': ' : ''}${err.msg}`)
                        .join('\n');
                } else if (axiosError.response.statusText) {
                    errorMessage = `${axiosError.response.status} ${axiosError.response.statusText}`;
                }
            } else if (axiosError.response.statusText) {
                 errorMessage = `${axiosError.response.status} ${axiosError.response.statusText}`;
            }
        } else if (axiosError.request) {
            errorMessage = '无法连接到服务器，请检查您的网络连接或API服务是否正在运行。';
        } else {
            errorMessage = axiosError.message;
        }
    } else if (error instanceof Error) {
        errorMessage = error.message;
    }
    console.error(`API 调用失败: ${errorMessage}`, error);
    return errorMessage;
};


// --- 通用分页响应接口 ---
export interface PaginatedResponse<T> {
    items: T[];
    total_count: number;
    page: number;
    page_size: number;
    total_pages: number;
}

// --- 配置相关接口 (与 backend/app/schemas.py -> ApplicationConfigSchema 保持一致) ---
export interface TokenizerOptions {
    local_model_token_estimation_factors?: Record<string, Record<string, number>> | null;
    default_chars_per_token_general?: number | null;
    default_chars_per_token_chinese?: number | null;
    lm_studio_prefer_api_token_count?: boolean | null;
    lm_studio_tokenize_include_model_param?: boolean | null;
    default_estimation_factors_by_provider?: Record<string, number> | null;
    truncate_initial_slice_multiplier?: number; // 新增
    truncate_max_refinement_attempts?: number; // 新增
    truncate_refinement_step_factor?: number; // 新增
}

export interface UserDefinedLLMConfig {
    user_given_id: string;
    user_given_name: string;
    model_identifier_for_api: string;
    provider_tag: string;
    api_key?: string | null;
    base_url?: string | null;
    max_context_tokens?: number | null;
    supports_system_prompt: boolean; // 在 SQLModel 中为非 Optional
    enabled: boolean; // 在 SQLModel 中为非 Optional
    notes?: string | null;
    api_key_is_from_env: boolean; // 新增，来自 schemas.py UserDefinedLLMConfigSchema
}

export interface LLMProviderConfig {
    enabled: boolean; // 在 SQLModel 中为非 Optional
    api_timeout_seconds?: number; // 在 SQLModel 中为 Optional，但有默认值
    max_retries?: number; // 在 SQLModel 中为 Optional，但有默认值
    default_jailbreak_prefix?: string | null;
    default_test_model_id?: string | null;
    api_key_source?: 'env' | 'config' | 'not_set' | null;
}

export interface LLMSettingsConfig {
    default_model_id?: string | null;
    available_models: UserDefinedLLMConfig[]; // SQLModel 中是非 Optional
    max_prompt_tokens: number; // SQLModel 中是非 Optional
    default_temperature: number; // SQLModel 中是非 Optional
    default_max_completion_tokens: number; // SQLModel 中是非 Optional
    token_buffer_overhead?: number; // SQLModel 中是非 Optional
    model_aliases?: Record<string, string>; // SQLModel 中是 Dict，非 Optional
    task_model_preference?: Record<string, string>; // SQLModel 中是 Dict，非 Optional
    default_llm_fallback: string; // SQLModel 中是非 Optional
    safety_fallback_model_id?: string | null;
    tasks_eligible_for_safety_fallback?: string[] | null;
    tokenizer_options?: TokenizerOptions; // SQLModel 中是非 Optional
    gemini_safety_settings?: Record<string, string> | null;
    global_system_prompt_prefix?: string | null;
    rag_default_top_n_context?: number; // SQLModel 中是非 Optional
    rag_default_top_n_context_fallback?: number; // SQLModel 中是非 Optional
}

export enum VectorStoreTypeEnumFE { // 与后端 schemas.VectorStoreTypeEnum 一致
    QDRANT = "qdrant",
    CHROMA = "chromadb",
}

export interface VectorStoreSettingsConfig { // 与 backend/app/schemas.py -> VectorStoreSettingsConfigSchema 保持一致
    enabled: boolean;
    type: VectorStoreTypeEnumFE;
    persist_directory?: string | null;
    embedding_model: string;
    default_collection_name: string;
    text_chunk_size: number;
    text_chunk_overlap: number;
    default_tokenizer_model_for_chunking: string;
    qdrant_host?: string | null;
    qdrant_port?: number | null;
    qdrant_grpc_port?: number | null;
    qdrant_prefer_grpc: boolean;
    qdrant_api_key?: string | null;
    qdrant_vector_size?: number | null;
    qdrant_distance_metric?: string | null;
    chromadb_path?: string | null;
    chromadb_collection?: string | null;
}

export interface EmbeddingServiceSettingsConfig { // 与 backend/app/schemas.py -> EmbeddingServiceSettingsConfigSchema 一致
    model_name: string;
    model_kwargs: Record<string, any>;
    encode_kwargs: Record<string, any>;
}

export interface AnalysisChunkSettingsConfig { // 与 backend/app/schemas.py -> AnalysisChunkSettingsConfigSchema 一致
    chunk_size: number;
    chunk_overlap: number;
    min_length_for_chunking_factor: number;
    default_tokenizer_model_for_chunking: string;
}

export enum LocalNLPDeviceEnumFE { CPU = "cpu", CUDA = "cuda" } // 与后端 schemas.LocalNLPDeviceEnum 一致
export enum LocalNLPSentenceSplitterModelEnumFE { // 与后端 schemas.LocalNLPSentenceSplitterModelEnum 一致
    SPACY_DEFAULT = "spacy_default",
    PY_SBD = "pysbd",
    NLTK_PUNKT = "nltk_punkt",
    RE_SPLITTER = "re_splitter",
}
export enum LocalNLPSentimentModelEnumFE { // 与后端 schemas.LocalNLPSentimentModelEnum 一致
    SNOWNLP_DEFAULT = "snownlp_default",
    BERT_CHINESE_SENTIMENT = "bert_chinese_sentiment",
}

export interface LocalNLPSettingsConfig { // 与 backend/app/schemas.py -> LocalNLPSettingsConfigSchema 一致
    enabled: boolean;
    device: LocalNLPDeviceEnumFE;
    sentence_splitter_model: LocalNLPSentenceSplitterModelEnumFE;
    sentiment_model: LocalNLPSentimentModelEnumFE;
    spacy_model_name: string;
}

export interface FileStorageSettingsConfig { // 与 backend/app/schemas.py -> FileStorageSettingsConfigSchema 一致
    upload_directory: string;
}
export interface ApplicationGeneralSettingsConfig { // 与 backend/app/schemas.py -> ApplicationGeneralSettingsConfigSchema 一致
    log_level: string;
    allow_config_writes_via_api: boolean;
    cors_origins?: string[]; // 新增：对应后端
    database_url?: string; // 新增：对应后端
}
export interface PlanningServiceSettingsConfig { // 与 backend/app/schemas.py -> PlanningServiceSettingsConfigSchema 一致
    use_semantic_recommendation?: boolean; // SQLModel中为非Optional，但schemas中是Optional，保持Optional
    semantic_score_weight?: number;
    max_recommendations?: number;
    plot_suggestion_context_max_tokens?: number;
    plot_suggestion_max_tokens?: number;
}
export interface TokenCostInfo { input_per_million?: number | null; output_per_million?: number | null; }
export interface CostEstimationTiers { // 与 backend/app/schemas.py -> CostEstimationTiersSchema 一致
    low_max_tokens: number;
    medium_max_tokens: number;
    token_cost_per_model?: Record<string, TokenCostInfo> | null;
    avg_tokens_per_rag_chunk?: Record<string, any> | null; // 后端是 Any
}
export interface SentimentThresholds { // 与 backend/app/schemas.py -> SentimentThresholdsSchema 一致
    positive_min_score: number;
    negative_max_score: number;
}
export interface ApplicationConfig { // 与 backend/app/schemas.py -> ApplicationConfigSchema 一致
    llm_providers: Record<string, LLMProviderConfig>;
    llm_settings: LLMSettingsConfig;
    vector_store_settings: VectorStoreSettingsConfig;
    embedding_settings: EmbeddingServiceSettingsConfig;
    analysis_chunk_settings: AnalysisChunkSettingsConfig;
    local_nlp_settings: LocalNLPSettingsConfig;
    file_storage_settings: FileStorageSettingsConfig;
    application_settings: ApplicationGeneralSettingsConfig;
    planning_settings: PlanningServiceSettingsConfig;
    cost_estimation_tiers: CostEstimationTiers;
    sentiment_thresholds: SentimentThresholds;
}

export interface ConfigUpdateResponse { // 与 backend/app/schemas.py -> ConfigUpdateResponse 一致
    message: string;
    new_config: ApplicationConfig;
}
export interface LLMProviderTestRequest { // 与 backend/app/schemas.py -> LLMProviderTestRequest 一致
    user_config_id_to_test?: string | null;
    temp_api_key?: string | null;
    temp_base_url?: string | null;
    model_identifier_for_test?: string | null;
}
export interface LLMProviderTestResponse { // 与 backend/app/schemas.py -> LLMProviderTestResponse 一致
    success: boolean;
    message: string;
    details?: string[] | null;
}

// --- 实体接口定义 (对齐 backend/app/models.py 中的 SQLModel) ---
// 注意：日期时间字段 (created_at, updated_at) 在前端通常为 string (ISO 8601 格式)
// JSON 字段 (keywords, analysis_errors, worldview_settings等) 在前端为相应的JS类型 (string[], Record<string,any>)

export interface Novel { // 对齐 models.Novel
    id: number;
    title: string;
    author?: string | null;
    file_path: string;
    summary?: string | null;
    keywords: string[]; // 之前是 string | null，models.py 是 List[str] (JSON)
    llm_extracted_roles?: any | null; // models.py 是 Optional[Any] (JSON)
    local_extracted_persons: string[]; // models.py 是 List[str] (JSON)
    analysis_status: NovelAnalysisStatusEnum;
    analysis_errors: string[]; // models.py 是 List[str] (JSON)
    vectorization_status?: NovelVectorizationStatusEnum | null;
    vectorization_errors: string[]; // models.py 是 List[str] (JSON)
    qdrant_collection_name?: string | null;
    main_conflict_ids: number[]; // models.py 是 List[int] (JSON)
    worldview_settings: Record<string, any>; // models.py 是 Dict[str, Any] (JSON)
    genre?: string | null;
    target_audience_profile?: string | null;
    main_characters_description?: string | null;
    main_plot_points_summary?: string | null;
    created_at: string; // datetime -> string
    updated_at: string; // datetime -> string
    // 关系字段通常不在列表或单个GET中默认返回全部，除非显式请求或后端配置了 eager loading。
    // 这里暂时不包含 chapters, characters 等关系列表，除非后端确认会返回。
    // 如果需要，它们的类型也应是其SQLModel对应的TS接口。
    chapters?: Chapter[]; // 假设可能包含，但需后端确认
    characters?: Character[]; // 假设可能包含
    events?: Event[]; // 假设可能包含
    conflicts?: Conflict[]; // 假设可能包含
    plot_branches?: PlotBranch[]; // 假设可能包含
}
// Create/Update 类型通常不包含 id, created_at, updated_at 和关系字段
export interface NovelCreate { // 对齐 models.NovelBase 或特定的Create SQLModel (如果定义)
    title: string;
    author?: string | null;
    file_path: string; // 创建时通常需要
    summary?: string | null;
    keywords?: string[];
    llm_extracted_roles?: any | null;
    local_extracted_persons?: string[];
    main_conflict_ids?: number[];
    worldview_settings?: Record<string, any>;
    genre?: string | null;
    target_audience_profile?: string | null;
    main_characters_description?: string | null;
    main_plot_points_summary?: string | null;
    // analysis_status, vectorization_status 等通常由后端设置
}
export interface NovelUpdate { // 对齐 models.NovelBase 或特定的Update SQLModel，所有字段可选
    title?: string | null;
    author?: string | null;
    // file_path 通常不可更新
    summary?: string | null;
    keywords?: string[];
    llm_extracted_roles?: any | null;
    local_extracted_persons?: string[];
    analysis_status?: NovelAnalysisStatusEnum | null;
    analysis_errors?: string[];
    vectorization_status?: NovelVectorizationStatusEnum | null;
    vectorization_errors?: string[];
    qdrant_collection_name?: string | null;
    main_conflict_ids?: number[];
    worldview_settings?: Record<string, any>;
    genre?: string | null;
    target_audience_profile?: string | null;
    main_characters_description?: string | null;
    main_plot_points_summary?: string | null;
}
export interface NovelUploadResponse { // 与 backend/app/schemas.py -> NovelUploadResponse 一致
    message: string;
    novel_id: number;
    title: string;
    analysis_summary: Record<string, any>;
}

// Chapter Analysis 结构 (与 backend/app/schemas.py 一致)
export interface SentimentAnalysisDetail { // 来自 schemas.py
  label: string;
  score: number;
}
export interface ChapterSentimentAnalysis { // 来自 schemas.py
  overall_sentiment_label: string;
  overall_sentiment_score: number;
  details?: SentimentAnalysisDetail[] | null;
}
export interface ChapterExtractedEvent { // 来自 schemas.py
  event_summary: string;
  involved_characters: string[];
  location?: string | null;
  trigger?: string | null;
}
export interface ChapterCharacterAnalysis { // 来自 schemas.py
  character_name: string;
  appearance_summary: string;
  new_traits_or_changes: string[];
  key_actions: string[];
}

export interface Chapter { // 对齐 models.Chapter
    id: number;
    novel_id: number;
    chapter_index: number;
    version_order?: number | null;
    title?: string | null;
    content: string;
    summary?: string | null; // 新增，来自 models.ChapterBase
    sentiment_analysis?: ChapterSentimentAnalysis | null; // 新增
    event_extraction?: ChapterExtractedEvent[] | null;    // 新增
    character_analysis?: ChapterCharacterAnalysis[] | null; // 新增
    theme_analysis?: string[] | Record<string, any> | null; // 新增
    plot_version_id?: number | null;
    created_at: string;
    updated_at: string;
}
export interface ChapterCreateForNovelPayload { // 与 backend/app/schemas.py 一致
    title?: string | null;
    content?: string; // 原 schemas.py 是 Optional[str] = ""，这里保持可选
    chapter_index?: number | null;
}
export interface ChapterCreateForVersionPayload { // 与 backend/app/schemas.py 一致
    title?: string | null;
    content?: string | null; // 原 schemas.py 是 Optional[str] = None
    chapter_index?: number | null;
    version_order?: number | null;
}
export interface ChapterUpdate { // 对齐 models.ChapterBase 或特定的Update SQLModel
    title?: string | null;
    content?: string | null;
    summary?: string | null;
    sentiment_analysis?: ChapterSentimentAnalysis | null;
    event_extraction?: ChapterExtractedEvent[] | null;
    character_analysis?: ChapterCharacterAnalysis[] | null;
    theme_analysis?: string[] | Record<string, any> | null;
    plot_version_id?: number | null; // 允许更新章节所属的版本
    chapter_index?: number | null;   // 允许更新全局索引 (需谨慎)
    version_order?: number | null;   // 允许更新版本内顺序 (通常通过 reorder 接口)
}
export interface ChapterReorderRequest { ordered_chapter_ids: number[]; } // 与 backend/app/schemas.py 一致

export interface Character { // 对齐 models.Character
    id: number;
    novel_id: number;
    name: string;
    description?: string | null;
    aliases: string[]; // models.py 是 List[str] (JSON)
    role_type?: string | null;
    first_appearance_chapter_index?: number | null;
    core_setting?: string | null; // 新增
    personality_traits?: string | null; // 新增
    appearance_description?: string | null; // 新增
    background_story?: string | null; // 新增
    tags: string[]; // 新增, models.py 是 List[str] (JSON)
    avatar_url?: string | null; // 新增
    created_at: string;
    updated_at: string;
}
export interface CharacterCreate { // 对齐 models.CharacterBase
    name: string;
    description?: string | null;
    aliases?: string[];
    role_type?: string | null;
    first_appearance_chapter_index?: number | null;
    core_setting?: string | null;
    personality_traits?: string | null;
    appearance_description?: string | null;
    background_story?: string | null;
    tags?: string[];
    avatar_url?: string | null;
}
export interface CharacterUpdate { // 对齐 models.CharacterBase, 所有字段可选
    name?: string | null;
    description?: string | null;
    aliases?: string[];
    role_type?: string | null;
    first_appearance_chapter_index?: number | null;
    core_setting?: string | null;
    personality_traits?: string | null;
    appearance_description?: string | null;
    background_story?: string | null;
    tags?: string[];
    avatar_url?: string | null;
}

export interface Event { // 对齐 models.Event
    id: number;
    novel_id: number;
    chapter_id?: number | null;
    plot_version_id?: number | null;
    summary: string;
    name?: string | null; // 新增, from models.EventBase
    description?: string | null;
    event_order?: number | null;
    sequence_in_chapter?: number | null; // 新增, from models.EventBase
    timestamp_in_story?: string | null; // 对应 models.EventBase.timestamp
    timestamp?: string | null;          // 新增, from models.EventBase, 如果两个都存在，前端可能需要合并或选择一个
    location?: string | null;
    significance_score?: number | null; // 对应 models.EventBase.significance_score
    significance?: number | null;       // 新增, from models.EventBase, 同 timestamp
    tags: string[]; // models.py 是 List[str] (JSON)
    previous_event_id?: number | null;
    next_event_id?: number | null;
    created_at: string;
    updated_at: string;
    involved_characters?: Character[]; // 关系字段
}
export interface EventCreate { // 对齐 models.EventBase
    summary: string;
    name?: string | null;
    description?: string | null;
    chapter_id?: number | null;
    plot_version_id?: number | null;
    event_order?: number | null;
    sequence_in_chapter?: number | null;
    timestamp_in_story?: string | null;
    timestamp?: string | null;
    location?: string | null;
    significance_score?: number | null;
    significance?: number | null;
    tags?: string[];
    previous_event_id?: number | null;
    next_event_id?: number | null;
    involved_character_ids?: number[]; // 创建时通过ID列表关联
}
export interface EventUpdate { // 对齐 models.EventBase, 所有字段可选
    summary?: string | null;
    name?: string | null;
    description?: string | null;
    chapter_id?: number | null;
    plot_version_id?: number | null;
    event_order?: number | null;
    sequence_in_chapter?: number | null;
    timestamp_in_story?: string | null;
    timestamp?: string | null;
    location?: string | null;
    significance_score?: number | null;
    significance?: number | null;
    tags?: string[];
    previous_event_id?: number | null;
    next_event_id?: number | null;
    involved_character_ids?: number[];
}

export interface EventRelationship { // 对齐 models.EventRelationship
    id: number;
    event_source_id: number;
    event_target_id: number;
    relationship_type: EventRelationshipTypeEnum;
    description?: string | null;
    // 新增 from_event_id, to_event_id from models.EventRelationshipBase for compatibility
    from_event_id?: number | null;
    to_event_id?: number | null;
    created_at: string;
    updated_at: string;
    event_source?: Event; // 关系字段
    event_target?: Event; // 关系字段
}

// 新增：用于图表展示的节点和边类型 (来自CharacterRelationshipListPage.tsx 和 schemas.py)
export interface CharacterGraphNode { // schemas.CharacterGraphNode
    id: number; // character.id
    label: string; // character.name
    title?: string; // tooltip: e.g. character.name + character.role_type
    group?: string; // character.role_type
    value?: number; // e.g. number of relationships for sizing
    level?: number; // for hierarchical layout
    hidden?: boolean; // 新增
    shape?: string; // 新增
    image?: string; // 新增
    color?: string | { border: string; background: string; }; // 新增
}
export interface CharacterGraphEdge { // schemas.CharacterGraphEdge
    id: string; // e.g., `rel-${rel.id}` or `char1Id-char2Id-type`
    from: number; // character_a_id
    to: number;   // character_b_id
    label?: string; // relationship_type
    title?: string; // tooltip: e.g., rel.description
    arrows?: string; // 新增
    dashes?: boolean; // 新增
    color?: string | { color?: string; highlight?: string; hover?: string; }; // 新增
}
export interface CharacterRelationshipGraph { // schemas.CharacterRelationshipGraph
    nodes: CharacterGraphNode[];
    edges: CharacterGraphEdge[];
}


export interface Conflict { // 对齐 models.Conflict
    id: number;
    novel_id: number;
    chapter_id?: number | null;
    plot_version_id?: number | null;
    description: string;
    conflict_type?: string | null; // 新增, from models.ConflictBase
    level: ConflictLevelEnum;
    status: ConflictStatusEnum; // 新增, from models.ConflictBase
    participants: (number | string)[]; // models.py 是 List[Union[int, str]] (JSON)
    involved_entities: InvolvedEntity[]; // 新增, from models.ConflictBase (JSON of schemas.InvolvedEntity)
    related_event_ids: number[]; // models.py 是 List[int] (JSON)
    resolution?: string | null; // 对应 models.ConflictBase.resolution
    resolution_details?: string | null; // 新增, from models.ConflictBase
    created_at: string;
    updated_at: string;
}
// 新增：对应后端 schemas.InvolvedEntity
export interface InvolvedEntity {
    entity_type: string;
    entity_id: number | string;
}
export interface ConflictCreate { // 对齐 models.ConflictBase
    description: string;
    conflict_type?: string | null;
    level: ConflictLevelEnum;
    status?: ConflictStatusEnum;
    chapter_id?: number | null;
    plot_version_id?: number | null;
    participants?: (number | string)[];
    involved_entities?: InvolvedEntity[];
    related_event_ids?: number[];
    resolution_details?: string | null;
}
export interface ConflictUpdate { // 对齐 models.ConflictBase, 所有字段可选
    description?: string | null;
    conflict_type?: string | null;
    level?: ConflictLevelEnum | null;
    status?: ConflictStatusEnum | null;
    participants?: (number | string)[];
    involved_entities?: InvolvedEntity[];
    related_event_ids?: number[];
    resolution_details?: string | null;
    plot_version_id?: number | null;
    chapter_id?: number | null;
}

export interface CharacterRelationship { // 对齐 models.CharacterRelationship
    id: number;
    novel_id: number;
    chapter_id?: number | null;
    character_a_id: number;
    character_b_id: number;
    relationship_type: RelationshipTypeEnum;
    status: RelationshipStatusEnum; // 新增
    description?: string | null;
    start_chapter_index?: number | null;
    end_chapter_index?: number | null;
    dynamic_changes: DynamicChange[]; // models.py 是 List[schemas.DynamicChange] (JSON)
    plot_version_id?: number | null;
    created_at: string;
    updated_at: string;
    character_a?: Character; // 关系字段
    character_b?: Character; // 关系字段
}
// 新增：对应后端 schemas.DynamicChange
export interface DynamicChange {
    chapter_index?: number | null;
    event_trigger?: string | null;
    change_description: string;
}
export interface CharacterRelationshipCreate { // 对齐 models.CharacterRelationshipBase
    chapter_id?: number | null;
    character_a_id: number;
    character_b_id: number;
    relationship_type: RelationshipTypeEnum;
    status?: RelationshipStatusEnum;
    description?: string | null;
    start_chapter_index?: number | null;
    end_chapter_index?: number | null;
    dynamic_changes?: DynamicChange[];
    plot_version_id?: number | null;
}
export interface CharacterRelationshipUpdate { // 对齐 models.CharacterRelationshipBase, 所有字段可选
    character_a_id?: number | null;
    character_b_id?: number | null;
    relationship_type?: RelationshipTypeEnum | null;
    status?: RelationshipStatusEnum | null;
    description?: string | null;
    start_chapter_index?: number | null;
    end_chapter_index?: number | null;
    dynamic_changes?: DynamicChange[];
    plot_version_id?: number | null;
    chapter_id?: number | null;
}

export interface PlotBranch { // 对齐 models.PlotBranch
    id: number;
    novel_id: number;
    name: string;
    description?: string | null;
    branch_type: PlotBranchTypeEnum;
    origin_chapter_id?: number | null;
    origin_event_id?: number | null;
    created_at: string;
    updated_at: string;
    versions?: PlotVersion[]; // 关系字段
}
export interface PlotBranchCreate { // 对齐 models.PlotBranchBase
    name: string;
    description?: string | null;
    branch_type?: PlotBranchTypeEnum;
    origin_chapter_id?: number | null;
    origin_event_id?: number | null;
    // novel_id will be set from path param
}
export type PlotBranchUpdate = Partial<PlotBranchCreate>;

export interface PlotVersion { // 对齐 models.PlotVersion
    id: number;
    plot_branch_id: number;
    version_number: number;
    version_name: string;
    description?: string | null;
    status: PlotVersionStatusEnum;
    content_summary: Record<string, any>; // models.py 是 Dict[str, Any] (JSON)
    content?: string | null; // 新增
    is_ending: boolean; // models.py 是非Optional
    created_at: string;
    updated_at: string;
    chapters_in_version?: Chapter[]; // 关系字段
}
export interface PlotVersionCreate { // 对齐 models.PlotVersionBase
    plot_branch_id: number; // 创建时通常从上下文或路径获取，但API可能要求显式提供
    version_name: string;
    description?: string | null;
    status?: PlotVersionStatusEnum;
    content_summary?: Record<string, any>;
    content?: string | null;
    is_ending?: boolean;
}
export interface PlotVersionUpdate { // 对齐 models.PlotVersionBase, 所有字段可选
    version_name?: string | null;
    description?: string | null;
    status?: PlotVersionStatusEnum | null;
    content_summary?: Record<string, any>;
    content?: string | null;
    is_ending?: boolean | null;
}

// --- 规则链与规则模板相关接口 (对齐 backend/app/models.py 和 schemas.py) ---

// RuleStepParameterDefinition (与 backend/app/schemas.py -> RuleStepParameterDefinition 一致)
// 嵌套对象的值可以是其子参数定义的记录
export type StepParameterObjectValueFE = Record<string, RuleStepParameterDefinition>;
// 完整的参数值类型，可以是原始类型或嵌套对象
// 移除 RuleStepParameterDefinitionFE from union to avoid circular ref, RuleStepParameterDefinition should handle it via StepParameterObjectValueFE
export type StepParameterValueType = SimpleParameterValue | ParameterArrayValue | StepParameterObjectValueFE;

export interface SimpleParameterValueWrapper { // 用于表示参数值是简单类型的情况
    value: string | number | boolean | null | string[];
}
export interface RuleStepParameterDefinition { // 对齐 schemas.RuleStepParameterDefinition
    param_type: ParameterTypeEnum | string; // 允许自定义字符串，但优先枚举
    value?: StepParameterValueType; // 可以是各种类型，包括嵌套的 RuleStepParameterDefinition
    label?: string;
    description?: string;
    required?: boolean;
    options?: { value: string | number; label: string }[]; // options 的 value 应该是简单类型
    config?: Record<string, any>;
    // 新增，用于支持 object 类型的 schema 定义
    schema?: Record<string, Omit<RuleStepParameterDefinition, 'value'>>;
}

export interface RuleTemplateBase { // 对齐 models.RuleTemplateBase
    name: string;
    description?: string | null;
    tags: Record<string, any>; // models.py 是 Dict[str, Any] (JSON)
    task_type: string; // 通常是 PredefinedTaskEnum，但也允许自定义字符串
    parameters: Record<string, RuleStepParameterDefinition>; // 键是参数名，值是参数定义
    custom_instruction?: string | null;
    post_processing_rules: PostProcessingRuleEnum[]; // models.py 是 List[schemas.PostProcessingRuleEnum] (JSON)
    input_source: StepInputSourceEnum;
    model_id?: string | null;
    llm_override_parameters: Record<string, any>; // models.py 是 Dict[str, Any] (JSON)
    generation_constraints?: Partial<GenerationConstraintsSchema> | null; // 对齐 schemas.GenerationConstraintsSchema
    output_variable_name?: string | null;
}
export interface RuleTemplate extends RuleTemplateBase { // 对齐 models.RuleTemplate
    id: number;
    created_at: string;
    updated_at: string;
}
export type RuleTemplateCreate = RuleTemplateBase;
export type RuleTemplateUpdate = Partial<RuleTemplateCreate>;

// 规则链中的步骤定义
export interface RuleStepCreatePrivate { // 对齐 models.RuleStepBase 用于创建
    step_type: 'private'; // 用于前端区分
    step_order: number;
    is_enabled?: boolean;
    task_type: string; // PredefinedTaskEnum | string
    parameters: Record<string, RuleStepParameterDefinition>;
    custom_instruction?: string | null;
    post_processing_rules?: PostProcessingRuleEnum[];
    input_source?: StepInputSourceEnum;
    model_id?: string | null;
    llm_override_parameters?: Record<string, any>;
    generation_constraints?: Partial<GenerationConstraintsSchema> | null;
    output_variable_name?: string | null;
    description?: string | null;
}
export interface RuleTemplateReferenceCreate { // 用于在创建链时引用模板
    step_type: 'template'; // 用于前端区分
    template_id: number;
    step_order: number;
    is_enabled?: boolean;
}
export type ChainStepCreateItem = RuleStepCreatePrivate | RuleTemplateReferenceCreate;

// 规则链中展示的步骤 (公共)
export interface RuleStepPublic extends RuleStepCreatePrivate { // 扩展自Create，并添加ID
    id: number;
    // step_type: 'private'; // 已在 RuleStepCreatePrivate 中
}
export interface RuleTemplateInChainPublic extends RuleTemplate { // 模板在链中显示时，也带有步骤顺序和启用状态
    step_type: 'template';
    step_order: number;
    is_enabled: boolean;
    template_id: number; // 确保有 template_id (RuleTemplate.id 就是 template_id)
}
export type ChainStepPublic = RuleStepPublic | RuleTemplateInChainPublic;

// 新增：对应后端 models.RuleChainRuleTemplateAssociation (用于展示和发送数据)
export interface RuleChainRuleTemplateAssociation {
    rule_chain_id: number;
    template_id: number;
    step_order: number;
    is_enabled: boolean;
    template?: RuleTemplate; // 可选，如果后端返回了关联的模板详情
}
export interface RuleChainRuleTemplateAssociationCreate { // 用于创建链时
    template_id: number;
    step_order: number;
    is_enabled?: boolean;
}


export interface RuleChainBase { // 对齐 models.RuleChainBase
    name: string;
    description?: string | null;
    is_template?: boolean;
    novel_id?: number | null;
    global_model_id?: string | null;
    global_llm_override_parameters: Record<string, any>; // models.py 是 Dict[str, Any] (JSON)
    global_generation_constraints?: Partial<GenerationConstraintsSchema> | null;
}
export interface RuleChain extends RuleChainBase { // 对齐 models.RuleChain
    id: number;
    created_at: string;
    updated_at: string;
    // steps: ChainStepPublic[]; // **重要变更**：现在分为两个列表
    steps: RuleStepPublic[]; // 仅包含私有步骤
    template_associations: RuleChainRuleTemplateAssociation[]; // 包含模板引用
}
export interface RuleChainCreate extends RuleChainBase { // 创建规则链时，也应反映这种分离
    steps: RuleStepCreatePrivate[];
    template_associations: RuleChainRuleTemplateAssociationCreate[];
}
export interface RuleChainUpdate extends Partial<RuleChainBase> { // 更新时同样
    steps?: RuleStepCreatePrivate[]; // 可以是完整的替换列表
    template_associations?: RuleChainRuleTemplateAssociationCreate[]; // 可以是完整的替换列表
}

// --- API 交互特定模型 (来自 backend/app/schemas.py) ---
// GenerationConstraintsSchema, StepExecutionResult, RuleChainExecuteRequest,
// RuleChainExecuteResponse, RuleChainStepCostEstimate, RuleChainDryRunResponse,
// SimilaritySearchQuery, SimilaritySearchResultItem, SimilaritySearchResponse,
// RAGGenerateRequest, RAGGenerateResponse, AdaptationGoalRequest, ParsedAdaptationGoal,
// RecommendedRuleChainItem, AdaptationPlanResponse, AISuggestionRequest,
// NovelAnalysisStatusInfo, VectorStoreStatusResponse, PredefinedTaskMeta, ReferableFileItem
// 这些在您的原始 api.ts 文件中已有定义，将进行核对和保留。

export interface GenerationConstraintsSchema { // 与 backend/app/schemas.py -> GenerationConstraintsSchema 一致
  max_length?: number | null;
  min_length?: number | null;
  include_keywords?: string[] | null;
  exclude_keywords?: string[] | null;
  enforce_sentiment?: SentimentConstraintEnum | null;
  style_hints?: string[] | null;
  output_format?: OutputFormatConstraintEnum | null;
  output_format_details?: Record<string, any> | null;
  scene_setting?: string | null;
  character_focus?: string[] | null;
  dialogue_style?: string | null;
  target_narrative_pace?: string | null;
  target_language_style?: string | null;
  target_description_focus?: string | null;
  reference_style_text_snippet?: string | null;
}

export enum StepExecutionStatusEnumFE { // 与 backend/app/schemas.py -> StepExecutionStatusEnum 一致
    SUCCESS = "success",
    FAILURE = "failure"
}
export interface StepExecutionResult { // 与 backend/app/schemas.py -> StepExecutionResult 一致
    step_order: number;
    task_type: string;
    input_text_snippet: string;
    output_text_snippet: string;
    status: StepExecutionStatusEnumFE;
    parameters_used?: Record<string, any> | null;
    custom_instruction_used?: string | null;
    post_processing_rules_applied?: PostProcessingRuleEnum[] | null;
    error?: string | null;
    model_used?: string | null;
    constraints_satisfied?: Record<string, boolean> | null;
}

// 流式数据块的类型 (保持原始定义，因其与后端SSE格式相关)
// StreamChunkType 已移至 constants.ts，这里不再定义
// export enum StreamChunkType { ... }
export interface StepResultData { /* ... 保持您的定义 ... */ }
export interface FinalOutputData { /* ... 保持您的定义 ... */ }
export interface ErrorData { /* ... 保持您的定义 ... */ }
export interface MetadataData { /* ... 保持您的定义 ... */ }
export type StreamChunkActualData = StepResultData | FinalOutputData | ErrorData | MetadataData | string | Record<string, unknown>;

export interface StreamChunk { // 对应后端发送的SSE消息结构
    type: string; // StreamChunkTypeEnum (来自 constants.ts)
    data: StreamChunkActualData;
    step_order?: number;
    is_final_step?: boolean;
}

export interface RuleChainExecuteRequest { // 与 backend/app/schemas.py -> RuleChainExecuteRequest 一致
    source_text: string;
    novel_id: number;
    rule_chain_id?: number | null;
    // **重要变更**：rule_chain_definition 现在也应反映分离的 steps 和 template_associations
    rule_chain_definition?: RuleChainCreate | null; // 使用前端的 RuleChainCreate
    dry_run?: boolean;
    stream?: boolean;
    user_provided_params?: Record<string, any> | null; // 新增，对应后端
}
export interface RuleChainExecuteResponse { // 与 backend/app/schemas.py -> RuleChainExecuteResponse 一致
    original_text: string;
    final_output_text: string;
    executed_chain_id?: number | null;
    executed_chain_name?: string | null;
    steps_results: StepExecutionResult[];
    total_execution_time?: number | null;
}
export interface RuleChainStepCostEstimate { // 与 backend/app/schemas.py -> RuleChainStepCostEstimate 一致
    step_order: number;
    task_type: string;
    model_to_be_used: string;
    estimated_prompt_tokens: number;
    max_completion_tokens?: number | null;
}
export interface RuleChainDryRunResponse { // 与 backend/app/schemas.py -> RuleChainDryRunResponse 一致
    estimated_total_prompt_tokens: number;
    estimated_total_completion_tokens: number;
    token_cost_level: TokenCostLevelEnum | string; // 后端是 TokenCostLevelEnum
    steps_estimates: RuleChainStepCostEstimate[];
    warnings?: string[] | null;
}

export interface TextProcessRequest { // 与 backend/app/schemas.py -> TextProcessRequest 一致
    text?: string | null;
    task: PredefinedTaskEnum | string; // 后端是 Union[PredefinedTaskEnum, str]
    parameters?: Record<string, any> | null;
    custom_instruction?: string | null;
    post_processing_rules?: PostProcessingRuleEnum[] | null;
    model_id?: string | null;
    llm_override_parameters?: Record<string, any> | null;
    generation_constraints?: Partial<GenerationConstraintsSchema> | null;
    retrieved_context?: string | null; // 新增
}
export interface TextProcessResponse { // 与 backend/app/schemas.py -> TextProcessResponse 一致
    original_text?: string | null;
    processed_text: string;
    task_used: string;
    parameters_used?: Record<string, any> | null;
    post_process_rule_applied?: PostProcessingRuleEnum[] | null;
    instruction_used?: string | null;
    model_used?: string | null;
    constraints_applied?: Partial<GenerationConstraintsSchema> | null;
    constraints_satisfied?: Record<string, boolean> | null;
    retrieved_context_preview?: string | null; // 新增
}

export interface SimilaritySearchQuery { query: string; top_n?: number; } // 与 backend/app/schemas.py 一致
export interface SimilaritySearchResultItem { // 与 backend/app/schemas.py 一致
    id: string;
    text: string;
    metadata: Record<string, any>;
    distance: number;
    source?: string | null;
    // 新增：为了与后端返回的结构体对齐 (SimilaritySearchResult in vector_store_service.py)
    novel_id?: number | null;
    chapter_id?: number | null;
    chapter_order?: number | null;
    version_order?: number | null;
    plot_version_id?: number | null;
    chapter_title?: string | null;
    chunk_index_in_chapter?: number | null;
    full_text_content?: string; // 可选，如果前端需要完整内容
    similarity_score?: number; // 可选，如果API返回的是score而不是distance
    qdrant_point_id?: string;  // 可选
}
export interface SimilaritySearchResponse { // 与 backend/app/schemas.py 一致
    query_text: string;
    results: SimilaritySearchResultItem[];
    search_time?: number | null;
}

export interface RAGGenerateRequest { // 与 backend/app/schemas.py -> RAGGenerateRequest 一致
    instruction: string;
    top_n_context?: number;
    model_id?: string | null;
    llm_override_parameters?: Record<string, any> | null;
    generation_constraints?: Partial<GenerationConstraintsSchema> | null;
}
export interface RAGGenerateResponse { // 与 backend/app/schemas.py -> RAGGenerateResponse 一致
    instruction: string;
    retrieved_context_snippets: string[];
    generated_text: string;
    search_time?: number | null;
    generation_time?: number | null;
    model_used?: string | null;
    constraints_applied?: Partial<GenerationConstraintsSchema> | null;
    constraints_satisfied?: Record<string, boolean> | null;
}

export interface AdaptationGoalRequest { goal_description: string; novel_id?: number | null; } // 与 backend/app/schemas.py 一致
export interface ParsedAdaptationGoal { // 与 backend/app/schemas.py 一致
    main_intent?: string | null;
    key_elements?: string[] | null;
    target_style?: string[] | null;
    target_sentiment?: SentimentConstraintEnum | null;
    target_audience?: string | null;
    length_modification?: string | null;
    specific_instructions?: string | null;
    novel_title_hint?: string | null;
    focus_chapters_or_parts?: string | null;
}
export interface RecommendedRuleChainItem { // 与 backend/app/schemas.py 一致
    chain_id: number;
    chain_name: string;
    description?: string | null;
    relevance_score: number;
    reasoning?: string | null;
}
export interface AdaptationPlanResponse { // 与 backend/app/schemas.py 一致
    original_goal: string;
    parsed_goal?: ParsedAdaptationGoal | null;
    recommended_chains?: RecommendedRuleChainItem[] | null;
    // **重要变更**：generated_chain_draft 现在是 RuleChainCreate 类型，以匹配前端对分离步骤的需求
    generated_chain_draft?: RuleChainCreate | null;
    planner_log?: string[] | null;
}

export interface AISuggestionRequest { // 与 backend/app/schemas.py 一致
    user_prompt: string;
    parent_version_id?: number | null;
    model_id?: string | null;
    llm_parameters?: Record<string, any> | null;
}
// AISuggestionResponse is essentially a PlotVersion, so use PlotVersion interface.

export interface NovelAnalysisStatusInfo { // 与 backend/app/schemas.py 一致
    novel_id: number;
    analysis_status?: NovelAnalysisStatusEnum | null;
    vectorization_status?: NovelVectorizationStatusEnum | null;
    analysis_errors?: string[] | null;
    vectorization_errors?: string[] | null;
    last_updated?: string | null; // datetime -> string
    qdrant_collection_name?: string | null;
}
export interface VectorStoreStatusResponse { // 与 backend/app/schemas.py 一致
    collection_name: string;
    document_count: number;
    status: string;
    error_message?: string | null;
    embedding_function_name?: string | null;
    client_type?: string | null;
}
export interface PredefinedTaskMeta { // 与 backend/app/schemas.py 一致
    id: PredefinedTaskEnum;
    label: string;
    description: string;
    key_params?: string[] | null; // 后端是 List[str] = Field(default_factory=list)
}
export interface PredefinedTaskUIItem extends PredefinedTaskMeta { // 前端UI特定
    value: PredefinedTaskEnum; // for Select components
    keyParams?: string[] | null; // alias for key_params
}
export interface ReferableFileItem { // 与 backend/app/schemas.py 一致
    id: string;
    name: string;
    file_type: string;
    size?: number | null;
    created_at?: string | null; // datetime -> string
    updated_at?: string | null; // datetime -> string
    url?: string | null;
    description?: string | null;
    novel_id?: number | null;
}


// --- API 函数实现 (大部分保持不变，但需要更新参数和返回类型) ---

// Configuration
export const getApplicationConfig = async (): Promise<ApplicationConfig> => { try { const response = await apiClient.get<ApplicationConfig>('/configuration/'); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, "获取应用配置失败。")); } };
export const updateApplicationConfig = async (configData: ApplicationConfig): Promise<ConfigUpdateResponse> => { try { const response = await apiClient.post<ConfigUpdateResponse>('/configuration/', configData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, "更新应用配置失败。")); } };
export const getLLMProviderTags = async (): Promise<string[]> => { try { const response = await apiClient.get<string[]>('/configuration/llm/provider-tags'); return response.data || []; } catch (error) { throw new Error(handleError(error as AxiosError, "获取LLM提供商标签列表失败。")); } };
export const testLLMProvider = async (testData: LLMProviderTestRequest): Promise<LLMProviderTestResponse> => { try { const response = await apiClient.post<LLMProviderTestResponse>(`/configuration/test-llm-provider`, testData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `测试LLM提供商连接失败。`)); } };

// Novels
export const getNovels = async (page: number = 1, pageSize: number = 10): Promise<PaginatedResponse<Novel>> => { try { const response = await apiClient.get<PaginatedResponse<Novel>>('/novels/', { params: { page, page_size: pageSize } }); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, "获取小说列表失败。")); } };
export const getNovelById = async (novelId: number): Promise<Novel> => { try { const response = await apiClient.get<Novel>(`/novels/${novelId}`); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 失败。`)); } };
export const updateNovel = async (novelId: number, novelData: NovelUpdate): Promise<Novel> => { try { const response = await apiClient.put<Novel>(`/novels/${novelId}`, novelData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `更新小说 #${novelId} 失败。`)); } };
export const deleteNovel = async (novelId: number): Promise<void> => { try { await apiClient.delete(`/novels/${novelId}`); } catch (error) { throw new Error(handleError(error as AxiosError, `删除小说 #${novelId} 失败。`)); } };
export const uploadNovelFile = async (formData: FormData, onUploadProgress?: (progressEvent: AxiosProgressEvent) => void): Promise<NovelUploadResponse> => { // Renamed from uploadNovel
    try {
        const response = await apiClient.post<NovelUploadResponse>('/novels/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress
        });
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, "上传小说文件失败。"));
    }
};
export const createNovelEntry = async (novelData: NovelCreate): Promise<Novel> => { try { const response = await apiClient.post<Novel>('/novels/', novelData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, "创建小说条目失败。")); } };
export const startNovelAnalysis = async (novelId: number): Promise<NovelAnalysisStatusInfo> => { try { const response = await apiClient.post<NovelAnalysisStatusInfo>(`/novels/${novelId}/analyze`); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `启动小说 #${novelId} 分析失败。`)); } }; // Endpoint might be /novels/{novel_id}/analyze or /novels/{novel_id}/start-analysis
export const getNovelAnalysisStatusSummary = async (novelId: number): Promise<NovelAnalysisStatusInfo> => { try { const response = await apiClient.get<NovelAnalysisStatusInfo>(`/novels/${novelId}/analysis-status`); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 分析状态失败。`)); } }; // Renamed, and endpoint changed

// Chapters
export interface GetChaptersParams { // 新增参数接口
    plot_version_id?: number | 'UNASSIGNED' | string | null; // string for "UNASSIGNED"
    is_mainline?: boolean | null;
    page?: number;
    page_size?: number;
    sort_by?: string;
    sort_direction?: SortDirectionEnum;
}
export const getChaptersByNovelId = async (novelId: number, params?: GetChaptersParams): Promise<PaginatedResponse<Chapter>> => { try { const response = await apiClient.get<PaginatedResponse<Chapter>>(`/novels/${novelId}/chapters`, { params }); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的章节列表失败。`)); } };
export const createChapterForNovel = async (novelId: number, chapterData: ChapterCreateForNovelPayload): Promise<Chapter> => { try { const response = await apiClient.post<Chapter>(`/novels/${novelId}/chapters`, chapterData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建主线章节失败。`));} };
// createChapterForPlotVersion 在 plot_versions.py 路由中，这里保持独立
export const getChapterById = async (chapterId: number): Promise<Chapter> => { try { const response = await apiClient.get<Chapter>(`/chapters/${chapterId}`); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `获取章节 #${chapterId} 失败。`)); } }; // novelId no longer in path
export const updateChapter = async (chapterId: number, chapterData: ChapterUpdate): Promise<Chapter> => { try { const response = await apiClient.put<Chapter>(`/chapters/${chapterId}`, chapterData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `更新章节 #${chapterId} 失败。`)); } }; // novelId no longer in path
export const deleteChapter = async (chapterId: number): Promise<void> => { try { await apiClient.delete(`/chapters/${chapterId}`); } catch (error) { throw new Error(handleError(error as AxiosError, `删除章节 #${chapterId} 失败。`)); } }; // novelId no longer in path
// reorderChaptersInVersion 在 plot_versions.py 路由中

// Characters
export interface GetCharactersParams {
    name?: string;
    role_type?: string;
    sort_by?: string;
    sort_dir?: SortDirectionEnum;
    page?: number; // Changed from skip
    page_size?: number; // Changed from limit
}
export const getCharactersByNovelId = async (novelId: number, params?: GetCharactersParams): Promise<PaginatedResponse<Character>> => { try { const response = await apiClient.get<PaginatedResponse<Character>>(`/novels/${novelId}/characters/`, { params }); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的角色列表失败。`)); } };
export const createCharacter = async (novelId: number, characterData: CharacterCreate): Promise<Character> => { try { const response = await apiClient.post<Character>(`/novels/${novelId}/characters/`, characterData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建角色失败。`)); } };
export const getCharacterById = async (novelId: number, characterId: number): Promise<Character> => { try { const response = await apiClient.get<Character>(`/novels/${novelId}/characters/${characterId}`); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `获取角色 #${characterId} (小说 #${novelId}) 失败。`)); } };
export const updateCharacter = async (novelId: number, characterId: number, characterData: CharacterUpdate): Promise<Character> => { try { const response = await apiClient.put<Character>(`/novels/${novelId}/characters/${characterId}`, characterData); return response.data; } catch (e) { throw new Error(handleError(e as AxiosError, `更新角色 #${characterId} (小说 #${novelId}) 失败。`)); } };
export const deleteCharacter = async (novelId: number, characterId: number): Promise<void> => { try { await apiClient.delete(`/novels/${novelId}/characters/${characterId}`); } catch (e) { throw new Error(handleError(e as AxiosError, `删除角色 #${characterId} (小说 #${novelId}) 失败。`)); } };

// Events
export interface GetEventsParams {
    summary?: string;
    tags?: string; // Comma-separated string
    plot_version_id?: number | 'UNASSIGNED' | string | null;
    event_order_min?: number;
    event_order_max?: number;
    significance_min?: number;
    significance_max?: number;
    sort_by?: string;
    sort_dir?: SortDirectionEnum;
    page?: number; // Changed from skip
    page_size?: number; // Changed from limit
}
// Events are now primarily under /novels/{novel_id}/events
export const getEventsByNovelId = async (novelId: number, params?: GetEventsParams): Promise<PaginatedResponse<Event>> => { try { const response = await apiClient.get<PaginatedResponse<Event>>(`/novels/${novelId}/events/`, { params }); return response.data; } catch (e) { throw new Error(handleError(e as AxiosError, `获取小说 #${novelId} 的事件列表失败。`)); } };
export const createEvent = async (novelId: number, eventData: EventCreate): Promise<Event> => { try { const response = await apiClient.post<Event>(`/novels/${novelId}/events/`, eventData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建事件失败。`)); } };
// Global event GET/PUT/DELETE (by event_id only) might be needed if a page focuses only on one event without novel context in URL
// For now, assuming operations are contextualized by novel_id from path.
export const getEventById = async (novelId: number, eventId: number): Promise<Event> => { try { const response = await apiClient.get<Event>(`/novels/${novelId}/events/${eventId}`); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `获取事件 #${eventId} (小说 #${novelId}) 失败。`)); } };
export const updateEvent = async (novelId: number, eventId: number, eventData: EventUpdate ): Promise<Event> => { try { const response = await apiClient.put<Event>(`/novels/${novelId}/events/${eventId}`, eventData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `更新事件 #${eventId} (小说 #${novelId}) 失败。`)); } };
export const deleteEvent = async (novelId: number, eventId: number): Promise<void> => { try { await apiClient.delete(`/novels/${novelId}/events/${eventId}`); } catch (error) { throw new Error(handleError(error as AxiosError, `删除事件 #${eventId} (小说 #${novelId}) 失败。`)); } };
// Event Relationships are now under /event-relationships
export const getAllEventRelationshipsByNovelId = async (novelId: number): Promise<EventRelationship[]> => { try { const response = await apiClient.get<EventRelationship[]>(`/novels/${novelId}/events/all-relationships`); return response.data; } catch (e) { throw new Error(handleError(e as AxiosError, `获取小说 #${novelId} 的事件关系列表失败。`)); } };

// Conflicts
export interface GetConflictsParams {
    description?: string;
    level?: ConflictLevelEnum | null;
    plot_version_id?: number | 'UNASSIGNED' | string | null;
    sort_by?: string;
    sort_dir?: SortDirectionEnum;
    page?: number; // Changed
    page_size?: number; // Changed
}
// Conflicts are now primarily under /novels/{novel_id}/conflicts
export const getConflictsByNovelId = async (novelId: number, params?: GetConflictsParams): Promise<PaginatedResponse<Conflict>> => { try { const response = await apiClient.get<PaginatedResponse<Conflict>>(`/novels/${novelId}/conflicts/`, { params }); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的冲突列表失败。`)); } };
export const createConflict = async (novelId: number, conflictData: ConflictCreate): Promise<Conflict> => {  try { const response = await apiClient.post<Conflict>(`/novels/${novelId}/conflicts/`, conflictData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建冲突失败。`)); } };
export const getConflictById = async (novelId: number, conflictId: number): Promise<Conflict> => { try { const response = await apiClient.get<Conflict>(`/novels/${novelId}/conflicts/${conflictId}`); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `获取冲突 #${conflictId} (小说 #${novelId}) 失败。`)); } };
export const updateConflict = async (novelId: number, conflictId: number, conflictData: ConflictUpdate): Promise<Conflict> => { try { const response = await apiClient.put<Conflict>(`/novels/${novelId}/conflicts/${conflictId}`, conflictData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `更新冲突 #${conflictId} (小说 #${novelId}) 失败。`)); } };
export const deleteConflict = async (novelId: number, conflictId: number): Promise<void> => { try { await apiClient.delete(`/novels/${novelId}/conflicts/${conflictId}`); } catch (error) { throw new Error(handleError(error as AxiosError, `删除冲突 #${conflictId} (小说 #${novelId}) 失败。`)); } };

// CharacterRelationships
export interface GetCharacterRelationshipsParams {
    plot_version_id?: number | 'UNASSIGNED' | string | null;
    // chapter_id?: number; // Removed as not directly supported in backend router
    page?: number;
    page_size?: number;
    // Add sort_by, sort_dir if backend supports
}
export const getCharacterRelationshipsByNovelId = async (novelId: number, params?: GetCharacterRelationshipsParams): Promise<PaginatedResponse<CharacterRelationship>> => { try { const response = await apiClient.get<PaginatedResponse<CharacterRelationship>>(`/novels/${novelId}/character-relationships/`, { params }); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的人物关系列表失败。`)); } };
export const createCharacterRelationship = async (novelId: number, relData: CharacterRelationshipCreate): Promise<CharacterRelationship> => { try { const response = await apiClient.post<CharacterRelationship>(`/novels/${novelId}/character-relationships/`, relData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建人物关系失败。`)); } };
export const getCharacterRelationshipById = async (novelId: number, relationshipId: number): Promise<CharacterRelationship> => { try { const response = await apiClient.get<CharacterRelationship>(`/novels/${novelId}/character-relationships/${relationshipId}`); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `获取人物关系 #${relationshipId} (小说 #${novelId}) 失败。`)); } };
export const updateCharacterRelationship = async (novelId: number, relationshipId: number, relData: CharacterRelationshipUpdate): Promise<CharacterRelationship> => { try { const response = await apiClient.put<CharacterRelationship>(`/novels/${novelId}/character-relationships/${relationshipId}`, relData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `更新人物关系 #${relationshipId} (小说 #${novelId}) 失败。`)); } };
export const deleteCharacterRelationship = async (novelId: number, relationshipId: number): Promise<void> => { try { await apiClient.delete(`/novels/${novelId}/character-relationships/${relationshipId}`); } catch (error) { throw new Error(handleError(error as AxiosError, `删除人物关系 #${relationshipId} (小说 #${novelId}) 失败。`)); } };
// Get Character Relationship Graph Data
export const getCharacterRelationshipGraphData = async (novelId: number, plotVersionId?: number): Promise<CharacterRelationshipGraph> => {
    try {
        const params: Record<string, any> = {};
        if (plotVersionId !== undefined) params.plot_version_id = plotVersionId;
        const response = await apiClient.get<CharacterRelationshipGraph>(`/novels/${novelId}/character-relationships/graph`, { params });
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的角色关系图数据失败。`));
    }
};


// Plot Branches
export const getPlotBranchesByNovelId = async (novelId: number, page: number = 1, pageSize: number = 100): Promise<PaginatedResponse<PlotBranch>> => { try { const response = await apiClient.get<PaginatedResponse<PlotBranch>>(`/novels/${novelId}/plot-branches/`, {params: {page, page_size: pageSize}}); return response.data;} catch (error) { throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的剧情分支列表失败。`)); }};
export const createPlotBranch = async (novelId: number, branchData: PlotBranchCreate): Promise<PlotBranch> => {  try { const response = await apiClient.post<PlotBranch>(`/novels/${novelId}/plot-branches/`, branchData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建剧情分支失败。`)); }};
export const getPlotBranchById = async (novelId: number, plotBranchId: number): Promise<PlotBranch> => { try { const r = await apiClient.get<PlotBranch>(`/novels/${novelId}/plot-branches/${plotBranchId}`); return r.data; } catch(e){throw new Error(handleError(e as AxiosError, `获取分支 #${plotBranchId} (小说 #${novelId}) 失败`));}};
export const updatePlotBranch = async (novelId: number, plotBranchId: number, data: PlotBranchUpdate): Promise<PlotBranch> => { try { const r = await apiClient.put<PlotBranch>(`/novels/${novelId}/plot-branches/${plotBranchId}`, data); return r.data; } catch(e){throw new Error(handleError(e as AxiosError, `更新分支 #${plotBranchId} (小说 #${novelId}) 失败`));}};
export const deletePlotBranch = async (novelId: number, plotBranchId: number): Promise<void> => { try { await apiClient.delete(`/novels/${novelId}/plot-branches/${plotBranchId}`); } catch(e){throw new Error(handleError(e as AxiosError, `删除分支 #${plotBranchId} (小说 #${novelId}) 失败`));}};

// Plot Versions
export const getPlotVersionsByBranchId = async (novelId: number, branchId: number, page: number = 1, pageSize: number = 100): Promise<PaginatedResponse<PlotVersion>> => { try { const r = await apiClient.get<PaginatedResponse<PlotVersion>>(`/novels/${novelId}/plot-branches/${branchId}/versions/`, {params:{page, page_size: pageSize}}); return r.data; } catch(e){throw new Error(handleError(e as AxiosError,`获取分支 #${branchId} 的版本列表失败`));}};
export const createPlotVersion = async (novelId: number, branchId: number, plotVersionData: PlotVersionCreate): Promise<PlotVersion> => {  try { const response = await apiClient.post<PlotVersion>(`/novels/${novelId}/plot-branches/${branchId}/versions/`, plotVersionData); return response.data; } catch(e){throw new Error(handleError(e as AxiosError,`创建版本失败 (分支ID: ${branchId})`));}};
export const getPlotVersionById = async (novelId: number, branchId: number, versionId: number): Promise<PlotVersion> => { try { const r = await apiClient.get<PlotVersion>(`/novels/${novelId}/plot-branches/${branchId}/versions/${versionId}`); return r.data; } catch(e){throw new Error(handleError(e as AxiosError,`获取版本 #${versionId} 失败`));}};
export const updatePlotVersion = async (novelId: number, branchId: number, versionId: number, data: PlotVersionUpdate): Promise<PlotVersion> => { try { const r = await apiClient.put<PlotVersion>(`/novels/${novelId}/plot-branches/${branchId}/versions/${versionId}`, data); return r.data; } catch(e){throw new Error(handleError(e as AxiosError,`更新版本 #${versionId} 失败`));}};
export const deletePlotVersion = async (novelId: number, branchId: number, versionId: number): Promise<void> => { try { await apiClient.delete(`/novels/${novelId}/plot-branches/${branchId}/versions/${versionId}`); } catch(e){throw new Error(handleError(e as AxiosError,`删除版本 #${versionId} 失败`));}};
export const generateAISuggestedPlotVersion = async (novelId: number, branchId: number, reqData: AISuggestionRequest): Promise<PlotVersion> => { try { const r = await apiClient.post<PlotVersion>(`/novels/${novelId}/plot-branches/${branchId}/versions/ai-suggestion`, reqData); return r.data; } catch(e){throw new Error(handleError(e as AxiosError,`为分支 #${branchId} AI建议版本失败`));}};
export const reorderChaptersInVersion = async (novelId: number, branchId: number, versionId: number, reorderRequest: ChapterReorderRequest): Promise<Chapter[]> => { try { const response = await apiClient.put<Chapter[]>(`/novels/${novelId}/plot-branches/${branchId}/versions/${versionId}/reorder-chapters`, reorderRequest); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `为剧情版本 #${versionId} 重排章节顺序失败。`)); } };

// Novel Worldview Settings
export const updateNovelWorldviewSettings = async (novelId: number, worldviewData: Record<string, unknown>): Promise<Novel> => { try { const response = await apiClient.put<Novel>(`/novels/${novelId}/worldview`, worldviewData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `更新小说 #${novelId} 的世界观设定失败。`)); } };
export const getNovelWorldviewSettings = async (novelId: number): Promise<Record<string, unknown> | null> => { try { const response = await apiClient.get<Record<string, unknown> | null>(`/novels/${novelId}/worldview`); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的世界观设定失败。`)); } };

// NamedEntity (Assuming it's under novel, adjust if it's global or under chapter)
export interface NamedEntity { // 对齐 models.NamedEntity
    id: number;
    novel_id: number;
    chapter_id?: number | null;
    text: string;
    label: string;
    start_char?: number | null;
    end_char?: number | null;
    description?: string | null;
    created_at: string;
    updated_at: string;
}
export interface NamedEntityCreate { // 对齐 models.NamedEntityBase
    text: string;
    label: string;
    chapter_id?: number | null;
    start_char?: number | null;
    end_char?: number | null;
    description?: string | null;
}
export const createNamedEntity = async (novelId: number, data: NamedEntityCreate): Promise<NamedEntity> => { try { const response = await apiClient.post<NamedEntity>(`/novels/${novelId}/named-entities/`, data); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建命名实体失败。`)); } };

// RuleChains
export const getRuleChains = async (page: number = 1, pageSize: number = 100, is_template?: boolean, novel_id?: number): Promise<PaginatedResponse<RuleChain>> => {
    try {
        const params: Record<string, string | number | boolean> = { page, page_size: pageSize };
        if (is_template !== undefined) params.is_template = is_template;
        if (novel_id !== undefined) params.novel_id = novel_id;
        const response = await apiClient.get<PaginatedResponse<RuleChain>>('/rule-chains/', { params });
        return response.data;
    } catch (error) { throw new Error(handleError(error as AxiosError, "获取规则链列表失败。")); }
};
export const getRuleChainById = async (id: number): Promise<RuleChain> => { try { const response = await apiClient.get<RuleChain>(`/rule-chains/${id}`); return response.data;} catch(e){throw new Error(handleError(e as AxiosError, `获取规则链 #${id} 失败`));}}; // Renamed from getRuleChainDetail
export const createRuleChain = async (data: RuleChainCreate): Promise<RuleChain> => { try { const response = await apiClient.post<RuleChain>('/rule-chains/', data); return response.data;} catch(e){throw new Error(handleError(e as AxiosError, `创建规则链失败`));}};
export const updateRuleChain = async (id: number, data: RuleChainUpdate): Promise<RuleChain> => { try { const response = await apiClient.put<RuleChain>(`/rule-chains/${id}`, data); return response.data;} catch(e){throw new Error(handleError(e as AxiosError, `更新规则链 #${id} 失败`));}};
export const deleteRuleChain = async (id: number): Promise<void> => { try { await apiClient.delete(`/rule-chains/${id}`); } catch(e){throw new Error(handleError(e as AxiosError, `删除规则链 #${id} 失败`));}};
// createRuleChainFromTemplate - assuming this is for internal use or specific UI, if it's a general API, it should be here.
// Based on routers/rule_chains.py, there's no /create_from_template/{templateId} endpoint. It's a client-side logic.

// RuleTemplates
export const getRuleTemplates = async (page: number = 1, pageSize: number = 100): Promise<PaginatedResponse<RuleTemplate>> => { try { const response = await apiClient.get<PaginatedResponse<RuleTemplate>>('/rule-templates/', { params: { page, page_size: pageSize } }); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, "获取规则模板列表失败。")); }};
export const getRuleTemplateById = async (id: number): Promise<RuleTemplate> => { try { const response = await apiClient.get<RuleTemplate>(`/rule-templates/${id}`); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `获取规则模板 #${id} 失败。`)); }}; // Renamed from getRuleTemplate
export const createRuleTemplate = async (template: RuleTemplateCreate): Promise<RuleTemplate> => { try { const response = await apiClient.post<RuleTemplate>('/rule-templates/', template); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, "创建规则模板失败。")); }};
export const updateRuleTemplate = async (id: number, template: RuleTemplateUpdate): Promise<RuleTemplate> => { try { const response = await apiClient.put<RuleTemplate>(`/rule-templates/${id}`, template); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `更新规则模板 #${id} 失败。`)); }};
export const deleteRuleTemplate = async (id: number): Promise<void> => { try { await apiClient.delete(`/rule-templates/${id}`); } catch (error) { throw new Error(handleError(error as AxiosError, `删除规则模板 #${id} 失败。`)); }};

// Text Processing & LLM Utils
export const directLLMCompletion = async (requestData: { prompt: string; system_prompt?: string | null; model_id?: string | null; llm_parameters?: Record<string, unknown> | null; }): Promise<TextProcessResponse> => { try { const response = await apiClient.post<TextProcessResponse>('/llm-utils/direct-completion', requestData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, "直接LLM补全失败。")); }};
export const processTextWithLLM = async (requestData: TextProcessRequest): Promise<TextProcessResponse> => { try { const response = await apiClient.post<TextProcessResponse>('/text-processing/process', requestData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, "LLM文本处理失败。")); }};

export const executeRuleChain = async (requestData: RuleChainExecuteRequest): Promise<RuleChainExecuteResponse | RuleChainDryRunResponse> => { try { const endpoint = requestData.dry_run ? '/rule-chains/dry-run' : '/rule-chains/execute'; if (requestData.stream && !requestData.dry_run) { throw new Error("对于流式执行，请使用 executeRuleChainAndStream 函数。"); } const response = await apiClient.post<RuleChainExecuteResponse | RuleChainDryRunResponse>(endpoint, requestData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, "规则链执行失败。")); }};
export async function executeRuleChainAndStream(
    payload: RuleChainExecuteRequest, // Now takes full payload
    onChunk: (data: StreamChunk) => void, // Changed to StreamChunk
    onError: (error: Error) => void,
    onComplete: () => void
) {
    // Ensure stream is true
    const fullPayload: RuleChainExecuteRequest = { ...payload, stream: true };
    try {
        const response = await fetch(`${API_BASE_URL}/rule-chains/execute`, { // Endpoint changed
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/x-ndjson' },
            body: JSON.stringify(fullPayload),
        });
        if (!response.ok || !response.body) {
            let errorData; try { errorData = await response.json(); } catch { errorData = { detail: `流式请求失败，状态码: ${response.status} ${response.statusText}` }; }
            const errorMessage = handleError(errorData as AxiosError<ApiErrorResponse>, `流式请求失败，状态码: ${response.status}`);
            onError(new Error(errorMessage)); return;
        }
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
        while (true) {
            const { done, value } = await reader.read(); if (done) break;
            buffer += decoder.decode(value, { stream: true }); let eolIndex;
            while ((eolIndex = buffer.indexOf('\n\n')) >= 0) { // SSE events end with \n\n
                const eventString = buffer.slice(0, eolIndex).trim();
                buffer = buffer.slice(eolIndex + 2);
                if (eventString) {
                    const lines = eventString.split('\n');
                    const eventData: Partial<StreamChunk> = {};
                    lines.forEach(line => {
                        if (line.startsWith('event:')) eventData.type = line.substring(6).trim();
                        else if (line.startsWith('data:')) {
                            try { eventData.data = JSON.parse(line.substring(5).trim()); }
                            catch (e) { eventData.data = line.substring(5).trim(); /* store as string if not JSON */ }
                        }
                        // id field can also be parsed if needed
                    });
                    if (eventData.type && eventData.data !== undefined) {
                        onChunk(eventData as StreamChunk);
                    } else if (eventData.data) { // If only data field is present, assume 'message' event
                         onChunk({type: 'message', data: eventData.data } as StreamChunk)
                    }
                }
            }
        }
        // Process any remaining buffer content (though SSE usually ends with \n\n)
        // if (buffer.trim()) { ... } // Less likely for SSE
    } catch (error) {
        onError(new Error(handleError(error as AxiosError, "流式执行规则链时发生连接或请求错误。")));
    } finally {
        onComplete();
    }
}


// Planning Service
export const analyzeAdaptationGoal = async (requestData: AdaptationGoalRequest): Promise<AdaptationPlanResponse> => {  try { const response = await apiClient.post<AdaptationPlanResponse>('/planning/analyze-goal', requestData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, "解析改编目标失败。")); }}; // Renamed from parseAdaptationGoal
export const generateRuleChainDraftFromGoal = async (requestData: AdaptationGoalRequest): Promise<AdaptationPlanResponse> => {  try { const response = await apiClient.post<AdaptationPlanResponse>('/planning/generate-draft-chain', requestData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, "生成规则链草稿失败。")); }}; // Renamed from generateRuleChainDraft

// Vector Store & RAG
export const getVectorStoreStatus = async (): Promise<VectorStoreStatusResponse> => { try { const response = await apiClient.get<VectorStoreStatusResponse>('/configuration/vector-store/status'); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, "获取向量存储状态失败。")); }};
export const searchSimilarChunksInNovel = async (novelId: number, requestData: SimilaritySearchQuery): Promise<SimilaritySearchResponse> => { try { const response = await apiClient.post<SimilaritySearchResponse>(`/text-processing/similarity-search/${novelId}`, requestData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `在小说 #${novelId} 中进行相似性搜索失败。`)); }};
export const rebuildVectorStoreIndexForNovel = async (novelId: number): Promise<{ message: string, novel_id?: number }> => {  try { const response = await apiClient.post<{ message: string, novel_id?: number }>(`/text-processing/vector-store/rebuild-index/novel/${novelId}`); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `重建小说 #${novelId} 向量索引失败。`));}}; // Endpoint changed
export const ragGenerateWithNovelContext = async (novelId: number, requestData: RAGGenerateRequest): Promise<RAGGenerateResponse> => { try { const response = await apiClient.post<RAGGenerateResponse>(`/text-processing/rag-generate/${novelId}`, requestData); return response.data; } catch (error) { throw new Error(handleError(error as AxiosError, `小说 #${novelId} 的RAG生成失败。`)); }};

// Utility functions
export const getUserReferableFiles = async (novelId?: number | null): Promise<ReferableFileItem[]> => { try { const endpoint = novelId ? `/configuration/referable-files?novel_id=${novelId}` : '/configuration/referable-files'; const response = await apiClient.get<PaginatedResponse<ReferableFileItem>>(endpoint); return response.data.items || []; } catch (error) { const context = novelId ? `小说 #${novelId} 的` : "全局"; const errorMsg = handleError(error as AxiosError, `获取${context}可引用文件列表失败。`); toast.error(errorMsg, { toastId: `get-referable-files-err-${novelId || 'global'}` }); return []; } };
export const getSentimentThresholdSettings = async (): Promise<SentimentThresholds> => { try { const response = await apiClient.get<SentimentThresholds>('/configuration/sentiment-thresholds'); return response.data; } catch (e) { const errorMsg = handleError(e as AxiosError, '获取情感阈值配置失败。'); console.error(errorMsg, e); throw new Error(errorMsg); } };
export const fetchPredefinedTasksMeta = async (): Promise<PredefinedTaskMeta[]> => { try { const response = await apiClient.get<PredefinedTaskMeta[]>('/configuration/predefined-tasks'); return response.data; } catch (error) { const errorMsg = handleError(error as AxiosError, "获取预定义任务列表失败。"); toast.error(errorMsg, { toastId: 'fetch-predefined-tasks-meta-err' }); return [];  } }; // Endpoint changed
// getPredefinedTasksForUI and other hardcoded/utility functions are fine as they are.

export default apiClient;