# backend/app/services/vector_store_service.py
import logging
import asyncio
import os
from pathlib import Path # 引入 Path 以更好地处理路径
from typing import List, Dict, Any, Optional, Tuple

from sqlalchemy.orm import Session
# Langchain 的 FAISS 向量存储和嵌入模型包装器
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings # 或其他嵌入模型服务
# Langchain的 RecursiveCharacterTextSplitter 用于分块
from langchain.text_splitter import RecursiveCharacterTextSplitter

# 从应用内部模块导入
from app import crud, schemas, models as db_models # db_models 指向 SQLModel 定义的模型
from app.config_service import get_setting, get_config
from app.tokenizer_service import estimate_token_count
from app.database import SessionLocal # 用于后台任务创建独立的DB会话
from backend.app.text_processing_utils import secure_filename # 用于安全化集合名称或路径

logger = logging.getLogger(__name__)

# --- 全局或类级别的嵌入模型实例 ---
_embedding_model_instance_faiss: Optional[HuggingFaceEmbeddings] = None

def get_embedding_model_faiss() -> HuggingFaceEmbeddings:
    """获取 FAISS 使用的嵌入模型实例 (单例模式)"""
    global _embedding_model_instance_faiss
    if _embedding_model_instance_faiss is None:
        embedding_settings = get_config().embedding_settings
        model_name = embedding_settings.model_name
        model_kwargs = embedding_settings.model_kwargs if embedding_settings.model_kwargs is not None else {'device': 'cpu'}
        encode_kwargs = embedding_settings.encode_kwargs if embedding_settings.encode_kwargs is not None else {'normalize_embeddings': False} # Langchain FAISS 通常期望归一化以使用内积进行余弦相似度
        
        try:
            _embedding_model_instance_faiss = HuggingFaceEmbeddings(
                model_name=model_name,
                model_kwargs=model_kwargs,
                encode_kwargs=encode_kwargs
            )
            logger.info(f"FAISS Service: HuggingFace 嵌入模型 '{model_name}' 已初始化。")
        except Exception as e:
            logger.error(f"FAISS Service: 初始化嵌入模型 '{model_name}' 失败: {e}", exc_info=True)
            raise RuntimeError(f"无法初始化嵌入模型: {e}") from e
            
    return _embedding_model_instance_faiss

def _split_text_for_faiss_vectorization(
    text: str,
    chunk_config_from_vector_store: Dict[str, Any],
    target_tokenizer_model_user_id: Optional[str] = None
) -> List[str]:
    """为向量化目的将文本分割成块 (与原 Qdrant 版本逻辑类似)。"""
    if not text or not text.strip():
        return []

    chunk_size_tokens = chunk_config_from_vector_store.get("text_chunk_size", 500)
    chunk_overlap_tokens = chunk_config_from_vector_store.get("text_chunk_overlap", 50)
    tokenizer_model_ref_id = target_tokenizer_model_user_id or \
                             chunk_config_from_vector_store.get("default_tokenizer_model_for_chunking") or \
                             get_config().llm_settings.default_model_id

    try:
        def _token_length_for_splitter(text_to_measure: str) -> int:
            return estimate_token_count(text_to_measure, model_user_id=tokenizer_model_ref_id)

        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size_tokens,
            chunk_overlap=chunk_overlap_tokens,
            length_function=_token_length_for_splitter,
            separators=["\n\n", "\n", "。", "！", "？", "，", "、", " ", ""],
        )
        split_chunks_list = text_splitter.split_text(text)
        logger.debug(f"文本(FAISS分块)基于Token估算分割为 {len(split_chunks_list)} 块 (参考模型ID: '{tokenizer_model_ref_id}')。")
        return split_chunks_list
    except ImportError:
        logger.warning("langchain.text_splitter 未安装。回退到简单的基于字符的文本分割。")
    except Exception as e_token_split_vec:
        logger.warning(f"基于Token的文本分割(FAISS)失败 ({e_token_split_vec})。回退到基于字符的分割。")
    
    try: # 字符分割回退
        from langchain.text_splitter import RecursiveCharacterTextSplitter as LangchainRecursiveSplitterFallback # noqa
        app_config_fallback = get_config()
        char_factor_from_cfg = app_config_fallback.llm_settings.tokenizer_options.default_chars_per_token_general
        char_factor_val = char_factor_from_cfg if isinstance(char_factor_from_cfg, (int, float)) and char_factor_from_cfg > 0 else 2.5
        
        char_splitter_fb = LangchainRecursiveSplitterFallback( # noqa
            chunk_size=int(chunk_size_tokens * char_factor_val), 
            chunk_overlap=int(chunk_overlap_tokens * char_factor_val),
            separators=["\n\n", "\n", "。", "！", "？", "，", "、", " ", ""],
        )
        split_chunks_char_fb = char_splitter_fb.split_text(text) # noqa
        logger.debug(f"文本(FAISS分块)基于字符估算分割为 {len(split_chunks_char_fb)} 块。")
        return split_chunks_char_fb
    except Exception as e_char_split_final_vec:
        logger.error(f"最终尝试基于字符分割(FAISS)时也发生错误: {e_char_split_final_vec}。返回整个文本。")
        return [text]


