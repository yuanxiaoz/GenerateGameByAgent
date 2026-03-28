import { buildBackendUrl } from './backendConfig';

export const SERVER_MANAGED_API_KEY = 'server-managed';
export const DEFAULT_SERVER_PROXY_API_NAME = '服务器内置API';
export const DEFAULT_SERVER_PROXY_PROVIDER = 'custom' as const;
export const DEFAULT_SERVER_PROXY_TEMPERATURE = 0.7;
export const DEFAULT_SERVER_PROXY_MAX_TOKENS = 16000;
export const DEFAULT_SERVER_PROXY_FORCE_JSON = false;

const normalizeUrl = (value?: string | null): string => String(value || '').trim().replace(/\/+$/, '');

export interface ServerForwardedAPIOverrides {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  forceJsonOutput?: boolean;
}

export interface ServerForwardedDefaultApiConfigOverrides extends ServerForwardedAPIOverrides {
  name?: string;
  enabled?: boolean;
}

export const getDefaultServerProxyApiBaseUrl = (): string =>
  normalizeUrl(buildBackendUrl(DEFAULT_AI_PROXY_PATH || '/api/v1/ai-proxy'));

export const createServerForwardedAPIFields = (overrides: ServerForwardedAPIOverrides = {}) => ({
  provider: DEFAULT_SERVER_PROXY_PROVIDER,
  url: getDefaultServerProxyApiBaseUrl(),
  apiKey: SERVER_MANAGED_API_KEY,
  model: overrides.model || DEFAULT_FORWARD_MODEL || 'deepseek-chat',
  temperature: overrides.temperature ?? DEFAULT_SERVER_PROXY_TEMPERATURE,
  maxTokens: overrides.maxTokens ?? DEFAULT_SERVER_PROXY_MAX_TOKENS,
  forceJsonOutput: overrides.forceJsonOutput ?? DEFAULT_SERVER_PROXY_FORCE_JSON,
});

export const createServerForwardedDefaultApiConfig = (
  overrides: ServerForwardedDefaultApiConfigOverrides = {}
) => ({
  id: 'default',
  name: overrides.name || DEFAULT_SERVER_PROXY_API_NAME,
  enabled: overrides.enabled ?? true,
  useServerManaged: true,
  ...createServerForwardedAPIFields(overrides),
});

export const shouldHydrateServerForwardedDefault = (
  config?: { url?: string; apiKey?: string; provider?: string | null; useServerManaged?: boolean | null } | null
): boolean => {
  const url = normalizeUrl(config?.url);
  const apiKey = String(config?.apiKey || '').trim();
  const provider = String(config?.provider || '').trim();

  if (config?.useServerManaged === true) return true;
  if (!url) return true;

  // Migrate the old blank OpenAI default to the server-forwarded default.
  if (url === 'https://api.openai.com' && !apiKey && (!provider || provider === 'openai' || provider === 'custom')) {
    return true;
  }

  return false;
};
