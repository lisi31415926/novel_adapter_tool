# backend/app/services/novel_parser_service.py
import logging
import os
import re
import tempfile # 虽然在此版本中未直接使用，但与文件处理流程相关
import zipfile # 主要用于EPUB（EPUB本质是ZIP归档）
from typing import List, Dict, Any, Optional, Tuple, Set, Generator # 确保类型提示完整

import chardet # 用于编码检测
from bs4 import BeautifulSoup, Tag, NavigableString # 用于HTML解析
from ebooklib import epub, ITEM_DOCUMENT, ITEM_NAVIGATION, ITEM_IMAGE, ITEM_STYLE # 用于EPUB文件处理

# 修正：从上级目录 (app/) 导入 schemas
from .. import schemas # 导入应用内部的Pydantic schemas
# 修正：从上级目录 (app/) 的 utils.py 导入，并更正函数名
from ..text_processing_utils import generate_unique_id, secure_filename

logger = logging.getLogger(__name__)

# --- 常量定义 ---
MIN_CHAPTER_CONTENT_LENGTH = 50         # 最小章节内容长度，用于过滤空章节或无效章节
MIN_PARAGRAPHS_FOR_CHAPTER_SPLIT = 3    # 尝试按大标题拆分章节时，每个子章节应有的最小段落数
PARAGRAPH_SPLIT_MIN_LENGTH = 20         # 拆分段落时，段落的最小字符长度（主要用于TXT解析中的段落过滤）
MAX_TOC_CHAPTERS_FOR_FALLBACK = 3       # 如果EPUB的TOC提取的章节数少于此值，则触发备用章节提取逻辑
MAX_HEADING_TITLE_LENGTH = 100          # 章节标题或内部大标题的最大允许长度，防止误匹配
MAX_FILENAME_TITLE_LENGTH = 70          # 从文件名提取的标题的最大长度

# 增强的章节标题正则表达式模式 (用于TXT文件初步识别章节标题)
COMMON_CHAPTER_PATTERNS_FOR_TXT = [ #
    re.compile(r"^\s*(?:第\s*[零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟万亿〇]+)\s*[章节回卷节部篇话集]\s*(?P<title>.*?)\s*$", re.MULTILINE), #
    re.compile(r"^\s*Chapter\s*\d+\s*[:.-]?\s*(?P<title>.*?)\s*$", re.IGNORECASE | re.MULTILINE), #
    re.compile(r"^\s*卷\s*[零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟万亿]+\s*(?P<title>.*?)\s*$", re.MULTILINE), #
    re.compile(r"^\s*(序章|楔子|引子|前言|尾声|后记|最终章|最终话|番外(?:篇)?(?:\s*\d*)?)\s*[:：\-\s．.]*(?P<title>.*?)\s*$", re.IGNORECASE | re.MULTILINE), #
    re.compile(r"^\s*\d+\s*[:.-]?\s*(?P<title>.*?)\s*$", re.MULTILINE), # 数字开头的标题
    re.compile(r"^\s*(?P<title>[^\n\r]{2,60})\s*$", re.MULTILINE) # 匹配独立成行，长度在2到60之间的文本作为标题
]

# 内部大标题拆分章节用的正则
HEADING_SPLIT_PATTERN = re.compile( #
    r"^\s*(?:(?:第\s*[一二三四五六七八九十百千\d〇]+|Chapter\s*\d+)\s*[章节回卷篇集部]?\s*[:：\-\s．.]*\s*.*" #
    r"|[A-ZÀ-ÖØ-Þ\d][A-ZÀ-ÖØ-Þ\d\s\S']{3," + str(MAX_HEADING_TITLE_LENGTH -1) + r"}"  # 全大写或数字开头的短句 (英文标题)
    r"|[\u4e00-\u9fff]{1," + str(MAX_HEADING_TITLE_LENGTH // 2) + r"}"  # 纯中文短句 (中文标题，长度限制约为一半)
    r"|(?:楔子|序[章言]?|引子|尾声|后记|番外(?:篇)?(?:\s*\d+)?)(?:\s*[:：\-\s．.]*\s*.*)?)\s*$", # 特殊章节名
    re.IGNORECASE | re.MULTILINE
)


def _clean_html_to_text(html_content_bytes: bytes, encoding: str = 'utf-8') -> Tuple[List[str], Optional[str]]: #
    """
    将HTML内容字节清理并转换为纯文本段落列表。
    同时尝试提取HTML <title>标签的内容。返回 (段落列表, HTML标题或None)。
    """
    html_title_text: Optional[str] = None # 初始化HTML标题为None
    try:
        html_content = html_content_bytes.decode(encoding, errors='replace') # 使用指定编码解码，替换无法解码的字符
        soup = BeautifulSoup(html_content, 'lxml') # 使用lxml解析器创建BeautifulSoup对象

        # 提取 <title> 标签内容
        title_tag = soup.find('title') #
        if title_tag and title_tag.string: #
            html_title_text = title_tag.string.strip() # 获取并清理标题文本
            logger.debug(f"从HTML中找到标题: '{html_title_text}'") #
        
        # 定义并移除不需要的HTML标签（脚本、样式、元数据等）
        unwanted_tags = [ #
            "script", "style", "meta", "link", "head", "header", "footer",  #
            "nav", "aside", "form", "button", "input", "select", "textarea",  #
            "iframe", "figure", "figcaption", "template", "img", "audio", "video", "svg", "map", "area", "object", "embed" #
        ]
        for unwanted_tag_name in unwanted_tags: #
            for tag_instance in soup.find_all(unwanted_tag_name): #
                tag_instance.decompose() # 移除标签及其内容
        
        # 将 <br> 和 <hr> 替换为换行符，以辅助段落分割
        for br_tag in soup.find_all("br"): br_tag.replace_with("\n") #
        for hr_tag in soup.find_all("hr"): hr_tag.replace_with("\n\n") #
        # 在常见的块级标签后添加换行，帮助后续的段落切分
        for block_tag in soup.find_all(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'article', 'section']): #
            block_tag.append("\n\n") #

        # 获取清理后的文本内容，优先从 <body> 获取，否则从整个 soup 获取
        content_container = soup.body if soup.body else soup #
        text_with_newlines = content_container.get_text(separator='', strip=True) if content_container else "" #
        
        # 文本规范化：将多个连续换行符和仅含空白的换行符序列替换为统一的段落分隔符 (\n\n)
        normalized_text = re.sub(r'(\s*\n\s*){2,}', '\n\n', text_with_newlines) #
        # 按段落分隔符分割文本，并移除每个段落首尾的空白
        paragraphs = [p.strip() for p in normalized_text.split('\n\n') if p.strip()] #

        # 如果按双换行未能分割出段落，且文本不为空，则尝试按单换行分割
        if not paragraphs and text_with_newlines.strip(): #
            logger.debug("主要段落分割策略 (双换行) 未产生结果，尝试使用单换行分割。") #
            paragraphs = [p.strip() for p in text_with_newlines.split('\n') if p.strip()] #
        
        # 如果仍然没有段落，则将整个清理后的文本视为一个段落
        if not paragraphs and text_with_newlines.strip(): #
             paragraphs = [text_with_newlines.strip()] #

        if not paragraphs: # 如果最终未能提取到任何有效段落
            logger.warning(f"无法从HTML内容中提取有效的文本段落。HTML标题: {html_title_text}") #
            return [], html_title_text #
            
        return paragraphs, html_title_text
    except Exception as e:
        logger.error(f"清理HTML到文本时出错: {e}", exc_info=True) #
        return [], None # 出错时返回空列表和None


