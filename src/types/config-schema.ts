import * as v from 'valibot';

// Provider configuration schema
export const ProviderConfigSchema = v.object({
  type: v.optional(
    v.pipe(
      v.string(),
      v.picklist(['claude'], 'Provider type must be "claude"')
    ),
    'claude'
  ),
  command: v.optional(
    v.pipe(
      v.string(),
      v.minLength(1, 'Provider command cannot be empty')
    ),
    'claude'
  ),
  maxConcurrency: v.optional(
    v.pipe(
      v.number(),
      v.integer('Max concurrency must be an integer'),
      v.minValue(1, 'Max concurrency must be at least 1'),
      v.maxValue(20, 'Max concurrency cannot exceed 20')
    ),
    5
  ),
  maxRetries: v.optional(
    v.pipe(
      v.number(),
      v.integer('Max retries must be an integer'),
      v.minValue(1, 'Max retries must be at least 1'),
      v.maxValue(10, 'Max retries cannot exceed 10')
    ),
    3
  ),
  timeout: v.optional(
    v.pipe(
      v.number(),
      v.integer('Timeout must be an integer'),
      v.minValue(1, 'Timeout must be at least 1ms')
    ),
    120000 // Default 120 seconds
  ),
  // Claude-specific options (when type is 'claude')
  mcpDebug: v.optional(v.boolean()),
  dangerouslySkipPermissions: v.optional(v.boolean()),
  allowedTools: v.optional(v.array(v.string())),
  disallowedTools: v.optional(v.array(v.string())),
  mcpConfig: v.optional(v.string()),
  model: v.optional(v.string()),
  fallbackModel: v.optional(v.string()),
  addDir: v.optional(v.array(v.string())),
  // Legacy args field (ignored, kept for backward compatibility)
  args: v.optional(v.array(v.string()))
});

// Severity level schema
export const SeverityLevelSchema = v.picklist(['critical', 'error', 'warning', 'info'], 'Severity must be one of: critical, error, warning, info');

// Review rule schema
export const ReviewRuleSchema = v.object({
  id: v.pipe(
    v.string(),
    v.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Rule ID must be in kebab-case'),
    v.minLength(1, 'Rule ID cannot be empty')
  ),
  description: v.pipe(
    v.string(),
    v.minLength(20, 'Rule description must be at least 20 characters')
  ),
  severity: v.optional(SeverityLevelSchema, 'warning'),
  correct: v.pipe(
    v.string(),
    v.minLength(10, 'Correct example must be at least 10 characters')
  ),
  incorrect: v.pipe(
    v.string(),
    v.minLength(10, 'Incorrect example must be at least 10 characters')
  ),
  fix: v.pipe(
    v.string(),
    v.minLength(20, 'Fix instructions must be at least 20 characters')
  )
});

// File patterns schema
export const FilePatternsSchema = v.object({
  include: v.optional(
    v.pipe(
      v.array(v.string()),
      v.minLength(0)
    ),
    []
  ),
  exclude: v.optional(
    v.pipe(
      v.array(v.string()),
      v.minLength(0)
    ),
    ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/build/**', '**/coverage/**']
  )
});

// Main config schema
export const ConfigSchema = v.object({
  provider: v.optional(ProviderConfigSchema),
  rules: v.optional(
    v.pipe(
      v.array(ReviewRuleSchema),
      v.minLength(0)
    ),
    []
  ),
  filePatterns: v.optional(FilePatternsSchema),
  minSeverity: v.optional(SeverityLevelSchema, 'info')
});

// Fix result schema
export const FixResultSchema = v.object({
  success: v.boolean('Success must be a boolean'),
  description: v.pipe(
    v.string(),
    v.minLength(5, 'Description must be at least 5 characters')
  ),
  startLine: v.pipe(
    v.number(),
    v.integer('Start line must be an integer'),
    v.minValue(1, 'Start line must be at least 1')
  ),
  endLine: v.pipe(
    v.number(),
    v.integer('End line must be an integer'),
    v.minValue(1, 'End line must be at least 1')
  ),
  originalContent: v.string('Original content must be a string'),
  fixedContent: v.string('Fixed content must be a string'),
  reasoning: v.pipe(
    v.string(),
    v.minLength(10, 'Reasoning must be at least 10 characters')
  ),
  confidence: v.pipe(
    v.number(),
    v.integer('Confidence must be an integer'),
    v.minValue(0, 'Confidence must be at least 0'),
    v.maxValue(100, 'Confidence cannot exceed 100')
  ),
  appliedChange: v.string('Applied change must be a string')
});

// Type inference
export type Config = v.InferOutput<typeof ConfigSchema>;
export type ProviderConfig = v.InferOutput<typeof ProviderConfigSchema>;
export type ReviewRule = v.InferOutput<typeof ReviewRuleSchema>;
export type FilePatterns = v.InferOutput<typeof FilePatternsSchema>;
export type FixResult = v.InferOutput<typeof FixResultSchema>;
export type SeverityLevel = v.InferOutput<typeof SeverityLevelSchema>;