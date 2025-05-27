# backend/app/novel_parser_service.py
import logging
import os
import re
import tempfile # 虽然在此版本中未直接使用，但与文件处理流程相关
import zipfile # 主要用于EPUB（EPUB本质是ZIP归档）
from typing import List, Dict, Any, Optional, Tuple, Set, Generator # 确保类型提示完整

import chardet # 用于编码检测
from bs4 import BeautifulSoup, Tag, NavigableString # 用于HTML解析
from ebooklib import epub, ITEM_DOCUMENT, ITEM_NAVIGATION, ITEM_IMAGE, ITEM_STYLE # 用于EPUB文件处理

from . import schemas # 导入应用内部的Pydantic schemas
from .text_processing_utils import generate_unique_id, sanitize_filename # 导入工具函数

logger = logging.getLogger(__name__)

# --- 常量定义 ---
MIN_CHAPTER_CONTENT_LENGTH = 50         # 最小章节内容长度，用于过滤空章节或无效章节
MIN_PARAGRAPHS_FOR_CHAPTER_SPLIT = 3    # 尝试按大标题拆分章节时，每个子章节应有的最小段落数
PARAGRAPH_SPLIT_MIN_LENGTH = 20         # 拆分段落时，段落的最小字符长度（主要用于TXT解析中的段落过滤）
MAX_TOC_CHAPTERS_FOR_FALLBACK = 3       # 如果EPUB的TOC提取的章节数少于此值，则触发备用章节提取逻辑
MAX_HEADING_TITLE_LENGTH = 100          # 章节标题或内部大标题的最大允许长度，防止误匹配
MAX_FILENAME_TITLE_LENGTH = 70          # 从文件名提取的标题的最大长度

# 增强的章节标题正则表达式模式 (用于TXT文件初步识别章节标题)
COMMON_CHAPTER_PATTERNS_FOR_TXT = [
    re.compile(r"^\s*(?:第\s*[零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟万亿〇]+)\s*[章节回卷节部篇话集]\s*(?P<title>.*?)\s*$", re.MULTILINE),
    re.compile(r"^\s*Chapter\s*\d+\s*[:.-]?\s*(?P<title>.*?)\s*$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*卷\s*[零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟万亿]+\s*(?P<title>.*?)\s*$", re.MULTILINE),
    re.compile(r"^\s*(序章|楔子|引子|前言|尾声|后记|最终章|最终话|番外(?:篇)?(?:\s*\d*)?)\s*[:：\-\s．.]*(?P<title>.*?)\s*$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*\d+\s*[:.-]?\s*(?P<title>.*?)\s*$", re.MULTILINE), # 数字开头的标题
    # 一个更通用的匹配潜在标题的模式，通常放在最后
    re.compile(r"^\s*(?P<title>[^\n\r]{2,60})\s*$", re.MULTILINE) # 匹配独立成行，长度在2到60之间的文本作为标题
]

