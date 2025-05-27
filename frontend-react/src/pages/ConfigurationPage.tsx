// frontend-react/src/pages/ConfigurationPage.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { Tabs, Spin, Alert, Button } from 'antd';
import type { TabsProps } from 'antd';

// 从 api.ts 导入所有需要的类型和函数
import {
    getApplicationConfig,
    updateApplicationConfig,
    ApplicationConfig,
    LLMSettingsConfig,
    VectorStoreSettingsConfig,
    LLMProviderConfig,
    EmbeddingServiceSettingsConfig,
    AnalysisChunkSettingsConfig,
    LocalNLPSettingsConfig,
    FileStorageSettingsConfig,
    ApplicationGeneralSettingsConfig,
    PlanningServiceSettingsConfig,
    CostEstimationTiers,
    SentimentThresholds
} from '../services/api';

// 导入所有子表单组件
import GlobalLLMSettingsForm from '../components/configuration/GlobalLLMSettingsForm';
import LLMProvidersGlobalSettings from '../components/configuration/LLMProvidersGlobalSettings';
import UserDefinedLLMConfigList from '../components/configuration/UserDefinedLLMConfigList';
import VectorStoreSettingsForm from '../components/configuration/VectorStoreSettingsForm';
import ApplicationSettingsForm from '../components/configuration/ApplicationSettingsForm';
import PlanningSettingsForm from '../components/configuration/PlanningSettingsForm';
import LocalNLPSettingsForm from '../components/configuration/LocalNLPSettingsForm';
import CostEstimationTiersForm from '../components/configuration/CostEstimationTiersForm';
import SentimentThresholdsForm from '../components/configuration/SentimentThresholdsForm';
// 假设这些组件也存在
// import EmbeddingServiceSettingsForm from '../components/configuration/EmbeddingServiceSettingsForm';
// import AnalysisChunkSettingsForm from '../components/configuration/AnalysisChunkSettingsForm';
// import FileStorageSettingsForm from '../components/configuration/FileStorageSettingsForm';

// 导入页面和组件的样式
import pageStyles from './PageStyles.module.css';
import styles from './ConfigurationPage.module.css';
import { Save, RefreshCw as RefreshIcon } from 'lucide-react'; // 使用图标

// 定义配置项的键，用于强类型更新
type ConfigKey = keyof ApplicationConfig;

