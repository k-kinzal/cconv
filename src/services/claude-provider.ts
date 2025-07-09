import { spawn } from 'child_process';
import pc from 'picocolors';
import { ReviewRule, ReviewResult, Provider, ProviderConfig, FixResult } from '../types/index.js';
import { FixResultSchema, ReviewRuleSchema, SeverityLevelSchema } from '../types/config-schema.js';
import { GlobalOptions } from '../types/options.js';
import { logger, enableVerboseLogging } from '../utils/logger.js';
import { extractJsonFromResponse } from '../utils/extract-json.js';
import * as v from 'valibot';

export class ClaudeProvider implements Provider {
  private config: ProviderConfig;

  constructor(config: ProviderConfig, globalOptions: GlobalOptions = {}) {
    this.config = config;
    
    if (globalOptions.verbose) {
      enableVerboseLogging();
    }
  }

  private async runClaudeWithRetry(prompt: string, sessionId?: string, lastError?: unknown): Promise<string> {
    if (sessionId && lastError && !(lastError as Error & { isExecutionError?: boolean }).isExecutionError) {
      // For format errors, send error correction prompt with session ID
      const errorPrompt = this.createErrorCorrectionPrompt(lastError);
      return this.runClaude(errorPrompt, sessionId);
    }
    
    // For execution errors or initial attempts, run without session ID
    return this.runClaude(prompt);
  }
  
  private createErrorCorrectionPrompt(error: unknown): string {
    let errorMessage = 'The previous response had validation errors. ';
    
    const typedError = error as { validationError?: { message: string; issues: unknown[] }; message?: string };
    
    if (typedError.validationError) {
      errorMessage += `Validation error: ${typedError.validationError.message}\n`;
      errorMessage += `Issues: ${JSON.stringify(typedError.validationError.issues, null, 2)}\n`;
    } else if (typedError.message) {
      errorMessage += typedError.message + '\n';
    }
    
    errorMessage += '\nPlease provide a valid JSON array that conforms to the schema. Return ONLY the JSON array, no additional text.';
    
    return errorMessage;
  }