# 内部大标题拆分章节用的正则 (更宽松些，因为是在已知章节内容内部查找)
# 匹配 "第X章", "Chapter X", "卷X", "楔子", "序章" 等，后跟可选标题文本
# 并且该行本身字数较少 (例如 < MAX_HEADING_TITLE_LENGTH)
# 以及一些独立成行的，不以标点结尾的短句也可能是标题
HEADING_SPLIT_PATTERN = re.compile(
    r"^\s*(?:(?:第\s*[一二三四五六七八九十百千\d〇]+|Chapter\s*\d+)\s*[章节回卷篇集部]?\s*[:：\-\s．.]*\s*.*"
    r"|[A-ZÀ-ÖØ-Þ\d][A-ZÀ-ÖØ-Þ\d\s\S']{3," + str(MAX_HEADING_TITLE_LENGTH -1) + r"}"  # 全大写或数字开头的短句 (英文标题)
    r"|[\u4e00-\u9fff]{1," + str(MAX_HEADING_TITLE_LENGTH // 2) + r"}"  # 纯中文短句 (中文标题，长度限制约为一半)
    r"|(?:楔子|序[章言]?|引子|尾声|后记|番外(?:篇)?(?:\s*\d+)?)(?:\s*[:：\-\s．.]*\s*.*)?)\s*$",
    re.IGNORECASE | re.MULTILINE
)


def _clean_html_to_text(html_content_bytes: bytes, encoding: str = 'utf-8') -> Tuple[List[str], Optional[str]]:
    """
    将HTML内容字节清理并转换为纯文本段落列表。
    同时尝试提取HTML <title>标签的内容。
    """
    html_title_text: Optional[str] = None
    try:
        html_content = html_content_bytes.decode(encoding, errors='replace')
        soup = BeautifulSoup(html_content, 'lxml')

        title_tag = soup.find('title')
        if title_tag and title_tag.string:
            html_title_text = title_tag.string.strip()
            logger.debug(f"从HTML中找到标题: '{html_title_text}'")
        
        unwanted_tags = [
            "script", "style", "meta", "link", "head", "header", "footer", 
            "nav", "aside", "form", "button", "input", "select", "textarea", 
            "iframe", "figure", "figcaption", "template", "img", "audio", "video", "svg", "map", "area", "object", "embed"
        ]
        for unwanted_tag_name in unwanted_tags:
            for tag_instance in soup.find_all(unwanted_tag_name):
                tag_instance.decompose()
        
        for br_tag in soup.find_all("br"): br_tag.replace_with("\n")
        for hr_tag in soup.find_all("hr"): hr_tag.replace_with("\n\n")
        # 处理常见的块级标签，确保它们能正确分隔内容
        for block_tag in soup.find_all(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'article', 'section']):
            block_tag.append("\n\n") # 在块级标签后强制添加换行，帮助后续分割

        content_container = soup.body if soup.body else soup
        text_with_newlines = content_container.get_text(separator='', strip=True) if content_container else "" # separator='' 让BeautifulSoup自行处理空格和换行，strip=True去除首尾空白
        
        # 先用 re.sub 将多个连续换行和空白换行替换为单个 \n\n，作为段落分隔符
        normalized_text = re.sub(r'(\s*\n\s*){2,}', '\n\n', text_with_newlines)
        # 再按 \n\n 分割段落
        paragraphs = [p.strip() for p in normalized_text.split('\n\n') if p.strip()]

        if not paragraphs and text_with_newlines.strip(): # 如果没有双换行分割的段落，尝试单换行
            logger.debug("主要段落分割策略 (双换行) 未产生结果，尝试使用单换行分割。")
            paragraphs = [p.strip() for p in text_with_newlines.split('\n') if p.strip()]
        
        if not paragraphs and text_with_newlines.strip(): # 如果仍然没有，则整个内容为一个段落
             paragraphs = [text_with_newlines.strip()]

        if not paragraphs:
            logger.warning(f"无法从HTML内容中提取有效的文本段落。HTML标题: {html_title_text}")
            return [], html_title_text 
            
        return paragraphs, html_title_text
    except Exception as e:
        logger.error(f"清理HTML到文本时出错: {e}", exc_info=True)
        return [], None


def _detect_encoding(content_bytes: bytes) -> str:
    """尝试检测字节内容的编码，提供更完善的回退和日志。"""
    if not content_bytes:
        logger.warning("尝试检测空内容的编码，将默认为utf-8。")
        return 'utf-8'
    try:
        detected = chardet.detect(content_bytes)
        encoding = detected.get('encoding') if detected else None
        confidence = detected.get('confidence', 0) if detected else 0
        logger.info(f"Chardet检测到编码: {encoding}，置信度: {confidence:.2f}")

        if encoding:
            encoding_lower = encoding.lower()
            if 'gbk' == encoding_lower or 'gb2312' == encoding_lower or 'gb18030' == encoding_lower or 'hz-gb-2312' == encoding_lower:
                logger.info(f"Chardet结果 '{encoding}' 表明是GB系列编码。优先使用 'gb18030'。")
                return 'gb18030' 
            if 'big5' == encoding_lower or 'big5-hkscs' == encoding_lower:
                logger.info(f"Chardet结果 '{encoding}' 表明是Big5系列编码。使用 'big5hkscs' 或 'big5'。")
                return 'big5hkscs' # 更完整的 Big5
            if 'utf-8' in encoding_lower or 'utf8' in encoding_lower: return 'utf-8'
            if 'utf-16' in encoding_lower: return encoding # 保留 BE/LE
            if confidence > 0.8: # 提高置信度门槛
                logger.info(f"使用Chardet检测到的编码 '{encoding}' (置信度较高)。")
                return encoding

        common_encodings_to_try = ['utf-8', 'gb18030', 'big5hkscs', 'gbk']
        logger.warning(f"Chardet检测编码失败或置信度不足 ({confidence:.2f})。尝试预定义编码: {common_encodings_to_try}。")
        for enc_try in common_encodings_to_try:
            try:
                content_bytes.decode(enc_try); logger.info(f"使用备选编码 '{enc_try}' 解码成功。"); return enc_try
            except UnicodeDecodeError: logger.debug(f"备选编码 '{enc_try}' 解码失败。")
        
        logger.error("所有编码尝试均失败。将强制使用 'utf-8' 并替换错误字符。")
        return 'utf-8'
    except Exception as e:
        logger.error(f"Chardet编码检测异常: {e}。默认为 'utf-8'。", exc_info=True)
        return 'utf-8'


