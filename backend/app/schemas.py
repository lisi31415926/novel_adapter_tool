# backend/app/schemas.py
"""
文件版本: 1.2.0
更新日期: 2025-05-25
变更摘要:
- 增加 FAISS 持久化相关字段 (faiss_persist_directory, faiss_index_path)。
- 将应用配置相关的 Schema (如 VectorStoreSettingsConfigSchema, ApplicationConfigSchema) 集中到此文件。
- 优化了向量搜索结果的 Schema (SimilaritySearchResultItem, SimilaritySearchResult)。
- 更新 NovelVectorizationStatusEnum 添加 COMPLETED_NO_CONTENT 状态。
- 确保所有模型定义与最新的后端模型 (models.py) 和前端需求 (api.ts) 对齐。
"""
from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict, ValidationInfo, ValidationError
from typing import List, Optional, Dict, Any, Union, Literal, TypeVar, Annotated
import enum
import json
import logging
from datetime import datetime
from typing import TypeVar, Generic
logger = logging.getLogger(__name__)

# --- 通用配置 ---
ORM_CONFIG = ConfigDict(from_attributes=True)

# 定义一个类型变量，用于表示分页模型中的具体数据类型
DataType = TypeVar('DataType')

class PaginatedResponse(BaseModel, Generic[DataType]):
    """
    一个通用的、支持泛型的分页响应模型。
    """
    total_count: int = Field(..., description="符合条件的总项目数")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页的项目数")
    total_pages: int = Field(..., description="总页数")
    items: List[DataType] = Field(..., description="当前页的项目列表")
# --- 枚举定义 (Single Source of Truth) ---
class StepInputSourceEnum(str, enum.Enum):
    ORIGINAL = "original"
    PREVIOUS_STEP = "previous_step"

