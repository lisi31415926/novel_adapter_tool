# backend/app/models.py
"""
文件版本: 1.1.0
更新日期: 2025-05-25
"""
import logging
from sqlalchemy import (
    Column as SQLAlchemyColumn, 
    Enum as SQLAlchemyEnum, 
    UniqueConstraint, 
    Index, 
    Text, 
    DateTime
)
from sqlalchemy.dialects.postgresql import JSONB as SQLAlchemyJSONB # 若使用PostgreSQL，JSONB性能更佳
from sqlalchemy.types import JSON as SQLAlchemyJSON # 通用JSON类型
from sqlalchemy.sql import func
from sqlmodel import Field, Relationship, SQLModel
from typing import List, Optional, Dict, Any, Union
from datetime import datetime

# 导入在schemas.py中定义的、作为“单一事实来源”的枚举
from . import schemas

logger = logging.getLogger(__name__)

# --- SQLModel 模型定义 ---
# 注意：所有继承自SQLModel并映射到数据库表的类，都需添加 table=True。
# SQLModel自动处理Python类型（如List, Dict）到数据库JSON类型的转换。

# --- Novel (小说) 模型 ---
class NovelBase(SQLModel):
    title: str = Field(max_length=255, index=True, nullable=False, description="小说标题")
    author: Optional[str] = Field(default=None, max_length=255, description="作者")
    file_path: str = Field(max_length=1024, unique=True, nullable=False, description="原始文件路径")
    summary: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text), description="小说摘要")
    
    keywords: List[str] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON), description="关键词列表")
    llm_extracted_roles: Optional[Any] = Field(default=None, sa_column=SQLAlchemyColumn(SQLAlchemyJSON), description="LLM提取的角色信息")
    local_extracted_persons: List[str] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON), description="本地NLP提取的人物名")
    
    analysis_status: schemas.NovelAnalysisStatusEnum = Field(
        default=schemas.NovelAnalysisStatusEnum.PENDING,
        sa_column=SQLAlchemyColumn(SQLAlchemyEnum(schemas.NovelAnalysisStatusEnum, name="novel_analysis_status_enum_sqlm"), nullable=False),
        index=True,
        description="内容分析状态"
    )
    analysis_errors: List[str] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON), description="分析过程中的错误信息")
    
    vectorization_status: Optional[schemas.NovelVectorizationStatusEnum] = Field(
        default=schemas.NovelVectorizationStatusEnum.PENDING,
        sa_column=SQLAlchemyColumn(SQLAlchemyEnum(schemas.NovelVectorizationStatusEnum, name="novel_vectorization_status_enum_sqlm")),
        index=True,
        description="内容向量化状态"
    )
    vectorization_errors: List[str] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON), description="向量化过程中的错误信息")
    
    qdrant_collection_name: Optional[str] = Field(default=None, max_length=255, index=True, description="在Qdrant中的集合名称")

    main_conflict_ids: List[int] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON), description="主要冲突ID列表")
    worldview_settings: Dict[str, Any] = Field(default_factory=dict, sa_column=SQLAlchemyColumn(SQLAlchemyJSON), description="世界观设定")
    
    genre: Optional[str] = Field(default=None, max_length=100, description="小说类型/风格")
    target_audience_profile: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text), description="目标读者画像")
    main_characters_description: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text), description="主要角色概览")
    main_plot_points_summary: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text), description="主要情节节点摘要")