def _is_likely_content_html(html_content_str: str) -> bool:
    """启发式判断HTML字符串是否为主要内容页，而非目录、版权页等。"""
    if not html_content_str: return False
    soup = BeautifulSoup(html_content_str, 'lxml')
    
    # 移除脚本、样式等非显示内容
    for invisible_tag in soup(["script", "style", "meta", "link", "head"]): invisible_tag.decompose()
    
    text_content = soup.get_text(separator=' ', strip=True)
    
    # 常见非内容页关键词
    non_content_keywords = [
        '目录', 'contents', 'index', 'table of contents', 'navigation', 'toc',
        '版权', 'copyright', '出版社', '出版信息', 'publication info',
        '封面', 'cover', 'title page', '扉页',
        '献词', 'dedication', '致谢', 'acknowledgments',
        '广告', 'advertisement'
    ]
    text_lower = text_content[:500].lower() # 只检查开头部分的小写文本
    if any(kw in text_lower for kw in non_content_keywords):
        # 如果在文本开头发现这些词，进一步检查文本长度
        if len(text_content) < 1000 and len(re.findall(r'[\u4e00-\u9fff]', text_content)) < 500 : # 内容较短
             logger.debug(f"HTML页面可能为非内容页 (如目录/版权页)，因包含关键词且内容较短。文本开头: '{text_content[:100]}...'")
             return False

    # 移除常见的导航链接文本模式，避免它们影响长度判断
    text_content_cleaned = re.sub(r'(?:上一[章页回篇]?|下一[章页回篇]?|返回目录|上一节|下一节|previous|next)', '', text_content, flags=re.IGNORECASE)
    chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text_content_cleaned))
    
    # 调整判断逻辑：如果中文字符多，或者总字符多，则认为是内容
    # 如果段落数量也多，也可以作为判断依据
    paragraph_tags = soup.find_all(['p', 'div']) # 简单统计p和div标签数量
    if len(text_content_cleaned) > 300 or chinese_chars > 150 or len(paragraph_tags) > 5:
        return True
    
    logger.debug(f"HTML页面判断为非主要内容页。清理后文本长度: {len(text_content_cleaned)}, 中文字数: {chinese_chars}, 段落标签数: {len(paragraph_tags)}")
    return False