def _detect_encoding(content_bytes: bytes) -> str: #
    """尝试检测字节内容的编码，提供更完善的回退和日志。"""
    if not content_bytes: # 处理空内容输入
        logger.warning("尝试检测空内容的编码，将默认为utf-8。") #
        return 'utf-8'
    try:
        detected = chardet.detect(content_bytes) # 使用chardet进行检测
        encoding = detected.get('encoding') if detected else None #
        confidence = detected.get('confidence', 0) if detected else 0 #
        logger.info(f"Chardet检测到编码: {encoding}，置信度: {confidence:.2f}") #

        if encoding: #
            encoding_lower = encoding.lower() #
            # 针对常见的中文编码进行归一化处理
            if 'gbk' == encoding_lower or 'gb2312' == encoding_lower or 'gb18030' == encoding_lower or 'hz-gb-2312' == encoding_lower: #
                logger.info(f"Chardet结果 '{encoding}' 表明是GB系列编码。优先使用 'gb18030'。") #
                return 'gb18030' 
            if 'big5' == encoding_lower or 'big5-hkscs' == encoding_lower: #
                logger.info(f"Chardet结果 '{encoding}' 表明是Big5系列编码。使用 'big5hkscs' 或 'big5'。") #
                return 'big5hkscs' # 更完整的 Big5
            if 'utf-8' in encoding_lower or 'utf8' in encoding_lower: return 'utf-8' #
            if 'utf-16' in encoding_lower: return encoding # 保留 UTF-16 的字节顺序标记 (BE/LE)
            if confidence > 0.8: # 如果置信度较高，则采纳检测结果
                logger.info(f"使用Chardet检测到的编码 '{encoding}' (置信度较高)。") #
                return encoding

        # 如果检测失败或置信度低，则尝试预定义的常用编码列表
        common_encodings_to_try = ['utf-8', 'gb18030', 'big5hkscs', 'gbk'] #
        logger.warning(f"Chardet检测编码失败或置信度不足 ({confidence:.2f})。尝试预定义编码: {common_encodings_to_try}。") #
        for enc_try in common_encodings_to_try: #
            try:
                content_bytes.decode(enc_try); logger.info(f"使用备选编码 '{enc_try}' 解码成功。"); return enc_try #
            except UnicodeDecodeError: logger.debug(f"备选编码 '{enc_try}' 解码失败。") #
        
        # 如果所有尝试均失败，则强制使用 'utf-8' 并替换错误字符
        logger.error("所有编码尝试均失败。将强制使用 'utf-8' 并替换错误字符。") #
        return 'utf-8'
    except Exception as e:
        logger.error(f"Chardet编码检测异常: {e}。默认为 'utf-8'。", exc_info=True) #
        return 'utf-8'


def _is_likely_content_html(html_content_str: str) -> bool: #
    """启发式判断HTML字符串是否为主要内容页，而非目录、版权页等辅助页面。"""
    if not html_content_str: return False #
    soup = BeautifulSoup(html_content_str, 'lxml') #
    
    # 移除脚本、样式等非显示内容，这些不应影响内容判断
    for invisible_tag in soup(["script", "style", "meta", "link", "head"]): invisible_tag.decompose() #
    
    text_content = soup.get_text(separator=' ', strip=True) # 获取纯文本内容
    
    # 常见的非内容页关键词列表
    non_content_keywords = [ #
        '目录', 'contents', 'index', 'table of contents', 'navigation', 'toc', #
        '版权', 'copyright', '出版社', '出版信息', 'publication info', #
        '封面', 'cover', 'title page', '扉页', #
        '献词', 'dedication', '致谢', 'acknowledgments', #
        '广告', 'advertisement' #
    ]
    text_lower_sample = text_content[:500].lower() # 检查文本开头部分的小写形式
    if any(kw in text_lower_sample for kw in non_content_keywords): #
        # 如果包含非内容关键词，并且文本内容较短，则可能不是主要内容页
        if len(text_content) < 1000 and len(re.findall(r'[\u4e00-\u9fff]', text_content)) < 500 : # 内容较短的判断标准
             logger.debug(f"HTML页面可能为非内容页 (如目录/版权页)，因包含关键词且内容较短。文本开头: '{text_content[:100]}...'") #
             return False

    # 移除常见的导航链接文本模式，避免它们影响对实际内容长度的判断
    text_content_cleaned = re.sub(r'(?:上一[章页回篇]?|下一[章页回篇]?|返回目录|上一节|下一节|previous|next|index|home|contents)', '', text_content, flags=re.IGNORECASE) #
    chinese_chars_count = len(re.findall(r'[\u4e00-\u9fff]', text_content_cleaned)) # 统计中文字符数
    
    # 启发式规则：如果清理后的文本长度、中文字符数或段落标签数达到一定阈值，则认为是内容页
    paragraph_like_tags_count = len(soup.find_all(['p', 'div'])) # 简单统计 <p> 和 <div> 标签数量
    if len(text_content_cleaned) > 300 or chinese_chars_count > 150 or paragraph_like_tags_count > 5: #
        return True
    
    logger.debug(f"HTML页面判断为非主要内容页。清理后文本长度: {len(text_content_cleaned)}, 中文字数: {chinese_chars_count}, 段落标签数: {paragraph_like_tags_count}") #
    return False