  private async runClaude(prompt: string, sessionId?: string): Promise<string> {
    const args: string[] = [];
    
    // Always use JSON output format for structured responses
    args.push('--output-format', 'json');
    
    // Add resume flag if session ID is provided
    if (sessionId) {
      args.push('--resume', sessionId);
    }
    
    // Add Claude-specific options
    if (this.config.mcpDebug) {
      args.push('--mcp-debug');
    }
    if (this.config.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }
    if (this.config.allowedTools && this.config.allowedTools.length > 0) {
      args.push('--allowedTools', ...this.config.allowedTools);
    }
    if (this.config.disallowedTools && this.config.disallowedTools.length > 0) {
      args.push('--disallowedTools', ...this.config.disallowedTools);
    }
    if (this.config.mcpConfig) {
      args.push('--mcp-config', this.config.mcpConfig);
    }
    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    if (this.config.fallbackModel) {
      args.push('--fallback-model', this.config.fallbackModel);
    }
    if (this.config.addDir && this.config.addDir.length > 0) {
      args.push('--add-dir', ...this.config.addDir);
    }
    
    // Add prompt last
    args.push(prompt);
    
    logger.provider.verbose('Executing: %s %s', this.config.command || 'claude', args.slice(0, -1).join(' ') + ' [prompt]');
    
    return new Promise((resolve, reject) => {
      let resolved = false;
      const timeoutMs = this.config.timeout || 120000; // Default 120 seconds
      const timeoutSec = Math.round(timeoutMs / 1000);
      
      const timeout = setTimeout(() => {
        if (!resolved) {
          logger.provider.verbose(`Command timed out after ${timeoutSec} seconds`);
          claude.kill('SIGTERM');
          reject(new Error(`Claude command timed out after ${timeoutSec} seconds`));
        }
      }, timeoutMs);
      
      const claude = spawn(this.config.command || 'claude', args, {
        stdio: ['ignore', 'pipe', 'pipe'],  // stdin を ignore に変更
        shell: false,
        windowsHide: true,
        env: { ...process.env },
        detached: false
      });
      
      // Process is started, stderr will show progress
      
      // Set encoding for streams and increase buffer size
      claude.stdout.setEncoding('utf8');
      claude.stderr.setEncoding('utf8');
      
      // Increase the buffer size for stdout to handle large responses
      claude.stdout.setMaxListeners(0);

      let output = '';
      let error = '';
      const stdoutBuffer: string[] = [];

      claude.stdout.on('data', (chunk) => {
        // Collect stdout separately from debug output
        stdoutBuffer.push(chunk);
        
        // When verbose is enabled, show Claude's debug output in real-time
        if (logger.provider.enabled) {
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('[DEBUG]') || 
                line.startsWith('[INFO]') || 
                line.startsWith('[WARNING]') || 
                line.startsWith('[ERROR]')) {
              // Show Claude's debug output in gray
              process.stderr.write(pc.gray(line) + '\n');
            }
          }
        }
      });
      
      claude.stdout.on('end', () => {
        // Combine all stdout chunks
        output = stdoutBuffer.join('');
      });

      claude.stderr.on('data', (chunk) => {
        error += chunk;
        
        // Show claude's stderr output when in verbose mode
        if (logger.provider.enabled) {
          // Pass through Claude's stderr in gray
          process.stderr.write(pc.gray(chunk));
        }
      });

      claude.on('error', (err) => {
        logger.provider.verbose('Process error: %s', err.message);
        reject(err);
      });
      
      claude.on('exit', () => {
        // Don't log normal exits
      });

      claude.on('close', (code) => {
        clearTimeout(timeout);
        resolved = true;
        
        if (code !== 0) {
          logger.provider.verbose('Process failed (exit code: %d)', code);
          if (error) {
            console.error('Claude stderr:', error);
          }
          reject(new Error(`Claude process exited with code ${code}: ${error}`));
        } else {
          if (output.length > 0) {
            logger.provider.verbose('Response received (%d bytes)', output.length);
          }
          resolve(output);
        }
      });
    });
  }

  async generateRules(content: string): Promise<ReviewRule[]> {
    const prompt = `Analyze the following content and generate review rules in JSON format.
If the content is a markdown document describing a rule, extract the rule information from it.
If the content is code, analyze it to generate appropriate rules.

IMPORTANT: Follow the Single Responsibility Principle for rules. Each rule should:
- Focus on ONE specific aspect or requirement
- Be independently checkable and fixable
- Have a clear, single purpose
- If the content describes multiple requirements (e.g., "remove unnecessary comments" AND "write comments in English"), create SEPARATE rules for each requirement

Generate rules with:
- Concise but clear code examples (max 10-15 lines per example)
- Clear descriptions (2-3 sentences)
- Focus on the most important aspects

Output must be a JSON array conforming to this JSON Schema:
{
  "type": "array",
  "items": {
    "type": "object",
    "required": ["id", "description", "severity", "correct", "incorrect", "fix"],
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$",
        "description": "Unique identifier in kebab-case"
      },
      "description": {
        "type": "string",
        "minLength": 20,
        "description": "Detailed explanation of what this rule checks for"
      },
      "severity": {
        "type": "string",
        "enum": ["critical", "error", "warning", "info"],
        "description": "Severity level: critical (security/critical bugs), error (bugs/violations), warning (style/maintainability), info (suggestions)"
      },
      "correct": {
        "type": "string",
        "minLength": 10,
        "description": "Complete code example showing correct usage"
      },
      "incorrect": {
        "type": "string",
        "minLength": 10,
        "description": "Complete code example showing incorrect usage"
      },
      "fix": {
        "type": "string",
        "minLength": 20,
        "description": "Detailed instructions on how to fix violations"
      }
    },
    "additionalProperties": false
  },
  "minItems": 1
}

Return ONLY a raw JSON array with no additional text, no markdown formatting, and no code blocks.

SEVERITY GUIDELINES:
- critical: Security vulnerabilities, critical bugs that could cause data loss or system failures
- error: Bugs, logic errors, violations of fundamental principles
- warning: Code style issues, maintainability concerns, potential problems
- info: Suggestions, optimizations, minor improvements

Example format:
[
  {
    "id": "rule-name",
    "description": "Detailed description...",
    "severity": "warning",
    "correct": "Example code...",
    "incorrect": "Example code...",
    "fix": "How to fix..."
  }
]

Content to analyze:
${content}`;

    // Try up to maxRetries times to get valid JSON
    const maxRetries = this.config.maxRetries || 3;
    let lastSessionId: string | undefined;
    let lastError: unknown;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.runClaudeWithRetry(prompt, lastSessionId, lastError);
        const ReviewRulesArraySchema = v.pipe(
          v.array(ReviewRuleSchema),
          v.minLength(1, 'At least one rule must be generated')
        );
        const result = extractJsonFromResponse(response, ReviewRulesArraySchema);
        
        // If we got here, extraction was successful
        return result;
      } catch (error) {
        lastError = error;
        
        // Handle different types of errors
        if ((error as Error & { isExecutionError?: boolean }).isExecutionError) {
          // For execution errors, we'll retry from scratch (no session ID)
          logger.provider.verbose('Claude execution error on attempt %d/%d: %s', attempt, maxRetries, (error as Error).message);
          lastSessionId = undefined;
          lastError = error;
        } else {
          // For format/validation errors, extract session ID for correction
          logger.provider.verbose('Generation failed on attempt %d/%d: %s', attempt, maxRetries, (error as Error).message);
          
          if ((error as Error & { response?: string }).response) {
            try {
              // First try to parse the entire response as JSON
              try {
                const errorObj = JSON.parse((error as Error & { response?: string }).response!);
                if (errorObj.session_id) {
                  lastSessionId = errorObj.session_id;
                  logger.provider.verbose('Extracted session ID for correction: %s', lastSessionId);
                }
              } catch {
                // If full parse fails, try line by line
                const lines = ((error as Error & { response?: string }).response!).split('\n');
                for (const line of lines) {
                  if (line.trim()) {
                    try {
                      const obj = JSON.parse(line);
                      if (obj.session_id) {
                        lastSessionId = obj.session_id;
                        logger.provider.verbose('Extracted session ID for correction: %s', lastSessionId);
                        break;
                      }
                    } catch {
                      // Continue to next line
                    }
                  }
                }
              }
            } catch {
              // Ignore parse errors
            }
          }
          
          lastError = error;
        }
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        logger.provider.verbose('Attempt %d failed, retrying...', attempt);
      }
    }
    
    throw new Error(`Failed to generate rules after ${maxRetries} attempts`);
  }

  async reviewFile(filePath: string, content: string, rule: ReviewRule): Promise<ReviewResult[]> {
    const prompt = `Review the following file based on this rule:

Rule ID: ${rule.id}
Description: ${rule.description}
Correct example: ${rule.correct}
Incorrect example: ${rule.incorrect}

Find all violations in the file and output as JSON array with:
- file: "${filePath}"
- line: line number (1-based)
- column: column number (1-based)
- ruleId: "${rule.id}"
- message: specific violation message
- severity: "${rule.severity || 'warning'}" (use this exact severity level)

If no violations are found, return an empty array: []

File content:
${content}

Output only valid JSON array.`;

    const response = await this.runClaude(prompt);
    return this.extractReviewResults(response);
  }

  async reviewDiff(filePath: string, diffContent: string, rule: ReviewRule): Promise<ReviewResult[]> {
    const prompt = `Review the following git diff based on this rule:

Rule ID: ${rule.id}
Description: ${rule.description}
Correct example: ${rule.correct}
Incorrect example: ${rule.incorrect}

Focus on the changes (additions and deletions) in the diff.
Find violations in the modified code and output as JSON array with:
- file: "${filePath}"
- line: line number in the new file (1-based)
- column: column number (1-based)
- ruleId: "${rule.id}"
- message: specific violation message
- severity: "${rule.severity || 'warning'}" (use this exact severity level)

If no violations are found, return an empty array: []

Git diff:
${diffContent}

Output only valid JSON array.`;

    const response = await this.runClaude(prompt);
    return this.extractReviewResults(response);
  }

  private getLineContext(content: string, lineNumber: number, contextLines: number = 3): { 
    beforeLines: string[], 
    targetLine: string, 
    afterLines: string[] 
  } {
    const lines = content.split('\n');
    const targetIndex = lineNumber - 1; // Convert to 0-based index
    
    return {
      beforeLines: lines.slice(Math.max(0, targetIndex - contextLines), targetIndex),
      targetLine: lines[targetIndex] || '',
      afterLines: lines.slice(targetIndex + 1, targetIndex + 1 + contextLines)
    };
  }

  async fixIssue(filePath: string, content: string, result: ReviewResult, rule: ReviewRule): Promise<FixResult> {
    const context = this.getLineContext(content, result.line);
    
    const prompt = `Fix the following code issue based on the specified rule.

## Issue Details
- **File**: ${filePath}
- **Line**: ${result.line}
- **Column**: ${result.column}
- **Rule**: ${rule.description}
- **Issue**: ${result.message}

## Rule Information
- **Description**: ${rule.description}
- **Fix Guidance**: ${rule.fix}
- **Correct Example**: ${rule.correct}
- **Incorrect Example**: ${rule.incorrect}

## Code Context
\`\`\`
${context.beforeLines.map((line, i) => `${result.line - context.beforeLines.length + i}: ${line}`).join('\n')}
${result.line}: ${context.targetLine} ← **TARGET LINE**
${context.afterLines.map((line, i) => `${result.line + 1 + i}: ${line}`).join('\n')}
\`\`\`

## JSON Schema for Response
You must respond with a JSON object that matches this exact schema:

\`\`\`json
{
  "success": boolean,           // Whether fix was successful
  "description": "string",      // Brief description of what was fixed
  "startLine": number,          // First line of the fix (minimum 1)
  "endLine": number,            // Last line of the fix (>= startLine)
  "originalContent": "string",  // Original content that was replaced
  "fixedContent": "string",     // Fixed content to replace with
  "reasoning": "string",        // Explanation of why this fix was applied
  "confidence": number,         // Confidence level (0-100)
  "appliedChange": "string"     // Description of the exact change made
}
\`\`\`

## Instructions
1. Analyze the issue in the target line and surrounding context
2. Apply the rule's fix guidance to resolve the issue
3. Determine the exact line range that needs to be modified
4. Provide the original content and fixed content for that range
5. Explain your reasoning and confidence level
6. If the issue cannot be fixed, set success to false and explain why

Output only valid JSON matching the schema above.`;

    const response = await this.runClaude(prompt);
    return this.extractFixResult(response);
  }

  private extractFixResult(response: string): FixResult {
    try {
      const result = extractJsonFromResponse(response, FixResultSchema);
      
      // Additional validation: endLine should be >= startLine
      if (result.endLine < result.startLine) {
        throw new Error(`End line (${result.endLine}) cannot be less than start line (${result.startLine})`);
      }
      
      return result;
    } catch (error) {
      const errorDetails = `Failed to parse FixResult from Claude response.
Error: ${error instanceof Error ? error.message : 'Unknown error'}
Raw response: ${response}`;
      
      const enhancedError = new Error(errorDetails) as Error & { validationError?: unknown; response?: string };
      enhancedError.validationError = error;
      enhancedError.response = response;
      throw enhancedError;
    }
  }
  
  private extractReviewResults(response: string): ReviewResult[] {
    // Define validation schema for review results
    const ReviewResultSchema = v.object({
      file: v.string(),
      line: v.number(),
      column: v.number(),
      ruleId: v.string(),
      message: v.string(),
      severity: SeverityLevelSchema
    });
    
    const ReviewResultsArraySchema = v.array(ReviewResultSchema);
    
    try {
      // First, extract the JSON from the response
      const lines = response.split('\n');
      const nonDebugLines = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed !== '' &&
               !trimmed.startsWith('[DEBUG]') && 
               !trimmed.startsWith('[INFO]') &&
               !trimmed.startsWith('[WARNING]') &&
               !trimmed.startsWith('[ERROR]');
      });
      
      // Parse the result object
      let resultObject = null;
      for (const line of nonDebugLines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'result') {
            resultObject = obj;
            break;
          }
        } catch {
          // Continue to next line
        }
      }
      
      if (!resultObject) {
        throw new Error('Could not find result object in response');
      }
      
      // Extract the content
      const content = resultObject.result || resultObject.content || resultObject.response || '';
      
      // Try to parse JSON from content
      let jsonArray;
      if (typeof content === 'string') {
        // Remove markdown code blocks if present
        const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        const jsonContent = codeBlockMatch ? codeBlockMatch[1] : content;
        
        try {
          jsonArray = JSON.parse(jsonContent.trim());
        } catch {
          // Try to extract JSON array from the content
          const arrayMatch = jsonContent.match(/\[\s*(?:\{[^}]*\}(?:,\s*)?)*\s*\]/);
          if (arrayMatch) {
            jsonArray = JSON.parse(arrayMatch[0]);
          } else {
            // If we can't find JSON, assume no violations
            jsonArray = [];
          }
        }
      } else if (Array.isArray(content)) {
        jsonArray = content;
      } else {
        jsonArray = [];
      }
      
      // Validate the results
      const validatedResults = v.parse(ReviewResultsArraySchema, jsonArray);
      return validatedResults;
    } catch (error) {
      if (v.isValiError(error)) {
        console.error('Invalid review result format:', error.message);
        console.error('Validation issues:', JSON.stringify(error.issues, null, 2));
      } else {
        console.error('Error extracting review results:', (error as Error).message);
      }
      // Return empty array on error to continue processing
      return [];
    }
  }
}