def _extract_chapters_from_epub(book: epub.EpubBook) -> List[schemas.EpubChapter]:
    """从EpubBook对象中提取章节信息和内容，进行清理、排序和去重名处理。"""
    chapters_data: List[schemas.EpubChapter] = []
    processed_item_hrefs: Set[str] = set()
    href_to_item_map: Dict[str, epub.EpubItem] = {item.file_name: item for item in book.get_items()}

    toc_items_links: List[epub.Link] = []
    if book.toc:
        def flatten_toc(toc_list_or_tuple): # 递归展平TOC，处理元组和列表形式的TOC
            flat_list = []
            if isinstance(toc_list_or_tuple, (list, tuple)):
                for item in toc_list_or_tuple:
                    if isinstance(item, epub.Link): flat_list.append(item)
                    elif isinstance(item, (list, tuple)): flat_list.extend(flatten_toc(item)) # 递归处理嵌套
            return flat_list
        toc_items_links = flatten_toc(book.toc)
    else:
        logger.warning("EPUB文件缺少目录(TOC)。尝试从书脊(spine)或所有文档项中推断。")

    if toc_items_links:
        logger.info(f"从EPUB目录(TOC)找到 {len(toc_items_links)} 个条目进行处理。")
        # 优先使用TOC的顺序，因为它是作者意图的体现
        for idx, toc_link in enumerate(toc_items_links):
            if not toc_link.href: continue
            base_href = toc_link.href.split('#')[0]
            if not base_href or base_href in processed_item_hrefs: continue

            epub_document_item = href_to_item_map.get(base_href)
            if not epub_document_item or not isinstance(epub_document_item, epub.EpubHtml): continue

            item_content_bytes = epub_document_item.get_content()
            detected_encoding = _detect_encoding(item_content_bytes)
            content_paragraphs, html_title = _clean_html_to_text(item_content_bytes, encoding=detected_encoding)
            
            chapter_title = toc_link.title or html_title or os.path.splitext(epub_document_item.file_name)[0]
            chapter_title = chapter_title.strip() if chapter_title else f"章节 {idx + 1}" # 确保有标题
            
            full_content_str = "\n\n".join(content_paragraphs)
            is_aux = any(aux in chapter_title.lower() for aux in ["cover", "版权", "目录", "toc", "index", "扉页", "广告"])
            if len(full_content_str) < MIN_CHAPTER_CONTENT_LENGTH and not is_aux: continue

            chapters_data.append(schemas.EpubChapter(
                id=generate_unique_id(prefix="c_toc_"), title=chapter_title, content=full_content_str,
                paragraphs=content_paragraphs, order=idx, html_title=html_title
            ))
            processed_item_hrefs.add(base_href)
        logger.info(f"从TOC中有效提取并处理了 {len(chapters_data)} 个章节。")

    # 如果TOC提取的章节不足，或TOC本身不存在，则尝试从书脊和所有文档项回退
    if not chapters_data or len(chapters_data) < MAX_TOC_CHAPTERS_FOR_FALLBACK:
        logger.warning(f"TOC提取章节数 ({len(chapters_data)}) 不足或TOC不存在，尝试备选提取策略。")
        
        items_for_fallback: List[epub.EpubHtml] = []
        # 1. 先按书脊顺序收集未被TOC处理的HTML文件
        for item_id_spine, _ in book.spine:
            item_spine = book.get_item_with_id(item_id_spine)
            if item_spine and isinstance(item_spine, epub.EpubHtml) and item_spine.file_name not in processed_item_hrefs:
                if _is_likely_content_html(item_spine.get_content().decode(_detect_encoding(item_spine.get_content()), errors='replace')):
                    items_for_fallback.append(item_spine)
                    processed_item_hrefs.add(item_spine.file_name) # 标记为已处理
        
        # 2. 再收集所有其他未被处理的HTML文档项目 (不在书脊中，也不在TOC中)
        for item_doc in book.get_items_of_type(ITEM_DOCUMENT):
            if isinstance(item_doc, epub.EpubHtml) and item_doc.file_name not in processed_item_hrefs:
                if _is_likely_content_html(item_doc.get_content().decode(_detect_encoding(item_doc.get_content()), errors='replace')):
                    items_for_fallback.append(item_doc)
                    processed_item_hrefs.add(item_doc.file_name)
        
        logger.info(f"备选提取策略找到 {len(items_for_fallback)} 个潜在的HTML内容文件。")
        
        # 为备选提取的章节分配顺序 (接续TOC提取的)
        fallback_order_offset = len(chapters_data) 
        for idx_fb, doc_item_fb in enumerate(items_for_fallback):
            item_content_bytes_fb = doc_item_fb.get_content()
            detected_encoding_fb = _detect_encoding(item_content_bytes_fb)
            content_paragraphs_fb, html_title_fb = _clean_html_to_text(item_content_bytes_fb, encoding=detected_encoding_fb)
            
            chapter_title_fb = html_title_fb or os.path.splitext(doc_item_fb.file_name)[0]
            chapter_title_fb = chapter_title_fb.strip() if chapter_title_fb else f"补充章节 {idx_fb + 1}"
            full_content_str_fb = "\n\n".join(content_paragraphs_fb)

            is_aux_fb = any(aux in chapter_title_fb.lower() for aux in ["cover", "版权", "目录", "toc", "index", "扉页", "广告"])
            if len(full_content_str_fb) < MIN_CHAPTER_CONTENT_LENGTH and not is_aux_fb: continue

            chapters_data.append(schemas.EpubChapter(
                id=generate_unique_id(prefix="c_fb_"), title=chapter_title_fb, content=full_content_str_fb,
                paragraphs=content_paragraphs_fb, order=fallback_order_offset + idx_fb, html_title=html_title_fb
            ))
        logger.info(f"备选提取逻辑处理完毕，当前总章节数: {len(chapters_data)}。")

    # 最终排序和去重名处理
    sorted_chapters = sorted(chapters_data, key=lambda c: c.order)
    final_chapters_data_epub: List[schemas.EpubChapter] = []
    title_counts_epub: Dict[str, int] = {}
    for final_idx, chap_item_epub in enumerate(sorted_chapters):
        chap_item_epub.order = final_idx # 保证 order 是从0开始的连续整数
        original_title_epub = chap_item_epub.title
        if original_title_epub in title_counts_epub:
            title_counts_epub[original_title_epub] += 1
            chap_item_epub.title = f"{original_title_epub} ({title_counts_epub[original_title_epub]})"
        else:
            title_counts_epub[original_title_epub] = 1
        final_chapters_data_epub.append(chap_item_epub)

    return final_chapters_data_epub


def _parse_epub_from_path(epub_path: str) -> Optional[schemas.ParsedNovel]:
    """解析指定路径的EPUB文件，返回 ParsedNovel schema 或 None。"""
    try:
        if not os.path.exists(epub_path): logger.error(f"EPUB文件路径不存在: {epub_path}"); return None
        book = epub.read_epub(epub_path)
        novel_title_meta = book.get_metadata('DC', 'title'); novel_title_str = (novel_title_meta[0][0] if isinstance(novel_title_meta[0], tuple) else str(novel_title_meta[0])) if novel_title_meta else "未知EPUB书名"
        novel_author_meta = book.get_metadata('DC', 'creator'); novel_author_str = (novel_author_meta[0][0] if isinstance(novel_author_meta[0], tuple) else str(novel_author_meta[0])) if novel_author_meta else "未知EPUB作者"
        novel_lang_meta = book.get_metadata('DC', 'language'); novel_lang_str = (novel_lang_meta[0][0] if isinstance(novel_lang_meta[0], tuple) else str(novel_lang_meta[0])) if novel_lang_meta else "unk"
        logger.info(f"解析EPUB: '{novel_title_str}' 作者: '{novel_author_str}', 语言: '{novel_lang_str}'")
        chapters = _extract_chapters_from_epub(book)
        if not chapters: logger.error(f"未能从EPUB文件 '{epub_path}' 中提取任何章节。"); return None
        return schemas.ParsedNovel(
            id=generate_unique_id(prefix="epub_novel"), title=novel_title_str.strip(), author=novel_author_str.strip(),
            chapters=chapters, metadata={"language": novel_lang_str, "source_format": "epub"}
        )
    except Exception as e:
        logger.error(f"解析EPUB文件 '{epub_path}' 时发生一般错误: {e}", exc_info=True)
        return None


