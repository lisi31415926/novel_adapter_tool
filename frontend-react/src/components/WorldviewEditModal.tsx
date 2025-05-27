// frontend-react/src/components/WorldviewEditModal.tsx
import React, { useState, useEffect, useCallback, FormEvent, ChangeEvent } from 'react';
import { toast } from 'react-toastify';
import {
    Settings as SettingsIcon, Edit3, X as CloseIcon, Save, PlusCircle, Trash2, Loader, Info
} from 'lucide-react';

import pageViewStyles from '../pages/PageStyles.module.css';
import styles from './NovelOverview.module.css'; // 沿用 NovelOverview 的部分样式

// 定义世界观条目的值类型
export type WorldviewValue = string | number | boolean | string[] | Record<string, any>;

// 定义世界观条目的结构，用于在UI中进行动态编辑
export interface WorldviewEntry {
    id: string; // 用于React key的临时ID
    keyName: string;
    value: WorldviewValue;
    valueType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'textarea';
}

// 定义模态框组件的 Props
interface WorldviewEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentWorldview: Record<string, any> | null | undefined;
    onSave: (newWorldviewData: Record<string, any>) => Promise<void>;
    isSaving: boolean;
}

const WorldviewEditModal: React.FC<WorldviewEditModalProps> = ({
    isOpen, onClose, currentWorldview, onSave, isSaving
}) => {
    // 状态管理
    const [entries, setEntries] = useState<WorldviewEntry[]>([]);
    const [newKey, setNewKey] = useState<string>('');
    const [newValue, setNewValue] = useState<string>('');
    const [newValueType, setNewValueType] = useState<WorldviewEntry['valueType']>('string');

    const generateTempId = () => `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // 当模态框打开或外部数据变化时，初始化编辑条目
    useEffect(() => {
        if (isOpen) {
            if (currentWorldview && typeof currentWorldview === 'object') {
                const initialEntries = Object.entries(currentWorldview).map(([key, val]): WorldviewEntry => {
                    let type: WorldviewEntry['valueType'] = 'string';
                    if (typeof val === 'number') type = 'number';
                    else if (typeof val === 'boolean') type = 'boolean';
                    else if (Array.isArray(val)) type = 'array';
                    else if (typeof val === 'object' && val !== null) type = 'object';
                    else if (typeof val === 'string' && val.length > 100) type = 'textarea';
                    return { id: generateTempId(), keyName: key, value: val, valueType: type };
                });
                setEntries(initialEntries);
            } else {
                setEntries([]);
            }
            // 重置“添加新条目”的表单
            setNewKey('');
            setNewValue('');
            setNewValueType('string');
        }
    }, [isOpen, currentWorldview]);

    // 处理单个条目字段的变更
    const handleEntryChange = useCallback((id: string, field: keyof Omit<WorldviewEntry, 'id'>, val: string | boolean) => {
        setEntries(prevEntries =>
            prevEntries.map(entry => {
                if (entry.id !== id) return entry;

                const updatedEntry = { ...entry, [field]: val };

                // 当值类型改变时，尝试转换或重置值
                if (field === 'valueType') {
                    const newType = val as WorldviewEntry['valueType'];
                    try {
                        if (newType === 'number') updatedEntry.value = parseFloat(String(entry.value)) || 0;
                        else if (newType === 'boolean') updatedEntry.value = String(entry.value).toLowerCase() === 'true';
                        else if (newType === 'array') updatedEntry.value = Array.isArray(entry.value) ? entry.value : String(entry.value).split(',').map(s => s.trim());
                        else if (newType === 'object') updatedEntry.value = typeof entry.value === 'object' && !Array.isArray(entry.value) ? entry.value : JSON.parse(String(entry.value) || '{}');
                        else updatedEntry.value = String(entry.value);
                    } catch (e) {
                        // 转换失败则重置为该类型的默认值
                        const defaults = { number: 0, boolean: false, array: [], object: {}, string: '', textarea: '' };
                        updatedEntry.value = defaults[newType];
                    }
                }
                return updatedEntry;
            })
        );
    }, []);

    // 添加新条目
    const handleAddEntry = useCallback(() => {
        const trimmedKey = newKey.trim();
        if (!trimmedKey) {
            toast.warn("新设定的键名不能为空。");
            return;
        }
        if (entries.some(entry => entry.keyName === trimmedKey)) {
            toast.warn(`键名 "${trimmedKey}" 已存在，请使用唯一的键名。`);
            return;
        }

        let parsedValue: WorldviewValue = newValue;
        try {
            if (newValueType === 'number') parsedValue = parseFloat(newValue) || 0;
            else if (newValueType === 'boolean') parsedValue = newValue === 'true';
            else if (newValueType === 'array') parsedValue = newValue.split(',').map(s => s.trim()).filter(Boolean);
            else if (newValueType === 'object') parsedValue = JSON.parse(newValue || '{}');
        } catch (e) {
            toast.error(`添加新设定失败：值 "${newValue}" 无法按类型 "${newValueType}" 解析。`);
            return;
        }

        setEntries(prev => [...prev, { id: generateTempId(), keyName: trimmedKey, value: parsedValue, valueType: newValueType }]);
        setNewKey('');
        setNewValue('');
        setNewValueType('string');
    }, [newKey, newValue, newValueType, entries]);

    // 移除一个条目
    const handleRemoveEntry = useCallback((id: string) => {
        setEntries(prev => prev.filter(entry => entry.id !== id));
    }, []);
    
    // 渲染不同类型的输入框
    const renderValueInput = (entry: WorldviewEntry) => {
        const commonProps = {
            value: typeof entry.value === 'object' ? JSON.stringify(entry.value, null, 2) : String(entry.value),
            onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => handleEntryChange(entry.id, 'value', e.target.value),
            className: pageViewStyles.inputField,
            disabled: isSaving,
        };
        const booleanSelectProps = {
            value: String(entry.value),
            onChange: (e: ChangeEvent<HTMLSelectElement>) => handleEntryChange(entry.id, 'value', e.target.value === 'true'),
            className: pageViewStyles.selectField,
            disabled: isSaving,
        };

        switch (entry.valueType) {
            case 'number': return <input type="number" {...commonProps} />;
            case 'boolean': return <select {...booleanSelectProps}><option value="true">是</option><option value="false">否</option></select>;
            case 'array': return <input type="text" {...commonProps} placeholder="值1, 值2" />;
            case 'object': return <textarea {...commonProps} rows={3} placeholder='有效的JSON对象' />;
            case 'textarea': return <textarea {...commonProps} rows={3} />;
            default: return <input type="text" {...commonProps} />;
        }
    };
    
    // 表单提交处理
    const handleSubmit = useCallback(async (e: FormEvent) => {
        e.preventDefault();
        const record: Record<string, any> = {};
        for (const entry of entries) {
            if (!entry.keyName.trim()) { toast.error("存在空的键名，请修正。"); return; }
            if (record[entry.keyName.trim()]) { toast.error(`键名 "${entry.keyName.trim()}" 重复。`); return; }
            record[entry.keyName.trim()] = entry.value;
        }
        await onSave(record);
    }, [entries, onSave]);

    if (!isOpen) return null;

    return (
        <div className={pageViewStyles.modalOverlay}>
            <div className={`${pageViewStyles.modalContent} ${styles.worldviewModalContentDynamic}`}>
                <div className={pageViewStyles.modalHeader}>
                    <h4><SettingsIcon size={18} /> 编辑世界观设定</h4>
                    <button onClick={onClose} className={pageViewStyles.modalCloseButton} title="关闭" disabled={isSaving}><CloseIcon size={22} /></button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className={`${pageViewStyles.modalBody} ${styles.dynamicFormModalBody}`}>
                        <p className={styles.worldviewEditHelpText}><Info size={16}/> 动态编辑键值对。对于“数组”，请输入逗号分隔的值；对于“对象”，请输入有效的JSON。</p>
                        <div className={styles.entriesList}>
                            {entries.map(entry => (
                                <div key={entry.id} className={styles.worldviewEntryRow}>
                                    <input type="text" value={entry.keyName} onChange={(e) => handleEntryChange(entry.id, 'keyName', e.target.value)} className={pageViewStyles.inputField} placeholder="键名" disabled={isSaving}/>
                                    <select value={entry.valueType} onChange={(e) => handleEntryChange(entry.id, 'valueType', e.target.value)} className={pageViewStyles.selectField} disabled={isSaving}>
                                        <option value="string">文本(短)</option><option value="textarea">文本(长)</option><option value="number">数字</option><option value="boolean">布尔</option><option value="array">数组</option><option value="object">对象</option>
                                    </select>
                                    {renderValueInput(entry)}
                                    <button type="button" onClick={() => handleRemoveEntry(entry.id)} className={styles.removeEntryButton} title="删除此条目" disabled={isSaving}><Trash2 size={16} /></button>
                                </div>
                            ))}
                        </div>
                        <div className={styles.addNewEntryForm}>
                            <h5><PlusCircle size={16} /> 添加新设定</h5>
                            <div className={styles.worldviewEntryRow}>
                                <input type="text" value={newKey} onChange={(e) => setNewKey(e.target.value)} className={pageViewStyles.inputField} placeholder="新键名" disabled={isSaving}/>
                                <select value={newValueType} onChange={(e) => setNewValueType(e.target.value as WorldviewEntry['valueType'])} className={pageViewStyles.selectField} disabled={isSaving}>
                                    <option value="string">文本(短)</option><option value="textarea">文本(长)</option><option value="number">数字</option><option value="boolean">布尔</option><option value="array">数组</option><option value="object">对象</option>
                                </select>
                                <input type="text" value={newValue} onChange={(e) => setNewValue(e.target.value)} className={pageViewStyles.inputField} placeholder="新设定值" disabled={isSaving}/>
                                <button type="button" onClick={handleAddEntry} className={styles.addEntryButton} title="添加" disabled={isSaving || !newKey.trim()}><PlusCircle size={16}/></button>
                            </div>
                        </div>
                    </div>
                    <div className={pageViewStyles.modalFooter}>
                        <button type="button" onClick={onClose} className="btn btn-sm btn-secondary" disabled={isSaving}>取消</button>
                        <button type="submit" className="btn btn-sm btn-primary" disabled={isSaving}>
                            {isSaving ? <><Loader size={16} className="spinning-icon" /> 保存中...</> : <><Save size={16}/> 保存世界观</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default WorldviewEditModal;