import type { Settings } from '../../types/models';
import { HeuristicProvider } from './HeuristicProvider';
import { OpenRouterProvider } from './OpenRouterProvider';
import type { LLMProvider } from './LLMProvider';
import { BackendLLMProvider } from './BackendLLMProvider';
export const getLLMProvider = (settings: Settings): LLMProvider => settings.syncEnabled && settings.backendUrl && settings.backendToken ? new BackendLLMProvider(settings) : settings.openRouterApiKey && settings.openRouterModel ? new OpenRouterProvider(settings.openRouterApiKey, settings.openRouterModel, settings.temperature, settings.maxTokens) : new HeuristicProvider();
