import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { APIProvider } from '@/services/aiService';
import {
  createServerForwardedDefaultApiConfig,
  shouldHydrateServerForwardedDefault,
} from '@/services/defaultForwardedAPI';

export interface APIConfig {
  id: string;
  name: string;
  provider: APIProvider;
  url: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  useServerManaged?: boolean;
  forceJsonOutput?: boolean;
}

export type APIUsageType =
  | 'main'
  | 'memory_summary'
  | 'embedding'
  | 'text_optimization'
  | 'instruction_generation'
  | 'world_generation'
  | 'event_generation'
  | 'sect_generation'
  | 'crafting';

export type GenerationMode = 'raw' | 'standard';

export interface FunctionModeConfig {
  type: APIUsageType;
  mode: GenerationMode;
}

export interface FunctionEnabledConfig {
  type: APIUsageType;
  enabled: boolean;
}

export interface APIAssignment {
  type: APIUsageType;
  apiId: string;
}

export type RunMode = 'tavern' | 'web';

const DEFAULT_API_ASSIGNMENTS: APIAssignment[] = [
  { type: 'main', apiId: 'default' },
  { type: 'memory_summary', apiId: 'default' },
  { type: 'embedding', apiId: 'default' },
  { type: 'text_optimization', apiId: 'default' },
  { type: 'instruction_generation', apiId: 'default' },
  { type: 'world_generation', apiId: 'default' },
  { type: 'event_generation', apiId: 'default' },
  { type: 'sect_generation', apiId: 'default' },
  { type: 'crafting', apiId: 'default' },
];

const DEFAULT_FUNCTION_MODES: FunctionModeConfig[] = [
  { type: 'memory_summary', mode: 'raw' },
  { type: 'text_optimization', mode: 'raw' },
  { type: 'world_generation', mode: 'raw' },
  { type: 'event_generation', mode: 'raw' },
  { type: 'sect_generation', mode: 'raw' },
  { type: 'crafting', mode: 'raw' },
];

const DEFAULT_FUNCTION_ENABLED: FunctionEnabledConfig[] = [
  { type: 'memory_summary', enabled: true },
  { type: 'text_optimization', enabled: false },
  { type: 'embedding', enabled: false },
  { type: 'world_generation', enabled: true },
  { type: 'event_generation', enabled: true },
  { type: 'sect_generation', enabled: true },
  { type: 'crafting', enabled: true },
];

const STORAGE_KEY = 'api_management_config';

const normalizeDefaultApiConfig = (current?: Partial<APIConfig> | null): APIConfig =>
  createServerForwardedDefaultApiConfig({
    name: current?.name,
    enabled: current?.enabled,
    model: current?.model,
    temperature: current?.temperature,
    maxTokens: current?.maxTokens,
    forceJsonOutput: current?.forceJsonOutput,
  }) as APIConfig;

