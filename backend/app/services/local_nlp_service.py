# backend/app/services/local_nlp_service.py
import logging
from typing import List, Dict, Optional, Any, Tuple, Callable # Callable用于类型提示
import gc # 用于垃圾回收，辅助模型卸载

# NLP库的导入是可选的，取决于配置和实际使用
_NLP_LIBRARIES_AVAILABLE: Dict[str, bool] = {
    "spacy": False,
    "stanza": False,
    "hanlp": False,
}

try:
    import spacy
    from spacy.language import Language as SpacyLanguage
    _NLP_LIBRARIES_AVAILABLE["spacy"] = True
except ImportError:
    SpacyLanguage = None # type: ignore
    logger = logging.getLogger(__name__) # 在导入失败时获取logger
    logger.info("spaCy 库未安装。如果需要使用spaCy进行本地NLP处理，请运行 'pip install spacy' 并下载相应模型。")

try:
    import stanza
    StanzaPipeline = stanza.Pipeline # type: ignore
    _NLP_LIBRARIES_AVAILABLE["stanza"] = True
except ImportError:
    StanzaPipeline = None # type: ignore
    logger = logging.getLogger(__name__)
    logger.info("Stanza 库未安装。如果需要使用Stanza进行本地NLP处理，请运行 'pip install stanza' 并下载相应模型。")

try:
    import hanlp # type: ignore
    HanlpPipeline = Any # hanlp.Pipeline的类型较为复杂，用Any简化
    _NLP_LIBRARIES_AVAILABLE["hanlp"] = True
except ImportError:
    HanlpPipeline = None # type: ignore
    logger = logging.getLogger(__name__)
    logger.info("HanLP 库未安装。如果需要使用HanLP进行本地NLP处理，请运行 'pip install hanlp' 并确保已配置或下载模型。")

# 从应用内部模块导入
# 修正导入路径：config_service 与 local_nlp_service 在同一目录下，应使用相对导入
from .config_service import get_setting, get_config # 
from .. import schemas # schemas 在 app/ 目录下，相对于 app/services/ 是上一级

logger = logging.getLogger(__name__) # 全局logger

# --- 全局变量用于缓存已加载的NLP模型 ---
_loaded_spacy_models: Dict[str, SpacyLanguage] = {}
_loaded_stanza_pipelines: Dict[str, StanzaPipeline] = {} # type: ignore
_loaded_hanlp_pipelines: Dict[str, HanlpPipeline] = {} # type: ignore


def _load_spacy_model(lang_code: str, model_name_or_path: Optional[str] = None) -> Optional[SpacyLanguage]:
    """加载（或获取缓存的）spaCy模型。"""
    if not _NLP_LIBRARIES_AVAILABLE["spacy"] or not SpacyLanguage:
        logger.warning("spaCy库不可用，无法加载模型。")
        return None
    
    model_key = f"spacy_{lang_code}_{model_name_or_path or 'default'}"
    if model_key in _loaded_spacy_models:
        logger.debug(f"从缓存返回已加载的spaCy模型: {model_key}")
        return _loaded_spacy_models[model_key]

    try:
        effective_model_name = model_name_or_path
        if not effective_model_name: # 如果未指定模型名，尝试从语言代码推断
            # spaCy的语言模型命名通常是 lang_core_web_sm/md/lg/trf
            # 这里仅是一个简单示例，实际应用中可能需要更复杂的查找逻辑或配置
            if lang_code == "zh": effective_model_name = "zh_core_web_sm"
            elif lang_code == "en": effective_model_name = "en_core_web_sm"
            else: # 其他语言可能没有简单的默认小型模型名
                logger.warning(f"spaCy: 未为语言 '{lang_code}' 指定模型名，且无默认推断规则。加载可能失败。")
                return None
        
        logger.info(f"spaCy: 尝试加载模型 '{effective_model_name}'...")
        # --- MODIFICATION START ---
        # 添加 try...except 块来处理 spacy.load 可能的失败
        nlp_model = spacy.load(effective_model_name) # type: ignore
        # --- MODIFICATION END ---
        _loaded_spacy_models[model_key] = nlp_model
        logger.info(f"spaCy: 模型 '{effective_model_name}' 加载成功并缓存。")
        return nlp_model
    except OSError as e_os: # 模型未找到或无法加载
        logger.error(f"spaCy: 加载模型 '{effective_model_name}' 失败 (OSError): {e_os}。请确保模型已下载 (例如: python -m spacy download {effective_model_name})。")
    except Exception as e: # 捕获其他可能的 spacy.load 异常或上面代码块的通用异常
        logger.error(f"spaCy: 加载模型 '{effective_model_name}' 时发生未知错误: {e}", exc_info=True)
    return None

