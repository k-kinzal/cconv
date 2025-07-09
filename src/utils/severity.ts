import { SeverityLevel, ReviewRule } from '../types/index.js';

// Severity levels in order from highest to lowest priority
const SEVERITY_ORDER: SeverityLevel[] = ['critical', 'error', 'warning', 'info'];

/**
 * Get the numeric priority for a severity level (higher number = higher priority)
 */
export function getSeverityPriority(severity: SeverityLevel): number {
  const index = SEVERITY_ORDER.indexOf(severity);
  return index === -1 ? 0 : SEVERITY_ORDER.length - index;
}

/**
 * Check if an issue severity meets the minimum required severity level
 */
export function meetsMinSeverity(issueSeverity: SeverityLevel, minSeverity: SeverityLevel): boolean {
  return getSeverityPriority(issueSeverity) >= getSeverityPriority(minSeverity);
}

/**
 * Filter rules by minimum severity level
 */
export function filterRulesBySeverity(rules: ReviewRule[], minSeverity: SeverityLevel): ReviewRule[] {
  return rules.filter(rule => meetsMinSeverity(rule.severity || 'warning', minSeverity));
}

/**
 * Get color for severity level in console output
 */
export function getSeverityColor(severity: SeverityLevel): string {
  switch (severity) {
    case 'critical': return 'magenta';
    case 'error': return 'red';
    case 'warning': return 'yellow';
    case 'info': return 'blue';
    default: return 'gray';
  }
}

/**
 * Convert severity to SARIF level
 */
export function severityToSarifLevel(severity: SeverityLevel): 'error' | 'warning' | 'note' {
  switch (severity) {
    case 'critical':
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'note';
    default:
      return 'warning';
  }
}

/**
 * Convert severity to reviewdog severity
 */
export function severityToReviewdogLevel(severity: SeverityLevel): 'ERROR' | 'WARNING' | 'INFO' {
  switch (severity) {
    case 'critical':
    case 'error':
      return 'ERROR';
    case 'warning':
      return 'WARNING';
    case 'info':
      return 'INFO';
    default:
      return 'WARNING';
  }
}