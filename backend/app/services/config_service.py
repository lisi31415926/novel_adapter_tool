# backend/app/services/config_service.py
import json
import os
from pathlib import Path
from typing import Dict, Any, Optional, List, Union, TypeVar, Type
import logging

from pydantic import BaseModel, Field, ValidationError # model_validator 未在此文件中直接使用，但与Pydantic相关
from pydantic_settings import BaseSettings, SettingsConfigDict

# 从 schemas.py 导入所有需要的配置相关的 Pydantic 模型
# config_service.py 位于 app/services/ 目录下, schemas.py 位于 app/ 目录下
# 因此使用相对导入 ..
from .. import schemas # 导入 schemas.py

logger = logging.getLogger(__name__)

# --- 配置常量 ---
# 假设 config_service.py 位于 app/services/ 目录
# 那么 app 目录是 Path(__file__).resolve().parent.parent
APP_ROOT_DIR = Path(__file__).resolve().parent.parent # 指向 app/ 目录
CONFIG_FILE_PATH = APP_ROOT_DIR / "config.json" # 配置文件路径 app/config.json
ENV_FILE_PATH = APP_ROOT_DIR / ".env" # 可选的 .env 文件路径 app/.env

# --- 辅助函数：确保目录存在 ---
def _ensure_config_dir_exists():
    """确保配置文件所在的目录存在。"""
    try:
        CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        logger.warning(f"创建配置目录 '{CONFIG_FILE_PATH.parent}' 时出错: {e}")

# --- Pydantic 配置模型 (现在完全依赖 schemas.py 中的定义) ---
# ApplicationSettingsModel 将作为 BaseSettings 的基础，
# 并使用从 schemas.py 导入的 TopLevelApplicationConfigSchema 的字段结构。
# 这种方式下，ConfigService 仅负责加载、校验和提供配置，
# 而配置的结构定义完全由 schemas.py 控制。

class ApplicationSettingsModel(BaseSettings, schemas.TopLevelApplicationConfigSchema): # 继承自 schemas.TopLevelApplicationConfigSchema
    """
    主应用配置模型，使用Pydantic BaseSettings。
    它会从 config.json 文件加载配置，并允许环境变量覆盖。
    其结构与 schemas.TopLevelApplicationConfigSchema 完全一致。
    """
    # 字段定义已由 schemas.TopLevelApplicationConfigSchema 提供。
    # 例如：
    # llm_providers: Dict[str, schemas.LLMProviderConfigSchema] = Field(default_factory=dict)
    # llm_settings: schemas.LLMSettingsConfigSchema
    # ...等等，所有字段都在 schemas.TopLevelApplicationConfigSchema 中定义。

    model_config = SettingsConfigDict(
        env_file=ENV_FILE_PATH if ENV_FILE_PATH.exists() else None,
        env_nested_delimiter='__', # 例如 LLM_PROVIDERS__OPENAI__ENABLED=true
        extra='ignore', # 忽略 .env 或环境变量中未在模型中定义的额外字段
        # 新增：如果希望从JSON文件加载配置，可以添加 json_file 设置，
        # 但这里我们通过自定义的 load_from_json 方法实现，以获得更多控制权。
        # json_file=CONFIG_FILE_PATH,
    )

    @classmethod
    def load_from_json(cls, file_path: Path) -> Dict[str, Any]:
        """从指定的JSON文件加载原始配置字典。"""
        if not file_path.exists():
            logger.error(f"关键错误：配置文件 '{file_path}' 未找到！应用可能无法正常启动。将使用默认值。")
            # 返回一个结构，使其至少能通过 Pydantic 的默认值初始化
            return {
                "application_settings": {},
                "vector_store_settings": {},
                "embedding_settings": {},
                "llm_settings": {"available_models": []}, # 确保 available_models 是列表
                "llm_providers": {},
                "analysis_chunk_settings": {},
                "local_nlp_settings": {},
                "file_storage_settings": {},
                "planning_settings": {},
                "cost_estimation_tiers": {},
                "sentiment_thresholds": {}
            }
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            logger.info(f"已从 '{file_path}' 加载原始配置数据。")
            return data
        except json.JSONDecodeError as e:
            logger.error(f"配置文件 '{file_path}' JSON格式错误: {e}。将尝试使用Pydantic模型默认值。")
            return {} # 返回空字典，让Pydantic尝试使用默认值
        except Exception as e_load:
            logger.error(f"加载配置文件 '{file_path}' 时发生未知错误: {e_load}。将尝试使用Pydantic模型默认值。")
            return {}


# --- 全局配置实例 ---
_app_config_instance: Optional[ApplicationSettingsModel] = None
_config_load_error: Optional[str] = None
_is_loading_config: bool = False # 防止并发加载


