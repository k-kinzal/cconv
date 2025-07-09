// Re-export types from config-schema
export { Config, ProviderConfig, ReviewRule, FilePatterns, SeverityLevel } from './config-schema.js';

import type { ReviewRule, SeverityLevel } from './config-schema.js';

// Additional types not in schema
export interface ReviewResult {
  file: string;
  line: number;
  column: number;
  ruleId: string;
  message: string;
  severity: SeverityLevel;
}

export interface FixResult {
  success: boolean;
  description: string;
  startLine: number;
  endLine: number;
  originalContent: string;
  fixedContent: string;
  reasoning: string;
  confidence: number;
  appliedChange: string;
}

export interface Provider {
  generateRules(content: string): Promise<ReviewRule[]>;
  reviewFile(filePath: string, content: string, rule: ReviewRule): Promise<ReviewResult[]>;
  reviewDiff(filePath: string, diffContent: string, rule: ReviewRule): Promise<ReviewResult[]>;
  fixIssue(filePath: string, content: string, result: ReviewResult, rule: ReviewRule): Promise<FixResult>;
}

// Reviewdog format types
export interface ReviewdogPosition {
  line: number;
  column: number;
}

export interface ReviewdogRange {
  start: ReviewdogPosition;
  end?: ReviewdogPosition;
}

export interface ReviewdogLocation {
  path: string;
  range: ReviewdogRange;
}

export interface ReviewdogCode {
  value: string;
  url?: string;
}

export interface ReviewdogSuggestion {
  range: ReviewdogRange;
  text: string;
}

export interface ReviewdogSource {
  name: string;
  url?: string;
}

export interface ReviewdogDiagnostic {
  message: string;
  location: ReviewdogLocation;
  severity: 'ERROR' | 'WARNING' | 'INFO' | 'UNKNOWN_SEVERITY';
  code?: ReviewdogCode;
  suggestions?: ReviewdogSuggestion[];
  source?: ReviewdogSource;
}

export interface ReviewdogResult {
  source: ReviewdogSource;
  severity: 'ERROR' | 'WARNING' | 'INFO' | 'UNKNOWN_SEVERITY';
  diagnostics: ReviewdogDiagnostic[];
}