class Novel(NovelBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now()), nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()), nullable=False)
    
    # --- Relationships ---
    chapters: List["Chapter"] = Relationship(back_populates="novel", sa_relationship_kwargs={"cascade": "all, delete-orphan", "lazy": "selectin"})
    characters: List["Character"] = Relationship(back_populates="novel", sa_relationship_kwargs={"cascade": "all, delete-orphan", "lazy": "selectin"})
    events: List["Event"] = Relationship(back_populates="novel", sa_relationship_kwargs={"cascade": "all, delete-orphan", "lazy": "selectin"})
    conflicts: List["Conflict"] = Relationship(back_populates="novel", sa_relationship_kwargs={"cascade": "all, delete-orphan", "lazy": "selectin"})
    plot_branches: List["PlotBranch"] = Relationship(back_populates="novel", sa_relationship_kwargs={"cascade": "all, delete-orphan", "lazy": "selectin"})
    character_relationships: List["CharacterRelationship"] = Relationship(back_populates="novel", sa_relationship_kwargs={"cascade": "all, delete-orphan", "lazy": "selectin"})
    rule_chains: List["RuleChain"] = Relationship(back_populates="novel", sa_relationship_kwargs={"lazy": "selectin"})
    named_entities: List["NamedEntity"] = Relationship(back_populates="novel", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    faiss_index_path: Optional[str] = Field(default=None, max_length=1024, index=True, description="持久化FAISS索引的文件夹路径")


# --- CharacterEventLink (角色-事件 关联表) ---
class CharacterEventLink(SQLModel, table=True):
    character_id: int = Field(foreign_key="character.id", primary_key=True)
    event_id: int = Field(foreign_key="event.id", primary_key=True)


# --- Chapter (章节) 模型 ---
class ChapterBase(SQLModel):
    novel_id: int = Field(foreign_key="novel.id", nullable=False, index=True)
    chapter_index: int = Field(nullable=False, index=True, description="章节全局顺序 (0-based)")
    version_order: Optional[int] = Field(default=None, index=True, description="章节在版本内顺序 (0-based)")
    title: Optional[str] = Field(default=None, max_length=512)
    content: str = Field(sa_column=SQLAlchemyColumn(Text), nullable=False)
    
    sentiment_analysis: Optional[schemas.ChapterSentimentAnalysis] = Field(default=None, sa_column=SQLAlchemyColumn(SQLAlchemyJSON), description="情感分析结果")
    event_extraction: Optional[List[schemas.ChapterExtractedEvent]] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON), description="事件提取结果")
    character_analysis: Optional[List[schemas.ChapterCharacterAnalysis]] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON), description="角色分析结果")
    theme_analysis: Optional[Union[List[str], Dict[str, Any]]] = Field(default=None, sa_column=SQLAlchemyColumn(SQLAlchemyJSON), description="主题分析结果")
    summary: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text), description="LLM生成的摘要")
    
    plot_version_id: Optional[int] = Field(default=None, foreign_key="plotversion.id", index=True)

class Chapter(ChapterBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now()), nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()), nullable=False)

    novel: "Novel" = Relationship(back_populates="chapters")
    named_entities: List["NamedEntity"] = Relationship(back_populates="chapter", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    events_in_chapter: List["Event"] = Relationship(back_populates="chapter", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    plot_version: Optional["PlotVersion"] = Relationship(back_populates="chapters_in_version")

    __table_args__ = (
        Index('ix_chapter_novel_version_order_sqlm', "novel_id", "plot_version_id", "version_order"),
        Index('ix_chapter_novel_mainline_order_sqlm', "novel_id", "chapter_index"),
    )

# --- NamedEntity (命名实体) 模型 ---
class NamedEntityBase(SQLModel):
    novel_id: int = Field(foreign_key="novel.id", nullable=False, index=True)
    chapter_id: Optional[int] = Field(default=None, foreign_key="chapter.id", index=True)
    text: str = Field(max_length=255, nullable=False, index=True)
    label: str = Field(max_length=50, nullable=False, index=True, description="例如 PERSON, ORG, LOC")
    start_char: Optional[int] = Field(default=None)
    end_char: Optional[int] = Field(default=None)
    description: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))

class NamedEntity(NamedEntityBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now()), nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()), nullable=False)
    
    novel: "Novel" = Relationship(back_populates="named_entities")
    chapter: Optional["Chapter"] = Relationship(back_populates="named_entities")

# --- Character (角色) 模型 ---
class CharacterBase(SQLModel):
    novel_id: int = Field(foreign_key="novel.id", nullable=False, index=True)
    name: str = Field(max_length=255, nullable=False, index=True)
    description: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))
    aliases: List[str] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    role_type: Optional[str] = Field(default=None, max_length=100, index=True, description="主角, 配角, 反派")
    first_appearance_chapter_index: Optional[int] = Field(default=None)
    core_setting: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))
    personality_traits: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))
    appearance_description: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))
    background_story: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))
    tags: List[str] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    avatar_url: Optional[str] = Field(default=None, max_length=1024)

