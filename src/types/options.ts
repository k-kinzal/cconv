export type OutputFormat = 'text' | 'json' | 'reviewdog' | 'sarif';
export type SeverityLevel = 'critical' | 'error' | 'warning' | 'info';

export interface GlobalOptions {
  verbose?: boolean;
  maxConcurrency?: number;
  maxRetries?: number;
  timeout?: number;
  config?: string;
  output?: OutputFormat;
  minSeverity?: SeverityLevel;
}