def load_config(force_reload: bool = False) -> ApplicationSettingsModel:
    """
    加载并验证应用配置。如果已加载，则返回缓存的实例，除非 force_reload 为 True。
    """
    global _app_config_instance, _config_load_error, _is_loading_config
    if _app_config_instance is not None and not force_reload:
        return _app_config_instance
    
    if _is_loading_config and not force_reload: # 如果正在加载，则等待或返回当前（可能为空的）实例
        logger.debug("配置加载已在进行中，将等待现有加载完成。")
        # 可以选择在这里等待，或者如果只是为了获取，就返回当前的（可能是旧的或None的）_app_config_instance
        # 为了简单起见，这里返回当前实例。实际应用中可能需要更复杂的同步机制。
        return _app_config_instance if _app_config_instance is not None else ApplicationSettingsModel(**ApplicationSettingsModel.load_from_json(CONFIG_FILE_PATH))


    _is_loading_config = True # 标记正在加载

    _ensure_config_dir_exists() # 确保目录存在
    raw_config_data_from_json = ApplicationSettingsModel.load_from_json(CONFIG_FILE_PATH)

    try:
        # 使用从JSON加载的数据初始化BaseSettings模型。
        # Pydantic会自动处理环境变量的覆盖（如果 .env 文件被指定且存在）。
        _app_config_instance = ApplicationSettingsModel(**raw_config_data_from_json)
        
        logger.info("应用配置已成功加载和验证。")
        _config_load_error = None

        # 初始化完成后，检查并应用环境变量到 UserDefinedLLMConfig 中的 api_key 和 base_url (如果适用)
        # 这是根据 UserDefinedLLMConfigSchema 中的 api_key_is_from_env 标志进行的。
        # [保留原有的环境变量覆盖逻辑]
        if _app_config_instance.llm_settings and _app_config_instance.llm_settings.available_models:
            for model_config in _app_config_instance.llm_settings.available_models:
                if model_config.api_key_is_from_env: # api_key_is_from_env 现在是布尔值
                    # 处理 API Key
                    if not model_config.api_key: # 仅当配置中为空时才尝试环境变量
                        provider_prefix = model_config.provider_tag.upper().replace('-', '_')
                        model_id_prefix = model_config.user_given_id.upper().replace('-', '_').replace('/', '_')
                        
                        env_var_name_specific_key = f"{provider_prefix}_{model_id_prefix}_API_KEY"
                        env_var_name_provider_key = f"{provider_prefix}_API_KEY"

                        env_key_val = os.getenv(env_var_name_specific_key)
                        if env_key_val:
                            model_config.api_key = env_key_val
                            logger.debug(f"模型 '{model_config.user_given_name}' 的 API Key 从特定环境变量 '{env_var_name_specific_key}' 加载。")
                        elif not model_config.api_key:
                            env_key_provider_level_val = os.getenv(env_var_name_provider_key)
                            if env_key_provider_level_val:
                                model_config.api_key = env_key_provider_level_val
                                logger.debug(f"模型 '{model_config.user_given_name}' 的 API Key 从通用提供商环境变量 '{env_var_name_provider_key}' 加载。")
                    
                    # 处理 Base URL
                    if not model_config.base_url: # 仅当配置中为空时才尝试环境变量
                        provider_prefix_url = model_config.provider_tag.upper().replace('-', '_')
                        model_id_prefix_url = model_config.user_given_id.upper().replace('-', '_').replace('/', '_')
                        env_var_url_specific = f"{provider_prefix_url}_{model_id_prefix_url}_BASE_URL"
                        env_var_url_provider = f"{provider_prefix_url}_BASE_URL"
                        
                        env_base_url_val = os.getenv(env_var_url_specific)
                        if env_base_url_val:
                            model_config.base_url = env_base_url_val
                            logger.debug(f"模型 '{model_config.user_given_name}' 的 Base URL 从特定环境变量 '{env_var_url_specific}' 加载。")
                        elif not model_config.base_url:
                            env_base_url_provider_level = os.getenv(env_var_url_provider)
                            if env_base_url_provider_level:
                                model_config.base_url = env_base_url_provider_level
                                logger.debug(f"模型 '{model_config.user_given_name}' 的 Base URL 从通用提供商环境变量 '{env_var_url_provider}' 加载。")
        
        _is_loading_config = False # 完成加载
        return _app_config_instance
    except ValidationError as e_val:
        _config_load_error = f"配置校验失败: {e_val}"
        logger.critical(_config_load_error, exc_info=True)
        _is_loading_config = False # 完成加载（虽然失败）
        raise ValueError(_config_load_error) from e_val
    except Exception as e_glob:
        _config_load_error = f"加载配置过程中发生未知严重错误: {e_glob}"
        logger.critical(_config_load_error, exc_info=True)
        _is_loading_config = False # 完成加载（虽然失败）
        raise RuntimeError(_config_load_error) from e_glob