class NovelAnalysisStatusEnum(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    COMPLETED_WITH_ERRORS = "completed_with_errors" # 新增，对应 bug.txt 状态

class NovelVectorizationStatusEnum(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    COMPLETED_NO_CONTENT = "completed_no_content"

class EventRelationshipTypeEnum(str, enum.Enum):
    CAUSE_EFFECT = "cause_effect"
    TEMPORAL_SUCCESSION = "temporal_succession"
    PARALLEL = "parallel"
    RELATED = "related"

class RelationshipTypeEnum(str, enum.Enum):
    FRIEND = "friend"
    ENEMY = "enemy"
    ALLY = "ally"
    RIVAL = "rival"
    FAMILY = "family"
    ROMANTIC = "romantic"
    NEUTRAL = "neutral"

class RelationshipStatusEnum(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive" # 曾用 PAST，改为 INACTIVE 更通用
    ENDED = "ended"
    STRAINED = "strained" # 新增
    UNKNOWN = "unknown"   # 新增

class ConflictLevelEnum(str, enum.Enum):
    # 与 models.py 和前端保持一致，使用更具体的级别
    INTERNAL = "internal"
    INTERPERSONAL = "interpersonal"
    SOCIETAL = "societal"
    UNIVERSAL = "universal"
    MAJOR = "major" # 保留用于通用描述或旧数据兼容
    MINOR = "minor" # 保留用于通用描述或旧数据兼容
    CHARACTER_INTERNAL = "character_internal" # 保留用于特定分析任务

class ConflictStatusEnum(str, enum.Enum):
    OPEN = "open"
    ONGOING = "ongoing"
    RESOLVED = "resolved"
    ESCALATED = "escalated"
    UNKNOWN = "unknown" # 新增

class PlotBranchTypeEnum(str, enum.Enum):
    MAJOR_BRANCH = "major_branch"
    SIDE_STORY = "side_story"
    WHAT_IF = "what_if"
    # 新增更多类型以支持前端规划
    CHARACTER_ARC = "character_arc"
    ALTERNATE_ENDING = "alternate_ending"
    MINOR_CHOICE = "minor_choice" # 曾用，保留或映射
    ENDING_PATH = "ending_path"   # 曾用，保留或映射


class PlotVersionStatusEnum(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"
    FINALIZED = "finalized" # 新增

class PostProcessingRuleEnum(str, enum.Enum):
    TRIM_WHITESPACE = "trim_whitespace" # 对应旧的 STRIP
    TO_JSON = "to_json"
    EXTRACT_JSON_FROM_MARKDOWN = "extract_json_from_markdown" # 对应旧的 EXTRACT_CODE_BLOCK (假设是JSON块)
    REMOVE_EXTRA_SPACES = "remove_extra_spaces" # 新增
    CAPITALIZE_SENTENCES = "capitalize_sentences" # 新增
    NORMALIZE_CHINESE_PUNCTUATION_FULL_WIDTH = "normalize_chinese_punctuation_full_width" # 新增
    NORMALIZE_ENGLISH_PUNCTUATION_HALF_WIDTH = "normalize_english_punctuation_half_width" # 新增


class PredefinedTaskEnum(str, enum.Enum):
    # 与 constants.ts 和后端服务保持一致
    SUMMARIZE_CHAPTER = "summarize_chapter"
    EXTRACT_ROLES = "extract_roles" # 重命名自 EXTRACT_ROLES_IN_NOVEL
    ANALYZE_CHARACTER_RELATIONSHIPS = "analyze_character_relationships"
    IDENTIFY_MAIN_CONFLICTS = "identify_main_conflicts" # 与旧版兼容
    GENERATE_ADAPTATION_SUGGESTIONS = "generate_adaptation_suggestions"
    GENERATE_SCENE_FROM_EVENT = "generate_scene_from_event"
    SUGGEST_PLOT_TWISTS = "suggest_plot_twists"
    SUGGEST_NEW_PLOT_VERSION = "suggest_new_plot_version"
    SENTIMENT_ANALYSIS_CHAPTER = "sentiment_analysis_chapter"
    SUMMARIZE_TEXT = "summarize_text"
    EXPAND_TEXT = "expand_text"
    REWRITE_TEXT = "rewrite_text"
    GENERATE_PLOT_POINTS = "generate_plot_points"
    # 新增/调整的任务类型
    CHANGE_PERSPECTIVE = "change_perspective"
    EXTRACT_MAIN_EVENT = "extract_main_event" # 可能与 IDENTIFY_MAIN_CONFLICTS 相似或更具体
    IDENTIFY_EVENTS = "identify_events" # 可能是更广义的事件识别
    CUSTOM_INSTRUCTION = "custom_instruction"
    SIMPLIFY_TEXT = "simplify_text"
    EXTRACT_DIALOGUE = "extract_dialogue"
    CHANGE_TONE_FORMAL = "change_tone_formal"
    CHANGE_TONE_INFORMAL = "change_tone_informal"
    CHANGE_TONE_HUMOROUS = "change_tone_humorous"
    EXPLAIN_TEXT = "explain_text"
    GENERATE_NEXT_PLOT = "generate_next_plot"
    ANALYZE_CHAPTER_THEME = "analyze_chapter_theme"
    RAG_GENERATION = "rag_generation"
    ANALYZE_EVENT_RELATIONSHIPS = "analyze_event_relationships"
    EXTRACT_CORE_CONFLICTS = "extract_core_conflicts" # 更具体的冲突提取
    ENHANCE_SCENE_DESCRIPTION = "enhance_scene_description"
    WHAT_IF_PLOT_DERIVATION = "what_if_plot_derivation"
    PLOT_SUGGESTION = "plot_suggestion"
    PLANNING_PARSE_GOAL = "planning_parse_goal"
    PLANNING_GENERATE_DRAFT = "planning_generate_draft"

class SortDirectionEnum(str, enum.Enum): # 新增，用于API排序
    ASC = "asc"
    DESC = "desc"

class ParameterTypeEnum(str, enum.Enum): # 新增，对应前端常量和后端使用
    STATIC_STRING = "static_string"
    STATIC_TEXTAREA = "static_textarea"
    STATIC_NUMBER = "static_number"
    STATIC_BOOLEAN = "static_boolean"
    USER_INPUT_TEXT = "user_input_text"
    USER_INPUT_CHOICE = "user_input_choice"
    MODEL_SELECTOR = "model_selector"
    NOVEL_SUMMARY = "novel_summary"
    NOVEL_WORLDVIEW_KEY = "novel_worldview_key"
    NOVEL_ELEMENT_CHAPTER_ID = "novel_element_chapter_id"
    NOVEL_ELEMENT_CHAPTER_CONTENT = "novel_element_chapter_content"
    NOVEL_ELEMENT_CHARACTER_ID = "novel_element_character_id"
    NOVEL_ELEMENT_EVENT_ID = "novel_element_event_id"
    FILE_REFERENCE_TEXT = "file_reference_text"
    PREVIOUS_STEP_OUTPUT_FIELD = "previous_step_output_field"
    GENERATION_CONSTRAINTS = "generation_constraints" # 代表整个 GenerationConstraintsSchema 对象
    LLM_OVERRIDE_PARAMETERS = "llm_override_parameters" # 代表整个 LLM 参数覆盖对象
    PARAMETER_TYPE_OBJECT = "parameter_type_object" # 用于嵌套参数对象

class VectorStoreTypeEnum(str, enum.Enum): # 新增，对应前端常量
    QDRANT = "qdrant"
    CHROMA = "chromadb"
    FAISS = "faiss" # 新增

class LocalNLPDeviceEnum(str, enum.Enum): # 新增，对应前端常量
    CPU = "cpu"
    CUDA = "cuda"

class LocalNLPSentenceSplitterModelEnum(str, enum.Enum): # 新增
    SPACY_DEFAULT = "spacy_default"
    PY_SBD = "pysbd"
    NLTK_PUNKT = "nltk_punkt"
    RE_SPLITTER = "re_splitter"

class LocalNLPSentimentModelEnum(str, enum.Enum): # 新增
    SNOWNLP_DEFAULT = "snownlp_default"
    BERT_CHINESE_SENTIMENT = "bert_chinese_sentiment"

class TokenCostLevelEnum(str, enum.Enum): # 新增
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    UNKNOWN = "unknown"

# --- 复杂字段的内部结构 Schema ---
class ChapterSentimentAnalysis(BaseModel): # 与models.py中定义的JSON结构匹配
    overall_sentiment_label: str
    overall_sentiment_score: float
    details: Optional[List[Dict[str, Any]]] = None # 例如 [{'label': 'positive', 'score': 0.8}, ...]

class ChapterExtractedEvent(BaseModel): # 与models.py中定义的JSON结构匹配
    event_summary: str
    involved_characters: List[str] = Field(default_factory=list)
    location: Optional[str] = None
    trigger: Optional[str] = None # 新增，可以表示事件的触发因素

class ChapterCharacterAnalysis(BaseModel): # 与models.py中定义的JSON结构匹配
    character_name: str
    appearance_summary: str # 外貌或出场情况
    new_traits_or_changes: List[str] = Field(default_factory=list)
    key_actions: List[str] = Field(default_factory=list)

class DynamicChange(BaseModel):
    chapter_index: Optional[int] = None # 之前是必填，改为可选以适应不同场景
    event_trigger: Optional[str] = None # 新增，用于记录触发关系的事件
    change_description: str # 之前是 description

class InvolvedEntity(BaseModel):
    entity_type: Literal["character", "event", "group", "item", "location", "concept"] # 扩展实体类型
    entity_id: Union[int, str] # 允许字符串ID (例如物品或概念的自定义ID)
    # name 字段已从这里移除，应通过 entity_id 在前端查找名称

class GenerationConstraintsSchema(BaseModel):
    max_length: Optional[int] = Field(None, ge=10, description="最大生成token数或字符数")
    min_length: Optional[int] = Field(None, ge=1, description="最小生成token数或字符数")
    include_keywords: Optional[List[str]] = Field(None, description="必须包含的关键词列表")
    exclude_keywords: Optional[List[str]] = Field(None, description="必须排除的关键词列表")
    enforce_sentiment: Optional[SentimentConstraintEnum] = Field(None, description="强制的情感倾向")
    style_hints: Optional[List[str]] = Field(None, description="风格提示，如'正式','幽默'")
    output_format: Optional[OutputFormatConstraintEnum] = Field(None, description="期望的输出格式")
    output_format_details: Optional[Dict[str, Any]] = Field(None, description="特定输出格式的额外配置，如JSON Schema")
    # 新增场景描写相关约束
    scene_setting: Optional[str] = Field(None, description="场景的具体设定和环境")
    character_focus: Optional[List[str]] = Field(None, description="需要重点描写的角色列表")
    dialogue_style: Optional[str] = Field(None, description="对话的风格，如'简洁明快'或'古风典雅'")
    target_narrative_pace: Optional[str] = Field(None, description="目标叙事节奏，如'快节奏推进'或'慢节奏渲染氛围'")
    target_language_style: Optional[str] = Field(None, description="目标语言风格，如'华丽辞藻'或'朴实无华'")
    target_description_focus: Optional[List[str]] = Field(None, description="描写的侧重点，如['视觉细节','心理活动','环境氛围']")
    reference_style_text_snippet: Optional[str] = Field(None, description="用于参考风格的文本片段")


class RuleStepParameterDefinition(BaseModel):
    param_type: Union[ParameterTypeEnum, str] # 允许自定义字符串类型，但优先使用枚举
    label: str = Field(..., description="在UI中展示的参数名称")
    value: Optional[Any] = Field(None, description="参数的当前值或默认值，由前端或步骤执行时填充")
    description: Optional[str] = Field(None, description="参数的详细描述或提示")
    required: bool = Field(False, description="此参数是否为必填项")
    options: Optional[List[Dict[str, Any]]] = Field(None, description="如果参数是选择类型, 这里提供选项，例如 [{'label': '选项A', 'value': 'option_a'}]")
    config: Optional[Dict[str, Any]] = Field(None, description="参数的额外UI配置，如min/max/step for number, rows for textarea, isMulti for choice")
    # 新增 schema 字段，用于当 param_type 为 PARAMETER_TYPE_OBJECT 时，定义其内部结构
    schema: Optional[Dict[str, 'RuleStepParameterDefinitionWithoutValue']] = Field(None, description="当参数类型为对象时，定义其内部字段的结构")

# 辅助类型，避免 RuleStepParameterDefinition 的循环引用
RuleStepParameterDefinitionWithoutValue = Omit[RuleStepParameterDefinition, 'value'] # type: ignore
RuleStepParameterDefinition.model_rebuild()


# --- 数据库模型对应的 API Schema ---
# ... (NamedEntity, Chapter, Character, Event, Relationships, Conflict, PlotBranch, PlotVersion 等 Schema 定义与之前版本基本一致，此处省略以减少重复) ...
# --- NamedEntity Schemas ---
class NamedEntityBase(BaseModel):
    novel_id: int
    chapter_id: Optional[int] = None
    text: str = Field(..., max_length=255)
    label: str = Field(..., max_length=50)
    start_char: Optional[int] = None
    end_char: Optional[int] = None
    description: Optional[str] = None
class NamedEntityCreate(NamedEntityBase): pass
class NamedEntityUpdate(BaseModel):
    text: Optional[str] = Field(None, max_length=255)
    label: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = None
class NamedEntityRead(NamedEntityBase):
    id: int
    created_at: datetime
    model_config = ORM_CONFIG
# --- Chapter Schemas ---
class ChapterBase(BaseModel):
    novel_id: int
    chapter_index: int
    version_order: Optional[int] = None
    title: Optional[str] = Field(None, max_length=512)
    content: str
    summary: Optional[str] = None
    sentiment_analysis: Optional[ChapterSentimentAnalysis] = None
    event_extraction: Optional[List[ChapterExtractedEvent]] = None
    character_analysis: Optional[List[ChapterCharacterAnalysis]] = None
    theme_analysis: Optional[Union[List[str], Dict[str, Any]]] = None
    plot_version_id: Optional[int] = None
class ChapterCreate(ChapterBase): pass
class ChapterUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=512)
    content: Optional[str] = None
    summary: Optional[str] = None
    plot_version_id: Optional[int] = None
    version_order: Optional[int] = None
class ChapterRead(ChapterBase):
    id: int
    created_at: datetime
    updated_at: datetime
    model_config = ORM_CONFIG
class ChapterReadWithDetails(ChapterRead):
    named_entities: List[NamedEntityRead] = []
    model_config = ORM_CONFIG
# --- Character Schemas ---
class CharacterBase(BaseModel):
    novel_id: int
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    aliases: List[str] = Field(default_factory=list)
    role_type: Optional[str] = Field(None, max_length=100)
    first_appearance_chapter_index: Optional[int] = None
    core_setting: Optional[str] = None
    personality_traits: Optional[str] = None
    appearance_description: Optional[str] = None
    background_story: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    avatar_url: Optional[str] = Field(None, max_length=1024)
class CharacterCreate(CharacterBase): pass
class CharacterUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    aliases: Optional[List[str]] = None
    role_type: Optional[str] = Field(None, max_length=100)
    first_appearance_chapter_index: Optional[int] = None
    core_setting: Optional[str] = None
    personality_traits: Optional[str] = None
    appearance_description: Optional[str] = None
    background_story: Optional[str] = None
    tags: Optional[List[str]] = None
    avatar_url: Optional[str] = Field(None, max_length=1024)
class CharacterRead(CharacterBase):
    id: int
    created_at: datetime
    updated_at: datetime
    model_config = ORM_CONFIG
# --- Event Schemas ---
class EventBase(BaseModel):
    novel_id: int
    chapter_id: Optional[int] = None
    plot_version_id: Optional[int] = None
    summary: str = Field(..., max_length=500)
    name: Optional[str] = Field(None, max_length=500)
    description: Optional[str] = None
    event_order: Optional[int] = None
    sequence_in_chapter: Optional[int] = None
    timestamp_in_story: Optional[str] = Field(None, max_length=255)
    location: Optional[str] = Field(None, max_length=255)
    significance_score: Optional[int] = Field(None, ge=0, le=10)
    tags: List[str] = Field(default_factory=list)
    previous_event_id: Optional[int] = None
    next_event_id: Optional[int] = None
class EventCreate(EventBase):
    involved_character_ids: List[int] = Field(default_factory=list)
class EventUpdate(BaseModel):
    summary: Optional[str] = Field(None, max_length=500)
    name: Optional[str] = Field(None, max_length=500)
    description: Optional[str] = None
    chapter_id: Optional[int] = None
    plot_version_id: Optional[int] = None
    event_order: Optional[int] = None
    sequence_in_chapter: Optional[int] = None
    timestamp_in_story: Optional[str] = Field(None, max_length=255)
    location: Optional[str] = Field(None, max_length=255)
    significance_score: Optional[int] = Field(None, ge=0, le=10)
    tags: Optional[List[str]] = None
    previous_event_id: Optional[int] = None
    next_event_id: Optional[int] = None
    involved_character_ids: Optional[List[int]] = None
class EventRead(EventBase):
    id: int
    created_at: datetime
    updated_at: datetime
    source_relationships: List['EventRelationshipRead'] = []
    target_relationships: List['EventRelationshipRead'] = []

    class Config:
        orm_mode = True
# --- CharacterRelationship Schemas ---
class CharacterRelationshipBase(BaseModel):
    novel_id: int
    chapter_id: Optional[int] = None
    character_a_id: int
    character_b_id: int
    relationship_type: RelationshipTypeEnum
    status: RelationshipStatusEnum = RelationshipStatusEnum.ACTIVE
    description: Optional[str] = None
    start_chapter_index: Optional[int] = None
    end_chapter_index: Optional[int] = None
    dynamic_changes: List[DynamicChange] = Field(default_factory=list)
    plot_version_id: Optional[int] = None
    @model_validator(mode='before')
    def check_different_characters(cls, values):
        char_a = values.get('character_a_id', values.get('character_id1'))
        char_b = values.get('character_b_id', values.get('character_id2'))
        if char_a is not None and char_b is not None and char_a == char_b:
            raise ValueError("角色A和角色B不能是同一个角色")
        return values
class CharacterRelationshipCreate(CharacterRelationshipBase): pass
class CharacterRelationshipUpdate(BaseModel):
    relationship_type: Optional[RelationshipTypeEnum] = None
    status: Optional[RelationshipStatusEnum] = None
    description: Optional[str] = None
    start_chapter_index: Optional[int] = None
    end_chapter_index: Optional[int] = None
    dynamic_changes: Optional[List[DynamicChange]] = None
class CharacterRelationshipRead(CharacterRelationshipBase):
    id: int
    created_at: datetime
    updated_at: datetime
    character_a: CharacterRead
    character_b: CharacterRead
    model_config = ORM_CONFIG
# --- EventRelationship Schemas ---
class EventRelationshipBase(BaseModel):
    source_event_id: int
    target_event_id: int
    relationship_type: str
    description: Optional[str] = None
    novel_id: int

class EventRelationshipCreate(EventRelationshipBase):
    pass

class EventRelationshipUpdate(BaseModel):
    relationship_type: Optional[str] = None
    description: Optional[str] = None

class EventRelationshipRead(EventRelationshipBase):
    id: int
    created_at: datetime
    updated_at: datetime
    source_event: EventBase
    target_event: EventBase

    class Config:
        orm_mode = True
EventRead.update_forward_refs(EventRelationshipRead=EventRelationshipRead)
# --- Conflict Schemas ---
class ConflictBase(BaseModel):
    novel_id: int
    chapter_id: Optional[int] = None
    plot_version_id: Optional[int] = None
    description: str
    level: ConflictLevelEnum
    conflict_type: Optional[str] = Field(None, max_length=255)
    participants: List[Union[int, str]] = Field(default_factory=list)
    involved_entities: List[InvolvedEntity] = Field(default_factory=list)
    related_event_ids: List[int] = Field(default_factory=list)
    resolution_details: Optional[str] = None
    status: ConflictStatusEnum = ConflictStatusEnum.OPEN
class ConflictCreate(ConflictBase): pass
class ConflictUpdate(BaseModel):
    description: Optional[str] = None
    level: Optional[ConflictLevelEnum] = None
    conflict_type: Optional[str] = Field(None, max_length=255)
    participants: Optional[List[Union[int, str]]] = None
    involved_entities: Optional[List[InvolvedEntity]] = None
    related_event_ids: Optional[List[int]] = None
    resolution_details: Optional[str] = None
    status: Optional[ConflictStatusEnum] = None
class ConflictRead(ConflictBase):
    id: int
    created_at: datetime
    updated_at: datetime
    model_config = ORM_CONFIG
# --- PlotVersion Schemas ---
class PlotVersionBase(BaseModel):
    plot_branch_id: int
    version_number: int
    version_name: str = Field(..., max_length=255)
    description: Optional[str] = None
    status: PlotVersionStatusEnum = PlotVersionStatusEnum.DRAFT
    content_summary: Dict[str, Any] = Field(default_factory=dict)
    is_ending: bool = False
    content: Optional[str] = None
class PlotVersionCreate(PlotVersionBase): pass
class PlotVersionUpdate(BaseModel):
    version_name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    status: Optional[PlotVersionStatusEnum] = None
    content_summary: Optional[Dict[str, Any]] = None
    is_ending: Optional[bool] = None
    content: Optional[str] = None
class PlotVersionRead(PlotVersionBase):
    id: int
    created_at: datetime
    updated_at: datetime
    model_config = ORM_CONFIG
class PlotVersionReadWithDetails(PlotVersionRead):
    chapters_in_version: List[ChapterRead] = []
    events_in_version: List[EventRead] = []
    model_config = ORM_CONFIG
# --- PlotBranch Schemas ---
class PlotBranchBase(BaseModel):
    novel_id: int
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    branch_type: PlotBranchTypeEnum = PlotBranchTypeEnum.MAJOR_BRANCH
    origin_chapter_id: Optional[int] = None
    origin_event_id: Optional[int] = None
class PlotBranchCreate(PlotBranchBase): pass
class PlotBranchUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    branch_type: Optional[PlotBranchTypeEnum] = None
class PlotBranchRead(PlotBranchBase):
    id: int
    created_at: datetime
    updated_at: datetime
    model_config = ORM_CONFIG
class PlotBranchReadWithVersions(PlotBranchRead):
    versions: List[PlotVersionRead] = []
    model_config = ORM_CONFIG

# --- Novel Schemas ---
class NovelBase(BaseModel):
    title: str = Field(..., max_length=255)
    author: Optional[str] = Field(None, max_length=255)
    summary: Optional[str] = None
    keywords: List[str] = Field(default_factory=list)
    genre: Optional[str] = Field(None, max_length=100)
    target_audience_profile: Optional[str] = None
    main_characters_description: Optional[str] = None
    main_plot_points_summary: Optional[str] = None
    worldview_settings: Dict[str, Any] = Field(default_factory=dict)
    
class NovelCreate(NovelBase):
    file_path: str = Field(..., max_length=1024)

class NovelUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    author: Optional[str] = Field(None, max_length=255)
    summary: Optional[str] = None
    keywords: Optional[List[str]] = None
    genre: Optional[str] = Field(None, max_length=100)
    target_audience_profile: Optional[str] = None
    main_characters_description: Optional[str] = None
    main_plot_points_summary: Optional[str] = None
    worldview_settings: Optional[Dict[str, Any]] = None
    faiss_index_path: Optional[str] = Field(None, max_length=1024, description="持久化FAISS索引的文件夹路径")


class NovelRead(NovelBase):
    id: int
    created_at: datetime
    updated_at: datetime
    file_path: str
    analysis_status: NovelAnalysisStatusEnum
    vectorization_status: Optional[NovelVectorizationStatusEnum] = None # 允许为None
    qdrant_collection_name: Optional[str] = None
    faiss_index_path: Optional[str] = Field(None, description="持久化FAISS索引的文件夹路径")
    model_config = ORM_CONFIG

class NovelReadWithDetails(NovelRead):
    chapters: List[ChapterRead] = []
    characters: List[CharacterRead] = []
    events: List[EventRead] = []
    conflicts: List[ConflictRead] = []
    plot_branches: List[PlotBranchReadWithVersions] = []
    character_relationships: List[CharacterRelationshipRead] = []
    model_config = ORM_CONFIG

# --- Rule & Chain Schemas ---
class RuleStepBase(BaseModel):
    chain_id: Optional[int] = None
    template_id: Optional[int] = None
    step_order: int
    task_type: Union[PredefinedTaskEnum, str]
    parameters: Dict[str, RuleStepParameterDefinition] # 值应该是参数定义，而不是运行时值
    input_source: StepInputSourceEnum = StepInputSourceEnum.PREVIOUS_STEP
    model_id: Optional[str] = Field(None, max_length=255)
    llm_override_parameters: Dict[str, Any] = Field(default_factory=dict)
    generation_constraints: Optional[GenerationConstraintsSchema] = None
    is_enabled: bool = True
    output_variable_name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None

class RuleStepCreate(RuleStepBase): pass # 创建时参数值在定义中
class RuleStepUpdate(BaseModel): # 更新时也类似
    step_order: Optional[int] = None
    task_type: Optional[Union[PredefinedTaskEnum, str]] = None
    parameters: Optional[Dict[str, RuleStepParameterDefinition]] = None
    input_source: Optional[StepInputSourceEnum] = None
    model_id: Optional[str] = Field(None, max_length=255)
    llm_override_parameters: Optional[Dict[str, Any]] = None
    generation_constraints: Optional[GenerationConstraintsSchema] = None
    is_enabled: Optional[bool] = None
    output_variable_name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
class RuleStepRead(RuleStepBase):
    id: int
    chain_id: int
    model_config = ORM_CONFIG

class RuleTemplateBase(BaseModel):
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    tags: Dict[str, Any] = Field(default_factory=dict)
    task_type: Union[PredefinedTaskEnum, str]
    parameters: Dict[str, RuleStepParameterDefinition] = Field(default_factory=dict) # 包含参数定义
    custom_instruction: Optional[str] = None
    post_processing_rules: List[PostProcessingRuleEnum] = Field(default_factory=list)
    input_source: StepInputSourceEnum = StepInputSourceEnum.PREVIOUS_STEP
    model_id: Optional[str] = Field(None, max_length=255)
    llm_override_parameters: Dict[str, Any] = Field(default_factory=dict)
    generation_constraints: Optional[GenerationConstraintsSchema] = None
    output_variable_name: Optional[str] = Field(None, max_length=100)
class RuleTemplateCreate(RuleTemplateBase): pass
class RuleTemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    tags: Optional[Dict[str, Any]] = None
    task_type: Optional[Union[PredefinedTaskEnum, str]] = None
    parameters: Optional[Dict[str, RuleStepParameterDefinition]] = None
    custom_instruction: Optional[str] = None
    post_processing_rules: Optional[List[PostProcessingRuleEnum]] = None
    input_source: Optional[StepInputSourceEnum] = None
    model_id: Optional[str] = Field(None, max_length=255)
    llm_override_parameters: Optional[Dict[str, Any]] = None
    generation_constraints: Optional[GenerationConstraintsSchema] = None
    output_variable_name: Optional[str] = Field(None, max_length=100)
class RuleTemplateRead(RuleTemplateBase):
    id: int
    created_at: datetime
    updated_at: datetime
    model_config = ORM_CONFIG

class RuleChainBase(BaseModel):
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    is_template: bool = False
    novel_id: Optional[int] = None
    global_model_id: Optional[str] = Field(None, max_length=255)
    global_llm_override_parameters: Dict[str, Any] = Field(default_factory=dict)
    global_generation_constraints: Optional[GenerationConstraintsSchema] = None
class RuleChainCreate(RuleChainBase):
    steps: List[RuleStepCreate] = Field(default_factory=list)
class RuleChainUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    is_template: Optional[bool] = None
    global_model_id: Optional[str] = Field(None, max_length=255)
    global_llm_override_parameters: Optional[Dict[str, Any]] = None
    global_generation_constraints: Optional[GenerationConstraintsSchema] = None
    steps: Optional[List[Union[RuleStepCreate, RuleStepUpdate, int]]] = None
class RuleChainRead(RuleChainBase):
    id: int
    created_at: datetime
    updated_at: datetime
    model_config = ORM_CONFIG
class RuleChainReadWithSteps(RuleChainRead):
    steps: List[RuleStepRead] = []
    model_config = ORM_CONFIG


# --- 其他辅助 Schemas ---
class FilePath(BaseModel):
    file_path: str
class TaskParameter(BaseModel):
    task_type: str
    params: Dict[str, Any]
class AnalysisTask(BaseModel):
    novel_id: int
    task_types: List[str]

class SimilaritySearchQuery(BaseModel):
    # novel_id: int # 从 path 获取，这里不需要
    query_text: str
    top_n: int = Field(5, gt=0, le=100)
    score_threshold: Optional[float] = Field(None, ge=0.0, le=1.0)

class SimilaritySearchResultItem(BaseModel):
    id: str = Field(..., description="结果块的唯一标识符，例如来自Qdrant的point ID")
    text: str = Field(..., description="文本块内容")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="与文本块关联的元数据")
    distance: Optional[float] = Field(None, description="向量间的原始距离 (例如L2距离, 越小越相似)")
    similarity_score: Optional[float] = Field(None, description="归一化的相似度分数 (例如余弦相似度, 0-1, 越大越相似)")
    source: Optional[str] = Field(None, description="内容来源的简要描述")
    # 新增，与后端 vector_store_service.py 的输出对齐
    novel_id: Optional[int] = None
    chapter_id: Optional[int] = None
    chapter_order: Optional[int] = None
    version_order: Optional[int] = None
    plot_version_id: Optional[int] = None
    chapter_title: Optional[str] = None
    chunk_index_in_chapter: Optional[int] = None
    full_text_content: Optional[str] = None # 可选，用于需要时传递完整块文本
    qdrant_point_id: Optional[str] = None # 可选，如果来源是Qdrant

class SimilaritySearchResponse(BaseModel): # 对应路由返回
    query_text: str
    results: List[SimilaritySearchResultItem]
    search_time: Optional[float] = None # 新增，记录搜索耗时

# --- LLM 调用与文本处理 Schemas (对应 routers/text_processing.py 和 llm_utils.py) ---
class TextProcessRequest(BaseModel): # 对应 text_processing.py/process_text
    text: Optional[str] = None # 原文，对于某些任务可能是可选的（例如，如果prompt模板不依赖它）
    task: Union[PredefinedTaskEnum, str]
    parameters: Optional[Dict[str, Any]] = None # 运行时参数值
    custom_instruction: Optional[str] = None
    post_processing_rules: Optional[List[PostProcessingRuleEnum]] = None
    model_id: Optional[str] = None
    llm_override_parameters: Optional[Dict[str, Any]] = None
    generation_constraints: Optional[GenerationConstraintsSchema] = None
    retrieved_context: Optional[str] = None # 用于RAG或带上下文的任务

class TextProcessResponse(BaseModel): # 对应 text_processing.py/process_text
    original_text: Optional[str] = None
    processed_text: str
    task_used: str
    model_used: Optional[str] = None
    parameters_used: Optional[Dict[str, Any]] = None
    instruction_used: Optional[str] = None
    post_process_rule_applied: Optional[List[PostProcessingRuleEnum]] = None
    constraints_applied: Optional[GenerationConstraintsSchema] = None
    constraints_satisfied: Optional[Dict[str, bool]] = None
    retrieved_context_preview: Optional[str] = None # RAG任务中使用的上下文预览

class LLMResponse(BaseModel): # 对应 llm_providers/base_llm_provider.py -> LLMResponse
    text: str
    model_id_used: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    finish_reason: Optional[str] = None
    error: Optional[str] = None
    is_blocked_by_safety: Optional[bool] = False # 新增
    safety_details: Optional[Dict[str, Any]] = None # 新增

class DirectCompletionRequest(BaseModel): # 对应 llm_utils.py/direct_text_completion
    prompt: str
    system_prompt: Optional[str] = None
    model_id: Optional[str] = None
    llm_parameters: Optional[Dict[str, Any]] = Field(default_factory=dict)

# --- RuleChain 执行相关 (对应 routers/rule_chains.py) ---
class StepExecutionStatusEnum(str, enum.Enum): # 新增，对应前端
    SUCCESS = "success"
    FAILURE = "failure"
class StepExecutionResult(BaseModel): # 对应 rule_chains.py
    step_order: int
    task_type: str
    input_text_snippet: str
    output_text_snippet: str
    status: StepExecutionStatusEnum # 改为枚举
    model_used: Optional[str] = None
    parameters_used: Optional[Dict[str, Any]] = None # 运行时参数值
    custom_instruction_used: Optional[str] = None
    post_processing_rules_applied: Optional[List[PostProcessingRuleEnum]] = None
    constraints_satisfied: Optional[Dict[str, bool]] = None
    error: Optional[str] = None # 如果 status is failure

class RuleChainExecuteRequest(BaseModel): # 对应 rule_chains.py
    source_text: str
    novel_id: Optional[int] = None # 改为 Optional
    rule_chain_id: Optional[int] = None
    rule_chain_definition: Optional[RuleChainCreate] = None # 可以直接传递链定义
    dry_run: bool = False
    stream: bool = False # 新增，用于流式执行
    user_provided_params: Optional[Dict[str, Any]] = Field(default_factory=dict) # 运行时用户参数

class RuleChainExecuteResponse(BaseModel): # 对应 rule_chains.py
    original_text: str
    final_output_text: str
    executed_chain_id: Optional[int] = None
    executed_chain_name: Optional[str] = None
    steps_results: List[StepExecutionResult]
    total_execution_time: Optional[float] = None
    error_message: Optional[str] = None # 新增，用于记录链执行级别的错误

class RuleChainStepCostEstimate(BaseModel): # 对应 rule_chains.py
    step_order: int
    task_type: str
    model_to_be_used: str
    estimated_prompt_tokens: int
    max_completion_tokens: Optional[int] = None

class RuleChainDryRunResponse(BaseModel): # 对应 rule_chains.py
    estimated_total_prompt_tokens: int
    estimated_total_completion_tokens: int
    token_cost_level: TokenCostLevelEnum
    steps_estimates: List[RuleChainStepCostEstimate]
    warnings: Optional[List[str]] = None

# --- Planning Service 相关 (对应 routers/planning.py) ---
class RAGGenerateRequest(BaseModel): # 对应 text_processing.py
    instruction: str
    top_n_context: Optional[int] = 3
    model_id: Optional[str] = None
    llm_override_parameters: Optional[Dict[str, Any]] = None
    generation_constraints: Optional[GenerationConstraintsSchema] = None

class RAGGenerateResponse(BaseModel): # 对应 text_processing.py
    instruction: str
    retrieved_context_snippets: List[str]
    generated_text: str
    model_used: Optional[str] = None
    search_time: Optional[float] = None
    generation_time: Optional[float] = None
    constraints_applied: Optional[GenerationConstraintsSchema] = None
    constraints_satisfied: Optional[Dict[str, bool]] = None

class AdaptationGoalRequest(BaseModel): # 对应 planning.py
    goal_description: str
    novel_id: Optional[int] = None

class ParsedAdaptationGoal(BaseModel): # 对应 planning.py
    main_intent: Optional[str] = None
    key_elements: Optional[List[str]] = None
    target_style: Optional[List[str]] = None
    target_sentiment: Optional[SentimentConstraintEnum] = None
    target_audience: Optional[str] = None
    length_modification: Optional[str] = None
    specific_instructions: Optional[str] = None
    novel_title_hint: Optional[str] = None
    focus_chapters_or_parts: Optional[str] = None

class RecommendedRuleChainItem(BaseModel): # 对应 planning.py
    chain_id: int
    chain_name: str
    description: Optional[str] = None
    relevance_score: float
    reasoning: Optional[str] = None

class AdaptationPlanResponse(BaseModel): # 对应 planning.py
    original_goal: str
    parsed_goal: Optional[ParsedAdaptationGoal] = None
    recommended_chains: List[RecommendedRuleChainItem] = Field(default_factory=list)
    generated_chain_draft: Optional[RuleChainCreate] = None # 可以直接是 RuleChainCreate 结构
    planner_log: Optional[List[str]] = None

# --- Plot Version AI Suggestion (对应 routers/plot_versions.py) ---
class AISuggestionRequest(BaseModel):
    user_prompt: str
    parent_version_id: Optional[int] = None
    model_id: Optional[str] = None
    llm_parameters: Optional[Dict[str, Any]] = None

# AISuggestionResponse 实际返回的是一个 PlotVersionRead 对象
AISuggestionResponse = PlotVersionRead

# --- 应用配置 Schemas (用于 config.json, 之前在 config_service.py 中) ---
class LLMProviderConfigSchema(BaseModel): # 新增 (基于原始 config.json)
    provider_tag: str = Field(description="提供商的唯一标识符 (代码中使用)") # 虽然不在json中，但逻辑上需要
    api_key: Optional[str] = Field(None, description="此提供商的API密钥。如果为空，将尝试从环境变量读取。")
    base_url: Optional[str] = Field(None, description="API的基础URL (用于兼容OpenAI的第三方服务或本地模型)。")
    enabled: bool = Field(True, description="是否启用此提供商。")
    api_timeout_seconds: Optional[float] = Field(120.0, description="API请求超时时间（秒）。")
    max_retries: Optional[int] = Field(2, description="API请求失败时的最大重试次数。")
    default_jailbreak_prefix: Optional[str] = Field(None, description="Grok等模型可能需要的默认引导前缀。")
    default_test_model_id: Optional[str] = Field(None, description="测试连接时默认使用的模型API ID。")
    api_key_source: Optional[Literal['env', 'config', 'not_set']] = Field("not_set", description="API密钥的来源指示。")

class UserDefinedLLMConfigSchema(BaseModel): # 新增 (基于原始 config.json)
    user_given_id: str = Field(..., description="用户定义的唯一ID，用于在应用中引用此模型配置。")
    user_given_name: str = Field(..., description="用户定义的易读名称。")
    model_identifier_for_api: str = Field(..., description="实际调用API时使用的模型标识符 (例如 'gpt-4-turbo')。")
    provider_tag: str = Field(..., description="此模型配置关联的提供商标签 (必须在 llm_providers 中定义)。")
    api_key: Optional[str] = Field(None, description="专用于此模型配置的API密钥 (覆盖提供商全局密钥)。")
    base_url: Optional[str] = Field(None, description="专用于此模型配置的API基础URL (覆盖提供商全局URL)。")
    max_context_tokens: Optional[int] = Field(None, description="此模型支持的最大上下文Token数。")
    supports_system_prompt: bool = Field(True, description="此模型是否原生支持独立的系统提示。")
    enabled: bool = Field(True, description="是否启用此模型配置。")
    notes: Optional[str] = Field(None, description="关于此模型配置的备注。")
    api_key_is_from_env: bool = Field(False, description="指示API密钥和Base URL是否优先从环境变量加载（如果此处未填写）。")

class TokenizerOptionsSchema(BaseModel): # 新增
    local_model_token_estimation_factors: Optional[Dict[str, Dict[str, float]]] = Field(default_factory=dict)
    default_chars_per_token_general: float = Field(2.5)
    default_chars_per_token_chinese: float = Field(1.7)
    lm_studio_prefer_api_token_count: bool = Field(False)
    lm_studio_tokenize_include_model_param: bool = Field(True)
    default_estimation_factors_by_provider: Optional[Dict[str, float]] = Field(default_factory=dict)
    truncate_initial_slice_multiplier: float = Field(1.3)
    truncate_max_refinement_attempts: int = Field(10)
    truncate_refinement_step_factor: int = Field(5)

class LLMSettingsConfigSchema(BaseModel): # 新增 (基于原始 config.json)
    default_model_id: Optional[str] = Field(None, description="应用全局默认使用的模型ID。")
    available_models: List[UserDefinedLLMConfigSchema] = Field(default_factory=list)
    max_prompt_tokens: int = Field(8000, description="允许发送给LLM的最大提示Token数（估算）。")
    default_temperature: float = Field(0.7, ge=0.0, le=2.0)
    default_max_completion_tokens: int = Field(1500, ge=1)
    token_buffer_overhead: int = Field(200, description="Token预算的余量。")
    model_aliases: Dict[str, str] = Field(default_factory=dict, description="模型别名映射。")
    task_model_preference: Dict[str, str] = Field(default_factory=dict, description="特定任务类型偏好的模型ID或别名。")
    default_llm_fallback: Optional[str] = Field(None, description="当默认模型失败时的全局备用模型ID。")
    safety_fallback_model_id: Optional[str] = Field(None, description="内容安全触发时的备用模型ID。")
    tasks_eligible_for_safety_fallback: Optional[List[str]] = Field(default_factory=list)
    tokenizer_options: TokenizerOptionsSchema = Field(default_factory=TokenizerOptionsSchema)
    gemini_safety_settings: Optional[Dict[str, str]] = Field(None, description="Gemini模型的安全设置。")
    global_system_prompt_prefix: Optional[str] = Field(None, description="附加到所有系统提示前的全局前缀。")
    rag_default_top_n_context: int = Field(5)
    rag_default_top_n_context_fallback: int = Field(3)

class VectorStoreSettingsConfigSchema(BaseModel): # 基于原始 config.json 和新需求
    enabled: bool = Field(True)
    type: VectorStoreTypeEnum = Field(VectorStoreTypeEnum.FAISS) # 默认为FAISS
    persist_directory: Optional[str] = Field("vector_store_data", description="向量数据库持久化存储的根目录。")
    # 嵌入模型名称现在从 EmbeddingSettingsConfigSchema 获取
    embedding_model: str = Field("default_embedding_model_id", description="用于文本向量化的嵌入模型ID (来自LLM配置中的user_given_id)。")
    default_collection_name: str = Field("novel_content_main_idx", description="默认的向量集合名称。")
    text_chunk_size: int = Field(700, ge=50)
    text_chunk_overlap: int = Field(100, ge=0)
    default_tokenizer_model_for_chunking: Optional[str] = Field(None, description="分块时用于计算token的参考模型ID。")
    # Qdrant
    qdrant_host: Optional[str] = Field("localhost")
    qdrant_port: Optional[int] = Field(6333)
    qdrant_grpc_port: Optional[int] = Field(6334)
    qdrant_prefer_grpc: bool = Field(False)
    qdrant_api_key: Optional[str] = None
    qdrant_vector_size: Optional[int] = None # 通常从嵌入模型自动获取
    qdrant_distance_metric: Optional[str] = Field("Cosine")
    # ChromaDB
    chromadb_path: Optional[str] = Field("./chroma_db_store")
    chromadb_collection: Optional[str] = Field("novel_adaptation_store")
    # FAISS
    faiss_persist_directory: str = Field("faiss_data/novel_indexes", description="FAISS索引在服务器上持久化存储的基础目录路径。")

class EmbeddingServiceSettingsConfigSchema(BaseModel): # 新增 (基于原始 config.json)
    model_name: str = Field("BAAI/bge-large-zh-v1.5", description="HuggingFace SentenceTransformer 模型名称。")
    model_kwargs: Dict[str, Any] = Field({"device": "cpu"}, description="传递给模型构造的参数。")
    encode_kwargs: Dict[str, Any] = Field({"normalize_embeddings": False}, description="编码时参数。FAISS可能需要True。")

class AnalysisChunkSettingsConfigSchema(BaseModel): # 新增 (基于原始 config.json)
    chunk_size: int = Field(1500)
    chunk_overlap: int = Field(150)
    min_length_for_chunking_factor: float = Field(0.3, description="内容长度小于 chunk_size * factor 时不分块。")
    default_tokenizer_model_for_chunking: Optional[str] = Field(None, description="文本分块时用于估算token的参考模型ID。")

class LocalNLPSettingsConfigSchema(BaseModel): # 新增 (基于原始 config.json)
    enabled: bool = Field(False)
    device: LocalNLPDeviceEnum = Field(LocalNLPDeviceEnum.CPU)
    sentence_splitter_model: LocalNLPSentenceSplitterModelEnum = Field(LocalNLPSentenceSplitterModelEnum.SPACY_DEFAULT)
    sentiment_model: LocalNLPSentimentModelEnum = Field(LocalNLPSentimentModelEnum.SNOWNLP_DEFAULT)
    spacy_model_name: Optional[str] = Field("zh_core_web_sm", description="spaCy 使用的语言模型。")

class FileStorageSettingsConfigSchema(BaseModel): # 新增 (基于原始 config.json)
    upload_directory: str = Field("user_uploads", description="文件上传的根目录。")

class ApplicationGeneralSettingsConfigSchema(BaseModel): # 新增 (基于原始 config.json)
    log_level: str = Field("INFO", description="应用全局日志级别。")
    allow_config_writes_via_api: bool = Field(False, description="是否允许通过API接口修改配置文件。")
    cors_origins: Optional[List[str]] = Field(default_factory=lambda: ["http://localhost:3000", "http://localhost:5173"])
    database_url: Optional[str] = Field("sqlite:///./novel_adapter_tool.db") # 后端database.py会用

class PlanningServiceSettingsConfigSchema(BaseModel): # 新增 (基于原始 config.json)
    use_semantic_recommendation: bool = Field(True)
    semantic_score_weight: float = Field(1.5)
    max_recommendations: int = Field(5)
    plot_suggestion_context_max_tokens: Optional[int] = Field(3000)
    plot_suggestion_max_tokens: Optional[int] = Field(4000)

class TokenCostInfoSchema(BaseModel): # 新增 (基于原始 config.json)
    input_per_million: Optional[float] = None
    output_per_million: Optional[float] = None

class CostEstimationTiersSchema(BaseModel): # 新增 (基于原始 config.json)
    low_max_tokens: int = Field(8000)
    medium_max_tokens: int = Field(60000)
    token_cost_per_model: Optional[Dict[str, TokenCostInfoSchema]] = Field(default_factory=dict)
    avg_tokens_per_rag_chunk: Optional[Dict[str, Any]] = Field(default_factory=dict) # value可以是数字或更复杂的对象

class SentimentThresholdsSchema(BaseModel): # 新增 (基于原始 config.json)
    positive_min_score: float = Field(0.65, ge=0.0, le=1.0)
    negative_max_score: float = Field(0.35, ge=0.0, le=1.0)

    @model_validator(mode='after')
    def check_thresholds(self) -> 'SentimentThresholdsSchema':
        if self.positive_min_score <= self.negative_max_score:
            raise ValueError('positive_min_score 必须大于 negative_max_score 以确保存在中性区间。')
        return self

class ApplicationConfigSchema(BaseModel): # 顶层配置模型，对应 config.json
    llm_providers: Dict[str, LLMProviderConfigSchema] = Field(default_factory=dict)
    llm_settings: LLMSettingsConfigSchema = Field(default_factory=LLMSettingsConfigSchema)
    vector_store_settings: VectorStoreSettingsConfigSchema = Field(default_factory=VectorStoreSettingsConfigSchema)
    embedding_settings: EmbeddingServiceSettingsConfigSchema = Field(default_factory=EmbeddingServiceSettingsConfigSchema)
    analysis_chunk_settings: AnalysisChunkSettingsConfigSchema = Field(default_factory=AnalysisChunkSettingsConfigSchema)
    local_nlp_settings: LocalNLPSettingsConfigSchema = Field(default_factory=LocalNLPSettingsConfigSchema)
    file_storage_settings: FileStorageSettingsConfigSchema = Field(default_factory=FileStorageSettingsConfigSchema)
    application_settings: ApplicationGeneralSettingsConfigSchema = Field(default_factory=ApplicationGeneralSettingsConfigSchema)
    planning_settings: PlanningServiceSettingsConfigSchema = Field(default_factory=PlanningServiceSettingsConfigSchema)
    cost_estimation_tiers: CostEstimationTiersSchema = Field(default_factory=CostEstimationTiersSchema)
    sentiment_thresholds: SentimentThresholdsSchema = Field(default_factory=SentimentThresholdsSchema)

    model_config = ConfigDict(extra='ignore') # 忽略 config.json 中未在模型中定义的字段

# --- 各种API请求/响应的特定Schemas ---
class MessageResponse(BaseModel): # 通用消息响应
    message: str

class NovelUploadResponse(BaseModel): # 对应 routers/novels.py
    message: str
    novel_id: int
    title: str
    analysis_summary: Dict[str, Any] = Field(default_factory=dict)

class ConfigUpdateResponse(BaseModel): # 对应 routers/configuration.py
    message: str
    new_config: ApplicationConfigSchema # 包含完整的配置

class LLMProviderTestRequest(BaseModel): # 对应 routers/configuration.py
    user_config_id_to_test: Optional[str] = None
    temp_api_key: Optional[str] = None
    temp_base_url: Optional[str] = None
    model_identifier_for_test: Optional[str] = None # 如果要测试特定模型

class LLMProviderTestResponse(BaseModel): # 对应 routers/configuration.py
    success: bool
    message: str
    details: Optional[List[str]] = None

class ModelCapabilitySchema(BaseModel): # 对应 routers/llm_utils.py
    user_given_id: str
    user_given_name: str
    provider_tag: str
    model_identifier_for_api: str
    max_context_tokens: Optional[int] = None
    supports_system_prompt: bool
    is_default_model: bool
    is_fallback_model: bool
    notes: Optional[str] = None

class PredefinedTaskMeta(BaseModel): # 对应 routers/configuration.py 和 text_processing.py
    id: PredefinedTaskEnum # value of enum
    label: str
    description: str
    key_params: List[str] = Field(default_factory=list) # 从 get_predefined_task_details 调整

class ReferableFileItem(BaseModel): # 对应 routers/configuration.py
    id: str # Unique identifier for the file reference
    name: str # Display name
    file_type: str # e.g., 'novel_content', 'character_sheet_md'
    size: Optional[int] = None # File size in bytes
    created_at: Optional[str] = None # ISO datetime string
    updated_at: Optional[str] = None # ISO datetime string
    url: Optional[str] = None # Direct URL if applicable
    description: Optional[str] = None
    novel_id: Optional[int] = None # If it's novel content

class PaginatedReferableFilesResponse(BaseModel): # 对应 routers/configuration.py
    total_count: int
    page: int
    page_size: int
    total_pages: int
    items: List[ReferableFileItem]

class NovelAnalysisStatusInfo(BaseModel): # 对应 routers/novels.py
    novel_id: int
    analysis_status: Optional[NovelAnalysisStatusEnum] = None
    vectorization_status: Optional[NovelVectorizationStatusEnum] = None
    analysis_errors: Optional[List[str]] = None
    vectorization_errors: Optional[List[str]] = None
    qdrant_collection_name: Optional[str] = None
    faiss_index_path: Optional[str] = None # 新增
    last_updated: Optional[str] = None # ISO datetime string

class VectorStoreStatusResponse(BaseModel): # 对应 routers/configuration.py
    collection_name: str # 对于FAISS, 可能是基础路径或 "N/A"
    document_count: int # 对于FAISS, 可能是所有索引的总块数或当前活动索引的块数
    status: str # e.g., "OPERATIONAL", "UNAVAILABLE"
    error_message: Optional[str] = None
    embedding_function_name: Optional[str] = None
    client_type: Optional[str] = None # e.g., "Qdrant", "ChromaDB", "FAISS"
    # 新增 FAISS 特定状态信息 (如果需要更详细)
    indexed_novel_count_in_cache: Optional[int] = None
    indexed_novel_count_on_disk: Optional[int] = None

class ChapterReorderRequest(BaseModel): # 对应 routers/chapters.py
    ordered_chapter_ids: List[int]

class ChapterSegmentRequest(BaseModel): # 对应 text_processing.py
    chapter_id: Optional[int] = None
    content: str
    segment_type: Optional[Literal["sentence", "paragraph"]] = "sentence"
    min_segment_length: Optional[int] = 5

class SegmentSuggestion(BaseModel): # 对应 text_processing.py
    text: str
    start_char: int
    end_char: int
    segment_type: str
    metadata: Optional[Dict[str, Any]] = None

class ChapterSegmentSuggestionsResponse(BaseModel): # 对应 text_processing.py
    chapter_id: Optional[int] = None
    suggestions: List[SegmentSuggestion]

# --- [新] 预定义任务的详细信息获取函数 (从 routers/configuration.py 移至此处，作为Schema的一部分) ---
def get_predefined_task_details_map() -> Dict[PredefinedTaskEnum, Dict[str, Any]]:
    """返回所有预定义任务的详细信息，用于前端UI展示或后端逻辑。"""
    details_map: Dict[PredefinedTaskEnum, Dict[str, Any]] = {}
    
    # 任务的友好标签和描述 (与 constants.ts 中 PREDEFINED_TASK_DETAILS_MAP 类似)
    task_display_info: Dict[PredefinedTaskEnum, Dict[str, str]] = {
        PredefinedTaskEnum.SUMMARIZE_CHAPTER: {"label": "章节摘要(独立)", "description": "为章节内容生成独立摘要。"},
        PredefinedTaskEnum.EXTRACT_ROLES: {"label": "角色提取", "description": "从文本中识别并列出主要角色。"},
        PredefinedTaskEnum.ANALYZE_CHARACTER_RELATIONSHIPS: {"label": "人物关系分析", "description": "分析文本中角色之间的相互关系。"},
        PredefinedTaskEnum.IDENTIFY_MAIN_CONFLICTS: {"label": "主要冲突识别", "description": "识别文本中的主要矛盾冲突点。"},
        PredefinedTaskEnum.GENERATE_ADAPTATION_SUGGESTIONS: {"label": "改编建议生成", "description": "根据原文生成改编方向或创意的建议。"},
        PredefinedTaskEnum.GENERATE_SCENE_FROM_EVENT: {"label": "事件生成场景", "description": "基于给定的事件描述，生成详细的场景内容。"},
        PredefinedTaskEnum.SUGGEST_PLOT_TWISTS: {"label": "剧情反转建议", "description": "为当前情节构思可能的反转或意外发展。"},
        PredefinedTaskEnum.SUGGEST_NEW_PLOT_VERSION: {"label": "新剧情版本建议", "description": "基于现有剧情，构思一个全新的平行版本或“What If”线。"},
        PredefinedTaskEnum.SENTIMENT_ANALYSIS_CHAPTER: {"label": "章节情感分析(独立)", "description": "对章节文本进行情感分析并返回结构化结果。"},
        PredefinedTaskEnum.SUMMARIZE_TEXT: {"label": "通用文本摘要", "description": "对任意输入文本进行摘要。"},
        PredefinedTaskEnum.EXPAND_TEXT: {"label": "文本扩展", "description": "基于输入文本进行内容扩展或细节补充。"},
        PredefinedTaskEnum.REWRITE_TEXT: {"label": "文本改写", "description": "对输入文本进行同义改写或结构调整，保持核心意义。"},
        PredefinedTaskEnum.GENERATE_PLOT_POINTS: {"label": "剧情点生成", "description": "基于主题或输入生成若干关键剧情点。"},
        PredefinedTaskEnum.CHANGE_PERSPECTIVE: {"label": "视角转换", "description": "将文本从一个视角转换为另一个视角。"},
        PredefinedTaskEnum.EXTRACT_MAIN_EVENT: {"label": "主要事件提取(结构化)", "description": "从文本中识别并提取核心事件或主要情节，以结构化形式返回。"},
        PredefinedTaskEnum.IDENTIFY_EVENTS: {"label": "事件识别(列表)", "description": "识别并列出文本中的所有事件，通常用于初步分析。"},
        PredefinedTaskEnum.CUSTOM_INSTRUCTION: {"label": "自定义指令 (LLM)", "description": "根据用户提供的详细指令直接与大语言模型交互处理文本。"},
        PredefinedTaskEnum.SIMPLIFY_TEXT: {"label": "文本简化", "description": "使复杂文本更易于理解，例如降低阅读难度。"},
        PredefinedTaskEnum.EXTRACT_DIALOGUE: {"label": "对话提取", "description": "提取并列出文本中的所有对话内容。"},
        PredefinedTaskEnum.CHANGE_TONE_FORMAL: {"label": "语气改写-正式", "description": "将文本改写为更正式、专业的语气。"},
        PredefinedTaskEnum.CHANGE_TONE_INFORMAL: {"label": "语气改写-非正式", "description": "将文本改写为更轻松、口语化的语气。"},
        PredefinedTaskEnum.CHANGE_TONE_HUMOROUS: {"label": "语气改写-幽默", "description": "将文本改写为更幽默、风趣的语气。"},
        PredefinedTaskEnum.EXPLAIN_TEXT: {"label": "文本解释", "description": "详细解释输入文本片段的含义、背景或引申义。"},
        PredefinedTaskEnum.GENERATE_NEXT_PLOT: {"label": "后续情节生成", "description": "根据当前故事情节生成合乎逻辑的后续发展。"},
        PredefinedTaskEnum.ANALYZE_CHAPTER_THEME: {"label": "章节主题分析(结构化)", "description": "分析并总结章节的主要主题思想，以结构化形式返回。"},
        PredefinedTaskEnum.RAG_GENERATION: {"label": "RAG检索增强生成", "description": "结合从知识库检索到的上下文信息来回答问题或生成文本。"},
        PredefinedTaskEnum.ANALYZE_EVENT_RELATIONSHIPS: {"label": "事件关系分析(结构化)", "description": "分析文本中事件之间的相互关系，并以结构化形式返回。"},
        PredefinedTaskEnum.EXTRACT_CORE_CONFLICTS: {"label": "核心冲突提取(结构化)", "description": "从文本中识别和提取核心的矛盾冲突点及其参与方，以结构化形式返回。"},
        PredefinedTaskEnum.ENHANCE_SCENE_DESCRIPTION: {"label": "场景描写增强", "description": "根据特定侧重点（如环境、感官、氛围）增强场景的描写。"},
        PredefinedTaskEnum.WHAT_IF_PLOT_DERIVATION: {"label": "What-If剧情推演", "description": "基于给定的假设条件，推演剧情的多种可能发展。"},
        PredefinedTaskEnum.PLANNING_PARSE_GOAL: {"label": "规划-解析改编目标", "description": "解析用户输入的自然语言改编目标，提取关键意图和要素。"},
        PredefinedTaskEnum.PLANNING_GENERATE_DRAFT: {"label": "规划-生成规则链草稿", "description": "根据解析的改编目标，自动生成一个初步的规则链草稿。"},
        PredefinedTaskEnum.PLOT_SUGGESTION: {"label": "剧情版本AI建议", "description": "AI根据当前剧情发展和用户目标，给出新的剧情版本走向建议。"},
    }
    # 任务的关键参数提示 (用于UI，帮助用户理解需要哪些参数)
    task_key_params_hints: Dict[PredefinedTaskEnum, List[str]] = {
        PredefinedTaskEnum.CHANGE_PERSPECTIVE: ["source_perspective", "target_perspective", "key_character_for_perspective"],
        PredefinedTaskEnum.ENHANCE_SCENE_DESCRIPTION: ["enhancement_focus_areas", "desired_mood"],
        PredefinedTaskEnum.WHAT_IF_PLOT_DERIVATION: ["hypothetical_condition", "number_of_variations"],
        PredefinedTaskEnum.RAG_GENERATION: ["retrieval_config.top_k_results", "retrieval_config.similarity_threshold"],
        PredefinedTaskEnum.SUMMARIZE_TEXT: ["max_length", "min_length", "output_style_hint"],
        PredefinedTaskEnum.REWRITE_TEXT: ["rewrite_goal", "preserve_meaning", "strength"],
        PredefinedTaskEnum.EXPAND_TEXT: ["expansion_points", "target_expansion_length_ratio"],
        PredefinedTaskEnum.GENERATE_PLOT_POINTS: ["topic_or_theme", "number_of_plot_points", "target_audience_style"],
        PredefinedTaskEnum.CUSTOM_INSTRUCTION: ["role_for_ai", "tone_of_voice", "additional_context_snippet"],
    }
    
    for task_enum_member in PredefinedTaskEnum:
        task_val_str = task_enum_member.value # 获取枚举的字符串值
        display_info = task_display_info.get(task_enum_member, {})
        details_map[task_enum_member] = { # 使用枚举成员作为键
            "id": task_val_str,
            "label": display_info.get("label", task_val_str.replace("_", " ").title()),
            "description": display_info.get("description", f"对 “{task_val_str}” 任务的默认描述。"),
            "key_params": task_key_params_hints.get(task_enum_member, [])
        }
        
    return details_map

# --- 向前兼容的别名 ---
NovelSchema = NovelRead
ChapterSchema = ChapterRead
CharacterSchema = CharacterRead
EventSchema = EventRead
ConflictSchema = ConflictRead
CharacterRelationshipSchema = CharacterRelationshipRead
PlotBranchSchema = PlotBranchRead
PlotVersionSchema = PlotVersionRead
RuleChainSchema = RuleChainReadWithSteps # 默认返回带步骤的
RuleStepSchema = RuleStepRead
RuleTemplateSchema = RuleTemplateRead