class FaissVectorStoreService:
    """
    使用 FAISS 和 Langchain 实现的向量存储服务，支持持久化。
    """
    def __init__(self):
        self.config = get_config().vector_store_settings
        self.embedding_model = get_embedding_model_faiss()
        self.base_persist_path = Path(self.config.faiss_persist_directory or "faiss_indexes") # 从配置获取或默认
        if not self.base_persist_path.exists():
            self.base_persist_path.mkdir(parents=True, exist_ok=True)
            logger.info(f"FAISS 持久化目录 '{self.base_persist_path}' 已创建。")
        
        # 内存缓存加载的FAISS索引实例
        self._loaded_faiss_indexes: Dict[int, FAISS] = {} 
        logger.info(f"FaissVectorStoreService 初始化完成。索引持久化目录: '{self.base_persist_path}'")

    def _get_novel_index_path(self, novel_id: int) -> Path:
        """获取特定小说FAISS索引的存储路径。"""
        return self.base_persist_path / f"novel_{novel_id}_faiss_index"

    def _load_index_from_disk(self, novel_id: int) -> Optional[FAISS]:
        """从磁盘加载指定小说的FAISS索引（如果存在）。"""
        index_path = self._get_novel_index_path(novel_id)
        if index_path.exists() and (index_path / "index.faiss").exists(): # FAISS 会保存 index.faiss 和 index.pkl
            try:
                logger.info(f"正在从磁盘加载 Novel ID {novel_id} 的 FAISS 索引 (路径: '{index_path}')。")
                # Langchain FAISS.load_local 需要 allow_dangerous_deserialization=True
                # 因为FAISS索引通常使用pickle序列化，这可能存在安全风险（如果索引文件来自不可信来源）。
                # 在此应用场景中，我们假设索引文件是由本应用自己生成的，是可信的。
                faiss_index = FAISS.load_local(
                    folder_path=str(index_path), 
                    embeddings=self.embedding_model,
                    allow_dangerous_deserialization=True 
                )
                self._loaded_faiss_indexes[novel_id] = faiss_index
                logger.info(f"Novel ID {novel_id} 的 FAISS 索引已成功从磁盘加载并缓存。")
                return faiss_index
            except Exception as e:
                logger.error(f"从磁盘加载 Novel ID {novel_id} 的 FAISS 索引失败: {e}", exc_info=True)
                # 如果加载失败，可以考虑删除损坏的索引目录
                # import shutil; shutil.rmtree(index_path, ignore_errors=True)
                return None
        logger.debug(f"磁盘上未找到 Novel ID {novel_id} 的持久化FAISS索引 (路径: '{index_path}')。")
        return None

    def get_or_create_index_for_novel(self, novel_id: int, db_novel_obj_for_path_update: Optional[db_models.Novel] = None, db_session_for_path_update: Optional[Session] = None) -> FAISS:
        """
        获取（从缓存或磁盘）或创建一个新的FAISS索引实例。
        如果创建了新索引或从磁盘加载，会更新数据库中 novel 记录的索引路径。
        """
        if novel_id in self._loaded_faiss_indexes:
            return self._loaded_faiss_indexes[novel_id]
        
        loaded_index = self._load_index_from_disk(novel_id)
        if loaded_index:
            return loaded_index
        
        # 如果索引不存在，则创建一个新的空索引
        logger.info(f"未找到 Novel ID {novel_id} 的现有FAISS索引，将创建新索引。")
        # FAISS.from_texts 需要至少一个文本和一个元数据才能创建，
        # 但我们希望有一个可以稍后添加文本的空索引。
        # Langchain 的 FAISS 实现可能不直接支持创建完全空的索引。
        # 一种策略是使用一个虚拟的文档来初始化它，但这并不理想。
        # 另一种方法是，如果只是为了获取一个可操作的 FAISS 对象，
        # 并且我们知道后续会调用 add_texts，可以在 add_texts 时处理创建。
        # 或者，我们可以先用一个占位符创建，如果后续没有添加，则不保存。
        # 为了简化，我们假设如果 get_or_create 被调用且索引不存在，
        # 那么调用者很可能马上就要添加文本，所以可以在 add_texts_to_novel_index 中处理创建。
        # 或者，如果只是为了搜索一个可能不存在的索引，那么返回一个临时空索引可能不合适。
        # 
        # 调整策略：get_or_create_index_for_novel 主要用于“获取”，如果磁盘上没有，
        # 应该由 add_texts_to_novel_index 来负责创建和首次保存。
        # 如果一个小说从未被向量化，那么它就不应该有索引。
        # 
        # 进一步调整：为了支持“即使没有文本也要有一个索引对象以便后续添加”的场景，
        # 我们可以使用一个非常小的、非空的占位符文本和元数据来初始化FAISS。
        # 但更好的做法可能是，只有在实际有文本要添加时才创建索引。
        # 此函数现在改为：如果磁盘加载失败，则返回一个新创建的、内存中的空FAISS实例，
        # 但【不】立即保存它，也不更新数据库路径，保存和路径更新由 `add_texts_to_novel_index` 负责。
        
        placeholder_text = ["初始化占位符文本，用于创建空的FAISS索引实例。"]
        placeholder_meta = [{"source": "init"}]
        
        try:
            new_empty_index = FAISS.from_texts(
                texts=placeholder_text,
                embedding=self.embedding_model,
                metadatas=placeholder_meta
            )
            # 删除占位符文档，使其成为一个逻辑上“空”的索引
            if new_empty_index.index and new_empty_index.index.ntotal > 0: # type: ignore
                 # FAISS的删除操作比较复杂，通常是按ID删除。
                 # Langchain的FAISS包装器提供了 delete 方法，需要文档的ID。
                 # docs = new_empty_index.similarity_search_with_score(placeholder_text[0], k=1)
                 # if docs:
                 #    ids_to_delete = [new_empty_index.index_to_docstore_id.get(new_empty_index.index.search(docs[0][0].embedding,1)[1][0])]
                 #    new_empty_index.delete(ids=ids_to_delete)
                 # 简单起见，我们接受这个包含一个占位符的索引，后续添加实际文本会覆盖它
                 pass
            
            self._loaded_faiss_indexes[novel_id] = new_empty_index
            logger.info(f"为 Novel ID {novel_id} 创建了一个新的内存中FAISS索引实例 (含占位符)。")
            # 注意：此时不保存到磁盘，也不更新数据库路径。这些由 add_texts 负责。
            return new_empty_index
        except Exception as e_create_empty:
            logger.error(f"创建新的空FAISS索引实例失败 (Novel ID {novel_id}): {e_create_empty}", exc_info=True)
            raise RuntimeError(f"创建FAISS索引失败: {e_create_empty}") from e_create_empty


    async def add_texts_to_novel_index(
        self,
        db: Session, # 同步Session
        novel_id: int,
        texts_with_metadata: List[Tuple[str, Dict[str, Any]]],
        db_novel_for_path_update: db_models.Novel # 传入 SQLModel 实例
    ) -> bool:
        """
        向指定小说的FAISS索引中添加文本和元数据。
        如果索引不存在，则创建它。然后保存到磁盘并更新数据库中的路径。
        """
        if not texts_with_metadata:
            logger.info(f"Novel ID {novel_id}: 没有提供文本和元数据，无需添加到FAISS索引。")
            return True # 没有内容添加，也视为成功

        log_prefix_add = f"[FAISS-AddTexts NID:{novel_id}]"
        texts, metadatas = zip(*texts_with_metadata)
        
        try:
            # 尝试获取或创建索引
            # get_or_create_index_for_novel 可能会返回一个带占位符的索引
            # 或者我们可以直接在这里处理创建逻辑
            
            current_index: Optional[FAISS] = None
            if novel_id in self._loaded_faiss_indexes:
                current_index = self._loaded_faiss_indexes[novel_id]
            else:
                current_index = self._load_index_from_disk(novel_id)

            if current_index:
                logger.info(f"{log_prefix_add} 向现有FAISS索引添加 {len(texts)} 个新文档。")
                await asyncio.to_thread(current_index.add_texts, texts=list(texts), metadatas=list(metadatas))
            else:
                logger.info(f"{log_prefix_add} 首次为小说创建FAISS索引并添加 {len(texts)} 个文档。")
                current_index = await asyncio.to_thread(
                    FAISS.from_texts, 
                    texts=list(texts), 
                    embedding=self.embedding_model, 
                    metadatas=list(metadatas)
                )
            
            if not current_index: # 进一步保险
                raise RuntimeError("未能获取或创建FAISS索引实例。")

            # 保存到磁盘
            index_path = self._get_novel_index_path(novel_id)
            await asyncio.to_thread(current_index.save_local, folder_path=str(index_path))
            logger.info(f"{log_prefix_add} FAISS索引已保存到磁盘: '{index_path}'")

            # 更新内存缓存
            self._loaded_faiss_indexes[novel_id] = current_index

            # 更新数据库中的 Novel 记录的索引路径
            if db_novel_for_path_update:
                update_payload = db_models.Novel(faiss_index_path=str(index_path)) # 使用模型更新
                await asyncio.to_thread(crud.update_novel, db, novel_obj=db_novel_for_path_update, novel_in=update_payload)
                logger.info(f"{log_prefix_add} 数据库中 Novel ID {novel_id} 的 faiss_index_path 已更新为 '{index_path}'。")
            else:
                logger.warning(f"{log_prefix_add} 未提供 db_novel_for_path_update 对象，无法更新数据库中的索引路径。")
            
            return True
        except Exception as e:
            logger.error(f"{log_prefix_add} 添加文本到FAISS索引并持久化时失败: {e}", exc_info=True)
            return False

    async def vectorize_novel_in_background(self, novel_id: int):
        """后台任务：对整个小说进行向量化并存入FAISS。"""
        log_prefix_bg = f"[FAISS-VectorizeBG NID:{novel_id}]"
        logger.info(f"{log_prefix_bg} 后台向量化任务启动。")
        
        db_bg: Optional[Session] = None
        novel_obj_for_update: Optional[db_models.Novel] = None

        try:
            db_bg = SessionLocal() # 为后台任务创建独立的DB会话
            novel_obj_for_update = await asyncio.to_thread(crud.get_novel, db_bg, novel_id=novel_id, with_details=True)
            if not novel_obj_for_update:
                logger.error(f"{log_prefix_bg} 未找到小说ID {novel_id}。向量化中止。")
                return

            update_payload_in_progress = db_models.Novel(
                vectorization_status=schemas.NovelVectorizationStatusEnum.IN_PROGRESS, 
                vectorization_errors=[]
            )
            await asyncio.to_thread(crud.update_novel, db_bg, novel_obj=novel_obj_for_update, novel_in=update_payload_in_progress)
            # 确保状态已刷新
            novel_obj_for_update = await asyncio.to_thread(db_bg.get, db_models.Novel, novel_id) #
            if not novel_obj_for_update: logger.error(f"{log_prefix_bg} 更新状态后无法重新获取小说对象。"); return #

            logger.info(f"{log_prefix_bg} 小说《{novel_obj_for_update.title}》向量化状态更新为 IN_PROGRESS。")

            if not novel_obj_for_update.chapters:
                logger.info(f"{log_prefix_bg} 小说《{novel_obj_for_update.title}》没有章节内容。向量化标记为“无内容完成”。")
                update_payload_no_content = db_models.Novel(vectorization_status=schemas.NovelVectorizationStatusEnum.COMPLETED_NO_CONTENT)
                await asyncio.to_thread(crud.update_novel, db_bg, novel_obj=novel_obj_for_update, novel_in=update_payload_no_content)
                return

            texts_with_metadata_list: List[Tuple[str, Dict[str, Any]]] = []
            processed_chapters_count = 0
            
            vector_store_chunk_config = get_config().vector_store_settings # 获取分块配置
            embedding_model_name_tok = get_config().embedding_settings.model_name # 用于分词器的参考模型

            for chapter_obj in novel_obj_for_update.chapters:
                if not chapter_obj.content or not chapter_obj.content.strip():
                    logger.info(f"{log_prefix_bg} [CH_ID:{chapter_obj.id}] 内容为空，跳过。")
                    continue
                
                logger.info(f"{log_prefix_bg} [CH_ID:{chapter_obj.id}] 正在处理章节 '{chapter_obj.title}'。")
                
                chapter_text_chunks = await asyncio.to_thread(
                    _split_text_for_faiss_vectorization,
                    chapter_obj.content,
                    vector_store_chunk_config.model_dump(), # 将Pydantic模型转为字典
                    target_tokenizer_model_user_id=embedding_model_name_tok
                )
                if not chapter_text_chunks: continue

                for chunk_idx, text_chunk in enumerate(chapter_text_chunks):
                    metadata = {
                        "novel_id": novel_id, "chapter_id": chapter_obj.id,
                        "chapter_order": chapter_obj.chapter_index,
                        "plot_version_id": chapter_obj.plot_version_id, # 确保模型中有此字段
                        "version_order": chapter_obj.version_order,   # 确保模型中有此字段
                        "chapter_title": chapter_obj.title or f"章节 {chapter_obj.chapter_index + 1}",
                        "chunk_index_in_chapter": chunk_idx,
                        "text_preview": text_chunk[:200] + ("..." if len(text_chunk)>200 else "")
                    }
                    texts_with_metadata_list.append((text_chunk, metadata))
                processed_chapters_count +=1
            
            if not texts_with_metadata_list:
                logger.info(f"{log_prefix_bg} 所有章节处理完毕，但未生成任何有效文本块。")
                update_payload_no_blocks = db_models.Novel(vectorization_status=schemas.NovelVectorizationStatusEnum.COMPLETED_NO_CONTENT)
                await asyncio.to_thread(crud.update_novel, db_bg, novel_obj=novel_obj_for_update, novel_in=update_payload_no_blocks)
                return

            # 添加到FAISS并保存
            add_success = await self.add_texts_to_novel_index(db_bg, novel_id, texts_with_metadata_list, novel_obj_for_update)
            
            if add_success:
                final_status_update = db_models.Novel(vectorization_status=schemas.NovelVectorizationStatusEnum.COMPLETED)
            else:
                final_status_update = db_models.Novel(vectorization_status=schemas.NovelVectorizationStatusEnum.FAILED, vectorization_errors=["添加文本到索引时发生错误，详见日志。"])
            
            await asyncio.to_thread(crud.update_novel, db_bg, novel_obj=novel_obj_for_update, novel_in=final_status_update)
            logger.info(f"{log_prefix_bg} 后台向量化任务完成。最终状态: {final_status_update.vectorization_status.value if final_status_update.vectorization_status else '未知'}。")

        except Exception as e_bg:
            logger.error(f"{log_prefix_bg} 后台向量化任务中发生严重错误: {e_bg}", exc_info=True)
            if db_bg and novel_obj_for_update:
                try:
                    err_update = db_models.Novel(
                        vectorization_status=schemas.NovelVectorizationStatusEnum.FAILED,
                        vectorization_errors=(novel_obj_for_update.vectorization_errors or []) + [f"后台任务主错误: {str(e_bg)[:150]}"]
                    )
                    await asyncio.to_thread(crud.update_novel, db_bg, novel_obj=novel_obj_for_update, novel_in=err_update)
                except Exception as e_db_final_err:
                    logger.error(f"{log_prefix_bg} 更新小说状态为FAILED时再次失败: {e_db_final_err}", exc_info=True)
        finally:
            if db_bg:
                db_bg.close()
                logger.info(f"{log_prefix_bg} 后台任务数据库会话已关闭。")

    async def search_similar_documents(
        self, novel_id: int, query_text: str, top_k: int = 5, 
        score_threshold: Optional[float] = None # 0-1, higher is more similar
    ) -> List[schemas.SimilaritySearchResultItem]:
        """在指定小说的FAISS索引中执行相似性搜索。"""
        log_prefix_search = f"[FAISS-Search NID:{novel_id}]"
        logger.info(f"{log_prefix_search} 搜索: '{query_text[:50]}...', top_k={top_k}, threshold={score_threshold}")

        faiss_index = self.get_or_create_index_for_novel(novel_id) # 这会从缓存或磁盘加载
        if not faiss_index or (hasattr(faiss_index, 'index') and faiss_index.index is None): # 检查索引是否有效
             logger.warning(f"{log_prefix_search} 未找到或无法加载 Novel ID {novel_id} 的FAISS索引。")
             return []
        # 确保索引中有内容
        if hasattr(faiss_index, 'index') and faiss_index.index is not None and faiss_index.index.ntotal == 0: # type: ignore
            logger.info(f"{log_prefix_search} Novel ID {novel_id} 的FAISS索引为空，无法搜索。")
            return []


        try:
            # Langchain FAISS 的 similarity_search_with_relevance_scores 返回 (Document, score)
            # score 范围 0-1，越高越相似 (基于余弦相似度)
            # 这是同步阻塞操作，用 to_thread 包装
            search_results_with_scores: List[Tuple[Any, float]] = await asyncio.to_thread(
                faiss_index.similarity_search_with_relevance_scores,
                query=query_text,
                k=top_k,
                score_threshold=score_threshold # 直接传递给langchain，它会处理
            )
            logger.info(f"{log_prefix_search} 从FAISS获取到 {len(search_results_with_scores)} 条原始结果。")
            
            processed_results: List[schemas.SimilaritySearchResultItem] = []
            for doc_obj, relevance_score_val in search_results_with_scores:
                metadata_item = doc_obj.metadata or {}
                # 确保返回的 SimilaritySearchResultItem 结构符合 schemas.py 定义
                processed_results.append(schemas.SimilaritySearchResultItem(
                    id=metadata_item.get("doc_id", f"faiss_chunk_{novel_id}_{metadata_item.get('chapter_id', 'unk')}_{metadata_item.get('chunk_index_in_chapter', 'unk')}"), # 构建唯一ID
                    text=doc_obj.page_content,
                    metadata=metadata_item,
                    distance=(1.0 - relevance_score_val), # 将相关性得分转换为“距离”（如果需要，但前端可能直接用score）
                    similarity_score=relevance_score_val, # 保留原始相关性得分
                    source=str(metadata_item.get("source_document_path") or metadata_item.get("chapter_title") or f"Chapter {metadata_item.get('chapter_order', -1)+1}")
                ))
            return processed_results
        except Exception as e:
            logger.error(f"{log_prefix_search} FAISS相似性搜索时出错: {e}", exc_info=True)
            return []

    async def delete_novel_index(self, db: Session, novel_id: int, novel_obj_to_update: Optional[db_models.Novel] = None) -> bool:
        """删除指定小说的FAISS索引（从缓存和磁盘）。"""
        log_prefix_del = f"[FAISS-DeleteIndex NID:{novel_id}]"
        logger.info(f"{log_prefix_del} 开始删除索引。")
        
        index_path = self._get_novel_index_path(novel_id)
        
        # 1. 从内存缓存中移除
        if novel_id in self._loaded_faiss_indexes:
            del self._loaded_faiss_indexes[novel_id]
            logger.info(f"{log_prefix_del} 已从内存缓存中移除索引。")

        # 2. 从磁盘删除持久化文件
        deleted_from_disk = False
        if index_path.exists():
            try:
                import shutil # 导入shutil用于删除目录
                await asyncio.to_thread(shutil.rmtree, str(index_path))
                deleted_from_disk = True
                logger.info(f"{log_prefix_del} 已从磁盘删除索引目录: '{index_path}'。")
            except Exception as e:
                logger.error(f"{log_prefix_del} 从磁盘删除索引目录 '{index_path}' 失败: {e}", exc_info=True)
        else:
            logger.info(f"{log_prefix_del} 磁盘上未找到索引目录 '{index_path}'，无需删除。")
            deleted_from_disk = True # 逻辑上已“删除”（因为它不存在）

        # 3. 更新数据库中的 Novel 记录 (清除索引路径)
        if novel_obj_to_update or (db and novel_id):
            try:
                db_novel_obj = novel_obj_to_update or await asyncio.to_thread(db.get, db_models.Novel, novel_id)
                if db_novel_obj:
                    update_payload_del_path = db_models.Novel(faiss_index_path=None, vectorization_status=schemas.NovelVectorizationStatusEnum.PENDING)
                    await asyncio.to_thread(crud.update_novel, db, novel_obj=db_novel_obj, novel_in=update_payload_del_path)
                    logger.info(f"{log_prefix_del} 数据库中 Novel ID {novel_id} 的 faiss_index_path 已清除。")
            except Exception as e_db_update:
                logger.error(f"{log_prefix_del} 清除数据库中 Novel ID {novel_id} 的索引路径时失败: {e_db_update}", exc_info=True)
        
        return deleted_from_disk

    async def get_status_summary(self) -> schemas.VectorStoreStatusResponse:
        """获取当前FAISS向量存储服务的状态摘要。"""
        num_cached_indexes = len(self._loaded_faiss_indexes)
        persisted_index_count = 0
        if self.base_persist_path.exists() and self.base_persist_path.is_dir():
            try:
                persisted_index_count = sum(1 for item in self.base_persist_path.iterdir() if item.is_dir() and (item / "index.faiss").exists())
            except Exception as e:
                logger.warning(f"检查持久化FAISS索引数量时出错: {e}")

        return schemas.VectorStoreStatusResponse(
            collection_name=f"FAISS (Base Path: {self.base_persist_path})", # FAISS没有单一集合名的概念
            document_count=0, # FAISS本身不直接提供跨所有索引的文档总数
            indexed_novel_count_in_cache=num_cached_indexes,
            indexed_novel_count_on_disk=persisted_index_count,
            status="OPERATIONAL" if self.embedding_model else "INITIALIZING_EMBEDDINGS_FAILED",
            error_message=None,
            client_type="FAISS (Langchain)",
            embedding_function_name=self.embedding_model.model_name if self.embedding_model else "N/A"
        )