class Character(CharacterBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now()), nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()), nullable=False)
    
    novel: "Novel" = Relationship(back_populates="characters")
    events: List["Event"] = Relationship(back_populates="involved_characters", link_model=CharacterEventLink)
    relationships_as_a: List["CharacterRelationship"] = Relationship(back_populates="character_a", sa_relationship_kwargs={"foreign_keys": "CharacterRelationship.character_a_id", "cascade": "all, delete-orphan"})
    relationships_as_b: List["CharacterRelationship"] = Relationship(back_populates="character_b", sa_relationship_kwargs={"foreign_keys": "CharacterRelationship.character_b_id", "cascade": "all, delete-orphan"})

    __table_args__ = (UniqueConstraint('novel_id', 'name', name='uq_novel_character_name_sqlm'),)


# --- Event (事件) 模型 ---
class EventBase(SQLModel):
    title: str = Field(max_length=512, nullable=False, description="事件标题")
    description: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text), description="事件描述")
    novel_id: int = Field(foreign_key="novel.id", nullable=False, index=True)
    chapter_id: Optional[int] = Field(default=None, foreign_key="chapter.id", index=True)
    plot_version_id: Optional[int] = Field(default=None, foreign_key="plotversion.id", index=True)
    summary: str = Field(max_length=500, nullable=False, index=True)
    name: Optional[str] = Field(default=None, max_length=500, index=True)
    event_order: Optional[int] = Field(default=None, index=True, description="全局或版本内顺序")
    sequence_in_chapter: Optional[int] = Field(default=None, description="章节内顺序")
    timestamp_in_story: Optional[str] = Field(default=None, max_length=255)
    location: Optional[str] = Field(default=None, max_length=255)
    significance_score: Optional[int] = Field(default=None, description="重要性评分 (0-10)")
    tags: List[str] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    previous_event_id: Optional[int] = Field(default=None, foreign_key="event.id")
    next_event_id: Optional[int] = Field(default=None, foreign_key="event.id")

class Event(EventBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True, index=True)
    novel: "Novel" = Relationship(back_populates="events")

    # 【新增】双向关系，指向 EventRelationship
    # 一个事件可以是多个关系的“源头”
    source_for_relationships: List["EventRelationship"] = Relationship(
        back_populates="source_event",
        sa_relationship_kwargs={
            "primaryjoin": "Event.id==EventRelationship.source_event_id",
            "cascade": "all, delete-orphan"
        }
    )
    # 一个事件也可以是多个关系的“目标”
    target_for_relationships: List["EventRelationship"] = Relationship(
        back_populates="target_event",
        sa_relationship_kwargs={
            "primaryjoin": "Event.id==EventRelationship.target_event_id",
            "cascade": "all, delete-orphan"
        }
    )
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now()), nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()), nullable=False)
    chapter: Optional["Chapter"] = Relationship(back_populates="events_in_chapter")
    plot_version: Optional["PlotVersion"] = Relationship(back_populates="events_in_version")
    involved_characters: List["Character"] = Relationship(back_populates="events", link_model=CharacterEventLink)
    relationships_as_source: List["EventRelationship"] = Relationship(back_populates="event_source", sa_relationship_kwargs={"foreign_keys": "EventRelationship.event_source_id", "cascade": "all, delete-orphan"})
    relationships_as_target: List["EventRelationship"] = Relationship(back_populates="event_target", sa_relationship_kwargs={"foreign_keys": "EventRelationship.event_target_id", "cascade": "all, delete-orphan"})


# --- EventRelationship (事件关系) 模型 ---
# 【新增】事件关系模型
class EventRelationship(SQLModel, table=True):
    """
    事件关系模型，用于表示事件之间的关联。
    """
    # 添加唯一约束，防止两个事件之间创建重复方向的关系
    __table_args__ = (
        UniqueConstraint("source_event_id", "target_event_id", name="uq_source_target_event"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    relationship_type: str = Field(index=True, description="关系类型 (例如: '因果', '时序', '影响')")
    description: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text), description="对关系的详细描述")

    source_event_id: int = Field(foreign_key="event.id")
    target_event_id: int = Field(foreign_key="event.id")

    # 建立与 Event 模型的 M-1 关系
    source_event: "Event" = Relationship(
        back_populates="source_for_relationships",
        sa_relationship_kwargs={"foreign_keys": "[EventRelationship.source_event_id]"}
    )
    target_event: "Event" = Relationship(
        back_populates="target_for_relationships",
        sa_relationship_kwargs={"foreign_keys": "[EventRelationship.target_event_id]"}
    )
    