def _extract_chapters_from_epub(book: epub.EpubBook) -> List[schemas.EpubChapter]: #
    """从EpubBook对象中提取章节信息和内容，进行清理、排序和去重名处理。"""
    chapters_data: List[schemas.EpubChapter] = [] # 存储提取的章节数据
    processed_item_hrefs: Set[str] = set() # 记录已处理的HTML文件href，避免重复
    # 创建一个从href到EpubItem的映射，方便快速查找
    href_to_item_map: Dict[str, epub.EpubItem] = {item.file_name: item for item in book.get_items()} #

    toc_items_links: List[epub.Link] = [] # 存储从TOC中解析出的链接
    if book.toc: # 如果EPUB文件包含目录 (Table of Contents)
        def flatten_toc(toc_list_or_tuple): # 递归函数，用于展平可能嵌套的TOC结构
            flat_list = [] #
            if isinstance(toc_list_or_tuple, (list, tuple)): #
                for item_in_toc in toc_list_or_tuple: #
                    if isinstance(item_in_toc, epub.Link): flat_list.append(item_in_toc) # 如果是链接项，直接添加
                    elif isinstance(item_in_toc, (list, tuple)): flat_list.extend(flatten_toc(item_in_toc)) # 递归处理嵌套列表/元组
            return flat_list
        toc_items_links = flatten_toc(book.toc) #
    else: # 如果没有TOC
        logger.warning("EPUB文件缺少目录(TOC)。尝试从书脊(spine)或所有文档项中推断章节。") #

    # 优先处理TOC中的项目
    if toc_items_links: #
        logger.info(f"从EPUB目录(TOC)找到 {len(toc_items_links)} 个条目进行处理。") #
        for idx, toc_link_item in enumerate(toc_items_links): #
            if not toc_link_item.href: continue # 跳过没有href的链接
            base_href_val = toc_link_item.href.split('#')[0] # 移除锚点，获取基础href
            if not base_href_val or base_href_val in processed_item_hrefs: continue # 跳过无效或已处理的href

            epub_document_item_obj = href_to_item_map.get(base_href_val) # 从映射中查找对应的EpubItem
            if not epub_document_item_obj or not isinstance(epub_document_item_obj, epub.EpubHtml): continue # 确保是HTML文档项

            item_content_bytes_val = epub_document_item_obj.get_content() # 获取内容字节
            detected_encoding_val = _detect_encoding(item_content_bytes_val) # 检测编码
            content_paragraphs_list, html_title_val = _clean_html_to_text(item_content_bytes_val, encoding=detected_encoding_val) # 清理HTML并提取段落和标题
            
            # 确定章节标题：优先使用TOC链接的标题，其次是HTML内部的<title>，最后是文件名
            chapter_title_str = toc_link_item.title or html_title_val or os.path.splitext(epub_document_item_obj.file_name)[0] #
            chapter_title_str = chapter_title_str.strip() if chapter_title_str else f"章节 {idx + 1}" # 确保有标题
            
            full_content_str_val = "\n\n".join(content_paragraphs_list) # 将段落合并为完整内容字符串
            # 简单判断是否为辅助页面 (如封面、版权页等)
            is_auxiliary_page = any(aux_keyword in chapter_title_str.lower() for aux_keyword in ["cover", "版权", "目录", "toc", "index", "扉页", "广告"]) #
            # 如果内容过短且不是明确的辅助页面，则跳过
            if len(full_content_str_val) < MIN_CHAPTER_CONTENT_LENGTH and not is_auxiliary_page: continue #

            chapters_data.append(schemas.EpubChapter( #
                id=generate_unique_id(prefix="c_toc_"), title=chapter_title_str, content=full_content_str_val, #
                paragraphs=content_paragraphs_list, order=idx, html_title=html_title_val #
            ))
            processed_item_hrefs.add(base_href_val) # 标记此href已处理
        logger.info(f"从TOC中有效提取并处理了 {len(chapters_data)} 个章节。") #

    # 如果TOC提取的章节不足或TOC不存在，则尝试备选提取策略
    if not chapters_data or len(chapters_data) < MAX_TOC_CHAPTERS_FOR_FALLBACK: #
        logger.warning(f"TOC提取章节数 ({len(chapters_data)}) 不足或TOC不存在，尝试备选提取策略。") #
        
        items_for_fallback_processing: List[epub.EpubHtml] = [] # 存储备选策略找到的HTML项
        # 1. 按书脊 (spine) 顺序收集未被TOC处理的、可能是内容的HTML文件
        for item_id_in_spine, _ in book.spine: #
            item_from_spine = book.get_item_with_id(item_id_in_spine) #
            if item_from_spine and isinstance(item_from_spine, epub.EpubHtml) and item_from_spine.file_name not in processed_item_hrefs: #
                # 使用启发式函数判断是否为主要内容页
                if _is_likely_content_html(item_from_spine.get_content().decode(_detect_encoding(item_from_spine.get_content()), errors='replace')): #
                    items_for_fallback_processing.append(item_from_spine) #
                    processed_item_hrefs.add(item_from_spine.file_name) # 标记为已处理
        
        # 2. 收集所有其他未被处理的、可能是内容的HTML文档项目 (不在书脊中，也不在TOC中)
        for item_general_doc in book.get_items_of_type(ITEM_DOCUMENT): #
            if isinstance(item_general_doc, epub.EpubHtml) and item_general_doc.file_name not in processed_item_hrefs: #
                if _is_likely_content_html(item_general_doc.get_content().decode(_detect_encoding(item_general_doc.get_content()), errors='replace')): #
                    items_for_fallback_processing.append(item_general_doc) #
                    processed_item_hrefs.add(item_general_doc.file_name) #
        
        logger.info(f"备选提取策略找到 {len(items_for_fallback_processing)} 个潜在的HTML内容文件。") #
        
        fallback_order_current_offset = len(chapters_data) # 为备选提取的章节分配顺序号（接续TOC提取的）
        for idx_fallback, doc_item_in_fallback in enumerate(items_for_fallback_processing): #
            item_content_bytes_fb_val = doc_item_in_fallback.get_content() #
            detected_encoding_fb_val = _detect_encoding(item_content_bytes_fb_val) #
            content_paragraphs_fb_list, html_title_fb_val = _clean_html_to_text(item_content_bytes_fb_val, encoding=detected_encoding_fb_val) #
            
            chapter_title_fb_str = html_title_fb_val or os.path.splitext(doc_item_in_fallback.file_name)[0] # 优先HTML标题，其次文件名
            chapter_title_fb_str = chapter_title_fb_str.strip() if chapter_title_fb_str else f"补充章节 {idx_fallback + 1}" #
            full_content_str_fb_val = "\n\n".join(content_paragraphs_fb_list) #

            is_auxiliary_page_fb = any(aux_kw in chapter_title_fb_str.lower() for aux_kw in ["cover", "版权", "目录", "toc", "index", "扉页", "广告"]) #
            if len(full_content_str_fb_val) < MIN_CHAPTER_CONTENT_LENGTH and not is_auxiliary_page_fb: continue #

            chapters_data.append(schemas.EpubChapter( #
                id=generate_unique_id(prefix="c_fb_"), title=chapter_title_fb_str, content=full_content_str_fb_val, #
                paragraphs=content_paragraphs_fb_list, order=fallback_order_current_offset + idx_fallback, html_title=html_title_fb_val #
            ))
        logger.info(f"备选提取逻辑处理完毕，当前总章节数: {len(chapters_data)}。") #

    # 最终排序和去重名处理
    sorted_chapters_list_final = sorted(chapters_data, key=lambda c_item: c_item.order) # 按 order 字段排序
    final_chapters_data_list_epub: List[schemas.EpubChapter] = [] #
    title_occurrence_counts_epub: Dict[str, int] = {} # 用于处理同名章节
    for final_idx_val, chap_item_final_epub in enumerate(sorted_chapters_list_final): #
        chap_item_final_epub.order = final_idx_val # 确保 order 是从0开始的连续整数
        original_title_val_epub = chap_item_final_epub.title #
        if original_title_val_epub in title_occurrence_counts_epub: # 如果标题已存在
            title_occurrence_counts_epub[original_title_val_epub] += 1 #
            chap_item_final_epub.title = f"{original_title_val_epub} ({title_occurrence_counts_epub[original_title_val_epub]})" # 添加序号区分
        else:
            title_occurrence_counts_epub[original_title_val_epub] = 1 #
        final_chapters_data_list_epub.append(chap_item_final_epub) #

    return final_chapters_data_list_epub


