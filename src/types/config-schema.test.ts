import { describe, expect, it } from '@jest/globals';
import * as v from 'valibot';
import { ProviderConfigSchema } from '../types/config-schema.js';

describe('ProviderConfigSchema', () => {
  describe('executionInterval', () => {
    it('should accept valid execution intervals', () => {
      const validConfigs = [
        { executionInterval: 0 },
        { executionInterval: 10 },
        { executionInterval: 500 },
        { executionInterval: 1000 },
      ];

      validConfigs.forEach(config => {
        expect(() => v.parse(ProviderConfigSchema, config)).not.toThrow();
      });
    });

    it('should use default value of 10ms when not specified', () => {
      const config = {};
      const parsed = v.parse(ProviderConfigSchema, config);
      expect(parsed.executionInterval).toBe(10);
    });

    it('should reject negative values', () => {
      const config = { executionInterval: -1 };
      expect(() => v.parse(ProviderConfigSchema, config)).toThrow('Execution interval must be at least 0ms');
    });

    it('should reject values greater than 1000ms', () => {
      const config = { executionInterval: 1001 };
      expect(() => v.parse(ProviderConfigSchema, config)).toThrow('Execution interval cannot exceed 1000ms');
    });

    it('should reject non-integer values', () => {
      const config = { executionInterval: 10.5 };
      expect(() => v.parse(ProviderConfigSchema, config)).toThrow('Execution interval must be an integer');
    });

    it('should accept boundary values', () => {
      // Test minimum boundary
      const minConfig = { executionInterval: 0 };
      const minParsed = v.parse(ProviderConfigSchema, minConfig);
      expect(minParsed.executionInterval).toBe(0);

      // Test maximum boundary
      const maxConfig = { executionInterval: 1000 };
      const maxParsed = v.parse(ProviderConfigSchema, maxConfig);
      expect(maxParsed.executionInterval).toBe(1000);
    });

    it('should handle optional field correctly', () => {
      // Ensure field is optional
      const configWithoutField = { command: 'claude' };
      const parsed = v.parse(ProviderConfigSchema, configWithoutField);
      expect(parsed.executionInterval).toBe(10); // Should have default value
    });
  });

  describe('integration with other fields', () => {
    it('should work with complete provider config', () => {
      const fullConfig = {
        command: 'claude',
        maxRetries: 3,
        timeout: 60000,
        executionInterval: 50,
        mcpDebug: false,
        dangerouslySkipPermissions: false,
        allowedTools: ['tool1', 'tool2'],
        disallowedTools: ['tool3'],
        mcpConfig: '/path/to/config',
        model: 'claude-3',
        fallbackModel: 'claude-2',
        addDir: ['/dir1', '/dir2']
      };

      const parsed = v.parse(ProviderConfigSchema, fullConfig);
      expect(parsed.executionInterval).toBe(50);
      expect(parsed.command).toBe('claude');
    });
  });
});