def get_config() -> schemas.ApplicationConfigSchema: # 返回类型现在是 schemas.ApplicationConfigSchema
    """
    返回当前加载的配置实例 (符合 schemas.ApplicationConfigSchema)。
    如果未加载，则尝试加载。
    """
    if _app_config_instance is None:
        loaded_instance = load_config()
        # 尽管 ApplicationSettingsModel 继承自 schemas.ApplicationConfigSchema，
        # 为了类型提示的严格符合和调用方的期望，这里显式返回符合该 Schema 的实例。
        # 在 Pydantic v2 中，如果 ApplicationSettingsModel 正确继承了，直接返回 loaded_instance 即可。
        # return loaded_instance
        # 如果需要严格返回 schemas.ApplicationConfigSchema 而不是其子类 ApplicationSettingsModel 的实例
        # 可以这样做，但这通常不是必要的，因为子类实例也满足父类类型。
        # return schemas.ApplicationConfigSchema.model_validate(loaded_instance.model_dump())
        return loaded_instance # 直接返回即可，因为 ApplicationSettingsModel is-a schemas.ApplicationConfigSchema
    return _app_config_instance

# 新增：一个同步获取配置的函数，用于在异步上下文之外需要配置的地方（例如某些顶层服务初始化）
# 注意：这仍然依赖于 _app_config_instance 已经被异步的 load_config() 成功加载。
# 如果在应用启动初期、异步事件循环启动前调用，且配置尚未加载，可能会有问题。
# 更好的做法是确保所有依赖配置的服务都在异步上下文中通过 Depends(get_config_dependency) 获取。
def get_config_sync() -> schemas.ApplicationConfigSchema:
    """
    同步获取配置实例。主要用于应用启动时的非异步上下文。
    警告：此函数期望 load_config() 已经（至少一次）成功执行。
    """
    if _app_config_instance is None:
        logger.warning("get_config_sync() 被调用，但全局配置实例尚未加载。尝试同步加载。这可能在某些情况下导致问题。")
        # 尝试同步加载一次。这在主事件循环之外可能是可接受的，但在活跃的异步应用中应避免。
        try:
            return load_config()
        except Exception as e:
            logger.critical(f"get_config_sync() 尝试同步加载配置时失败: {e}")
            # 根据应用需求，这里可以抛出异常或返回一个默认的空配置
            # 为了让应用尽可能启动，这里可以返回一个基于模型默认值的配置
            # return schemas.ApplicationConfigSchema() # 返回一个使用Pydantic模型默认值的实例
            raise RuntimeError(f"无法在同步上下文中加载配置：{e}") from e

    return _app_config_instance


T = TypeVar('T')
def get_setting(path: str, default: Optional[T] = None) -> Any:
    """
    通过点分隔的路径从配置中获取特定设置。
    例如: "llm_settings.default_model_id"
    """
    config_instance = get_config() # 确保配置已加载
    keys = path.split('.')
    value: Any = config_instance # 显式声明 value 类型为 Any
    try:
        for key in keys:
            if isinstance(value, BaseModel): # 如果是Pydantic模型
                # Pydantic v2 中，访问字段直接用点号，如果属性可能不存在，先用 hasattr
                if hasattr(value, key):
                    value = getattr(value, key)
                else: # 属性不存在
                    if default is not None: return default
                    raise KeyError(f"在 Pydantic 模型 '{type(value).__name__}' 中未找到属性 '{key}' (路径: '{path}')。")
            elif isinstance(value, dict):    # 如果是普通字典
                value = value[key]
            else: # 路径无效或值不是容器
                if default is not None: return default
                raise TypeError(f"路径 '{path}' 中的 '{key}' 之前的值不是对象或字典 (类型: {type(value)})。")
        return value
    except (AttributeError, KeyError, IndexError, TypeError) as e_get_setting:
        logger.debug(f"在配置中未找到路径 '{path}' 或解析时出错 ({e_get_setting})。返回默认值: {default}")
        if default is not None:
            return default
        return None # 或者可以根据需求抛出异常


# 定义一个自定义异常，用于指示配置写入被拒绝
class ConfigWriteDenied(PermissionError):
    pass