def _parse_epub_from_path(epub_path: str) -> Optional[schemas.ParsedNovel]: #
    """解析指定路径的EPUB文件，返回 ParsedNovel schema 或 None。"""
    try:
        if not os.path.exists(epub_path): logger.error(f"EPUB文件路径不存在: {epub_path}"); return None #
        book = epub.read_epub(epub_path) # 读取EPUB文件
        # 提取元数据：标题、作者、语言
        novel_title_meta_val = book.get_metadata('DC', 'title'); novel_title_str_val = (novel_title_meta_val[0][0] if isinstance(novel_title_meta_val[0], tuple) else str(novel_title_meta_val[0])) if novel_title_meta_val else "未知EPUB书名" #
        novel_author_meta_val = book.get_metadata('DC', 'creator'); novel_author_str_val = (novel_author_meta_val[0][0] if isinstance(novel_author_meta_val[0], tuple) else str(novel_author_meta_val[0])) if novel_author_meta_val else "未知EPUB作者" #
        novel_lang_meta_val = book.get_metadata('DC', 'language'); novel_lang_str_val = (novel_lang_meta_val[0][0] if isinstance(novel_lang_meta_val[0], tuple) else str(novel_lang_meta_val[0])) if novel_lang_meta_val else "unk" #
        
        logger.info(f"解析EPUB: '{novel_title_str_val}' 作者: '{novel_author_str_val}', 语言: '{novel_lang_str_val}'") #
        chapters_list = _extract_chapters_from_epub(book) # 提取章节
        if not chapters_list: logger.error(f"未能从EPUB文件 '{epub_path}' 中提取任何章节。"); return None #
        
        return schemas.ParsedNovel( # 构建并返回 ParsedNovel 对象
            id=generate_unique_id(prefix="epub_novel_"), title=novel_title_str_val.strip(),  #
            author=novel_author_str_val.strip(), chapters=chapters_list,  #
            metadata={"language": novel_lang_str_val, "source_format": "epub"} #
        )
    except Exception as e: # 捕获所有可能的异常
        logger.error(f"解析EPUB文件 '{epub_path}' 时发生一般错误: {e}", exc_info=True) #
        return None


