// frontend-react/src/components/PlotVersionContentModal.tsx
import React, { useState, useEffect, FormEvent, useCallback } from 'react';
import { toast } from 'react-toastify';
import { PlotVersion } from '../services/api'; // 假设 PlotVersion 在此处正确导入
import pageViewStyles from '../pages/PageStyles.module.css';
import componentStyles from './PlotVersionContentModal.module.css';

import { FileJson, Save, X as CloseIcon, Loader, Info, ChevronDown, PlusCircle, Trash2 } from 'lucide-react';

// ContentSummaryValue 现在允许 null，这对于可选的数字或重置值很重要
type ContentSummaryValue = string | number | boolean | string[] | Record<string, any> | null;

interface ContentSummaryEntry {
    id: string;
    keyName: string;
    value: ContentSummaryValue;
    valueType: 'string' | 'textarea' | 'number' | 'boolean' | 'array' | 'object';
}

interface PlotVersionContentModalProps {
    isOpen: boolean;
    onClose: () => void;
    version: PlotVersion | null;
    onSave: (versionId: number, newContentSummary: Record<string, any>) => Promise<void>;
    isSaving: boolean;
}

const PlotVersionContentModal: React.FC<PlotVersionContentModalProps> = ({
    isOpen,
    onClose,
    version,
    onSave,
    isSaving,
}) => {
    const [entries, setEntries] = useState<ContentSummaryEntry[]>([]);
    const [newKey, setNewKey] = useState<string>('');
    const [newValueInput, setNewValueInput] = useState<string>(''); // 输入框的值始终为字符串
    const [newValueType, setNewValueType] = useState<ContentSummaryEntry['valueType']>('string');

    const generateTempId = useCallback(() => `cs-entry-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, []);

    useEffect(() => {
        if (isOpen && version) {
            const summary = version.content_summary;
            if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
                const initialEntries = Object.entries(summary).map(([key, val]) => {
                    let type: ContentSummaryEntry['valueType'] = 'string';
                    let actualValueForState: ContentSummaryValue = val;

                    if (typeof val === 'number') {
                        type = 'number';
                    } else if (typeof val === 'boolean') {
                        type = 'boolean';
                    } else if (Array.isArray(val)) {
                        type = 'array';
                        // 确保数组元素是字符串，如果不是，则转换（或根据需求处理更复杂数组）
                        actualValueForState = val.map(item => String(item));
                    } else if (typeof val === 'object' && val !== null) {
                        type = 'object';
                    } else if (typeof val === 'string') {
                        type = val.length > 80 || val.includes('\n') ? 'textarea' : 'string';
                    } else if (val === null || val === undefined) {
                        type = 'string'; // 默认为 string 类型
                        actualValueForState = null; // 保持 null 值
                    }
                    return { id: generateTempId(), keyName: key, value: actualValueForState, valueType: type };
                });
                setEntries(initialEntries);
            } else {
                setEntries([]);
                if (summary && (typeof summary !== 'object' || Array.isArray(summary))) {
                    toast.warn("内容摘要数据格式不是预期的键值对对象，已清空。请编辑并保存为正确格式。", { autoClose: 7000, toastId: `content-summary-format-warning-${version?.id}` });
                }
            }
            setNewKey(''); setNewValueInput(''); setNewValueType('string');
        } else if (!isOpen) {
            setEntries([]); // 关闭时清空
        }
    }, [isOpen, version, generateTempId]);

    const handleEntryChange = (id: string, field: 'keyName' | 'value' | 'valueType', newValueFromInput: string | boolean | number) => {
        setEntries(prevEntries =>
            prevEntries.map(entry => {
                if (entry.id === id) {
                    const updatedEntry = { ...entry };
                    if (field === 'keyName') {
                        updatedEntry.keyName = String(newValueFromInput);
                    } else if (field === 'valueType') {
                        const newType = newValueFromInput as ContentSummaryEntry['valueType'];
                        const oldType = updatedEntry.valueType;
                        updatedEntry.valueType = newType;
                        
                        // 当值类型改变时，尝试智能转换或重置值
                        if (newType !== oldType) {
                            const currentValStr = (typeof entry.value === 'object' && entry.value !== null) ? 
                                                JSON.stringify(entry.value) : 
                                                String(entry.value ?? '');
                            let resetValue: ContentSummaryValue = ''; // 默认重置为字符串空
                            try {
                                switch (newType) {
                                    case 'number':
                                        resetValue = currentValStr.trim() === '' ? null : parseFloat(currentValStr);
                                        if (resetValue !== null && isNaN(resetValue as number)) resetValue = null; // 若解析失败则为null
                                        break;
                                    case 'boolean':
                                        resetValue = currentValStr.toLowerCase() === 'true' || currentValStr === '1';
                                        break;
                                    case 'array':
                                        // 如果之前是对象或复杂结构，简单地转为字符串数组可能不合适，直接重置为空数组
                                        resetValue = (typeof entry.value === 'string' && entry.value.includes(',')) 
                                            ? currentValStr.split(',').map(s => s.trim()).filter(Boolean) 
                                            : [];
                                        break;
                                    case 'object':
                                        // 尝试解析为对象，否则重置为空对象
                                        if (typeof entry.value === 'string') {
                                            try { resetValue = JSON.parse(currentValStr.trim() || '{}'); } catch { resetValue = {}; }
                                        } else { resetValue = {}; }
                                        break;
                                    default: // string, textarea
                                        resetValue = currentValStr; // 保留字符串形式
                                }
                                updatedEntry.value = resetValue;
                                toast.info(`键 "${entry.keyName}" 的值类型已更改为 "${newType}"。值已尝试转换为新类型或重置。`, {toastId: `type-change-info-${entry.id}`});
                            } catch (e) {
                                toast.warn(`尝试将键 "${entry.keyName}" 的值从类型 "${oldType}" 转换为 "${newType}" 失败，已重置为默认值。错误: ${(e as Error).message}`, {toastId: `type-convert-err-${entry.id}`});
                                // 根据新类型设置安全的默认值
                                if (newType === 'array') updatedEntry.value = [];
                                else if (newType === 'object') updatedEntry.value = {};
                                else if (newType === 'number') updatedEntry.value = null;
                                else if (newType === 'boolean') updatedEntry.value = false;
                                else updatedEntry.value = '';
                            }
                        }
                    } else if (field === 'value') {
                        // 根据当前的 entry.valueType 来处理输入的值
                        if (entry.valueType === 'boolean') {
                             updatedEntry.value = newValueFromInput === 'true' || newValueFromInput === true;
                        } else if (entry.valueType === 'number') {
                             const numStr = String(newValueFromInput).trim();
                             updatedEntry.value = numStr === '' ? null : Number(newValueFromInput); // 输入框会处理非数字，但这里再次确保
                             if (updatedEntry.value !== null && isNaN(updatedEntry.value as number)) {
                                 // 如果用户输入了非数字，number input 会变为空字符串，传到这里newValueFromInput会是空串
                                 // 如果用户强制输入了非法字符，可以保持输入框内容但标记错误，或者直接设为null
                                 // 当前行为：Number(nonNumericString) -> NaN. 我们希望存储 null 或有效数字。
                                 updatedEntry.value = null; 
                             }
                        } else { // string, textarea, array (用户输入逗号分隔字符串), object (用户输入JSON字符串)
                             updatedEntry.value = String(newValueFromInput); 
                        }
                    }
                    return updatedEntry;
                }
                return entry;
            })
        );
    };

    const handleAddEntry = () => {
        const trimmedNewKey = newKey.trim();
        if (!trimmedNewKey) { toast.warn("新设定的键名不能为空。"); return; }
        if (entries.some(entry => entry.keyName === trimmedNewKey)) { toast.warn(`键名 "${trimmedNewKey}" 已存在，请使用唯一的键名。`); return; }
        
        let parsedNewValue: ContentSummaryValue = newValueInput; // newValueInput 来自表单，是string
        const valueStrTrimmed = newValueInput.trim();

        try {
            switch (newValueType) {
                case 'number':
                    parsedNewValue = valueStrTrimmed === '' ? null : parseFloat(valueStrTrimmed);
                    if (parsedNewValue !== null && isNaN(parsedNewValue as number)) {
                        toast.error(`添加失败：值 "${newValueInput}" 不是有效的数字。`); return;
                    }
                    break;
                case 'boolean':
                    parsedNewValue = valueStrTrimmed.toLowerCase() === 'true'; // 'true' 字符串解析为 true，其他为 false
                    break;
                case 'array':
                    parsedNewValue = valueStrTrimmed ? valueStrTrimmed.split(',').map(s => s.trim()).filter(Boolean) : [];
                    break;
                case 'object':
                    parsedNewValue = valueStrTrimmed ? JSON.parse(valueStrTrimmed) : {};
                    if (typeof parsedNewValue !== 'object' || parsedNewValue === null || Array.isArray(parsedNewValue)) {
                         toast.error(`添加失败：值 "${newValueInput}" 不是有效的JSON对象。`); return;
                    }
                    break;
                case 'string':
                case 'textarea':
                    parsedNewValue = newValueInput; // 保持字符串原样
                    break;
            }
        } catch (e) { 
            toast.error(`添加新设定失败：值 "${newValueInput}" 无法按类型 "${newValueType}" 解析。请确保JSON对象或数组格式正确。错误: ${(e as Error).message}`, {toastId: `add-parse-err-${trimmedNewKey}`}); 
            return; 
        }
        
        setEntries(prev => [...prev, { id: generateTempId(), keyName: trimmedNewKey, value: parsedNewValue, valueType: newValueType }]);
        setNewKey(''); setNewValueInput(''); setNewValueType('string'); // 重置表单
    };

    const handleRemoveEntry = (id: string) => {
        setEntries(prev => prev.filter(entry => entry.id !== id));
        toast.info("一个摘要条目已移除。");
    };

    const convertEntriesToRecord = (): { data: Record<string, any> | null, error: string | null } => {
        const record: Record<string, any> = {};
        for (const entry of entries) {
            const key = entry.keyName.trim();
            if (!key) return { data: null, error: "存在空的键名，请修正或删除该条目后保存。" };
            if (record.hasOwnProperty(key)) return { data: null, error: `键名 "${key}" 重复，请确保所有键名唯一后保存。` };
            
            let valueToSave: ContentSummaryValue = entry.value;

            try {
                switch (entry.valueType) {
                    case 'number':
                        if (entry.value === null || String(entry.value).trim() === '') {
                            valueToSave = null;
                        } else {
                            const num = parseFloat(String(entry.value));
                            if (isNaN(num)) {
                                throw new Error(`“${entry.value}”不是一个有效的数字。`);
                            }
                            valueToSave = num;
                        }
                        break;
                    case 'boolean':
                        // 在handleEntryChange中，布尔值已经存为实际的true/false
                        if (typeof entry.value !== 'boolean') {
                            valueToSave = String(entry.value).toLowerCase() === 'true';
                        }
                        break;
                    case 'array':
                        if (typeof entry.value === 'string') { // 用户在文本框输入了逗号分隔的字符串
                            valueToSave = entry.value.split(',').map(s => s.trim()).filter(Boolean);
                        } else if (!Array.isArray(entry.value)) { // 类型是array，但值不是（可能类型刚切换，值还是旧的）
                             toast.warn(`键 "${key}" 的类型为数组，但当前值不是一个有效数组。将尝试按逗号分隔的字符串解析，或保存为空数组。`);
                             valueToSave = String(entry.value ?? '').split(',').map(s => s.trim()).filter(Boolean);
                             if (!Array.isArray(valueToSave)) valueToSave = []; // 进一步保护
                        }
                        // 如果 entry.value 已经是数组，则直接使用 (已在 useEffect 和 handleEntryChange 中处理好)
                        break;
                    case 'object':
                        if (typeof entry.value === 'string') { // 用户在文本框输入了JSON字符串
                            const trimmedJsonString = entry.value.trim();
                            valueToSave = trimmedJsonString ? JSON.parse(trimmedJsonString) : {};
                            if (typeof valueToSave !== 'object' || valueToSave === null || Array.isArray(valueToSave)) {
                                throw new Error("值不是有效的JSON对象。");
                            }
                        } else if (typeof entry.value !== 'object' || entry.value === null || Array.isArray(entry.value)) {
                             toast.warn(`键 "${key}" 的类型为对象，但当前值不是一个有效的对象。将保存为空对象。`);
                             valueToSave = {};
                        }
                        // 如果 entry.value 已经是对象，则直接使用
                        break;
                    default: // string, textarea
                        valueToSave = String(entry.value ?? ''); // 确保是字符串，并将 null/undefined 转换为空字符串
                        break;
                }
            } catch (e) { 
                return { data: null, error: `键 "${key}" 的值无法按类型 "${entry.valueType}" 解析并保存: ${ (e as Error).message }。请检查数据格式。` }; 
            }
            record[key] = valueToSave;
        }
        return { data: record, error: null };
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!version) { toast.error("版本信息缺失，无法保存。"); return; }
        
        const conversionResult = convertEntriesToRecord();
        if (conversionResult.error) {
            toast.error(conversionResult.error);
            return;
        }
        if (conversionResult.data !== null) { 
            await onSave(version.id, conversionResult.data);
            // onClose(); // onSave 成功后通常会自动关闭模态框或由父组件处理
        } else {
            // 通常 convertEntriesToRecord 出错时会返回 error message，这里作为后备
            toast.error("内容摘要数据转换时发生未知错误，未能保存。");
        }
    };
    
    // renderValueInput现在用于渲染编辑现有条目的输入框
    const renderValueInput = (entry: ContentSummaryEntry) => {
        let displayValueForInput: string;

        // 根据条目类型，格式化状态中的值以便在输入框中显示
        if (entry.valueType === 'object') {
            try {
                displayValueForInput = (typeof entry.value === 'string') 
                    ? entry.value // 如果用户正在输入JSON字符串，直接显示
                    : (entry.value === null || entry.value === undefined)
                        ? '' // 如果值是null/undefined（例如，新条目或类型刚切换），显示空
                        : JSON.stringify(entry.value, null, 2); // 如果值是实际对象，格式化为JSON字符串
            } catch { 
                displayValueForInput = (typeof entry.value === 'string' ? entry.value : '{}'); // 解析或格式化失败的回退
            }
        } else if (entry.valueType === 'array') {
            displayValueForInput = Array.isArray(entry.value) 
                ? entry.value.join(', ') // 如果是数组，用逗号连接显示
                : String(entry.value ?? ''); // 否则显示字符串形式（可能是用户正在输入的）
        } else if (entry.valueType === 'boolean') {
             // select 的 value 需要是字符串 "true" 或 "false"
             displayValueForInput = String(entry.value ?? false); 
        } else { // string, textarea, number
            displayValueForInput = String(entry.value ?? ''); // 数字也会转为字符串，由input type="number"处理
        }

        const commonInputProps = {
            value: displayValueForInput,
            onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => 
                        handleEntryChange(entry.id, 'value', e.target.value), // 总是传递字符串值
            className: pageViewStyles.inputField, 
            disabled: isSaving,
        };
       
        switch (entry.valueType) {
            case 'number': 
                return <input type="number" {...commonInputProps} step="any" />;
            case 'boolean': 
                return ( 
                    <div className={pageViewStyles.selectContainerFullWidth}>
                        <select 
                            value={displayValueForInput} // "true" 或 "false"
                            onChange={(e) => handleEntryChange(entry.id, 'value', e.target.value === 'true')} // 转换回布尔值
                            className={`${pageViewStyles.selectField} ${componentStyles.typeSelect}`} 
                            disabled={isSaving}
                        >
                            <option value="true">是 (True)</option>
                            <option value="false">否 (False)</option>
                        </select>
                        <ChevronDown size={16} className={pageViewStyles.selectArrowInsideFull}/>
                    </div> 
                );
            case 'array': 
                return <input type="text" {...commonInputProps} placeholder="值1, 值2, 值3 (英文逗号分隔)" title="输入英文逗号分隔的列表项"/>;
            case 'object': 
                return <textarea {...commonInputProps} rows={3} className={`${pageViewStyles.textareaField} ${componentStyles.jsonValueTextarea}`} placeholder='有效的JSON对象字符串, 例如: {"sub_key": "sub_value"}' />;
            case 'textarea': 
                return <textarea {...commonInputProps} rows={3} className={pageViewStyles.textareaField} placeholder="较长的文本描述..." />;
            case 'string': 
            default: 
                return <input type="text" {...commonInputProps} placeholder="简短的文本值..." />;
        }
    };

    // renderNewValueInput 用于渲染“添加新设定”表单中的值输入框
    const renderNewValueInput = () => {
        const commonProps = {
            value: newValueInput, // 绑定到 newValueInput 字符串状态
            onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setNewValueInput(e.target.value),
            className: pageViewStyles.inputField,
            disabled: isSaving,
        };

        switch (newValueType) {
            case 'number':
                return <input type="number" {...commonProps} step="any" placeholder="数字，例如: 10 或 3.14"/>;
            case 'boolean':
                return (
                    <div className={pageViewStyles.selectContainerFullWidth}>
                        <select {...commonProps} value={newValueInput || "false"} /* 确保有默认值给select */ >
                            <option value="true">是 (True)</option>
                            <option value="false">否 (False)</option>
                        </select>
                        <ChevronDown size={16} className={pageViewStyles.selectArrowInsideFull}/>
                    </div>
                );
            case 'array':
                return <input type="text" {...commonProps} placeholder="值1, 值2, 值3 (英文逗号分隔)" />;
            case 'object':
                return <textarea {...commonProps} rows={2} className={`${pageViewStyles.textareaField} ${componentStyles.jsonValueTextarea}`} placeholder='有效的JSON对象, 例如: {"key":"value"}' />;
            case 'textarea':
                return <textarea {...commonProps} rows={2} className={pageViewStyles.textareaField} placeholder="较长的文本描述..."/>;
            case 'string':
            default:
                return <input type="text" {...commonProps} placeholder="简短的文本值..." />;
        }
    };


    if (!isOpen || !version) return null;

    return (
        <div className={pageViewStyles.modalOverlay} data-visible={isOpen} /* onClick={onClose} -- 避免误关 */ >
            <div className={`${pageViewStyles.modalContent} ${componentStyles.contentSummaryModalSizing}`}>
                <div className={pageViewStyles.modalHeader}>
                    <h4 className={componentStyles.modalTitleWithIcon}>
                        <FileJson size={18} />
                        编辑版本 “{version.version_name}” 的内容摘要
                    </h4>
                    <button onClick={onClose} className={pageViewStyles.modalCloseButton} title="关闭编辑器" disabled={isSaving}>
                        <CloseIcon size={22} />
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className={`${pageViewStyles.modalBody} ${componentStyles.dynamicFormModalBody}`}>
                        <p className={componentStyles.modalHelpText}>
                            动态编辑此剧情版本内容的结构化摘要。此摘要用于AI理解版本核心、生成后续内容或进行版本对比。
                            请为每个条目选择合适的值类型。对于“数组”，请输入英文逗号分隔的值。对于“对象”，请输入有效的JSON字符串。
                        </p>
                        
                        {entries.length === 0 && !isSaving && (
                            <p className={componentStyles.noEntriesMessage}><Info size={16}/> 当前没有摘要条目。点击下方“添加新设定”开始。</p>
                        )}

                        <div className={componentStyles.entriesList}>
                            {entries.map((entry) => (
                                <div key={entry.id} className={componentStyles.contentEntryRow}>
                                    <div className={componentStyles.entryInputGroup}>
                                        <label htmlFor={`cs-key-${entry.id}`}>键名:</label>
                                        <input type="text" id={`cs-key-${entry.id}`} value={entry.keyName}
                                            onChange={(e) => handleEntryChange(entry.id, 'keyName', e.target.value)}
                                            className={`${pageViewStyles.inputField} ${componentStyles.keyInput}`} placeholder="例如: main_theme" disabled={isSaving} />
                                    </div>
                                    <div className={componentStyles.entryInputGroup}>
                                        <label htmlFor={`cs-valueType-${entry.id}`}>值类型:</label>
                                        <div className={pageViewStyles.selectContainerFullWidth}>
                                            <select id={`cs-valueType-${entry.id}`} value={entry.valueType}
                                                onChange={(e) => handleEntryChange(entry.id, 'valueType', e.target.value)}
                                                className={`${pageViewStyles.selectField} ${componentStyles.typeSelect}`} disabled={isSaving}>
                                                <option value="string">文本 (短)</option>
                                                <option value="textarea">文本 (长)</option>
                                                <option value="number">数字</option>
                                                <option value="boolean">布尔 (是/否)</option>
                                                <option value="array">数组 (逗号分隔)</option>
                                                <option value="object">对象 (JSON字符串)</option>
                                            </select>
                                            <ChevronDown size={16} className={pageViewStyles.selectArrowInsideFull}/>
                                        </div>
                                    </div>
                                    <div className={`${componentStyles.entryInputGroup} ${componentStyles.valueInputCell}`}>
                                        <label htmlFor={`cs-value-${entry.id}`}>值:</label>
                                        {renderValueInput(entry)}
                                    </div>
                                    <button type="button" onClick={() => handleRemoveEntry(entry.id)} className={componentStyles.removeEntryButton} title="删除此条设定" disabled={isSaving}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div className={componentStyles.addNewEntryForm}>
                            <h5><PlusCircle size={16} /> 添加新设定</h5>
                            <div className={componentStyles.contentEntryRow}>
                                <div className={componentStyles.entryInputGroup}>
                                    <label htmlFor="cs-newKey">新键名:</label>
                                    <input type="text" id="cs-newKey" value={newKey} onChange={(e) => setNewKey(e.target.value)} className={`${pageViewStyles.inputField} ${componentStyles.keyInput}`} placeholder="例如: key_plot_points" disabled={isSaving}/>
                                </div>
                                <div className={componentStyles.entryInputGroup}>
                                    <label htmlFor="cs-newValueType">值类型:</label>
                                    <div className={pageViewStyles.selectContainerFullWidth}>
                                        <select id="cs-newValueType" value={newValueType} onChange={(e) => setNewValueType(e.target.value as ContentSummaryEntry['valueType'])} className={`${pageViewStyles.selectField} ${componentStyles.typeSelect}`} disabled={isSaving}>
                                            <option value="string">文本 (短)</option> 
                                            <option value="textarea">文本 (长)</option> 
                                            <option value="number">数字</option> 
                                            <option value="boolean">布尔 (是/否)</option> 
                                            <option value="array">数组 (逗号分隔)</option> 
                                            <option value="object">对象 (JSON字符串)</option>
                                        </select>
                                        <ChevronDown size={16} className={pageViewStyles.selectArrowInsideFull}/>
                                    </div>
                                </div>
                                <div className={`${componentStyles.entryInputGroup} ${componentStyles.valueInputCell}`}>
                                    <label htmlFor="cs-newValueInput">值:</label>
                                    {renderNewValueInput()}
                                </div>
                                <button type="button" onClick={handleAddEntry} className={componentStyles.addEntryButton} title="添加此新设定到列表" disabled={isSaving || !newKey.trim()}>
                                    <PlusCircle size={16}/> 添加
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className={pageViewStyles.modalFooter}>
                        <button type="button" onClick={onClose} className="btn btn-sm btn-secondary" disabled={isSaving}>取消</button>
                        <button type="submit" className="btn btn-sm btn-primary" disabled={isSaving}>
                            {isSaving ? <Loader size={16} className="spinning-icon" /> : <Save size={16}/>}
                            {isSaving ? '保存中...' : '保存内容摘要'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PlotVersionContentModal;