class EventRelationshipBase(SQLModel):
    event_source_id: int = Field(foreign_key="event.id", nullable=False, index=True)
    event_target_id: int = Field(foreign_key="event.id", nullable=False, index=True)
    relationship_type: schemas.EventRelationshipTypeEnum = Field(sa_column=SQLAlchemyColumn(SQLAlchemyEnum(schemas.EventRelationshipTypeEnum, name="event_relationship_type_enum_sqlm"), nullable=False), index=True)
    description: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))

class EventRelationship(EventRelationshipBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now()), nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()), nullable=False)
    
    event_source: "Event" = Relationship(back_populates="relationships_as_source", sa_relationship_kwargs={"foreign_keys": "[EventRelationship.event_source_id]"})
    event_target: "Event" = Relationship(back_populates="relationships_as_target", sa_relationship_kwargs={"foreign_keys": "[EventRelationship.event_target_id]"})
    
    __table_args__ = (UniqueConstraint('event_source_id', 'event_target_id', 'relationship_type', name='uq_event_relationship_definition_sqlm'),)


# --- CharacterRelationship (角色关系) 模型 ---
class CharacterRelationshipBase(SQLModel):
    novel_id: int = Field(foreign_key="novel.id", nullable=False, index=True)
    chapter_id: Optional[int] = Field(default=None, foreign_key="chapter.id", index=True)
    character_a_id: int = Field(foreign_key="character.id", nullable=False, index=True)
    character_b_id: int = Field(foreign_key="character.id", nullable=False, index=True)
    relationship_type: schemas.RelationshipTypeEnum = Field(sa_column=SQLAlchemyColumn(SQLAlchemyEnum(schemas.RelationshipTypeEnum, name="character_relationship_type_enum_sqlm"), nullable=False), index=True)
    status: schemas.RelationshipStatusEnum = Field(default=schemas.RelationshipStatusEnum.ACTIVE, sa_column=SQLAlchemyColumn(SQLAlchemyEnum(schemas.RelationshipStatusEnum, name="relationship_status_enum_sqlm"), nullable=False), index=True)
    description: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))
    start_chapter_index: Optional[int] = Field(default=None)
    end_chapter_index: Optional[int] = Field(default=None)
    dynamic_changes: List[schemas.DynamicChange] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    plot_version_id: Optional[int] = Field(default=None, foreign_key="plotversion.id", index=True)

class CharacterRelationship(CharacterRelationshipBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now()), nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()), nullable=False)
    
    novel: "Novel" = Relationship(back_populates="character_relationships")
    plot_version: Optional["PlotVersion"] = Relationship(back_populates="character_relationships_in_version")
    character_a: "Character" = Relationship(back_populates="relationships_as_a", sa_relationship_kwargs={"foreign_keys": "[CharacterRelationship.character_a_id]"})
    character_b: "Character" = Relationship(back_populates="relationships_as_b", sa_relationship_kwargs={"foreign_keys": "[CharacterRelationship.character_b_id]"})
    
    __table_args__ = (
        UniqueConstraint('character_a_id', 'character_b_id', 'relationship_type', 'plot_version_id', name='uq_char_rel_definition_version_sqlm'),
        Index('idx_char_rel_pair_sqlm', 'character_a_id', 'character_b_id')
    )