def _parse_txt_from_path(txt_path: str, id_prefix_for_novel: Optional[str] = None) -> Optional[schemas.ParsedNovel]: #
    """解析指定路径的TXT文件，增强章节识别和元数据提取。"""
    try:
        if not os.path.exists(txt_path): logger.error(f"TXT文件路径不存在: {txt_path}"); return None #
        with open(txt_path, 'rb') as f_txt: content_bytes_txt = f_txt.read() # 读取文件字节内容
        if not content_bytes_txt: logger.warning(f"TXT文件 '{txt_path}' 内容为空。"); return None #

        detected_encoding_txt = _detect_encoding(content_bytes_txt) # 检测编码
        logger.info(f"TXT文件 '{txt_path}' 检测编码: {detected_encoding_txt}") #
        try: full_text_content = content_bytes_txt.decode(detected_encoding_txt, errors='replace') # 解码
        except Exception as e_decode_txt: # 解码失败处理
            logger.error(f"使用编码 '{detected_encoding_txt}' 解码TXT '{txt_path}' 失败: {e_decode_txt}。尝试UTF-8。") #
            try: full_text_content = content_bytes_txt.decode('utf-8', errors='replace'); detected_encoding_txt = 'utf-8' #
            except Exception as e_utf8_txt: logger.error(f"UTF-8解码TXT '{txt_path}' 也失败: {e_utf8_txt}。无法处理。"); return None #
        
        full_text_content = full_text_content.replace('\r\n', '\n').replace('\r', '\n') # 规范化换行符

        temp_parser_service_instance = NovelParserService() #
        filename_for_metadata = os.path.basename(txt_path) #
        novel_title_from_filename, novel_author_from_filename = temp_parser_service_instance.extract_title_author_from_filename(filename_for_metadata) #
        
        if novel_title_from_filename == os.path.splitext(filename_for_metadata)[0] or not novel_title_from_filename.strip(): #
            first_few_lines_candidate = full_text_content.splitlines()[:5] # 取前5行
            for line_content_candidate in first_few_lines_candidate: #
                line_stripped_candidate = line_content_candidate.strip() #
                if line_stripped_candidate and 2 < len(line_stripped_candidate) < 70 and not any(cp_regex.match(line_stripped_candidate) for cp_regex in COMMON_CHAPTER_PATTERNS_FOR_TXT): #
                    potential_title_text = re.sub(r"^(作者|著|BY)[:：\s]*.*$", "", line_stripped_candidate, flags=re.IGNORECASE).strip() #
                    if potential_title_text:  #
                        novel_title_from_filename = potential_title_text #
                        logger.info(f"从TXT首行提取到标题: '{novel_title_from_filename}'") #
                        break 
        novel_title_from_filename = novel_title_from_filename.strip() or "未知TXT小说" # 确保标题不为空

        logger.info(f"解析TXT: '{novel_title_from_filename}' 作者: '{novel_author_from_filename or '未知作者'}'") #
        chapters_list_txt: List[schemas.EpubChapter] = [] # 复用 EpubChapter schema 存储解析结果
        chapter_order_current_val = 0 #
        text_lines_list = full_text_content.splitlines() # 按行分割全文
        
        potential_chapter_start_lines_info: List[Tuple[int, str, str]] = [] # (行号, 匹配到的原始行内容, 提取的标题名)
        for i_line_num, line_text_val in enumerate(text_lines_list): #
            line_stripped_processed = line_text_val.strip() #
            if not line_stripped_processed or len(line_stripped_processed) > 150 : continue # 跳过空行和过长行（不太可能是章节标题）
            for pattern_index, chapter_pattern_regex in enumerate(COMMON_CHAPTER_PATTERNS_FOR_TXT): #
                match_obj_txt = chapter_pattern_regex.fullmatch(line_stripped_processed) # 全行匹配
                if match_obj_txt: #
                    extracted_title_name_txt = (match_obj_txt.groupdict().get('title') or "").strip() #
                    if not extracted_title_name_txt and pattern_index >= 4 : # 对通用模式，如果未捕获title组，则用整行作为标题
                         extracted_title_name_txt = line_stripped_processed #
                    elif not extracted_title_name_txt: # 对于特定模式（如 "第X章"），如果title为空，则使用匹配到的整行
                         extracted_title_name_txt = line_stripped_processed #

                    if len(extracted_title_name_txt) < 2 and extracted_title_name_txt.isdigit(): continue # 过滤掉纯数字且长度小于2的标题
                    if len(extracted_title_name_txt) > MAX_HEADING_TITLE_LENGTH : continue # 确保标题长度在合理范围内
                        
                    potential_chapter_start_lines_info.append((i_line_num, line_stripped_processed, extracted_title_name_txt)); break # 找到匹配即跳出内层循环
        
        if not potential_chapter_start_lines_info: # 如果未找到明确章节标题
            logger.info("TXT中未找到明确章节标题。整个文件视为一章，按空行分段。") #
            raw_paragraphs_list = re.split(r'\n\s*\n+', full_text_content.strip()) # 按一个或多个空行分割段落
            cleaned_paragraphs_list = [p_item.strip() for p_item in raw_paragraphs_list if p_item.strip() and len(p_item.strip()) >= PARAGRAPH_SPLIT_MIN_LENGTH] # 清理并过滤短段落
            if cleaned_paragraphs_list:  #
                chapters_list_txt.append(schemas.EpubChapter( #
                    id=generate_unique_id(), title=novel_title_from_filename,  #
                    content="\n\n".join(cleaned_paragraphs_list), paragraphs=cleaned_paragraphs_list, order=0 #
                ))
        else: # 如果找到了潜在章节标题
            first_title_line_index = potential_chapter_start_lines_info[0][0] #
            if first_title_line_index > 0: # 如果第一个标题不是文件的第一行
                prologue_lines_list = text_lines_list[:first_title_line_index] #
                prologue_text_block_content = "\n".join(prologue_lines_list).strip() #
                prologue_paragraphs_raw_list = re.split(r'\n\s*\n+', prologue_text_block_content) if prologue_text_block_content else [] #
                prologue_paragraphs_cleaned = [p_item.strip() for p_item in prologue_paragraphs_raw_list if p_item.strip() and len(p_item.strip()) >= PARAGRAPH_SPLIT_MIN_LENGTH] #
                if prologue_paragraphs_cleaned:  #
                    chapters_list_txt.append(schemas.EpubChapter( #
                        id=generate_unique_id(), title="序言",  #
                        content="\n\n".join(prologue_paragraphs_cleaned), paragraphs=prologue_paragraphs_cleaned,  #
                        order=chapter_order_current_val #
                    ))
                    chapter_order_current_val+=1 #
            
            for i_potential_start in range(len(potential_chapter_start_lines_info)): #
                current_title_line_index_val, _, current_extracted_title_str = potential_chapter_start_lines_info[i_potential_start] #
                content_start_line_index = current_title_line_index_val + 1 #
                content_end_line_index = potential_chapter_start_lines_info[i_potential_start+1][0] if i_potential_start + 1 < len(potential_chapter_start_lines_info) else len(text_lines_list) #
                
                chapter_content_lines_block_list = text_lines_list[content_start_line_index : content_end_line_index] #
                chapter_text_block_val = "\n".join(chapter_content_lines_block_list).strip() #
                
                chapter_paragraphs_final_list: List[str] = [] #
                if chapter_text_block_val: # 如果章节内容不为空
                    chapter_paragraphs_raw_val = re.split(r'\n\s*\n+', chapter_text_block_val) #
                    chapter_paragraphs_final_list = [p_item.strip() for p_item in chapter_paragraphs_raw_val if p_item.strip() and len(p_item.strip()) >= PARAGRAPH_SPLIT_MIN_LENGTH] #
                
                if current_extracted_title_str or chapter_paragraphs_final_list: # 确保标题或内容至少有一个存在
                    final_chapter_title_str = current_extracted_title_str if current_extracted_title_str else f"未命名章节 {chapter_order_current_val+1}" #
                    chapters_list_txt.append(schemas.EpubChapter( #
                        id=generate_unique_id(), title=final_chapter_title_str,  #
                        content="\n\n".join(chapter_paragraphs_final_list), paragraphs=chapter_paragraphs_final_list,  #
                        order=chapter_order_current_val #
                    ))
                    chapter_order_current_val+=1 #

        if not chapters_list_txt: logger.error(f"未能从TXT '{txt_path}' 提取任何有效章节。"); return None #
        
        return schemas.ParsedNovel( # 构建并返回 ParsedNovel 对象
            id=generate_unique_id(prefix=id_prefix_for_novel or "txt_novel_"),  #
            title=novel_title_from_filename.strip(), #
            author=(novel_author_from_filename.strip() if novel_author_from_filename and novel_author_from_filename.lower() != "未知作者" else None), #
            chapters=chapters_list_txt,  #
            metadata={"source_format": "txt", "encoding": detected_encoding_txt} #
        )
    except Exception as e: # 捕获所有可能的异常
        logger.error(f"解析TXT '{txt_path}' 异常: {e}", exc_info=True) #
        return None