export const useAPIManagementStore = defineStore('apiManagement', () => {
  const apiConfigs = ref<APIConfig[]>([]);
  const apiAssignments = ref<APIAssignment[]>([...DEFAULT_API_ASSIGNMENTS]);
  const functionModes = ref<FunctionModeConfig[]>([...DEFAULT_FUNCTION_MODES]);
  const functionEnabled = ref<FunctionEnabledConfig[]>([...DEFAULT_FUNCTION_ENABLED]);
  const aiGenerationSettings = ref({
    splitStep2Streaming: false,
  });

  const enabledAPIs = computed(() => apiConfigs.value.filter((api) => api.enabled));

  const shouldEnableSplitGeneration = computed(() => {
    const instructionAssignment = apiAssignments.value.find((a) => a.type === 'instruction_generation');
    return !!(instructionAssignment?.apiId && instructionAssignment.apiId !== 'default');
  });

  const ensureDefaultApiConfig = (): boolean => {
    const defaultIndex = apiConfigs.value.findIndex((api) => api.id === 'default');

    if (defaultIndex === -1) {
      apiConfigs.value.unshift(normalizeDefaultApiConfig());
      return true;
    }

    const currentDefault = apiConfigs.value[defaultIndex];
    if (currentDefault.useServerManaged === true) {
      apiConfigs.value[defaultIndex] = normalizeDefaultApiConfig(currentDefault);
      return true;
    }

    if (!shouldHydrateServerForwardedDefault(currentDefault)) {
      return false;
    }

    apiConfigs.value[defaultIndex] = normalizeDefaultApiConfig(currentDefault);
    return true;
  };

  const saveToStorage = () => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          apiConfigs: apiConfigs.value,
          apiAssignments: apiAssignments.value,
          functionModes: functionModes.value,
          functionEnabled: functionEnabled.value,
          aiGenerationSettings: aiGenerationSettings.value,
        }),
      );
    } catch (error) {
      console.error('[API管理] 保存配置失败:', error);
    }
  };

  const loadFromStorage = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);

        if (data.aiGenerationSettings) {
          aiGenerationSettings.value = {
            ...aiGenerationSettings.value,
            ...data.aiGenerationSettings,
          };
        }

        apiConfigs.value = Array.isArray(data.apiConfigs) ? data.apiConfigs : [];
        ensureDefaultApiConfig();

        const knownTypes = new Set(DEFAULT_API_ASSIGNMENTS.map((a) => a.type));
        const mergedAssignments = new Map<APIUsageType, APIAssignment>();
        DEFAULT_API_ASSIGNMENTS.forEach((item) => mergedAssignments.set(item.type, { ...item }));

        const savedAssignments = Array.isArray(data.apiAssignments) ? data.apiAssignments : [];
        for (const item of savedAssignments) {
          const type = item?.type as APIUsageType;
          const apiId = typeof item?.apiId === 'string' ? item.apiId : 'default';
          if (!type || !knownTypes.has(type)) continue;
          mergedAssignments.set(type, { type, apiId });
        }

        const existingApiIds = new Set(apiConfigs.value.map((item) => item.id).filter(Boolean));
        apiAssignments.value = DEFAULT_API_ASSIGNMENTS.map((item) => {
          const current = mergedAssignments.get(item.type) || item;
          const apiId = existingApiIds.has(current.apiId) ? current.apiId : 'default';
          return { type: item.type, apiId };
        });

        const knownModeTypes = new Set(DEFAULT_FUNCTION_MODES.map((item) => item.type));
        const mergedModes = new Map<APIUsageType, FunctionModeConfig>();
        DEFAULT_FUNCTION_MODES.forEach((item) => mergedModes.set(item.type, { ...item }));

        const savedModes = Array.isArray(data.functionModes) ? data.functionModes : [];
        for (const item of savedModes) {
          const type = item?.type as APIUsageType;
          const mode = item?.mode === 'standard' ? 'standard' : 'raw';
          if (!type || !knownModeTypes.has(type)) continue;
          mergedModes.set(type, { type, mode });
        }
        functionModes.value = DEFAULT_FUNCTION_MODES.map((item) => mergedModes.get(item.type) || item);

        const knownEnabledTypes = new Set(DEFAULT_FUNCTION_ENABLED.map((item) => item.type));
        const mergedEnabled = new Map<APIUsageType, FunctionEnabledConfig>();
        DEFAULT_FUNCTION_ENABLED.forEach((item) => mergedEnabled.set(item.type, { ...item }));

        const savedEnabled = Array.isArray(data.functionEnabled) ? data.functionEnabled : [];
        for (const item of savedEnabled) {
          const type = item?.type as APIUsageType;
          const enabled = item?.enabled === true;
          if (!type || !knownEnabledTypes.has(type)) continue;
          mergedEnabled.set(type, { type, enabled });
        }
        functionEnabled.value = DEFAULT_FUNCTION_ENABLED.map((item) => mergedEnabled.get(item.type) || item);

        saveToStorage();
      }

      if (ensureDefaultApiConfig()) {
        saveToStorage();
      }
    } catch (error) {
      console.error('[API管理] 加载配置失败:', error);
    }
  };

  const addAPI = (config: Omit<APIConfig, 'id'>) => {
    const newAPI: APIConfig = {
      ...config,
      id: `api_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    };
    apiConfigs.value.push(newAPI);
    saveToStorage();
    return newAPI.id;
  };

  const updateAPI = (id: string, updates: Partial<APIConfig>) => {
    const index = apiConfigs.value.findIndex((api) => api.id === id);
    if (index === -1) return;

    apiConfigs.value[index] = { ...apiConfigs.value[index], ...updates };
    saveToStorage();
  };

  const deleteAPI = (id: string) => {
    if (id === 'default') {
      throw new Error('不能删除默认API配置');
    }

    apiAssignments.value.forEach((assignment) => {
      if (assignment.apiId === id) {
        assignment.apiId = 'default';
      }
    });

    apiConfigs.value = apiConfigs.value.filter((api) => api.id !== id);
    saveToStorage();
  };

  const assignAPI = (type: APIUsageType, apiId: string) => {
    const assignment = apiAssignments.value.find((item) => item.type === type);
    if (assignment) {
      assignment.apiId = apiId;
    } else {
      apiAssignments.value.push({ type, apiId });
    }
    saveToStorage();
  };

  const getAPIForType = (type: APIUsageType): APIConfig | null => {
    const assignment = apiAssignments.value.find((item) => item.type === type);
    if (!assignment) return null;

    const api = apiConfigs.value.find((item) => item.id === assignment.apiId && item.enabled);
    if (api) return api;

    return apiConfigs.value.find((item) => item.id === 'default') || null;
  };

  const toggleAPI = (id: string) => {
    const api = apiConfigs.value.find((item) => item.id === id);
    if (!api) return;

    api.enabled = !api.enabled;
    saveToStorage();
  };

  const setFunctionMode = (type: APIUsageType, mode: GenerationMode) => {
    const config = functionModes.value.find((item) => item.type === type);
    if (config) {
      config.mode = mode;
    } else {
      functionModes.value.push({ type, mode });
    }
    saveToStorage();
  };

  const getFunctionMode = (type: APIUsageType): GenerationMode => {
    const config = functionModes.value.find((item) => item.type === type);
    return config?.mode || 'raw';
  };

  const setFunctionEnabled = (type: APIUsageType, enabled: boolean) => {
    const config = functionEnabled.value.find((item) => item.type === type);
    if (config) {
      config.enabled = enabled;
    } else {
      functionEnabled.value.push({ type, enabled });
    }
    saveToStorage();
  };

  const isFunctionEnabled = (type: APIUsageType): boolean => {
    const config = functionEnabled.value.find((item) => item.type === type);
    return config?.enabled ?? true;
  };

  const updateAIGenerationSettings = (settings: Partial<typeof aiGenerationSettings.value>) => {
    aiGenerationSettings.value = { ...aiGenerationSettings.value, ...settings };
    saveToStorage();
  };

  const exportConfig = () => ({
    apiConfigs: apiConfigs.value,
    apiAssignments: apiAssignments.value,
    functionModes: functionModes.value,
    functionEnabled: functionEnabled.value,
    aiGenerationSettings: aiGenerationSettings.value,
    exportTime: new Date().toISOString(),
  });

  const importConfig = (data: any) => {
    try {
      if (Array.isArray(data.apiConfigs)) {
        apiConfigs.value = data.apiConfigs;
      }
      if (Array.isArray(data.apiAssignments)) {
        apiAssignments.value = data.apiAssignments;
      }
      if (Array.isArray(data.functionModes)) {
        functionModes.value = data.functionModes;
      }
      if (Array.isArray(data.functionEnabled)) {
        functionEnabled.value = data.functionEnabled;
      }
      if (data.aiGenerationSettings) {
        aiGenerationSettings.value = {
          ...aiGenerationSettings.value,
          ...data.aiGenerationSettings,
        };
      }

      ensureDefaultApiConfig();
      saveToStorage();
    } catch (error) {
      console.error('[API管理] 导入配置失败:', error);
      throw error;
    }
  };

  return {
    apiConfigs,
    apiAssignments,
    functionModes,
    functionEnabled,
    aiGenerationSettings,
    enabledAPIs,
    shouldEnableSplitGeneration,
    loadFromStorage,
    saveToStorage,
    addAPI,
    updateAPI,
    deleteAPI,
    assignAPI,
    getAPIForType,
    toggleAPI,
    setFunctionMode,
    getFunctionMode,
    setFunctionEnabled,
    isFunctionEnabled,
    updateAIGenerationSettings,
    exportConfig,
    importConfig,
  };
});
