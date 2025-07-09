import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { parse, stringify } from 'yaml';
import * as v from 'valibot';
import { Config, ConfigSchema } from '../types/config-schema.js';
import { logger } from '../utils/logger.js';

export class ConfigManager {
  private configFile: string;
  private config: Config | null = null;

  constructor(configFile?: string) {
    this.configFile = configFile || join(process.cwd(), '.cconv.yaml');
  }

  async loadConfig(): Promise<Config> {
    if (this.config) {
      logger.config.verbose('Using cached configuration');
      return this.config;
    }

    logger.config.verbose('Loading configuration from: %s', this.configFile);
    
    if (!existsSync(this.configFile)) {
      logger.config.verbose('No configuration file found, using defaults');
      this.config = { rules: [], minSeverity: 'info' };
      return this.config;
    }

    try {
      const content = await readFile(this.configFile, 'utf-8');
      const parsedConfig = parse(content) || {};
      
      // Validate with valibot
      try {
        this.config = v.parse(ConfigSchema, parsedConfig);
        logger.config.verbose('Configuration loaded and validated successfully');
      } catch (validationError) {
        if (v.isValiError(validationError)) {
          const errorDetails = `Invalid configuration format: ${validationError.message}`;
          console.error(errorDetails);
          console.error('Validation issues:', JSON.stringify(validationError.issues, null, 2));
          throw new Error(errorDetails);
        }
        throw validationError;
      }
      
      return this.config;
    } catch (error) {
      logger.config.verbose('Failed to load config: %s', error instanceof Error ? error.message : 'Unknown error');
      console.error('Failed to load config:', error);
      this.config = { rules: [], minSeverity: 'info' };
      return this.config;
    }
  }

  async saveConfig(config: Config): Promise<void> {
    logger.config.verbose('Saving configuration to: %s', this.configFile);
    
    // Validate with valibot before saving
    try {
      const validatedConfig = v.parse(ConfigSchema, config);
      const content = stringify(validatedConfig);
      await writeFile(this.configFile, content, 'utf-8');
      this.config = validatedConfig;
      logger.config.verbose('Configuration saved with %d rules', validatedConfig.rules?.length || 0);
    } catch (validationError) {
      if (v.isValiError(validationError)) {
        const errorDetails = `Invalid configuration format: ${validationError.message}`;
        console.error(errorDetails);
        console.error('Validation issues:', JSON.stringify(validationError.issues, null, 2));
        throw new Error(errorDetails);
      }
      throw validationError;
    }
  }

  async getConfig(): Promise<Config> {
    return await this.loadConfig();
  }


}