def post_process_parsed_chapters(chapters_input_list: List[schemas.EpubChapter]) -> List[schemas.EpubChapter]: #
    """对解析出的章节列表进行后处理，例如尝试根据内容中的大标题拆分过长章节。"""
    if not chapters_input_list: return [] #
    processed_chapters_output_list: List[schemas.EpubChapter] = [] #
    current_final_order_val = 0 # 用于重新编号最终的章节顺序
    for chapter_item_to_process in chapters_input_list: #
        # 只有当章节段落数和内容长度均较多时，才值得尝试进一步拆分
        if len(chapter_item_to_process.paragraphs) > MIN_PARAGRAPHS_FOR_CHAPTER_SPLIT * 2 and \
           len(chapter_item_to_process.content) > MIN_CHAPTER_CONTENT_LENGTH * 5: #
            
            sub_chapters_from_split = _try_split_chapter_by_headings(chapter_item_to_process) # 尝试拆分
            if sub_chapters_from_split: # 如果成功拆分出子章节
                logger.info(f"章节 '{chapter_item_to_process.title}' 被内部标题拆分为 {len(sub_chapters_from_split)} 个子章节。") #
                for sub_chap_item_val in sub_chapters_from_split: #
                    sub_chap_item_val.order = current_final_order_val # 更新顺序号
                    processed_chapters_output_list.append(sub_chap_item_val) #
                    current_final_order_val += 1 #
            else: # 未成功拆分或不符合拆分条件，保留原章节
                chapter_item_to_process.order = current_final_order_val #
                processed_chapters_output_list.append(chapter_item_to_process) #
                current_final_order_val += 1 #
        else: # 章节较短，不尝试拆分
            chapter_item_to_process.order = current_final_order_val #
            processed_chapters_output_list.append(chapter_item_to_process) #
            current_final_order_val += 1 #
    return processed_chapters_output_list