def _parse_txt_from_path(txt_path: str, id_prefix_for_novel: Optional[str] = None) -> Optional[schemas.ParsedNovel]:
    """解析指定路径的TXT文件，增强章节识别和元数据提取。"""
    try:
        if not os.path.exists(txt_path): logger.error(f"TXT文件路径不存在: {txt_path}"); return None
        with open(txt_path, 'rb') as f: content_bytes = f.read()
        if not content_bytes: logger.warning(f"TXT文件 '{txt_path}' 内容为空。"); return None

        detected_encoding = _detect_encoding(content_bytes)
        logger.info(f"TXT文件 '{txt_path}' 检测编码: {detected_encoding}")
        try: full_text = content_bytes.decode(detected_encoding, errors='replace')
        except Exception as e_decode:
            logger.error(f"使用编码 '{detected_encoding}' 解码TXT '{txt_path}' 失败: {e_decode}。尝试UTF-8。")
            try: full_text = content_bytes.decode('utf-8', errors='replace'); detected_encoding = 'utf-8'
            except Exception as e_utf8: logger.error(f"UTF-8解码TXT '{txt_path}' 也失败: {e_utf8}。无法处理。"); return None
        
        full_text = full_text.replace('\r\n', '\n').replace('\r', '\n')

        temp_service_instance = NovelParserService() # 用于调用实例方法
        filename_for_meta = os.path.basename(txt_path)
        novel_title_str, novel_author_str = temp_service_instance.extract_title_author_from_filename(filename_for_meta)
        
        if novel_title_str == os.path.splitext(filename_for_meta)[0] or not novel_title_str.strip(): # 如果标题只是文件名或为空
            first_lines_cand = full_text.splitlines()[:5]
            for line_c in first_lines_cand:
                line_s_c = line_c.strip()
                if line_s_c and 2 < len(line_s_c) < 70 and not any(cp.match(line_s_c) for cp in COMMON_CHAPTER_PATTERNS_FOR_TXT):
                    pot_title = re.sub(r"^(作者|著|BY)[:：\s]*.*$", "", line_s_c, flags=re.IGNORECASE).strip()
                    if pot_title: novel_title_str = pot_title; logger.info(f"从TXT首行提取到标题: '{novel_title_str}'"); break
        novel_title_str = novel_title_str.strip() or "未知TXT小说"

        logger.info(f"解析TXT: '{novel_title_str}' 作者: '{novel_author_str or '未知作者'}'")
        chapters: List[schemas.EpubChapter] = []
        chapter_order_counter = 0
        lines_txt = full_text.splitlines()
        
        potential_chapter_starts_txt: List[Tuple[int, str, str]] = [] 
        for i_line, line_txt_content in enumerate(lines_txt):
            line_s_proc = line_txt_content.strip()
            if not line_s_proc or len(line_s_proc) > 150 : continue # 跳过空行和过长的行（不太可能是标题）
            for pattern_idx, pattern_txt in enumerate(COMMON_CHAPTER_PATTERNS_FOR_TXT):
                match_txt = pattern_txt.fullmatch(line_s_proc) # 整行匹配
                if match_txt:
                    extracted_title_name = (match_txt.groupdict().get('title') or "").strip()
                    # 如果模式是通用的数字开头或短行匹配，且没有捕获到 title 组，则用整行作为标题，但需谨慎
                    if not extracted_title_name and pattern_idx >= 4 : # 假设后几个模式是较通用的
                         extracted_title_name = line_s_proc
                    elif not extracted_title_name: # 对于特定模式（如"第X章"）如果title为空，则只用匹配到的前缀
                         extracted_title_name = line_s_proc # 或者只取匹配到的非title部分

                    # 进一步过滤，避免将普通段落的短句误认为标题
                    if len(extracted_title_name) < 2 and extracted_title_name.isdigit(): continue
                    if len(extracted_title_name) > MAX_HEADING_TITLE_LENGTH : continue # 标题不应过长
                        
                    potential_chapter_starts_txt.append((i_line, line_s_proc, extracted_title_name)); break
        
        if not potential_chapter_starts_txt:
            logger.info("TXT中未找到明确章节标题。整个文件视为一章，按空行分段。")
            raw_paras = re.split(r'\n\s*\n+', full_text.strip())
            cleaned_paras = [p.strip() for p in raw_paras if p.strip() and len(p.strip()) >= PARAGRAPH_SPLIT_MIN_LENGTH]
            if cleaned_paras: chapters.append(schemas.EpubChapter(id=generate_unique_id(), title=novel_title_str, content="\n\n".join(cleaned_paras), paragraphs=cleaned_paras, order=0))
        else:
            first_title_idx = potential_chapter_starts_txt[0][0]
            if first_title_idx > 0:
                pro_lines = lines_txt[:first_title_idx]; pro_text_block = "\n".join(pro_lines).strip()
                pro_paras_raw = re.split(r'\n\s*\n+', pro_text_block) if pro_text_block else []
                pro_paras = [p.strip() for p in pro_paras_raw if p.strip() and len(p.strip()) >= PARAGRAPH_SPLIT_MIN_LENGTH]
                if pro_paras: chapters.append(schemas.EpubChapter(id=generate_unique_id(), title="序言", content="\n\n".join(pro_paras), paragraphs=pro_paras, order=chapter_order_counter)); chapter_order_counter+=1
            
            for i_pot in range(len(potential_chapter_starts_txt)):
                curr_title_line_idx, _, curr_title = potential_chapter_starts_txt[i_pot]
                start_content = curr_title_line_idx + 1
                end_content = potential_chapter_starts_txt[i_pot+1][0] if i_pot + 1 < len(potential_chapter_starts_txt) else len(lines_txt)
                content_lines_block = lines_txt[start_content : end_content]
                chap_text_block = "\n".join(content_lines_block).strip()
                
                chap_paras_final = []
                if chap_text_block:
                    chap_paras_raw = re.split(r'\n\s*\n+', chap_text_block)
                    chap_paras_final = [p.strip() for p in chap_paras_raw if p.strip() and len(p.strip()) >= PARAGRAPH_SPLIT_MIN_LENGTH]
                
                # 即使内容为空，如果标题有效，也创建章节
                if curr_title or chap_paras_final: # 确保标题或内容至少有一个存在
                    final_title = curr_title if curr_title else f"未命名章节 {chapter_order_counter+1}"
                    chapters.append(schemas.EpubChapter(id=generate_unique_id(), title=final_title, content="\n\n".join(chap_paras_final), paragraphs=chap_paras_final, order=chapter_order_counter))
                    chapter_order_counter+=1

        if not chapters: logger.error(f"未能从TXT '{txt_path}' 提取任何有效章节。"); return None
        return schemas.ParsedNovel(
            id=generate_unique_id(prefix=id_prefix_for_novel or "txt_novel"), title=novel_title_str.strip(),
            author=(novel_author_str.strip() if novel_author_str and novel_author_str.lower() != "未知作者" else None),
            chapters=chapters, metadata={"source_format": "txt", "encoding": detected_encoding}
        )
    except Exception as e:
        logger.error(f"解析TXT '{txt_path}' 异常: {e}", exc_info=True)
        return None