# --- Conflict (冲突) 模型 ---
class ConflictBase(SQLModel):
    novel_id: int = Field(foreign_key="novel.id", nullable=False, index=True)
    chapter_id: Optional[int] = Field(default=None, foreign_key="chapter.id", index=True)
    plot_version_id: Optional[int] = Field(default=None, foreign_key="plotversion.id", index=True)
    description: str = Field(sa_column=SQLAlchemyColumn(Text), nullable=False)
    level: schemas.ConflictLevelEnum = Field(sa_column=SQLAlchemyColumn(SQLAlchemyEnum(schemas.ConflictLevelEnum, name="conflict_level_enum_sqlm"), nullable=False), index=True)
    conflict_type: Optional[str] = Field(default=None, max_length=255)
    participants: List[Union[int, str]] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    involved_entities: List[schemas.InvolvedEntity] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    related_event_ids: List[int] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    resolution_details: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))
    status: schemas.ConflictStatusEnum = Field(default=schemas.ConflictStatusEnum.OPEN, sa_column=SQLAlchemyColumn(SQLAlchemyEnum(schemas.ConflictStatusEnum, name="conflict_status_enum_sqlm"), nullable=False), index=True)

class Conflict(ConflictBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now()), nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()), nullable=False)
    
    novel: "Novel" = Relationship(back_populates="conflicts")
    plot_version: Optional["PlotVersion"] = Relationship(back_populates="conflicts_in_version")
    chapter: Optional["Chapter"] = Relationship()

# --- PlotBranch (剧情分支) 模型 ---
class PlotBranchBase(SQLModel):
    novel_id: int = Field(foreign_key="novel.id", nullable=False, index=True)
    name: str = Field(max_length=255, nullable=False)
    description: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))
    branch_type: schemas.PlotBranchTypeEnum = Field(default=schemas.PlotBranchTypeEnum.MAJOR_BRANCH, sa_column=SQLAlchemyColumn(SQLAlchemyEnum(schemas.PlotBranchTypeEnum, name="plot_branch_type_enum_sqlm"), nullable=False), index=True)
    origin_chapter_id: Optional[int] = Field(default=None, foreign_key="chapter.id", index=True)
    origin_event_id: Optional[int] = Field(default=None, foreign_key="event.id", index=True)

class PlotBranch(PlotBranchBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now()), nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()), nullable=False)
    
    novel: "Novel" = Relationship(back_populates="plot_branches")
    origin_chapter: Optional["Chapter"] = Relationship(sa_relationship_kwargs={"foreign_keys": "[PlotBranch.origin_chapter_id]", "lazy": "joined"})
    origin_event: Optional["Event"] = Relationship(sa_relationship_kwargs={"foreign_keys": "[PlotBranch.origin_event_id]", "lazy": "joined"})
    versions: List["PlotVersion"] = Relationship(back_populates="plot_branch", sa_relationship_kwargs={"cascade": "all, delete-orphan", "lazy": "selectin", "order_by": "PlotVersion.version_number"})

    __table_args__ = (UniqueConstraint('novel_id', 'name', name='uq_novel_plot_branch_name_sqlm'),)

# --- PlotVersion (剧情版本) 模型 ---
class PlotVersionBase(SQLModel):
    plot_branch_id: int = Field(foreign_key="plotbranch.id", nullable=False, index=True)
    version_number: int = Field(nullable=False)
    version_name: str = Field(default="版本 1", max_length=255, nullable=False)
    description: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))
    status: schemas.PlotVersionStatusEnum = Field(default=schemas.PlotVersionStatusEnum.DRAFT, sa_column=SQLAlchemyColumn(SQLAlchemyEnum(schemas.PlotVersionStatusEnum, name="plot_version_status_enum_sqlm"), nullable=False), index=True)
    content_summary: Dict[str, Any] = Field(default_factory=dict, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    is_ending: bool = Field(default=False, nullable=False)
    content: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text), description="版本完整文本内容")

class PlotVersion(PlotVersionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now()), nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()), nullable=False)

    plot_branch: "PlotBranch" = Relationship(back_populates="versions")
    chapters_in_version: List["Chapter"] = Relationship(back_populates="plot_version", sa_relationship_kwargs={"lazy": "selectin", "order_by": "Chapter.version_order.nulls_last(), Chapter.id"})
    events_in_version: List["Event"] = Relationship(back_populates="plot_version", sa_relationship_kwargs={"lazy": "selectin", "order_by": "Event.event_order.nulls_last(), Event.id"})
    character_relationships_in_version: List["CharacterRelationship"] = Relationship(back_populates="plot_version", sa_relationship_kwargs={"lazy": "selectin"})
    conflicts_in_version: List["Conflict"] = Relationship(back_populates="plot_version", sa_relationship_kwargs={"lazy": "selectin"})

    __table_args__ = (UniqueConstraint('plot_branch_id', 'version_number', name='uq_plot_branch_version_number_sqlm'),)