def _load_stanza_model(lang_code: str, processors_str: Optional[str] = None) -> Optional[StanzaPipeline]: # type: ignore
    """加载（或获取缓存的）Stanza流水线。"""
    if not _NLP_LIBRARIES_AVAILABLE["stanza"] or not StanzaPipeline:
        logger.warning("Stanza库不可用，无法加载模型。")
        return None

    # Stanza的处理器字符串可能很长，用哈希或固定标识符作键可能更好
    model_key = f"stanza_{lang_code}_{processors_str or 'default'}"
    if model_key in _loaded_stanza_pipelines:
        logger.debug(f"从缓存返回已加载的Stanza流水线: {model_key}")
        return _loaded_stanza_pipelines[model_key]

    try:
        # 确定Stanza的语言代码，Stanza通常使用ISO 639-1代码
        stanza_lang_map = {"zh": "zh", "en": "en"} # 简单映射
        stanza_lang_code_eff = stanza_lang_map.get(lang_code, lang_code) # 如果不在映射中，直接使用
        
        effective_processors = processors_str
        if not effective_processors: # 如果未提供处理器，则使用默认组合
            # 默认组合通常包含 tokenize, mwt, pos, lemma, depparse, ner
            effective_processors = "tokenize,pos,lemma,ner,depparse" 
            logger.info(f"Stanza: 未指定处理器，使用默认组合: '{effective_processors}' for lang '{stanza_lang_code_eff}'.")

        logger.info(f"Stanza: 尝试为语言 '{stanza_lang_code_eff}' 加载处理器 '{effective_processors}'...")
        # Stanza 可能会在首次加载时下载模型，这可能需要时间
        # suppress_warning=True 可以减少一些不必要的警告输出
        pipeline = StanzaPipeline(lang=stanza_lang_code_eff, processors=effective_processors, use_gpu=False, suppress_warning=True) # type: ignore
        _loaded_stanza_pipelines[model_key] = pipeline
        logger.info(f"Stanza: 流水线 (lang='{stanza_lang_code_eff}', processors='{effective_processors}') 加载成功并缓存。")
        return pipeline
    except FileNotFoundError as e_fnf: # 模型文件未找到
         logger.error(f"Stanza: 加载模型文件失败 (FileNotFoundError): {e_fnf}。请确保已为语言 '{stanza_lang_code_eff}' 下载模型 (例如: stanza.download('{stanza_lang_code_eff}')).")
    except Exception as e:
        logger.error(f"Stanza: 加载流水线时发生未知错误 (lang='{stanza_lang_code_eff}', proc='{effective_processors}'): {e}", exc_info=True)
    return None

def _load_hanlp_model(task_or_model_name: str) -> Optional[HanlpPipeline]: # type: ignore
    """加载（或获取缓存的）HanLP模型/任务。"""
    if not _NLP_LIBRARIES_AVAILABLE["hanlp"] or not hanlp:
        logger.warning("HanLP库不可用，无法加载模型。")
        return None
    
    model_key = f"hanlp_{task_or_model_name}"
    if model_key in _loaded_hanlp_pipelines:
        logger.debug(f"从缓存返回已加载的HanLP模型/任务: {model_key}")
        return _loaded_hanlp_pipelines[model_key]

    try:
        logger.info(f"HanLP: 尝试加载模型/任务 '{task_or_model_name}'...")
        # HanLP的加载方式比较灵活，可以直接加载预训练模型，或指定任务让HanLP选择默认模型
        # 例如: hanlp.load(hanlp.pretrained.ner.MSRA_NER_ALBERT_BASE_CN)
        # 或 hanlp.pipeline("ner/msra")
        # 这里假设 task_or_model_name 是一个HanLP可以识别的字符串
        pipeline_or_model = hanlp.load(task_or_model_name) # type: ignore 
        _loaded_hanlp_pipelines[model_key] = pipeline_or_model
        logger.info(f"HanLP: 模型/任务 '{task_or_model_name}' 加载成功并缓存。")
        return pipeline_or_model
    except Exception as e:
        logger.error(f"HanLP: 加载模型/任务 '{task_or_model_name}' 时发生错误: {e}", exc_info=True)
    return None