def _try_split_chapter_by_headings(chapter_to_split: schemas.EpubChapter) -> Optional[List[schemas.EpubChapter]]: #
    """尝试根据章节内容中的常见大标题模式 (如 第X章, Chapter X) 拆分单个过长章节。"""
    potential_split_points_info: List[Tuple[int, str]] = [] # (段落索引, 识别到的标题文本)
    for i_paragraph_idx, paragraph_text_val in enumerate(chapter_to_split.paragraphs): #
        paragraph_first_line = paragraph_text_val.split('\n', 1)[0].strip() # 取段落首行进行判断
        # 判断首行是否符合大标题模式，并且长度在合理范围内
        if 1 < len(paragraph_first_line) < MAX_HEADING_TITLE_LENGTH and HEADING_SPLIT_PATTERN.match(paragraph_first_line): #
            # 避免将章节主标题自身作为拆分点（如果它恰好是内容的第一段）
            if i_paragraph_idx > 0 or \
               (i_paragraph_idx == 0 and paragraph_first_line.lower() != chapter_to_split.title.lower().strip()): #
                potential_split_points_info.append((i_paragraph_idx, paragraph_first_line)) #
                logger.debug(f"在章节 '{chapter_to_split.title}' 中找到潜在的内部标题拆分点: '{paragraph_first_line}' (段落索引 {i_paragraph_idx})") #

    if not potential_split_points_info: return None # 没有找到可拆分的标题点

    split_chapters_result_list: List[schemas.EpubChapter] = [] #
    last_split_paragraph_index = 0 # 上一个拆分点（标题所在段落）的索引
    
    current_sub_chapter_title_text = chapter_to_split.title # 第一个子章节的标题默认为原章节标题

    for i_split_point, (split_paragraph_index_val, heading_text_content) in enumerate(potential_split_points_info): #
        # 从上一个拆分点到当前拆分点（不含）的段落构成一个子章节的内容
        sub_chapter_paragraphs_list = chapter_to_split.paragraphs[last_split_paragraph_index : split_paragraph_index_val] #
        # 确保子章节有足够的段落数，避免产生过多过短的子章节
        if len(sub_chapter_paragraphs_list) >= MIN_PARAGRAPHS_FOR_CHAPTER_SPLIT: #
            sub_chapter_content_str = "\n\n".join(sub_chapter_paragraphs_list) #
            split_chapters_result_list.append(schemas.EpubChapter( #
                id=generate_unique_id(prefix="sub_c_"), title=current_sub_chapter_title_text,  #
                content=sub_chapter_content_str, paragraphs=sub_chapter_paragraphs_list,  #
                order=0, html_title=chapter_to_split.html_title # 临时order，后续重排
            ))
        # 更新下一个子章节的标题为当前识别到的heading，并记录新的起始段落索引
        current_sub_chapter_title_text = heading_text_content #
        last_split_paragraph_index = split_paragraph_index_val #

    # 处理最后一个识别到的标题到原章节末尾的内容
    remaining_paragraphs_after_last_split = chapter_to_split.paragraphs[last_split_paragraph_index:] #
    if len(remaining_paragraphs_after_last_split) >= MIN_PARAGRAPHS_FOR_CHAPTER_SPLIT: #
        last_sub_chapter_content_str = "\n\n".join(remaining_paragraphs_after_last_split) #
        split_chapters_result_list.append(schemas.EpubChapter( #
            id=generate_unique_id(prefix="sub_c_"), title=current_sub_chapter_title_text, # 使用最后一个识别的heading作为标题
            content=last_sub_chapter_content_str, paragraphs=remaining_paragraphs_after_last_split,  #
            order=0, html_title=chapter_to_split.html_title #
        ))

    # 只有当确实产生了多个子章节时，才认为拆分有效并返回结果
    if len(split_chapters_result_list) > 1: #
        logger.info(f"章节 '{chapter_to_split.title}' 被成功拆分为 {len(split_chapters_result_list)} 个子章节。") #
        return split_chapters_result_list
    
    logger.debug(f"尝试拆分章节 '{chapter_to_split.title}' 未产生有效的多个子章节，保持原样。") #
    return None # 未能有效拆分


