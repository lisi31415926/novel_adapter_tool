// frontend-react/src/services/api.ts
import axios, { AxiosError, AxiosInstance, AxiosProgressEvent } from 'axios';
import { toast } from 'react-toastify';

/**
 * =================================================================================
 * 类型定义 (Type Definitions)
 *
 * 重要提示：以下所有类型定义依赖于 openapi-typescript 自动生成的文件 `api-generated-types.ts`。
 * 请运行 `npm run generate-types` 生成类型文件，确保与后端 OpenAPI 规范同步。
 * 补充了前端专用类型（如 CharacterGraphNode、CharacterGraphEdge）以支持特定 UI 需求。
 * =================================================================================
 */

// 1. 导入由 openapi-typescript 生成的核心类型
import type { paths, components } from './api-generated-types';

// 2. 创建一个方便访问所有 Schema 的别名
type Schemas = components['schemas'];

// --- 核心实体类型 (Core Entity Types) ---
export type Novel = Schemas['NovelRead'];
export type NovelCreate = Schemas['NovelCreate'];
export type NovelUpdate = Schemas['NovelUpdate'];
export type NovelUploadResponse = Schemas['NovelUploadResponse'];

export type Chapter = Schemas['ChapterRead'];
export type ChapterCreateForNovelPayload = Schemas['ChapterCreateForNovel'];
export type ChapterCreateForVersionPayload = Schemas['ChapterCreateForVersion'];
export type ChapterUpdate = Schemas['ChapterUpdate'];
export type ChapterReorderRequest = Schemas['ChapterReorderRequest'];

export type Character = Schemas['CharacterRead'];
export type CharacterCreate = Schemas['CharacterCreate'];
export type CharacterUpdate = Schemas['CharacterUpdate'];

export type Event = Schemas['EventRead'];
export type EventCreate = Schemas['EventCreate'];
export type EventUpdate = Schemas['EventUpdate'];
export type EventRelationship = Schemas['EventRelationshipRead'];

export type Conflict = Schemas['ConflictRead'];
export type ConflictCreate = Schemas['ConflictCreate'];
export type ConflictUpdate = Schemas['ConflictUpdate'];

export type CharacterRelationship = Schemas['CharacterRelationshipRead'];
export type CharacterRelationshipCreate = Schemas['CharacterRelationshipCreate'];
export type CharacterRelationshipUpdate = Schemas['CharacterRelationshipUpdate'];

export type PlotBranch = Schemas['PlotBranchReadWithVersions'];
export type PlotBranchCreate = Schemas['PlotBranchCreate'];
export type PlotBranchUpdate = Schemas['PlotBranchUpdate'];

export type PlotVersion = Schemas['PlotVersionRead'];
export type PlotVersionCreate = Schemas['PlotVersionCreate'];
export type PlotVersionUpdate = Schemas['PlotVersionUpdate'];

export type RuleTemplate = Schemas['RuleTemplateRead'];
export type RuleTemplateCreate = Schemas['RuleTemplateCreate'];
export type RuleTemplateUpdate = Schemas['RuleTemplateUpdate'];

export type RuleStepPublic = Schemas['RuleStepRead'];
export type RuleStepCreatePrivate = Schemas['RuleStepCreatePrivate'];
export type RuleTemplateReferenceCreate = Schemas['RuleTemplateReferenceCreate'];
export type ChainStepCreateItem = Schemas['ChainStepCreateItem'];
export type RuleChainRuleTemplateAssociation = Schemas['RuleChainRuleTemplateAssociationRead'];

export type RuleChain = Schemas['RuleChainReadWithSteps'];
export type RuleChainCreate = Schemas['RuleChainCreate'];
export type RuleChainUpdate = Schemas['RuleChainUpdate'];

// --- 枚举类型 (Enums) ---
export type NovelAnalysisStatusEnum = Schemas['NovelAnalysisStatusEnum'];
export type NovelVectorizationStatusEnum = Schemas['NovelVectorizationStatusEnum'];
export type PredefinedTaskEnum = Schemas['PredefinedTaskEnum'];
export type PostProcessingRuleEnum = Schemas['PostProcessingRuleEnum'];
export type SentimentConstraintEnum = Schemas['SentimentConstraintEnum'];
export type OutputFormatConstraintEnum = Schemas['OutputFormatConstraintEnum'];
export type RelationshipTypeEnum = Schemas['RelationshipTypeEnum'];
export type RelationshipStatusEnum = Schemas['RelationshipStatusEnum'];
export type ConflictLevelEnum = Schemas['ConflictLevelEnum'];
export type ConflictStatusEnum = Schemas['ConflictStatusEnum'];
export type EventRelationshipTypeEnum = Schemas['EventRelationshipTypeEnum'];
export type PlotBranchTypeEnum = Schemas['PlotBranchTypeEnum'];
export type PlotVersionStatusEnum = Schemas['PlotVersionStatusEnum'];
export type StepInputSourceEnum = Schemas['StepInputSourceEnum'];
export type TokenCostLevelEnum = Schemas['TokenCostLevelEnum'];
export type SortDirectionEnum = Schemas['SortDirectionEnum'];
export type ParameterTypeEnum = Schemas['ParameterTypeEnumFE'];