def _unload_model(provider: str, lang_code: str, model_name: Optional[str] = None, task_name: Optional[str] = None) -> bool:
    """尝试卸载指定的NLP模型以释放内存。"""
    unloaded = False
    model_key_part = model_name or task_name or 'default'
    
    if provider == "spacy":
        model_key_spacy = f"spacy_{lang_code}_{model_key_part}"
        if model_key_spacy in _loaded_spacy_models:
            del _loaded_spacy_models[model_key_spacy]
            unloaded = True; logger.info(f"spaCy模型 '{model_key_spacy}' 已从缓存中移除。")
    elif provider == "stanza":
        model_key_stanza = f"stanza_{lang_code}_{model_key_part}"
        if model_key_stanza in _loaded_stanza_pipelines:
            del _loaded_stanza_pipelines[model_key_stanza]
            unloaded = True; logger.info(f"Stanza流水线 '{model_key_stanza}' 已从缓存中移除。")
    elif provider == "hanlp":
        model_key_hanlp = f"hanlp_{model_key_part}" # HanLP的键通常不包含lang_code
        if model_key_hanlp in _loaded_hanlp_pipelines:
            del _loaded_hanlp_pipelines[model_key_hanlp]
            unloaded = True; logger.info(f"HanLP模型/任务 '{model_key_hanlp}' 已从缓存中移除。")
    
    if unloaded:
        gc.collect() # 尝试触发垃圾回收
        logger.info(f"模型卸载后触发了垃圾回收。Provider: {provider}, KeyPart: {model_key_part}")
    else:
        logger.warning(f"尝试卸载模型失败：未找到匹配的模型。Provider: {provider}, KeyPart: {model_key_part}")
    return unloaded

def _get_preferred_provider_and_model(
    lang_code: str, 
    task: str # 例如 "ner", "pos", "dependency"
) -> Tuple[Optional[str], Optional[str]]:
    """根据语言和任务，从配置中获取首选的NLP提供商和模型名称。"""
    app_config_nlp = get_config()
    local_nlp_settings = app_config_nlp.local_nlp_settings
    
    # 优先使用语言特定的配置
    lang_specific_prefs = local_nlp_settings.language_preferences.get(lang_code)
    if lang_specific_prefs:
        task_specific_model_cfg = getattr(lang_specific_prefs, f"{task}_model", None) # 例如 lang_specific_prefs.ner_model
        if task_specific_model_cfg and task_specific_model_cfg.provider and task_specific_model_cfg.model_name_or_path:
            logger.debug(f"为语言 '{lang_code}' 的任务 '{task}' 找到特定配置: Provider='{task_specific_model_cfg.provider}', Model='{task_specific_model_cfg.model_name_or_path}'")
            return task_specific_model_cfg.provider, task_specific_model_cfg.model_name_or_path
    
    # 如果没有语言特定的，则使用全局默认提供商和该提供商的默认模型（如果配置了）
    default_provider_for_task = getattr(local_nlp_settings.default_provider_for_task, task, None)
    if default_provider_for_task:
        provider_defaults = local_nlp_settings.provider_defaults.get(default_provider_for_task)
        if provider_defaults and provider_defaults.default_model_for_lang.get(lang_code):
            model_name_val = provider_defaults.default_model_for_lang[lang_code]
            logger.debug(f"使用全局默认提供商 '{default_provider_for_task}' 和其为语言 '{lang_code}' 的默认模型 '{model_name_val}' (任务: '{task}')。")
            return default_provider_for_task, model_name_val
        elif provider_defaults and provider_defaults.generic_default_model: # 提供商的通用默认模型
            logger.debug(f"使用全局默认提供商 '{default_provider_for_task}' 及其通用默认模型 '{provider_defaults.generic_default_model}' (任务: '{task}', 语言: '{lang_code}')。")
            return default_provider_for_task, provider_defaults.generic_default_model
    
    logger.warning(f"未能为语言 '{lang_code}' 和任务 '{task}' 找到明确的NLP提供商和模型配置。")
    return None, None