# --- RuleTemplate (规则模板) 模型 ---
class RuleTemplateBase(SQLModel):
    name: str = Field(max_length=255, unique=True, index=True, nullable=False)
    description: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))
    tags: Dict[str, Any] = Field(default_factory=dict, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    task_type: str = Field(max_length=100, index=True, nullable=False, description="关联PredefinedTaskEnum或自定义字符串")
    parameters: Dict[str, schemas.RuleStepParameterDefinition] = Field(default_factory=dict, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    custom_instruction: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))
    post_processing_rules: List[schemas.PostProcessingRuleEnum] = Field(default_factory=list, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    input_source: schemas.StepInputSourceEnum = Field(default=schemas.StepInputSourceEnum.PREVIOUS_STEP, sa_column=SQLAlchemyColumn(SQLAlchemyEnum(schemas.StepInputSourceEnum, name="rule_template_input_source_enum_sqlm"), nullable=False))
    model_id: Optional[str] = Field(default=None, max_length=255)
    llm_override_parameters: Dict[str, Any] = Field(default_factory=dict, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    generation_constraints: Optional[schemas.GenerationConstraintsSchema] = Field(default=None, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    output_variable_name: Optional[str] = Field(default=None, max_length=100)

class RuleTemplate(RuleTemplateBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now()), nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()), nullable=False)
    
# --- RuleChain (规则链) 模型 ---
class RuleChainBase(SQLModel):
    name: str = Field(max_length=255, index=True, unique=True, nullable=False)
    description: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))
    is_template: bool = Field(default=False, index=True)
    novel_id: Optional[int] = Field(default=None, foreign_key="novel.id", index=True)
    global_model_id: Optional[str] = Field(default=None, max_length=255)
    global_llm_override_parameters: Dict[str, Any] = Field(default_factory=dict, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    global_generation_constraints: Optional[schemas.GenerationConstraintsSchema] = Field(default=None, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))

class RuleChain(RuleChainBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now()), nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()), nullable=False)
    
    novel: Optional["Novel"] = Relationship(back_populates="rule_chains")
    steps: List["RuleStep"] = Relationship(back_populates="chain", sa_relationship_kwargs={"cascade": "all, delete-orphan", "order_by": "RuleStep.step_order", "lazy":"selectin"})

# --- RuleStep (规则步骤) 模型 ---
class RuleStepBase(SQLModel):
    chain_id: int = Field(foreign_key="rulechain.id", nullable=False, index=True)
    template_id: Optional[int] = Field(default=None, foreign_key="ruletemplate.id", index=True)
    step_order: int = Field(nullable=False)
    task_type: str = Field(max_length=100, index=True, nullable=False, description="关联PredefinedTaskEnum或自定义字符串")
    parameters: Dict[str, Any] = Field(default_factory=dict, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    input_source: schemas.StepInputSourceEnum = Field(default=schemas.StepInputSourceEnum.PREVIOUS_STEP, sa_column=SQLAlchemyColumn(SQLAlchemyEnum(schemas.StepInputSourceEnum, name="rule_step_input_source_enum_sqlm"), nullable=False))
    model_id: Optional[str] = Field(default=None, max_length=255)
    llm_override_parameters: Dict[str, Any] = Field(default_factory=dict, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    generation_constraints: Optional[schemas.GenerationConstraintsSchema] = Field(default=None, sa_column=SQLAlchemyColumn(SQLAlchemyJSON))
    is_enabled: bool = Field(default=True, nullable=False)
    output_variable_name: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = Field(default=None, sa_column=SQLAlchemyColumn(Text))

class RuleStep(RuleStepBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now()), nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=SQLAlchemyColumn(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()), nullable=False)

    chain: "RuleChain" = Relationship(back_populates="steps")
    template: Optional["RuleTemplate"] = Relationship() # 单向关系，从Step可以查到Template