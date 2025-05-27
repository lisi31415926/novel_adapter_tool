# backend/app/llm_providers/__init__.py
import os
import importlib
import inspect
import logging
from typing import Dict, Type
from .base_llm_provider import BaseLLMProvider

logger = logging.getLogger(__name__)

# PROVIDER_CLASSES 将被动态填充
# 键是提供商的唯一标签 (例如 "openai", "gemini")
# 值是对应的提供商类 (例如 OpenAIProvider)
PROVIDER_CLASSES: Dict[str, Type[BaseLLMProvider]] = {}

def _discover_providers():
    """
    动态发现并加载所有位于此目录下的 LLM 提供商。
    这个函数会自动扫描所有 `_provider.py` 结尾的文件，
    并尝试导入其中的 `BaseLLMProvider` 子类。
    """
    if PROVIDER_CLASSES:  # 避免重复发现
        return

    current_dir = os.path.dirname(__file__)
    logger.info(f"开始从目录 '{current_dir}' 动态发现 LLM 提供商...")

    for filename in os.listdir(current_dir):
        # 我们只关心以 `_provider.py` 结尾的文件，以避免导入 `__init__.py` 或 `base_llm_provider.py`
        if filename.endswith("_provider.py") and filename != "base_llm_provider.py":
            module_name = filename[:-3]  # 移除 .py 后缀
            module_path = f"app.llm_providers.{module_name}"

            try:
                # 动态导入模块
                module = importlib.import_module(module_path)
                
                # 遍历模块中的所有成员，寻找 BaseLLMProvider 的子类
                for name, obj in inspect.getmembers(module):
                    if inspect.isclass(obj) and \
                       issubclass(obj, BaseLLMProvider) and \
                       obj is not BaseLLMProvider and \
                       hasattr(obj, 'PROVIDER_TAG'):
                        
                        provider_tag = obj.PROVIDER_TAG
                        if provider_tag in PROVIDER_CLASSES:
                            logger.warning(
                                f"发现重复的提供商标签 '{provider_tag}'。现有类: {PROVIDER_CLASSES[provider_tag].__name__}, "
                                f"新发现类: {obj.__name__}。后者将覆盖前者。"
                            )
                        
                        logger.info(f"发现并注册了提供商: '{provider_tag}' -> {obj.__name__}")
                        PROVIDER_CLASSES[provider_tag] = obj

            except ImportError as e:
                # 这是关键的容错处理
                # 如果某个 provider 的依赖库没有安装，我们只记录警告，而不是让整个应用崩溃
                logger.warning(
                    f"无法导入模块 '{module_path}'，可能缺少必要的依赖库。将跳过此提供商。错误: {e}"
                )
            except Exception as e:
                logger.error(
                    f"在加载和检查模块 '{module_path}' 时发生未知错误: {e}",
                    exc_info=True
                )

# 在模块首次被导入时执行发现过程
_discover_providers()

logger.info(f"LLM 提供商发现完成。共加载了 {len(PROVIDER_CLASSES)} 个提供商: {list(PROVIDER_CLASSES.keys())}")

# 你可以取消下面这行注释来在启动时查看所有已加载的提供商
# print(f"Registered LLM Providers: {PROVIDER_CLASSES}")