class LocalNLPService:
    """
    提供本地自然语言处理功能的封装服务。
    此类中的方法应该是静态的或需要实例化服务。
    为了与项目其他服务调用方式一致（例如后台任务中可能需要传递实例或重新创建），
    目前设计为调用时动态确定和加载模型。
    """

    @staticmethod
    def pos_tag_text(request: schemas.NLPTaskRequest) -> List[schemas.NLPToken]:
        """对文本进行词性标注。"""
        logger.info(f"LocalNLPService: 收到词性标注请求。语言: {request.language}, 文本 (预览): '{request.text[:50]}...'")
        provider, model_name = _get_preferred_provider_and_model(request.language, "pos")
        if not provider:
            raise ValueError(f"无法为语言 '{request.language}' 的词性标注任务找到合适的提供商。")

        results: List[schemas.NLPToken] = []
        if provider == "spacy" and _NLP_LIBRARIES_AVAILABLE["spacy"]:
            nlp = _load_spacy_model(request.language, model_name)
            if nlp:
                doc = nlp(request.text)
                for token in doc:
                    results.append(schemas.NLPToken(
                        text=token.text, lemma=token.lemma_, pos=token.pos_, tag=token.tag_,
                        start_char=token.idx, end_char=token.idx + len(token.text)
                    ))
        elif provider == "stanza" and _NLP_LIBRARIES_AVAILABLE["stanza"]:
            pipeline = _load_stanza_model(request.language, model_name or "tokenize,pos,lemma") # 确保包含pos
            if pipeline:
                doc = pipeline(request.text) # type: ignore
                for sent in doc.sentences:
                    for word in sent.words:
                        results.append(schemas.NLPToken(
                            text=word.text, lemma=word.lemma, pos=word.upos, tag=word.xpos,
                            start_char=word.start_char, end_char=word.end_char
                        ))
        elif provider == "hanlp" and _NLP_LIBRARIES_AVAILABLE["hanlp"]:
            # HanLP的词性标注通常作为分词的一部分或独立任务
            # 这里假设 model_name 是一个可以执行分词+词性标注的HanLP任务标识符
            # 例如 hanlp.pipeline('tok', conll=hanlp.pretrained.tok.COARSE_ELECTRA_SMALL_ZH) 后处理或直接使用POS组件
            pipeline_hanlp_pos = _load_hanlp_model(model_name or hanlp.pretrained.pos.CPTB_POS_ELECTRA_SMALL) # type: ignore # 示例模型
            if pipeline_hanlp_pos:
                # HanLP的输出格式多样，需要适配
                # 假设pipeline_hanlp_pos返回一个包含 (词, 词性) 元组的列表
                processed_output = pipeline_hanlp_pos(request.text)
                # 需要根据HanLP具体模型的输出结构来构建NLPToken
                # 以下是一个非常简化的示例，实际需要更复杂的偏移量计算和结构解析
                current_offset = 0
                if isinstance(processed_output, list) and all(isinstance(item, tuple) and len(item) == 2 for item in processed_output):
                    for word_text, pos_tag_val in processed_output:
                        results.append(schemas.NLPToken(
                            text=word_text, pos=pos_tag_val, tag=pos_tag_val, # lemma 和 tag 可能需要额外处理
                            start_char=current_offset, end_char=current_offset + len(word_text)
                        ))
                        current_offset += len(word_text) # 简化的偏移计算
                else: logger.warning(f"HanLP词性标注输出格式未知或不兼容: {type(processed_output)}")

        else:
            raise NotImplementedError(f"提供商 '{provider}' 或其库未正确加载，无法执行词性标注。")
        
        logger.info(f"LocalNLPService: 词性标注完成，生成 {len(results)} 个Token。")
        return results

    @staticmethod
    def ner_text(request: schemas.NLPTaskRequest) -> List[schemas.NLPEntity]:
        """对文本进行命名实体识别。"""
        logger.info(f"LocalNLPService: 收到命名实体识别请求。语言: {request.language}, 文本 (预览): '{request.text[:50]}...'")
        provider, model_name = _get_preferred_provider_and_model(request.language, "ner")
        if not provider:
            raise ValueError(f"无法为语言 '{request.language}' 的命名实体识别任务找到合适的提供商。")

        results: List[schemas.NLPEntity] = []
        if provider == "spacy" and _NLP_LIBRARIES_AVAILABLE["spacy"]:
            nlp = _load_spacy_model(request.language, model_name)
            if nlp:
                doc = nlp(request.text)
                for ent in doc.ents:
                    results.append(schemas.NLPEntity(
                        text=ent.text, label=ent.label_, 
                        start_char=ent.start_char, end_char=ent.end_char
                    ))
        elif provider == "stanza" and _NLP_LIBRARIES_AVAILABLE["stanza"]:
            pipeline = _load_stanza_model(request.language, model_name or "tokenize,ner") # 确保包含ner
            if pipeline:
                doc = pipeline(request.text) # type: ignore
                for ent in doc.ents: # type: ignore # Stanza的ent对象
                    results.append(schemas.NLPEntity(
                        text=ent.text, label=ent.type,
                        start_char=ent.start_char, end_char=ent.end_char
                    ))
        elif provider == "hanlp" and _NLP_LIBRARIES_AVAILABLE["hanlp"]:
            pipeline_hanlp_ner = _load_hanlp_model(model_name or hanlp.pretrained.ner.MSRA_NER_ALBERT_BASE_CN) # type: ignore # 示例模型
            if pipeline_hanlp_ner:
                processed_output_ner = pipeline_hanlp_ner(request.text) # HanLP的NER输出通常是 (实体文本, 实体类型, 起始索引, 结束索引) 列表
                if isinstance(processed_output_ner, list) and all(isinstance(item, tuple) and len(item) == 4 for item in processed_output_ner):
                    for ent_text, ent_type, ent_start, ent_end in processed_output_ner:
                         results.append(schemas.NLPEntity(text=ent_text, label=ent_type, start_char=ent_start, end_char=ent_end))
                else: logger.warning(f"HanLP命名实体识别输出格式未知或不兼容: {type(processed_output_ner)}")
        else:
            raise NotImplementedError(f"提供商 '{provider}' 或其库未正确加载，无法执行命名实体识别。")
        
        logger.info(f"LocalNLPService: 命名实体识别完成，找到 {len(results)} 个实体。")
        return results

    @staticmethod
    def dependency_parse_text(request: schemas.NLPTaskRequest) -> List[schemas.NLPDependency]:
        """对文本进行依存句法分析。"""
        logger.info(f"LocalNLPService: 收到依存句法分析请求。语言: {request.language}, 文本 (预览): '{request.text[:50]}...'")
        provider, model_name = _get_preferred_provider_and_model(request.language, "dependency")
        if not provider:
            raise ValueError(f"无法为语言 '{request.language}' 的依存句法分析任务找到合适的提供商。")

        results: List[schemas.NLPDependency] = []
        if provider == "spacy" and _NLP_LIBRARIES_AVAILABLE["spacy"]:
            nlp = _load_spacy_model(request.language, model_name)
            if nlp:
                doc = nlp(request.text)
                for token in doc:
                    results.append(schemas.NLPDependency(
                        dependent_text=token.text, dependent_pos=token.pos_,
                        head_text=token.head.text, head_pos=token.head.pos_,
                        relation=token.dep_
                    ))
        elif provider == "stanza" and _NLP_LIBRARIES_AVAILABLE["stanza"]:
            pipeline = _load_stanza_model(request.language, model_name or "tokenize,pos,lemma,depparse") # 确保包含depparse
            if pipeline:
                doc = pipeline(request.text) # type: ignore
                for sent in doc.sentences:
                    for word in sent.words: # type: ignore # Stanza的word对象
                        # Stanza中 word.head 是父节点的索引 (1-based)，0表示root
                        head_word_obj = sent.words[word.head - 1] if word.head > 0 else None
                        results.append(schemas.NLPDependency(
                            dependent_text=word.text, dependent_pos=word.upos,
                            head_text=head_word_obj.text if head_word_obj else "ROOT",
                            head_pos=head_word_obj.upos if head_word_obj else "ROOT",
                            relation=word.deprel
                        ))
        elif provider == "hanlp" and _NLP_LIBRARIES_AVAILABLE["hanlp"]:
            pipeline_hanlp_dep = _load_hanlp_model(model_name or hanlp.pretrained.dep.PMT_ELECTRA_SMALL_DEP_SUD_UD_2_10_CHINESE) # type: ignore # 示例模型
            if pipeline_hanlp_dep:
                # HanLP的依存句法输出通常是CoNLL格式的字符串或对象列表，需要解析
                # 这里假设它返回一个列表，每个元素代表一个词及其依存关系
                # (词索引, 词文本, 词性, 中心词索引, 依存关系标签)
                processed_output_dep = pipeline_hanlp_dep(request.text)
                # 需要根据具体输出格式适配
                if isinstance(processed_output_dep, list) and processed_output_dep and \
                   isinstance(processed_output_dep[0], list) and \
                   all(isinstance(row, list) and len(row) >= 7 for row in processed_output_dep[0]): # 假设是嵌套列表 [[token_info_sent1], [token_info_sent2]]
                    for sentence_deps in processed_output_dep: # 遍历每个句子
                        # HanLP的CoNLL格式通常是1-based索引
                        # words_in_sent = {int(row[0]): {"text": row[1], "pos": row[3]} for row in sentence_deps} # 创建一个词索引到信息的映射
                        for dep_info_row in sentence_deps: # 遍历句子中的每个词的依存信息
                            if len(dep_info_row) < 7: continue # 确保数据足够
                            word_idx, word_text, _, word_pos, _, _, head_idx_str, dep_rel = dep_info_row[:8] # 取前8个CoNLL列
                            head_idx_int = int(head_idx_str) if head_idx_str.isdigit() else 0
                            
                            head_text_val = "ROOT"; head_pos_val = "ROOT"
                            if head_idx_int > 0 and head_idx_int <= len(sentence_deps):
                                head_word_info_row = sentence_deps[head_idx_int - 1] # 获取中心词行
                                if len(head_word_info_row) >= 4:
                                    head_text_val = head_word_info_row[1]
                                    head_pos_val = head_word_info_row[3]
                            
                            results.append(schemas.NLPDependency(
                                dependent_text=word_text, dependent_pos=word_pos,
                                head_text=head_text_val, head_pos=head_pos_val,
                                relation=dep_rel
                            ))
                else: logger.warning(f"HanLP依存句法分析输出格式未知或不兼容: {type(processed_output_dep)}")
        else:
            raise NotImplementedError(f"提供商 '{provider}' 或其库未正确加载，无法执行依存句法分析。")

        logger.info(f"LocalNLPService: 依存句法分析完成，生成 {len(results)} 条依存关系。")
        return results

    @staticmethod
    def unload_nlp_model(provider: str, language: str, model_name_or_task: Optional[str] = None) -> Dict[str, Any]:
        """尝试卸载指定的本地NLP模型以释放资源。"""
        logger.info(f"LocalNLPService: 收到卸载模型请求。提供商: {provider}, 语言: {language}, 模型/任务: {model_name_or_task or '默认'}")
        if _unload_model(provider, language, model_name=model_name_or_task, task_name=model_name_or_task):
            return {"status": "success", "message": f"{provider} 模型 (语言: {language}, 名称/任务: {model_name_or_task or '默认'}) 已成功从缓存卸载。"}
        else:
            return {"status": "failure", "message": f"未能卸载 {provider} 模型 (语言: {language}, 名称/任务: {model_name_or_task or '默认'})，可能未加载或提供商/模型名不匹配。"}

    @staticmethod
    def get_loaded_models_info() -> Dict[str, List[str]]:
        """获取当前已加载的本地NLP模型信息。"""
        return {
            "spacy": list(_loaded_spacy_models.keys()),
            "stanza": list(_loaded_stanza_pipelines.keys()),
            "hanlp": list(_loaded_hanlp_pipelines.keys()),
        }