def post_process_parsed_chapters(chapters: List[schemas.EpubChapter]) -> List[schemas.EpubChapter]:
    """对解析出的章节列表进行后处理，例如尝试根据内容中的大标题拆分过长章节。"""
    if not chapters: return []
    processed_chapters_list: List[schemas.EpubChapter] = []
    current_order_val = 0
    for chapter_item in chapters:
        # 只有当章节段落数较多时才尝试进一步拆分
        if len(chapter_item.paragraphs) > MIN_PARAGRAPHS_FOR_CHAPTER_SPLIT * 2 and len(chapter_item.content) > MIN_CHAPTER_CONTENT_LENGTH * 5:
            sub_chapters_list = _try_split_chapter_by_headings(chapter_item)
            if sub_chapters_list:
                logger.info(f"章节 '{chapter_item.title}' 被内部标题拆分为 {len(sub_chapters_list)} 个子章节。")
                for sub_chap_item in sub_chapters_list:
                    sub_chap_item.order = current_order_val; processed_chapters_list.append(sub_chap_item); current_order_val += 1
            else: # 未成功拆分或不符合拆分条件
                chapter_item.order = current_order_val; processed_chapters_list.append(chapter_item); current_order_val += 1
        else: # 章节较短，不尝试拆分
            chapter_item.order = current_order_val; processed_chapters_list.append(chapter_item); current_order_val += 1
    return processed_chapters_list


