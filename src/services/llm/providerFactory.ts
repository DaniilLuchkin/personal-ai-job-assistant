import type { Settings } from '../../types/models';
import { HeuristicProvider } from './HeuristicProvider';
import { OpenRouterProvider } from './OpenRouterProvider';
import type { LLMProvider } from './LLMProvider';
export const getLLMProvider = (settings: Settings): LLMProvider => settings.openRouterApiKey && settings.openRouterModel ? new OpenRouterProvider(settings.openRouterApiKey, settings.openRouterModel, settings.temperature, settings.maxTokens) : new HeuristicProvider();
