import { Provider, ProviderConfig } from '../types/index.js';
import { ClaudeProvider } from './claude-provider.js';
import { ConfigManager } from './config-manager.js';
import { GlobalOptions } from '../types/options.js';

export class ProviderFactory {
  static async create(globalOptions: GlobalOptions = {}): Promise<Provider> {
    const configManager = new ConfigManager();
    const config = await configManager.getConfig();
    
    const providerConfig = this.getProviderConfig(config.provider, globalOptions);
    
    // For now, we only support Claude provider
    // In the future, we can add more providers based on the command
    return new ClaudeProvider(providerConfig, globalOptions);
  }

  private static getProviderConfig(configProvider?: ProviderConfig, globalOptions: GlobalOptions = {}): ProviderConfig {
    // Priority: global options > config file > defaults
    const baseConfig: ProviderConfig = {
      type: 'claude',
      command: 'claude',
      maxConcurrency: 5,
      maxRetries: 3,
      timeout: 120000,
      executionInterval: 10
    };

    // Apply config file settings
    if (configProvider) {
      Object.assign(baseConfig, configProvider);
      // Ensure type is set
      if (!baseConfig.type) {
        baseConfig.type = 'claude';
      }
    }

    // Apply global options (highest priority)
    if (globalOptions.maxConcurrency !== undefined) {
      baseConfig.maxConcurrency = globalOptions.maxConcurrency;
    }
    if (globalOptions.maxRetries !== undefined) {
      baseConfig.maxRetries = globalOptions.maxRetries;
    }
    if (globalOptions.timeout !== undefined) {
      baseConfig.timeout = globalOptions.timeout;
    }

    return baseConfig;
  }
}