// --- 其他辅助和配置类型 (Other Helper & Config Types) ---
export type RuleStepParameterDefinition = Schemas['RuleStepParameterDefinition'];
export type GenerationConstraintsSchema = Schemas['GenerationConstraintsSchema'];
export type InvolvedEntity = Schemas['InvolvedEntity'];
export type DynamicChange = Schemas['DynamicChange'];

export type ApplicationConfig = Schemas['ApplicationConfigSchema'];
export type LLMProviderConfig = Schemas['LLMProviderConfigSchema'];
export type UserDefinedLLMConfig = Schemas['UserDefinedLLMConfigSchema'];
export type LLMSettingsConfig = Schemas['LLMSettingsConfigSchema'];
export type VectorStoreSettingsConfig = Schemas['VectorStoreSettingsConfigSchema'];
export type VectorStoreTypeEnum = Schemas['VectorStoreTypeEnumFE'];
export type EmbeddingServiceSettingsConfig = Schemas['EmbeddingServiceSettingsConfigSchema'];
export type AnalysisChunkSettingsConfig = Schemas['AnalysisChunkSettingsConfigSchema'];
export type LocalNLPDeviceEnum = Schemas['LocalNLPDeviceEnumFE'];
export type LocalNLPSentenceSplitterModelEnum = Schemas['LocalNLPSentenceSplitterModelEnumFE'];
export type LocalNLPSentimentModelEnum = Schemas['LocalNLPSentimentModelEnumFE'];
export type LocalNLPSettingsConfig = Schemas['LocalNLPSettingsConfigSchema'];
export type FileStorageSettingsConfig = Schemas['FileStorageSettingsConfigSchema'];
export type ApplicationGeneralSettingsConfig = Schemas['ApplicationGeneralSettingsConfigSchema'];
export type PlanningServiceSettingsConfig = Schemas['PlanningServiceSettingsConfigSchema'];
export type TokenCostInfo = Schemas['TokenCostInfoSchema'];
export type CostEstimationTiers = Schemas['CostEstimationTiersSchema'];
export type SentimentThresholds = Schemas['SentimentThresholdsSchema'];
export type ConfigUpdateResponse = Schemas['ConfigUpdateResponse'];
export type LLMProviderTestRequest = Schemas['LLMProviderTestRequest'];
export type LLMProviderTestResponse = Schemas['LLMProviderTestResponse'];

// --- API 交互特定模型 (API Interaction Specific Models) ---
export type StepExecutionStatusEnumFE = Schemas['StepExecutionStatusEnumFE'];
export type StepExecutionResult = Schemas['StepExecutionResult'];
export type StreamChunkActualData = Schemas['StreamChunkActualData'];
export type StreamChunk = Schemas['StreamChunk'];
export type RuleChainExecuteRequest = Schemas['RuleChainExecuteRequest'];
export type RuleChainExecuteResponse = Schemas['RuleChainExecuteResponse'];
export type RuleChainStepCostEstimate = Schemas['RuleChainStepCostEstimate'];
export type RuleChainDryRunResponse = Schemas['RuleChainDryRunResponse'];
export type TextProcessRequest = Schemas['TextProcessRequest'];
export type TextProcessResponse = Schemas['TextProcessResponse'];
export type SimilaritySearchQuery = Schemas['SimilaritySearchQuery'];
export type SimilaritySearchResultItem = Schemas['SimilaritySearchResultItem'];
export type SimilaritySearchResponse = Schemas['SimilaritySearchResponse'];
export type RAGGenerateRequest = Schemas['RAGGenerateRequest'];
export type RAGGenerateResponse = Schemas['RAGGenerateResponse'];
export type AdaptationGoalRequest = Schemas['AdaptationGoalRequest'];
export type ParsedAdaptationGoal = Schemas['ParsedAdaptationGoal'];
export type RecommendedRuleChainItem = Schemas['RecommendedRuleChainItem'];
export type AdaptationPlanResponse = Schemas['AdaptationPlanResponse'];
export type AISuggestionRequest = Schemas['AISuggestionRequest'];
export type NovelAnalysisStatusInfo = Schemas['NovelAnalysisStatusInfo'];
export type VectorStoreStatusResponse = Schemas['VectorStoreStatusResponse'];
export type PredefinedTaskMeta = Schemas['PredefinedTaskMeta'];
export type PredefinedTaskUIItem = Schemas['PredefinedTaskUIItem'];
export type ReferableFileItem = Schemas['ReferableFileItem'];
export type PaginatedResponse<T> = Schemas['PaginatedResponse'] & { items: T[] };
export type HTTPValidationError = Schemas['HTTPValidationError'];

// --- 前端专用类型 (Frontend-Specific Types) ---
// 补充旧版中用于关系图展示的类型，假设 OpenAPI 规范未定义
export interface CharacterGraphNode {
    id: number;
    label: string;
    title?: string;
    group?: string;
    value?: number;
    level?: number;
    hidden?: boolean;
    shape?: string;
    image?: string;
    color?: string | { border: string; background: string };
}
export interface CharacterGraphEdge {
    id: string;
    from: number;
    to: number;
    label?: string;
    title?: string;
    arrows?: string;
    dashes?: boolean;
    color?: string | { color?: string; highlight?: string; hover?: string };
}
export interface CharacterRelationshipGraph {
    nodes: CharacterGraphNode[];
    edges: CharacterGraphEdge[];
}