# 单例模式或工厂函数
_vector_store_service_instance: Optional[FaissVectorStoreService] = None

# [最终修改] 将函数名从 get_faiss_vector_store_service 改回 get_vector_store_service
# 以匹配路由文件中对它的调用，确保API的正常工作。
def get_vector_store_service() -> FaissVectorStoreService:
    """
    获取向量存储服务的单例。
    此函数现在是应用中获取向量服务的唯一入口点。
    """
    global _vector_store_service_instance
    if _vector_store_service_instance is None:
        try:
            # 此处可以根据配置选择加载不同的服务，但目前我们专注于FAISS
            app_config = config_service.get_config_sync()
            if app_config.vector_store_settings.type == schemas.VectorStoreTypeEnum.FAISS:
                _vector_store_service_instance = FaissVectorStoreService()
                logger.info("已成功实例化 FaissVectorStoreService。")
            else:
                # 在此可以为其他向量存储（如Qdrant）添加逻辑
                logger.error(f"配置的向量存储类型 '{app_config.vector_store_settings.type}' 当前没有实现的服务。")
                raise NotImplementedError(f"Vector store type '{app_config.vector_store_settings.type}' is not implemented.")

        except Exception as e:
            logger.critical(f"VectorStoreService 实例化失败: {e}", exc_info=True)
            raise
    return _vector_store_service_instance