def _try_split_chapter_by_headings(chapter: schemas.EpubChapter) -> Optional[List[schemas.EpubChapter]]:
    """尝试根据章节内容中的大写标题模式 (H1, H2 等常见模式) 拆分单个章节。"""
    potential_splits_data: List[Tuple[int, str]] = [] # (段落索引, 标题文本)
    for i_para, paragraph_text_content in enumerate(chapter.paragraphs):
        paragraph_first_line_text = paragraph_text_content.split('\n', 1)[0].strip()
        if 1 < len(paragraph_first_line_text) < MAX_HEADING_TITLE_LENGTH and HEADING_SPLIT_PATTERN.match(paragraph_first_line_text):
            # 避免将章节主标题自身作为拆分点（如果它恰好在第一段）
            if i_para > 0 or (i_para == 0 and paragraph_first_line_text.lower() != chapter.title.lower().strip()):
                potential_splits_data.append((i_para, paragraph_first_line_text))
                logger.debug(f"在章节 '{chapter.title}' 中找到潜在的内部标题拆分点: '{paragraph_first_line_text}' (段落索引 {i_para})")

    if not potential_splits_data: return None # 没有找到可拆分的点

    split_chapters_result: List[schemas.EpubChapter] = []
    last_split_para_idx = 0
    original_chapter_title_prefix = chapter.title.split('(')[0].strip() # 用于子章节命名

    current_sub_chapter_title = chapter.title # 第一个子章节的标题默认为原章节标题

    for i_split, (split_para_idx_val, heading_text_val) in enumerate(potential_splits_data):
        # 从 last_split_para_idx 到 split_para_idx_val (不含) 的段落构成一个子章节
        sub_chapter_paras = chapter.paragraphs[last_split_para_idx:split_para_idx_val]
        if len(sub_chapter_paras) >= MIN_PARAGRAPHS_FOR_CHAPTER_SPLIT:
            sub_content_str = "\n\n".join(sub_chapter_paras)
            split_chapters_result.append(schemas.EpubChapter(
                id=generate_unique_id(prefix="sub_c_"), title=current_sub_chapter_title, content=sub_content_str,
                paragraphs=sub_chapter_paras, order=0, html_title=chapter.html_title 
            ))
        current_sub_chapter_title = heading_text_val # 下一个子章节的标题是当前找到的heading
        last_split_para_idx = split_para_idx_val # 更新下一个子章节的起始段落索引

    # 处理最后一个潜在标题到章节末尾的内容
    remaining_paras_after_last = chapter.paragraphs[last_split_para_idx:]
    if len(remaining_paras_after_last) >= MIN_PARAGRAPHS_FOR_CHAPTER_SPLIT:
        last_sub_content_str = "\n\n".join(remaining_paras_after_last)
        split_chapters_result.append(schemas.EpubChapter(
            id=generate_unique_id(prefix="sub_c_"), title=current_sub_chapter_title, # 使用最后一个识别的heading作为标题
            content=last_sub_content_str, paragraphs=remaining_paras_after_last, order=0, html_title=chapter.html_title
        ))

    if len(split_chapters_result) > 1: # 只有当确实产生了多个子章节时才认为拆分有效
        logger.info(f"章节 '{chapter.title}' 被成功拆分为 {len(split_chapters_result)} 个子章节。")
        return split_chapters_result
    
    logger.debug(f"尝试拆分章节 '{chapter.title}' 未产生有效的多个子章节，保持原样。")
    return None