// --- 命名实体类型 (Named Entity Types) ---
export type NamedEntity = Schemas['NamedEntityRead'];
export type NamedEntityCreate = Schemas['NamedEntityCreate'];

/**
 * =================================================================================
 * API 服务实现 (API Service Implementation)
 *
 * 所有函数签名使用 OpenAPI 生成的类型，确保与后端一致。
 * 恢复了旧版中缺失的功能（如 getCharacterRelationshipGraphData、createNamedEntity）。
 * 增强了流式处理的健壮性，支持非 JSON 数据块。
 * 保留中文错误信息和 toast 通知，保持用户友好性。
 * =================================================================================
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const apiClient: AxiosInstance = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

interface ApiErrorDetailItem {
    loc?: (string | number)[];
    msg: string;
    type?: string;
}

interface ApiErrorResponse {
    detail?: string | ApiErrorDetailItem[] | HTTPValidationError;
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
                        .map((err: ApiErrorDetailItem) => `${err.loc ? err.loc.join(' -> ') + ': ' : ''}${err.msg}`)
                        .join('\n');
                } else if ('detail' in errorData && Array.isArray((errorData as HTTPValidationError).detail)) {
                    errorMessage = (errorData as HTTPValidationError).detail
                        .map((err: ApiErrorDetailItem) => `${err.loc ? err.loc.join(' -> ') + ': ' : ''}${err.msg}`)
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

// --- Configuration ---

export const getApplicationConfig = async (): Promise<ApplicationConfig> => {
    try {
        const response = await apiClient.get<ApplicationConfig>('/configuration/');
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '获取应用配置失败。'));
    }
};

export const updateApplicationConfig = async (configData: ApplicationConfig): Promise<ConfigUpdateResponse> => {
    try {
        const response = await apiClient.put<ConfigUpdateResponse>('/configuration/', configData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '更新应用配置失败。'));
    }
};

export const getLLMProviderTags = async (): Promise<string[]> => {
    try {
        const response = await apiClient.get<string[]>('/configuration/llm-provider-tags');
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '获取LLM供应商标签失败。'));
    }
};

export const testLLMProvider = async (testData: LLMProviderTestRequest): Promise<LLMProviderTestResponse> => {
    try {
        const response = await apiClient.post<LLMProviderTestResponse>('/configuration/test-llm-provider', testData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '测试LLM供应商失败。'));
    }
};

// --- Novels ---

type GetNovelsQueryParams = paths['/api/v1/novels/']['get']['parameters']['query'];
export const getNovels = async (params?: GetNovelsQueryParams): Promise<PaginatedResponse<Novel>> => {
    try {
        const response = await apiClient.get<PaginatedResponse<Novel>>('/novels/', { params });
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '获取小说列表失败。'));
    }
};

export const getNovelById = async (novelId: number): Promise<Novel> => {
    try {
        const response = await apiClient.get<Novel>(`/novels/${novelId}`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 失败。`));
    }
};

export const updateNovel = async (novelId: number, novelData: NovelUpdate): Promise<Novel> => {
    try {
        const response = await apiClient.put<Novel>(`/novels/${novelId}`, novelData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `更新小说 #${novelId} 失败。`));
    }
};

export const deleteNovel = async (novelId: number): Promise<void> => {
    try {
        await apiClient.delete(`/novels/${novelId}`);
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `删除小说 #${novelId} 失败。`));
    }
};

export const uploadNovelFile = async (
    formData: FormData,
    onUploadProgress?: (progressEvent: AxiosProgressEvent) => void
): Promise<NovelUploadResponse> => {
    try {
        const response = await apiClient.post<NovelUploadResponse>('/novels/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress,
        });
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '上传小说文件失败。'));
    }
};

export const createNovelEntry = async (novelData: NovelCreate): Promise<Novel> => {
    try {
        const response = await apiClient.post<Novel>('/novels/', novelData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '创建小说条目失败。'));
    }
};

export const startNovelAnalysis = async (novelId: number): Promise<NovelAnalysisStatusInfo> => {
    try {
        const response = await apiClient.post<NovelAnalysisStatusInfo>(`/novels/${novelId}/analyze`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `开始小说 #${novelId} 的分析失败。`));
    }
};

export const getNovelAnalysisStatusSummary = async (novelId: number): Promise<NovelAnalysisStatusInfo> => {
    try {
        const response = await apiClient.get<NovelAnalysisStatusInfo>(`/novels/${novelId}/analysis-status`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的分析状态失败。`));
    }
};

// --- Chapters ---

export interface GetChaptersParams {
    plot_version_id?: number | 'UNASSIGNED' | string | null;
    is_mainline?: boolean | null;
    page?: number;
    page_size?: number;
    sort_by?: string;
    sort_direction?: SortDirectionEnum;
}
export const getChaptersByNovelId = async (novelId: number, params?: GetChaptersParams): Promise<PaginatedResponse<Chapter>> => {
    try {
        const response = await apiClient.get<PaginatedResponse<Chapter>>(`/novels/${novelId}/chapters/`, { params });
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的章节列表失败。`));
    }
};

export const createChapterForNovel = async (novelId: number, chapterData: ChapterCreateForNovelPayload): Promise<Chapter> => {
    try {
        const response = await apiClient.post<Chapter>(`/novels/${novelId}/chapters/`, chapterData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建章节失败。`));
    }
};

export const createChapterForPlotVersion = async (
    novelId: number,
    branchId: number,
    versionId: number,
    chapterData: ChapterCreateForVersionPayload
): Promise<Chapter> => {
    try {
        const response = await apiClient.post<Chapter>(
            `/novels/${novelId}/plot-branches/${branchId}/versions/${versionId}/chapters/`,
            chapterData
        );
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `为剧情版本 #${versionId} 创建章节失败。`));
    }
};

export const getChapterById = async (chapterId: number): Promise<Chapter> => {
    try {
        const response = await apiClient.get<Chapter>(`/chapters/${chapterId}`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取章节 #${chapterId} 失败。`));
    }
};

export const updateChapter = async (chapterId: number, chapterData: ChapterUpdate): Promise<Chapter> => {
    try {
        const response = await apiClient.put<Chapter>(`/chapters/${chapterId}`, chapterData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `更新章节 #${chapterId} 失败。`));
    }
};

export const deleteChapter = async (chapterId: number): Promise<void> => {
    try {
        await apiClient.delete(`/chapters/${chapterId}`);
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `删除章节 #${chapterId} 失败。`));
    }
};

export const reorderChaptersInVersion = async (
    novelId: number,
    branchId: number,
    versionId: number,
    reorderRequest: ChapterReorderRequest
): Promise<Chapter[]> => {
    try {
        const response = await apiClient.post<Chapter[]>(
            `/novels/${novelId}/plot-branches/${branchId}/versions/${versionId}/chapters/reorder`,
            reorderRequest
        );
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `为剧情版本 #${versionId} 重排章节顺序失败。`));
    }
};

// --- Characters ---

export interface GetCharactersParams {
    name?: string;
    role_type?: string;
    sort_by?: string;
    sort_dir?: SortDirectionEnum;
    page?: number;
    page_size?: number;
}
export const getCharactersByNovelId = async (novelId: number, params?: GetCharactersParams): Promise<PaginatedResponse<Character>> => {
    try {
        const response = await apiClient.get<PaginatedResponse<Character>>(`/novels/${novelId}/characters/`, { params });
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的角色列表失败。`));
    }
};

export const createCharacter = async (novelId: number, characterData: CharacterCreate): Promise<Character> => {
    try {
        const response = await apiClient.post<Character>(`/novels/${novelId}/characters/`, characterData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建角色失败。`));
    }
};

export const getCharacterById = async (novelId: number, characterId: number): Promise<Character> => {
    try {
        const response = await apiClient.get<Character>(`/novels/${novelId}/characters/${characterId}`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取角色 #${characterId} 失败。`));
    }
};

export const updateCharacter = async (novelId: number, characterId: number, characterData: CharacterUpdate): Promise<Character> => {
    try {
        const response = await apiClient.put<Character>(`/novels/${novelId}/characters/${characterId}`, characterData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `更新角色 #${characterId} 失败。`));
    }
};

export const deleteCharacter = async (novelId: number, characterId: number): Promise<void> => {
    try {
        await apiClient.delete(`/novels/${novelId}/characters/${characterId}`);
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `删除角色 #${characterId} 失败。`));
    }
};

// --- Events ---

export interface GetEventsParams {
    summary?: string;
    event_types?: string;
    importance_level?: number | null;
    plot_version_id?: number | 'UNASSIGNED' | string | null;
    start_timestamp?: string | null;
    end_timestamp?: string | null;
    event_order_min?: number | null;
    event_order_max?: number | null;
    significance_min?: number | null;
    significance_max?: number | null;
    sort_by?: string;
    sort_dir?: SortDirectionEnum;
    page?: number;
    page_size?: number;
}
export const getEventsByNovelId = async (novelId: number, params?: GetEventsParams): Promise<PaginatedResponse<Event>> => {
    try {
        const response = await apiClient.get<PaginatedResponse<Event>>(`/novels/${novelId}/events/`, { params });
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的事件列表失败。`));
    }
};

export const createEvent = async (novelId: number, eventData: EventCreate): Promise<Event> => {
    try {
        const response = await apiClient.post<Event>(`/novels/${novelId}/events/`, eventData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建事件失败。`));
    }
};

export const getEventById = async (novelId: number, eventId: number): Promise<Event> => {
    try {
        const response = await apiClient.get<Event>(`/novels/${novelId}/events/${eventId}`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取事件 #${eventId} 失败。`));
    }
};

export const updateEvent = async (novelId: number, eventId: number, eventData: EventUpdate): Promise<Event> => {
    try {
        const response = await apiClient.put<Event>(`/novels/${novelId}/events/${eventId}`, eventData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `更新事件 #${eventId} 失败。`));
    }
};

export const deleteEvent = async (novelId: number, eventId: number): Promise<void> => {
    try {
        await apiClient.delete(`/novels/${novelId}/events/${eventId}`);
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `删除事件 #${eventId} 失败。`));
    }
};

export const getAllEventRelationshipsByNovelId = async (novelId: number): Promise<PaginatedResponse<EventRelationship>> => {
    try {
        const response = await apiClient.get<PaginatedResponse<EventRelationship>>(`/novels/${novelId}/event-relationships/`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的事件关系列表失败。`));
    }
};

// --- Conflicts ---

export interface GetConflictsParams {
    description?: string;
    level?: ConflictLevelEnum | string | null;
    status?: ConflictStatusEnum | string | null;
    plot_version_id?: number | 'UNASSIGNED' | string | null;
    character_id?: number | null;
    event_id?: number | null;
    sort_by?: string;
    sort_dir?: SortDirectionEnum;
    page?: number;
    page_size?: number;
}
export const getConflictsByNovelId = async (novelId: number, params?: GetConflictsParams): Promise<PaginatedResponse<Conflict>> => {
    try {
        const response = await apiClient.get<PaginatedResponse<Conflict>>(`/novels/${novelId}/conflicts/`, { params });
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的冲突列表失败。`));
    }
};

export const createConflict = async (novelId: number, conflictData: ConflictCreate): Promise<Conflict> => {
    try {
        const response = await apiClient.post<Conflict>(`/novels/${novelId}/conflicts/`, conflictData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建冲突失败。`));
    }
};

export const getConflictById = async (novelId: number, conflictId: number): Promise<Conflict> => {
    try {
        const response = await apiClient.get<Conflict>(`/novels/${novelId}/conflicts/${conflictId}`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取冲突 #${conflictId} 失败。`));
    }
};

export const updateConflict = async (novelId: number, conflictId: number, conflictData: ConflictUpdate): Promise<Conflict> => {
    try {
        const response = await apiClient.put<Conflict>(`/novels/${novelId}/conflicts/${conflictId}`, conflictData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `更新冲突 #${conflictId} 失败。`));
    }
};

export const deleteConflict = async (novelId: number, conflictId: number): Promise<void> => {
    try {
        await apiClient.delete(`/novels/${novelId}/conflicts/${conflictId}`);
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `删除冲突 #${conflictId} 失败。`));
    }
};

// --- Character Relationships ---

export interface GetCharacterRelationshipsParams {
    character_id?: number | null;
    relationship_type?: RelationshipTypeEnum | string | null;
    status?: RelationshipStatusEnum | string | null;
    plot_version_id?: number | 'UNASSIGNED' | string | null;
    page?: number;
    page_size?: number;
}
export const getCharacterRelationshipsByNovelId = async (
    novelId: number,
    params?: GetCharacterRelationshipsParams
): Promise<PaginatedResponse<CharacterRelationship>> => {
    try {
        const response = await apiClient.get<PaginatedResponse<CharacterRelationship>>(
            `/novels/${novelId}/character-relationships/`,
            { params }
        );
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的人物关系列表失败。`));
    }
};

export const createCharacterRelationship = async (
    novelId: number,
    relData: CharacterRelationshipCreate
): Promise<CharacterRelationship> => {
    try {
        const response = await apiClient.post<CharacterRelationship>(`/novels/${novelId}/character-relationships/`, relData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建人物关系失败。`));
    }
};

export const getCharacterRelationshipById = async (
    novelId: number,
    relationshipId: number
): Promise<CharacterRelationship> => {
    try {
        const response = await apiClient.get<CharacterRelationship>(
            `/novels/${novelId}/character-relationships/${relationshipId}`
        );
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取人物关系 #${relationshipId} 失败。`));
    }
};

export const updateCharacterRelationship = async (
    novelId: number,
    relationshipId: number,
    relData: CharacterRelationshipUpdate
): Promise<CharacterRelationship> => {
    try {
        const response = await apiClient.put<CharacterRelationship>(
            `/novels/${novelId}/character-relationships/${relationshipId}`,
            relData
        );
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `更新人物关系 #${relationshipId} 失败。`));
    }
};

export const deleteCharacterRelationship = async (novelId: number, relationshipId: number): Promise<void> => {
    try {
        await apiClient.delete(`/novels/${novelId}/character-relationships/${relationshipId}`);
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `删除人物关系 #${relationshipId} 失败。`));
    }
};

export const getCharacterRelationshipGraphData = async (
    novelId: number,
    plotVersionId?: number
): Promise<CharacterRelationshipGraph> => {
    try {
        const params: Record<string, any> = {};
        if (plotVersionId !== undefined) params.plot_version_id = plotVersionId;
        const response = await apiClient.get<CharacterRelationshipGraph>(
            `/novels/${novelId}/character-relationships/graph`,
            { params }
        );
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的角色关系图数据失败。`));
    }
};

// --- Plot Branches ---

export interface GetPlotBranchesParams {
    page?: number;
    page_size?: number;
}
export const getPlotBranchesByNovelId = async (
    novelId: number,
    params?: GetPlotBranchesParams
): Promise<PaginatedResponse<PlotBranch>> => {
    try {
        const response = await apiClient.get<PaginatedResponse<PlotBranch>>(`/novels/${novelId}/plot-branches/`, {
            params,
        });
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的情节分支失败。`));
    }
};

export const createPlotBranch = async (novelId: number, branchData: PlotBranchCreate): Promise<PlotBranch> => {
    try {
        const response = await apiClient.post<PlotBranch>(`/novels/${novelId}/plot-branches/`, branchData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建情节分支失败。`));
    }
};

export const getPlotBranchById = async (novelId: number, plotBranchId: number): Promise<PlotBranch> => {
    try {
        const response = await apiClient.get<PlotBranch>(`/novels/${novelId}/plot-branches/${plotBranchId}`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取情节分支 #${plotBranchId} 失败。`));
    }
};

export const updatePlotBranch = async (
    novelId: number,
    plotBranchId: number,
    data: PlotBranchUpdate
): Promise<PlotBranch> => {
    try {
        const response = await apiClient.put<PlotBranch>(`/novels/${novelId}/plot-branches/${plotBranchId}`, data);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `更新情节分支 #${plotBranchId} 失败。`));
    }
};

export const deletePlotBranch = async (novelId: number, plotBranchId: number): Promise<void> => {
    try {
        await apiClient.delete(`/novels/${novelId}/plot-branches/${plotBranchId}`);
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `删除情节分支 #${plotBranchId} 失败。`));
    }
};

// --- Plot Versions ---

export interface GetPlotVersionsParams {
    page?: number;
    page_size?: number;
}
export const getPlotVersionsByBranchId = async (
    novelId: number,
    branchId: number,
    params?: GetPlotVersionsParams
): Promise<PaginatedResponse<PlotVersion>> => {
    try {
        const response = await apiClient.get<PaginatedResponse<PlotVersion>>(
            `/novels/${novelId}/plot-branches/${branchId}/versions/`,
            { params }
        );
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取分支 #${branchId} 的情节版本失败。`));
    }
};

export const createPlotVersion = async (
    novelId: number,
    branchId: number,
    plotVersionData: PlotVersionCreate
): Promise<PlotVersion> => {
    try {
        const response = await apiClient.post<PlotVersion>(
            `/novels/${novelId}/plot-branches/${branchId}/versions/`,
            plotVersionData
        );
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `为分支 #${branchId} 创建情节版本失败。`));
    }
};

export const getPlotVersionById = async (novelId: number, branchId: number, versionId: number): Promise<PlotVersion> => {
    try {
        const response = await apiClient.get<PlotVersion>(
            `/novels/${novelId}/plot-branches/${branchId}/versions/${versionId}`
        );
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取情节版本 #${versionId} 失败。`));
    }
};

export const updatePlotVersion = async (
    novelId: number,
    branchId: number,
    versionId: number,
    data: PlotVersionUpdate
): Promise<PlotVersion> => {
    try {
        const response = await apiClient.put<PlotVersion>(
            `/novels/${novelId}/plot-branches/${branchId}/versions/${versionId}`,
            data
        );
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `更新情节版本 #${versionId} 失败。`));
    }
};

export const deletePlotVersion = async (novelId: number, branchId: number, versionId: number): Promise<void> => {
    try {
        await apiClient.delete(`/novels/${novelId}/plot-branches/${branchId}/versions/${versionId}`);
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `删除情节版本 #${versionId} 失败。`));
    }
};

export const generateAISuggestedPlotVersion = async (
    novelId: number,
    branchId: number,
    reqData: AISuggestionRequest
): Promise<PlotVersion> => {
    try {
        const response = await apiClient.post<PlotVersion>(
            `/novels/${novelId}/plot-branches/${branchId}/versions/ai-suggest`,
            reqData
        );
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `为分支 #${branchId} 生成AI建议的情节版本失败。`));
    }
};

// --- Novel Worldview Settings ---

export const updateNovelWorldviewSettings = async (
    novelId: number,
    worldviewData: Record<string, unknown>
): Promise<Novel> => {
    try {
        const response = await apiClient.put<Novel>(`/novels/${novelId}/worldview`, worldviewData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `更新小说 #${novelId} 的世界观设定失败。`));
    }
};

export const getNovelWorldviewSettings = async (novelId: number): Promise<Record<string, unknown> | null> => {
    try {
        const response = await apiClient.get<Record<string, unknown> | null>(`/novels/${novelId}/worldview`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的世界观设定失败。`));
    }
};

export const getNovelWorldviewKeysByNovelId = async (novelId: number): Promise<string[]> => {
    try {
        const response = await apiClient.get<string[]>(`/novels/${novelId}/worldview/keys`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取小说 #${novelId} 的世界观键列表失败。`));
    }
};

// --- Named Entities ---

export const createNamedEntity = async (novelId: number, data: NamedEntityCreate): Promise<NamedEntity> => {
    try {
        const response = await apiClient.post<NamedEntity>(`/novels/${novelId}/named-entities/`, data);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 创建命名实体失败。`));
    }
};

// --- Rule Chains ---

export interface GetRuleChainsParams {
    page?: number;
    page_size?: number;
    is_template?: boolean;
    novel_id?: number;
}
export const getRuleChains = async (params?: GetRuleChainsParams): Promise<PaginatedResponse<RuleChain>> => {
    try {
        const response = await apiClient.get<PaginatedResponse<RuleChain>>('/rule-chains/', { params });
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '获取规则链列表失败。'));
    }
};

export const getRuleChainById = async (id: number): Promise<RuleChain> => {
    try {
        const response = await apiClient.get<RuleChain>(`/rule-chains/${id}`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取规则链 #${id} 失败。`));
    }
};

export const createRuleChain = async (data: RuleChainCreate): Promise<RuleChain> => {
    try {
        const response = await apiClient.post<RuleChain>('/rule-chains/', data);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '创建规则链失败。'));
    }
};

export const updateRuleChain = async (id: number, data: RuleChainUpdate): Promise<RuleChain> => {
    try {
        const response = await apiClient.put<RuleChain>(`/rule-chains/${id}`, data);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `更新规则链 #${id} 失败。`));
    }
};

export const deleteRuleChain = async (id: number): Promise<void> => {
    try {
        await apiClient.delete(`/rule-chains/${id}`);
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `删除规则链 #${id} 失败。`));
    }
};

export const batchExecuteChains = async (novelId: number, chainIds: number[]): Promise<{ message: string; job_ids: string[] }> => {
    try {
        const response = await apiClient.post<{ message: string; job_ids: string[] }>('/rule-chains/batch-execute', {
            novel_id: novelId,
            chain_ids: chainIds,
        });
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '批量执行规则链失败。'));
    }
};

// --- Rule Templates ---

export interface GetRuleTemplatesParams {
    page?: number;
    page_size?: number;
}
export const getRuleTemplates = async (params?: GetRuleTemplatesParams): Promise<PaginatedResponse<RuleTemplate>> => {
    try {
        const response = await apiClient.get<PaginatedResponse<RuleTemplate>>('/rule-templates/', { params });
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '获取规则模板列表失败。'));
    }
};

export const getRuleTemplate = async (id: number): Promise<RuleTemplate> => {
    try {
        const response = await apiClient.get<RuleTemplate>(`/rule-templates/${id}`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `获取规则模板 #${id} 失败。`));
    }
};

export const createRuleTemplate = async (template: RuleTemplateCreate): Promise<RuleTemplate> => {
    try {
        const response = await apiClient.post<RuleTemplate>('/rule-templates/', template);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '创建规则模板失败。'));
    }
};

export const updateRuleTemplate = async (id: number, template: RuleTemplateUpdate): Promise<RuleTemplate> => {
    try {
        const response = await apiClient.put<RuleTemplate>(`/rule-templates/${id}`, template);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `更新规则模板 #${id} 失败。`));
    }
};

export const deleteRuleTemplate = async (id: number): Promise<void> => {
    try {
        await apiClient.delete(`/rule-templates/${id}`);
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `删除规则模板 #${id} 失败。`));
    }
};

// --- Text Processing & LLM Utils ---

export const directLLMCompletion = async (requestData: {
    prompt: string;
    system_prompt?: string | null;
    model_id?: string | null;
    llm_parameters?: Record<string, unknown> | null;
}): Promise<TextProcessResponse> => {
    try {
        const response = await apiClient.post<TextProcessResponse>('/utils/direct-completion', requestData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '直接LLM调用失败。'));
    }
};

export const processTextWithLLM = async (requestData: TextProcessRequest): Promise<TextProcessResponse> => {
    try {
        const response = await apiClient.post<TextProcessResponse>('/text-processing/process', requestData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '使用预定义任务处理文本失败。'));
    }
};

export const executeRuleChain = async (
    requestData: RuleChainExecuteRequest
): Promise<RuleChainExecuteResponse | RuleChainDryRunResponse> => {
    try {
        const endpoint = requestData.dry_run ? '/rule-chains/dry-run' : '/rule-chains/execute';
        if (requestData.stream && !requestData.dry_run) {
            throw new Error('对于流式执行，请使用 executeRuleChainAndStream 函数。');
        }
        const response = await apiClient.post<RuleChainExecuteResponse | RuleChainDryRunResponse>(endpoint, requestData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '执行规则链失败。'));
    }
};

export async function executeRuleChainAndStream(
    payload: RuleChainExecuteRequest,
    onChunk: (data: StreamChunk) => void,
    onError: (error: Error) => void,
    onComplete: () => void
) {
    // Ensure stream is true
    const fullPayload: RuleChainExecuteRequest = { ...payload, stream: true };
    try {
        const response = await fetch(`${API_BASE_URL}/rule-chains/execute-stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
            },
            body: JSON.stringify(fullPayload),
        });

        if (!response.ok || !response.body) {
            let errorData;
            try {
                errorData = await response.json();
            } catch {
                errorData = { detail: `流式请求失败，状态码: ${response.status} ${response.statusText}` };
            }
            const errorMessage = handleError(errorData as AxiosError<ApiErrorResponse>, `流式请求失败，状态码: ${response.status}`);
            onError(new Error(errorMessage));
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let eolIndex;
            while ((eolIndex = buffer.indexOf('\n\n')) >= 0) {
                const eventString = buffer.slice(0, eolIndex).trim();
                buffer = buffer.slice(eolIndex + 2);
                if (eventString) {
                    const lines = eventString.split('\n');
                    const eventData: Partial<StreamChunk> = {};
                    lines.forEach(line => {
                        if (line.startsWith('event:')) {
                            eventData.type = line.substring(6).trim();
                        } else if (line.startsWith('data:')) {
                            try {
                                eventData.data = JSON.parse(line.substring(5).trim());
                            } catch (e) {
                                // 恢复旧版的回退逻辑，处理非 JSON 数据
                                eventData.data = line.substring(5).trim();
                                console.warn('无法解析流式数据块为 JSON，存储为字符串:', eventData.data);
                            }
                        }
                    });
                    if (eventData.type && eventData.data !== undefined) {
                        onChunk(eventData as StreamChunk);
                    } else if (eventData.data) {
                        onChunk({ type: 'message', data: eventData.data } as StreamChunk);
                    }
                }
            }
        }

        // 处理剩余的缓冲区内容（如果有）
        if (buffer.trim()) {
            try {
                const parsed = JSON.parse(buffer.trim());
                onChunk({ type: 'message', data: parsed } as StreamChunk);
            } catch (e) {
                onChunk({ type: 'message', data: buffer.trim() } as StreamChunk);
                console.warn('无法解析剩余缓冲区数据为 JSON，存储为字符串:', buffer.trim());
            }
        }
    } catch (error) {
        const errorMessage = handleError(error as AxiosError, '流式执行规则链时发生连接或请求错误。');
        onError(new Error(errorMessage));
    } finally {
        onComplete();
    }
}

// --- Planning Service ---

export const parseAdaptationGoal = async (requestData: AdaptationGoalRequest): Promise<AdaptationPlanResponse> => {
    try {
        const response = await apiClient.post<AdaptationPlanResponse>('/planning/parse-goal', requestData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '解析改编目标失败。'));
    }
};

export const generateRuleChainDraft = async (requestData: AdaptationGoalRequest): Promise<AdaptationPlanResponse> => {
    try {
        const response = await apiClient.post<AdaptationPlanResponse>('/planning/generate-draft', requestData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '生成规则链草稿失败。'));
    }
};

// --- Vector Store & RAG ---

export const getVectorStoreStatus = async (): Promise<VectorStoreStatusResponse> => {
    try {
        const response = await apiClient.get<VectorStoreStatusResponse>('/vector-store/status');
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '获取向量存储状态失败。'));
    }
};

export const searchSimilarChunksInNovel = async (
    novelId: number,
    requestData: SimilaritySearchQuery
): Promise<SimilaritySearchResponse> => {
    try {
        const response = await apiClient.post<SimilaritySearchResponse>(`/novels/${novelId}/search-similar`, requestData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `在小说 #${novelId} 中搜索相似片段失败。`));
    }
};

export const rebuildVectorStoreIndexForNovel = async (novelId: number): Promise<{ message: string; novel_id?: number }> => {
    try {
        const response = await apiClient.post<{ message: string; novel_id?: number }>(`/novels/${novelId}/rebuild-index`);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `为小说 #${novelId} 重建向量索引失败。`));
    }
};

export const ragGenerateWithNovelContext = async (
    novelId: number,
    requestData: RAGGenerateRequest
): Promise<RAGGenerateResponse> => {
    try {
        const response = await apiClient.post<RAGGenerateResponse>(`/novels/${novelId}/rag-generate`, requestData);
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, `使用小说 #${novelId} 上下文进行RAG生成失败。`));
    }
};

// --- Utility Functions ---

export const getUserReferableFiles = async (novelId?: number | null): Promise<PaginatedResponse<ReferableFileItem>> => {
    try {
        const endpoint = novelId ? `/configuration/referable-files?novel_id=${novelId}` : '/configuration/referable-files';
        const response = await apiClient.get<PaginatedResponse<ReferableFileItem>>(endpoint);
        return response.data;
    } catch (error) {
        const context = novelId ? `小说 #${novelId} 的` : '全局';
        const errorMsg = handleError(error as AxiosError, `获取${context}可引用文件列表失败。`);
        toast.error(errorMsg, { toastId: `get-referable-files-err-${novelId || 'global'}` });
        return { items: [], total_count: 0, page: 1, page_size: 0, total_pages: 0, has_next: false, has_prev: false };
    }
};

export const getSentimentThresholdSettings = async (): Promise<SentimentThresholds> => {
    try {
        const response = await apiClient.get<SentimentThresholds>('/configuration/sentiment-thresholds');
        return response.data;
    } catch (error) {
        throw new Error(handleError(error as AxiosError, '获取情感阈值设置失败。'));
    }
};

export const getPredefinedTasks = async (): Promise<PredefinedTaskMeta[]> => {
    try {
        const response = await apiClient.get<PredefinedTaskMeta[]>('/configuration/predefined-tasks');
        return response.data || [];
    } catch (error) {
        const errorMsg = handleError(error as AxiosError, '获取预定义任务列表失败。');
        toast.error(errorMsg, { toastId: 'fetch-predefined-tasks-meta-err' });
        return [];
    }
};

export const getAvailableLLMModels = async (): Promise<UserDefinedLLMConfig[]> => {
    try {
        const config = await getApplicationConfig();
        return config.llm_settings?.available_models?.filter(m => m.enabled && config.llm_providers[m.provider_tag]?.enabled) || [];
    } catch (error) {
        toast.error('获取可用LLM模型列表失败。');
        return [];
    }
};

export default apiClient;