const ConfigurationPage: React.FC = () => {
    // 整个应用的配置状态
    const [config, setConfig] = useState<ApplicationConfig | null>(null);
    // 跟踪是否有未保存的更改
    const [hasChanges, setHasChanges] = useState<boolean>(false);
    // 加载和错误状态管理
    const [isLoading, setIsLoading] = useState<boolean>(true); // 初始加载状态
    const [isSaving, setIsSaving] = useState<boolean>(false);   // 保存状态
    const [error, setError] = useState<string | null>(null);

    // --- 数据获取 ---
    // 使用 useCallback 包装 fetchConfig 以避免在 useEffect 中引起不必要的重渲染
    const fetchConfig = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await getApplicationConfig();
            setConfig(data);
            setHasChanges(false); // 成功加载后，重置更改状态
        } catch (err: any) {
            setError(err.message || '获取配置信息失败。');
            toast.error(err.message || '获取配置信息失败。');
        } finally {
            setIsLoading(false);
        }
    }, []);

    // 组件挂载时获取配置
    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    // --- 状态更新处理 ---
    // 优化的状态更新函数，使用泛型和回调确保类型安全和不可变性
    const handleUpdate = useCallback(<K extends ConfigKey>(key: K, value: ApplicationConfig[K]) => {
        setConfig(prevConfig => {
            if (!prevConfig) return null;
            // 检查值是否真的发生了变化，避免不必要的更新
            // 注意: 对于对象和数组，这只是浅比较。但足以防止因相同引用触发的更新。
            if (prevConfig[key] === value) {
                return prevConfig;
            }
            return {
                ...prevConfig,
                [key]: value,
            };
        });
        setHasChanges(true); // 标记有未保存的更改
    }, []);

    // --- 保存操作 ---
    const handleSave = async () => {
        if (!config) {
            toast.warn('配置数据尚未加载，无法保存。');
            return;
        }
        if (!hasChanges) {
            toast.info('配置没有发生变化。');
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            const response = await updateApplicationConfig(config);
            setConfig(response.new_config); // 使用后端返回的最新配置更新状态
            setHasChanges(false);
            toast.success('配置已成功保存！');
        } catch (err: any) {
            setError(err.message || '保存配置失败。');
            toast.error(err.message || '保存配置失败，请检查配置项是否正确。');
        } finally {
            setIsSaving(false);
        }
    };
    
    // --- UI 渲染 ---
    // 加载中的 UI
    if (isLoading) {
        return (
            <div className={pageStyles.page}>
                <div className={pageStyles.pageHeader}>
                    <h1 className={pageStyles.pageTitle}>应用配置</h1>
                </div>
                <div className={styles.loadingContainer}>
                    <Spin size="large" tip="正在加载配置信息..." />
                </div>
            </div>
        );
    }

    // 加载错误时的 UI
    if (error && !config) {
        return (
            <div className={pageStyles.page}>
                <div className={pageStyles.pageHeader}>
                    <h1 className={pageStyles.pageTitle}>应用配置</h1>
                </div>
                <Alert
                    message="加载错误"
                    description={error}
                    type="error"
                    showIcon
                    action={
                        <Button type="primary" onClick={fetchConfig}>
                            <RefreshIcon size={14} /> 重试
                        </Button>
                    }
                />
            </div>
        );
    }
    
    // 配置加载成功后的 UI
    if (!config) {
        // 这是一个边缘情况，理论上不会发生，但作为健壮性保障
        return <div className={pageStyles.page}>无法加载配置。</div>;
    }
    
    // 定义标签页内容
    // 确保每个表单组件都接收正确的 props 和更新回调
    const tabItems: TabsProps['items'] = [
        {
            key: 'llm_general',
            label: 'LLM 通用与模型',
            children: (
                <div className={styles.tabContent}>
                    <GlobalLLMSettingsForm
                        settings={config.llm_settings}
                        onUpdate={(updatedSettings: LLMSettingsConfig) => handleUpdate('llm_settings', updatedSettings)}
                    />
                    <UserDefinedLLMConfigList
                        availableModels={config.llm_settings.available_models}
                        onUpdate={(updatedModels) => handleUpdate('llm_settings', { ...config.llm_settings, available_models: updatedModels })}
                    />
                </div>
            ),
        },
        {
            key: 'llm_providers',
            label: 'LLM 提供商',
            children: (
                <div className={styles.tabContent}>
                    <LLMProvidersGlobalSettings
                        providers={config.llm_providers}
                        onUpdate={(updatedProviders: Record<string, LLMProviderConfig>) => handleUpdate('llm_providers', updatedProviders)}
                    />
                </div>
            ),
        },
        {
            key: 'vector_store',
            label: '向量与嵌入',
            children: (
                 <div className={styles.tabContent}>
                    <VectorStoreSettingsForm
                        settings={config.vector_store_settings}
                        onUpdate={(updatedSettings: VectorStoreSettingsConfig) => handleUpdate('vector_store_settings', updatedSettings)}
                    />
                    {/* 可以在这里添加 EmbeddingServiceSettingsForm 和 AnalysisChunkSettingsForm */}
                 </div>
            ),
        },
        {
            key: 'services',
            label: '应用服务',
            children: (
                <div className={styles.tabContent}>
                    <ApplicationSettingsForm
                        settings={config.application_settings}
                        onUpdate={(updatedSettings: ApplicationGeneralSettingsConfig) => handleUpdate('application_settings', updatedSettings)}
                    />
                    <PlanningSettingsForm
                         settings={config.planning_settings}
                         onUpdate={(updatedSettings: PlanningServiceSettingsConfig) => handleUpdate('planning_settings', updatedSettings)}
                    />
                     <LocalNLPSettingsForm
                         settings={config.local_nlp_settings}
                         onUpdate={(updatedSettings: LocalNLPSettingsConfig) => handleUpdate('local_nlp_settings', updatedSettings)}
                    />
                </div>
            ),
        },
        {
            key: 'advanced',
            label: '高级与成本',
            children: (
                 <div className={styles.tabContent}>
                    <CostEstimationTiersForm
                        settings={config.cost_estimation_tiers}
                        onUpdate={(updatedSettings: CostEstimationTiers) => handleUpdate('cost_estimation_tiers', updatedSettings)}
                    />
                    <SentimentThresholdsForm
                        settings={config.sentiment_thresholds}
                        onUpdate={(updatedSettings: SentimentThresholds) => handleUpdate('sentiment_thresholds', updatedSettings)}
                    />
                 </div>
            ),
        },
    ];

    return (
        <div className={pageStyles.page}>
            {/* 页面头部，包含标题和操作按钮 */}
            <div className={pageStyles.pageHeader}>
                <h1 className={pageStyles.pageTitle}>应用配置</h1>
                <div className={pageStyles.headerActions}>
                     <Button
                        type="primary"
                        onClick={handleSave}
                        loading={isSaving} // 保存时显示加载状态
                        disabled={!hasChanges || isSaving} // 无更改或正在保存时禁用
                        icon={<Save size={16} />}
                        title={hasChanges ? "保存所有更改" : "配置无更改"}
                    >
                        保存更改
                    </Button>
                </div>
            </div>

            {/* 当有保存错误时显示提示 */}
            {error && <Alert message="保存时出错" description={error} type="error" showIcon closable style={{ marginBottom: '1rem' }}/>}

            {/* 使用 Spin 组件包裹整个内容区，用于显示保存时的加载状态 */}
            <Spin spinning={isSaving} tip="正在保存配置，请稍候..." size="large">
                <div className={styles.configContainer}>
                     <Tabs defaultActiveKey="llm_general" items={tabItems} animated />
                </div>
            </Spin>
        </div>
    );
};

export default ConfigurationPage;