class NovelParserService:
    """封装了小说文件解析逻辑的服务类。"""
    def __init__(self, chapter_patterns_txt: Optional[List[re.Pattern]] = None):
        self.chapter_patterns_txt = chapter_patterns_txt or COMMON_CHAPTER_PATTERNS_FOR_TXT
        logger.info(f"NovelParserService (for TXT) initialized with {len(self.chapter_patterns_txt)} patterns.")

    def extract_title_author_from_filename(self, filename: str) -> Tuple[str, Optional[str]]:
        """尝试从文件名中启发式地提取书名和作者名。"""
        name_part = os.path.splitext(filename)[0] 
        common_separators = [
            re.compile(r"^(?P<title>.+?)\s*by\s*(?P<author>.+)$", re.IGNORECASE),
            re.compile(r"^(?P<title>.+?)\s*作者[：:]\s*(?P<author>.+)$", re.IGNORECASE),
            re.compile(r"^(?P<title>.+?)\s*著\s*(?P<author>.+)$", re.IGNORECASE),
            re.compile(r"^(?P<author>[^《》—-]*?)\s*[-—]\s*(?P<title>[^《》—-].*)$"), # 作者 - 书名 或 作者 —— 书名 (避免匹配书名号本身)
            re.compile(r"^(?P<author>[^《》]*?)《(?P<title>[^》]+?)》$"), # 作者《书名》
            re.compile(r"^《(?P<title>[^》]+?)》\s*(?P<author>[^《》]*?)$"), # 《书名》作者
        ]
        for pattern in common_separators:
            match = pattern.match(name_part)
            if match:
                raw_title = (match.group("title") or "").strip()
                raw_author = (match.group("author") or "").strip()
                
                # 清理标题和作者中的常见干扰词
                clean_title = raw_title.replace("《", "").replace("》", "").strip()
                # 移除作者名末尾可能存在的 "(著)" 或 "著"
                clean_author = re.sub(r"\s*[(（]?著[)）]?$", "", raw_author, flags=re.IGNORECASE).strip()
                
                if clean_title and clean_author: return clean_title, clean_author
                if clean_title and not clean_author: return clean_title, None # 只有标题
                if clean_author and not clean_title: # 只有作者，标题用原始文件名部分
                    # 避免将纯作者名作为标题返回
                    return name_part.strip() if name_part.strip() != clean_author else "未知书名", clean_author
        
        logger.debug(f"无法从文件名 '{filename}' 中可靠提取作者。将使用清理后的文件名作为标题。")
        # 如果都匹配不上，返回清理后的文件名作为标题，作者为None
        return name_part.strip()[:MAX_FILENAME_TITLE_LENGTH], None


    def parse_novel_file(self, file_path: str, original_filename: Optional[str] = None) -> Optional[schemas.ParsedNovel]:
        """根据文件扩展名选择合适的解析器来解析小说文件。"""
        logger.info(f"NovelParserService: 开始解析文件: {file_path}, 原始文件名: {original_filename}")
        effective_filename = original_filename or os.path.basename(file_path)
        filename_lower = effective_filename.lower()
        parsed_novel_result: Optional[schemas.ParsedNovel] = None

        if filename_lower.endswith(".epub"):
            parsed_novel_result = _parse_epub_from_path(file_path)
        elif filename_lower.endswith(".txt"):
            # 为TXT文件生成一个基于文件名的ID前缀，用于内部生成章节ID等
            txt_id_prefix = sanitize_filename(os.path.splitext(effective_filename)[0]) if effective_filename else "txt_novel"
            txt_id_prefix = txt_id_prefix[:30] # 限制前缀长度
            parsed_novel_result = _parse_txt_from_path(file_path, id_prefix_for_novel=txt_id_prefix)
        else:
            logger.error(f"不支持的文件格式: {filename_lower} (来自路径: {file_path})。无法解析。")
            return None # 解析失败

        if parsed_novel_result:
            if parsed_novel_result.chapters:
                logger.info(f"对 '{parsed_novel_result.title}' 的 {len(parsed_novel_result.chapters)} 个初始章节进行后处理...")
                parsed_novel_result.chapters = post_process_parsed_chapters(parsed_novel_result.chapters) # 应用后处理
                
                # 确保所有章节都有标题和有效内容格式
                for i_chap_final, chap_final in enumerate(parsed_novel_result.chapters):
                    chap_final.order = i_chap_final # 保证最终顺序是从0开始的连续整数
                    if not chap_final.title: chap_final.title = f"未命名章节 {chap_final.order + 1}"
                    if not isinstance(chap_final.content, str): chap_final.content = ""
                    if not isinstance(chap_final.paragraphs, list): chap_final.paragraphs = [] # 确保是列表
                    # 再次检查段落内容，确保是字符串列表
                    chap_final.paragraphs = [str(p) for p in chap_final.paragraphs if isinstance(p, str)]

                logger.info(f"后处理完成，最终章节数: {len(parsed_novel_result.chapters)}。")
            else: # 解析成功但没有章节
                 logger.warning(f"文件 '{effective_filename}' 解析成功，但未提取到任何章节内容。")
                 return None # 视为解析后无有效内容

        return parsed_novel_result

    def parse_novel_from_temp_file(
        self, temp_file_path: str, original_filename: str
    ) -> Optional[schemas.ParsedNovelCreate]:
        """
        从临时文件路径解析小说，并准备用于创建 schemas.ParsedNovelCreate 对象。
        """
        logger.info(f"NovelParserService: 处理临时文件进行最终解析: {temp_file_path} (原始文件名: {original_filename})")
        
        parsed_novel_data = self.parse_novel_file(temp_file_path, original_filename) 
        
        if not parsed_novel_data or not parsed_novel_data.chapters: # 确保有章节数据
            logger.error(f"未能从文件 '{original_filename}' 解析出任何有效的小说内容或章节。")
            return None

        # 为 ParsedNovelCreate schema 准备章节数据
        chapters_for_create_schema: List[schemas.ParsedChapterCreate] = []
        for ch_parsed in parsed_novel_data.chapters:
            # 确保从 ParsedNovel.chapters (包含 EpubChapter) 转换到 ParsedChapterCreate
            # ParsedChapterCreate 可能有不同的字段或期望
            chapters_for_create_schema.append(schemas.ParsedChapterCreate(
                title=ch_parsed.title,
                content=ch_parsed.content, 
                paragraphs=ch_parsed.paragraphs, 
                order=ch_parsed.order,
                metadata={
                    "html_title": ch_parsed.html_title, 
                    "parsed_chapter_id": ch_parsed.id # 保留解析时生成的内部章节ID
                } if ch_parsed.html_title else {"parsed_chapter_id": ch_parsed.id}
            ))
        
        novel_create_payload = schemas.ParsedNovelCreate(
            title=parsed_novel_data.title or "未命名小说", # 提供默认标题
            author=parsed_novel_data.author, # 作者可能是 None
            chapters=chapters_for_create_schema,
            metadata=parsed_novel_data.metadata or {},
            # novel_id_override 通常在特殊情况下使用，例如用户明确指定要覆盖的小说ID
            # 这里我们不使用它，让后端在创建新小说时生成ID
            novel_id_override=None 
        )
        
        logger.info(f"成功为 '{novel_create_payload.title}' 准备了 ParsedNovelCreate schema，包含 {len(novel_create_payload.chapters)} 个章节。")
        return novel_create_payload