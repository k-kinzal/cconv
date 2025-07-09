import { OutputFormat } from '../types/options.js';
import { ReviewRule, ReviewResult, FixResult, ReviewdogResult, ReviewdogDiagnostic } from '../types/index.js';
import { SarifBuilder, SarifRunBuilder, SarifResultBuilder, SarifRuleBuilder } from 'node-sarif-builder';
import { getSeverityColor, severityToSarifLevel, severityToReviewdogLevel } from './severity.js';
import pc from 'picocolors';

interface FixResultData {
  results: Array<{
    success: boolean;
    issue: ReviewResult;
    fix: FixResult;
  }>;
  summary: {
    totalFixed: number;
    filesFixed: number;
  };
}

export interface OutputData {
  type: 'rules' | 'rule' | 'review' | 'fix';
  data: ReviewRule[] | ReviewRule | ReviewResult[] | FixResultData | null;
  success?: boolean;
  message?: string;
}

export function formatOutput(outputData: OutputData, format: OutputFormat = 'text'): string {
  if (format === 'json') {
    return JSON.stringify(outputData);
  }
  
  if (format === 'reviewdog') {
    return formatReviewdog(outputData);
  }
  
  if (format === 'sarif') {
    return formatSarif(outputData);
  }
  
  // Text format
  switch (outputData.type) {
    case 'rules':
      return formatRulesText(outputData.data as ReviewRule[]);
    case 'rule':
      return formatRuleText(outputData.data as ReviewRule);
    case 'review':
      return formatReviewText(outputData.data as ReviewResult[]);
    case 'fix':
      return formatFixText(outputData.data as FixResultData);
    default:
      return outputData.message || '';
  }
}

function formatRulesText(rules: ReviewRule[]): string {
  if (rules.length === 0) {
    return pc.yellow('No review rules found.');
  }
  
  return rules.map(rule => 
    `${pc.blue(rule.id)}: ${rule.description.substring(0, 80)}${rule.description.length > 80 ? '...' : ''}`
  ).join('\n');
}

function formatRuleText(rule: ReviewRule): string {
  return `${pc.blue('ID:')} ${rule.id}
${pc.blue('Description:')} ${rule.description}

${pc.green('Correct Example:')}
${rule.correct}

${pc.red('Incorrect Example:')}
${rule.incorrect}

${pc.yellow('Fix Instructions:')}
${rule.fix}`;
}

function formatReviewText(results: ReviewResult[]): string {
  if (results.length === 0) {
    return pc.green('✓ No issues found!');
  }
  
  const output = results.map(result => {
    const colorName = getSeverityColor(result.severity);
    const severityColor = (pc[colorName as keyof typeof pc] as typeof pc.gray) || pc.gray;
    return `${result.file}:${result.line}:${result.column}: ${severityColor(result.severity)} [${result.ruleId}] ${result.message}`;
  }).join('\n');
  
  return output + `\n\n${pc.red('✗ Found ' + results.length + ' issues')}`;
}

function formatFixText(data: FixResultData): string {
  const { results, summary } = data;
  
  if (results.length === 0) {
    return pc.green('✓ No issues found to fix!');
  }
  
  const output = results.map(({ success, issue, fix }) => {
    if (success) {
      return `  ${pc.green('✓')} Fixed ${issue.ruleId} at line ${issue.line}
    ${fix.description}
    Confidence: ${fix.confidence}%${fix.reasoning ? '\n    Reason: ' + fix.reasoning : ''}`;
    } else {
      return `  ${pc.yellow('⚠')} Failed to fix ${issue.ruleId} at line ${issue.line}
    ${fix.description || 'No description provided'}${fix.reasoning ? '\n    Reason: ' + fix.reasoning : ''}`;
    }
  }).join('\n');
  
  return output + `\n\n${pc.green('✓ Fixed ' + summary.totalFixed + ' issues in ' + summary.filesFixed + ' files')}`;
}

function formatReviewdog(outputData: OutputData): string {
  // Only review type supports reviewdog format
  if (outputData.type !== 'review') {
    return '';
  }
  
  const results = outputData.data as ReviewResult[];
  
  if (results.length === 0) {
    return '';
  }
  
  const diagnostics: ReviewdogDiagnostic[] = results.map(result => ({
    message: result.message,
    location: {
      path: result.file,
      range: {
        start: {
          line: result.line,
          column: result.column
        }
      }
    },
    severity: severityToReviewdogLevel(result.severity),
    code: {
      value: result.ruleId
    },
    source: {
      name: 'reviewit'
    }
  }));
  
  const reviewdogResult: ReviewdogResult = {
    source: {
      name: 'reviewit',
      url: 'https://github.com/reviewit'
    },
    severity: results.some(r => r.severity === 'critical' || r.severity === 'error') ? 'ERROR' : 'WARNING',
    diagnostics
  };
  
  return JSON.stringify(reviewdogResult);
}

function formatSarif(outputData: OutputData): string {
  // Only review type supports SARIF format
  if (outputData.type !== 'review') {
    return '';
  }
  
  const results = outputData.data as ReviewResult[];
  
  const sarifBuilder = new SarifBuilder();
  const sarifRunBuilder = new SarifRunBuilder().initSimple({
    toolDriverName: "reviewit",
    toolDriverVersion: "1.0.0",
    url: "https://github.com/reviewit"
  });
  
  if (results.length === 0) {
    sarifBuilder.addRun(sarifRunBuilder);
    return sarifBuilder.buildSarifJsonString({ indent: false });
  }
  
  // Group rules by ID for efficient rule registration
  const ruleMap = new Map<string, ReviewResult>();
  results.forEach(result => {
    if (!ruleMap.has(result.ruleId)) {
      ruleMap.set(result.ruleId, result);
    }
  });
  
  // Add rules to the run
  ruleMap.forEach((result, ruleId) => {
    const ruleBuilder = new SarifRuleBuilder().initSimple({
      ruleId: ruleId,
      shortDescriptionText: result.message,
      fullDescriptionText: `Code review rule: ${ruleId}`
    });
    sarifRunBuilder.addRule(ruleBuilder);
  });
  
  // Add results
  results.forEach(result => {
    const level = severityToSarifLevel(result.severity);
    const resultBuilder = new SarifResultBuilder()
      .initSimple({
        ruleId: result.ruleId,
        level: level,
        messageText: result.message,
        fileUri: result.file,
        startLine: result.line,
        startColumn: result.column
      });
    
    sarifRunBuilder.addResult(resultBuilder);
  });
  
  sarifBuilder.addRun(sarifRunBuilder);
  return sarifBuilder.buildSarifJsonString({ indent: false });
}

export function outputResult(outputData: OutputData, format: OutputFormat = 'text'): void {
  const formattedOutput = formatOutput(outputData, format);
  
  if (format === 'json' || format === 'reviewdog' || format === 'sarif') {
    console.log(formattedOutput);
  } else {
    // For text format, use appropriate console method based on success
    if (outputData.success === false) {
      console.error(formattedOutput);
    } else {
      console.log(formattedOutput);
    }
  }
}