def update_config(config_update_data: schemas.ApplicationConfigSchema) -> schemas.ApplicationConfigSchema: # 接受并返回 schemas.ApplicationConfigSchema
    """
    更新并保存配置。现在接收并验证一个完整的 ApplicationConfigSchema 对象。
    """
    global _app_config_instance, _config_load_error
    
    app_general_settings = get_setting("application_settings", {}) # 获取应用通用设置
    if not isinstance(app_general_settings, dict) or not app_general_settings.get("allow_config_writes_via_api", False):
        logger.warning("尝试通过API写入配置，但此功能已被禁用。")
        raise ConfigWriteDenied("通过API修改配置的功能已被禁用或配置项缺失。") # 使用自定义异常

    try:
        # 校验传入的数据是否符合 ApplicationConfigSchema
        # Pydantic v2 中，如果 config_update_data 本身就是 ApplicationConfigSchema 的实例，
        # 并且其字段也都是正确的 Pydantic 模型实例，那么可以直接使用。
        # 但如果它是从例如 request.body() 解析来的 dict，则需要 model_validate。
        # 为保险起见，总是进行一次 model_validate (这也会执行所有自定义校验器)。
        if isinstance(config_update_data, dict): # 如果传入的是字典
            validated_config_pydantic_model = schemas.ApplicationConfigSchema.model_validate(config_update_data)
        elif isinstance(config_update_data, schemas.ApplicationConfigSchema): # 如果已是 Pydantic 模型实例
            validated_config_pydantic_model = config_update_data
        else:
            raise TypeError("config_update_data 必须是字典或 ApplicationConfigSchema 的实例。")

        # 将 Pydantic 模型转换为适合写入 JSON 的字典
        config_dict_to_write = validated_config_pydantic_model.model_dump(mode='json')

        # [保留原有的环境变量相关的API Key和Base URL保存逻辑]
        # 在保存到文件前，处理 UserDefinedLLMConfig 中的 api_key 和 base_url
        if "llm_settings" in config_dict_to_write and \
           isinstance(config_dict_to_write["llm_settings"], dict) and \
           "available_models" in config_dict_to_write["llm_settings"] and \
           isinstance(config_dict_to_write["llm_settings"]["available_models"], list):
            
            for model_conf_dict in config_dict_to_write["llm_settings"]["available_models"]:
                if isinstance(model_conf_dict, dict) and model_conf_dict.get("api_key_is_from_env") is True:
                    # 清除 API Key
                    if "api_key" in model_conf_dict:
                        logger.debug(f"配置保存：模型 '{model_conf_dict.get('user_given_name', model_conf_dict.get('user_given_id'))}' 的 API密钥标记为来自环境变量，将从保存数据中清除密钥字段。")
                        model_conf_dict["api_key"] = None
                    # 清除 Base URL
                    if "base_url" in model_conf_dict:
                        logger.debug(f"配置保存：模型 '{model_conf_dict.get('user_given_name', model_conf_dict.get('user_given_id'))}' 的 Base URL 标记为可能来自环境变量，将从保存数据中清除URL字段。")
                        model_conf_dict["base_url"] = None
        
        _ensure_config_dir_exists()
        with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(config_dict_to_write, f, indent=4, ensure_ascii=False)
        
        # 更新内存中的配置实例，需要确保它是 ApplicationSettingsModel 类型，
        # 因为 get_config() 和 _app_config_instance 期望的是这个类型。
        _app_config_instance = ApplicationSettingsModel(**config_dict_to_write)
        _config_load_error = None
        logger.info(f"应用配置已成功保存到 '{CONFIG_FILE_PATH}' 并更新到内存。")
        return _app_config_instance # 返回更新后的实例 (类型是 ApplicationSettingsModel，但兼容 ApplicationConfigSchema)
        
    except ValidationError as e_val_save:
        _config_load_error = f"尝试保存的配置数据无效: {e_val_save}"
        logger.error(_config_load_error, exc_info=True)
        raise ValueError(f"配置数据无效: {e_val_save}") from e_val_save
    except ConfigWriteDenied: # 直接重新抛出自定义的权限错误
        raise
    except Exception as e_save:
        _config_load_error = f"保存配置时发生未知错误: {e_save}"
        logger.error(_config_load_error, exc_info=True)
        raise RuntimeError(f"保存配置失败: {e_save}") from e_save


# --- 应用启动时自动加载配置 ---
# 确保此加载逻辑在所有其他模块导入此服务之前执行
try:
    load_config()
except Exception as e:
    # 这里的日志记录很重要，因为它发生在应用最早期
    logger.critical(f"config_service.py 模块级别：首次加载配置时发生严重错误: {e}。应用可能无法按预期运行。", exc_info=True)
    # 根据应用的容错策略，这里可以决定是否重新抛出异常以终止启动，
    # 或者允许应用以（可能不完整的）默认配置启动。
    # 如果配置是应用运行的绝对前提，则应该抛出：
    # raise RuntimeError(f"关键配置加载失败，应用无法启动: {e}") from e