class NovelParserService: #
    """封装了小说文件解析逻辑的服务类。"""
    def __init__(self, chapter_patterns_txt: Optional[List[re.Pattern]] = None): #
        # 初始化时可以使用自定义的章节标题匹配模式，否则使用默认模式
        self.chapter_patterns_txt = chapter_patterns_txt or COMMON_CHAPTER_PATTERNS_FOR_TXT #
        logger.info(f"NovelParserService (for TXT) initialized with {len(self.chapter_patterns_txt)} patterns.") #

    def extract_title_author_from_filename(self, filename_str: str) -> Tuple[str, Optional[str]]: #
        """尝试从文件名中启发式地提取书名和作者名。"""
        name_part_str = os.path.splitext(filename_str)[0] # 移除文件扩展名
        # 定义多种常见的文件名格式（书名和作者的分隔符）
        common_separator_patterns = [ #
            re.compile(r"^(?P<title>.+?)\s*by\s*(?P<author>.+)$", re.IGNORECASE), # "Title by Author"
            re.compile(r"^(?P<title>.+?)\s*作者[：:]\s*(?P<author>.+)$", re.IGNORECASE), # "Title 作者：Author"
            re.compile(r"^(?P<title>.+?)\s*著\s*(?P<author>.+)$", re.IGNORECASE), # "Title 著 Author"
            re.compile(r"^(?P<author>[^《》—-]*?)\s*[-—]\s*(?P<title>[^《》—-].*)$"), # "Author - Title" 或 "Author —— Title"
            re.compile(r"^(?P<author>[^《》]*?)《(?P<title>[^》]+?)》$"), # "Author《Title》"
            re.compile(r"^《(?P<title>[^》]+?)》\s*(?P<author>[^《》]*?)$"), # "《Title》Author"
        ]
        for pattern_regex in common_separator_patterns: #
            match_obj = pattern_regex.match(name_part_str) #
            if match_obj: #
                raw_title_str = (match_obj.group("title") or "").strip() #
                raw_author_str = (match_obj.group("author") or "").strip() #
                
                # 清理标题和作者中的常见干扰词，例如移除书名号、作者署名后缀
                clean_title_str = raw_title_str.replace("《", "").replace("》", "").strip() #
                clean_author_str = re.sub(r"\s*[(（]?著[)）]?$", "", raw_author_str, flags=re.IGNORECASE).strip() #
                
                if clean_title_str and clean_author_str: return clean_title_str, clean_author_str #
                if clean_title_str and not clean_author_str: return clean_title_str, None # 只有标题
                if clean_author_str and not clean_title_str: # 只有作者，标题用原始文件名部分
                    return name_part_str.strip() if name_part_str.strip() != clean_author_str else "未知书名", clean_author_str #
        
        logger.debug(f"无法从文件名 '{filename_str}' 中可靠提取作者。将使用清理后的文件名作为标题。") #
        # 如果所有模式都不匹配，则返回清理后的文件名作为标题，作者为None，并限制标题长度
        return name_part_str.strip()[:MAX_FILENAME_TITLE_LENGTH], None #


    def parse_novel_file(self, file_path_str: str, original_filename_str: Optional[str] = None) -> Optional[schemas.ParsedNovel]: #
        """根据文件扩展名选择合适的解析器来解析小说文件。"""
        logger.info(f"NovelParserService: 开始解析文件: {file_path_str}, 原始文件名: {original_filename_str}") #
        effective_filename_str = original_filename_str or os.path.basename(file_path_str) # 确定有效的文件名
        filename_lower_str = effective_filename_str.lower() # 转小写以便后缀匹配
        parsed_novel_data_result: Optional[schemas.ParsedNovel] = None #

        if filename_lower_str.endswith(".epub"): #
            parsed_novel_data_result = _parse_epub_from_path(file_path_str) #
        elif filename_lower_str.endswith(".txt"): #
            # 修正：使用 secure_filename
            txt_id_prefix_val = secure_filename(os.path.splitext(effective_filename_str)[0]) if effective_filename_str else "txt_novel" #
            txt_id_prefix_val = txt_id_prefix_val[:30] # 限制前缀长度
            parsed_novel_data_result = _parse_txt_from_path(file_path_str, id_prefix_for_novel=txt_id_prefix_val) #
        else:
            logger.error(f"不支持的文件格式: {filename_lower_str} (来自路径: {file_path_str})。无法解析。") #
            return None

        if parsed_novel_data_result: #
            if parsed_novel_data_result.chapters: #
                logger.info(f"对 '{parsed_novel_data_result.title}' 的 {len(parsed_novel_data_result.chapters)} 个初始章节进行后处理...") #
                # 对解析出的章节进行后处理（例如，尝试拆分过长章节）
                parsed_novel_data_result.chapters = post_process_parsed_chapters(parsed_novel_data_result.chapters) #
                
                # 确保所有章节都有标题和有效的内容格式，并重新编号顺序
                for i_chapter_final_idx, chapter_item_final_obj in enumerate(parsed_novel_data_result.chapters): #
                    chapter_item_final_obj.order = i_chapter_final_idx # 保证最终顺序是从0开始的连续整数
                    if not chapter_item_final_obj.title: chapter_item_final_obj.title = f"未命名章节 {chapter_item_final_obj.order + 1}" #
                    if not isinstance(chapter_item_final_obj.content, str): chapter_item_final_obj.content = "" # 确保内容是字符串
                    if not isinstance(chapter_item_final_obj.paragraphs, list): chapter_item_final_obj.paragraphs = [] # 确保段落是列表
                    chapter_item_final_obj.paragraphs = [str(p_graph) for p_graph in chapter_item_final_obj.paragraphs if isinstance(p_graph, str)] # 确保段落列表内都是字符串

                logger.info(f"后处理完成，最终章节数: {len(parsed_novel_data_result.chapters)}。") #
            else: # 解析成功但没有章节
                 logger.warning(f"文件 '{effective_filename_str}' 解析成功，但未提取到任何章节内容。") #
                 return None # 视为解析后无有效内容
        
        if not parsed_novel_data_result: #
            logger.error(f"文件 '{effective_filename_str}' 解析失败，未能生成任何 ParsedNovel 数据。") #

        return parsed_novel_data_result

    def parse_novel_from_temp_file( #
        self, temp_file_path_str: str, original_filename_str: str
    ) -> Optional[schemas.ParsedNovelCreate]:
        """
        从临时文件路径解析小说，并准备用于创建 schemas.ParsedNovelCreate 对象 (供数据库存储使用)。
        """
        logger.info(f"NovelParserService: 处理临时文件进行最终解析: {temp_file_path_str} (原始文件名: {original_filename_str})") #
        
        parsed_novel_internal_data = self.parse_novel_file(temp_file_path_str, original_filename_str)  #
        
        if not parsed_novel_internal_data or not parsed_novel_internal_data.chapters: # 确保有章节数据
            logger.error(f"未能从文件 '{original_filename_str}' 解析出任何有效的小说内容或章节。") #
            return None

        # 将内部使用的 schemas.EpubChapter (包含在 ParsedNovel.chapters 中) 转换为 schemas.ParsedChapterCreate
        chapters_for_create_payload_list: List[schemas.ParsedChapterCreate] = [] #
        for chapter_parsed_item in parsed_novel_internal_data.chapters: #
            chapters_for_create_payload_list.append(schemas.ParsedChapterCreate( #
                title=chapter_parsed_item.title, #
                content=chapter_parsed_item.content, # 
                paragraphs=chapter_parsed_item.paragraphs,  # 
                order=chapter_parsed_item.order, #
                # 保留解析时的HTML标题和内部ID作为元数据，可能有助于调试或特定功能
                metadata={ #
                    "html_title": chapter_parsed_item.html_title,  #
                    "parsed_chapter_id": chapter_parsed_item.id #
                } if chapter_parsed_item.html_title else {"parsed_chapter_id": chapter_parsed_item.id} #
            ))
        
        # 构建用于创建数据库记录的 ParsedNovelCreate payload
        novel_create_final_payload = schemas.ParsedNovelCreate( #
            title=parsed_novel_internal_data.title or "未命名小说", # 提供默认标题
            author=parsed_novel_internal_data.author, # 作者可能是 None
            chapters=chapters_for_create_payload_list, #
            metadata=parsed_novel_internal_data.metadata or {}, # 确保元数据是字典
            # novel_id_override 通常在特殊情况下使用，例如用户明确指定要覆盖的小说ID
            # 这里我们不使用它，让后端在创建新小说时生成ID
            novel_id_override=None #
        )
        
        logger.info(f"成功为 '{novel_create_final_payload.title}' 准备了 ParsedNovelCreate schema，包含 {len(novel_create_final_payload.chapters)} 个章节。") #
        return novel_create_final_payload