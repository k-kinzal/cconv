import { spawn } from 'child_process';
import pc from 'picocolors';
import { ReviewRule, ReviewResult, Provider, ProviderConfig, FixResult } from '../types/index.js';
import { FixResultSchema, ReviewRuleSchema } from '../types/config-schema.js';
import { GlobalOptions } from '../types/options.js';
import { logger, enableVerboseLogging } from '../utils/logger.js';
import * as v from 'valibot';
import { toJsonSchema } from '@valibot/to-json-schema';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export class ClaudeProvider implements Provider {
  private config: ProviderConfig;
  private workingDir: string;
  private processCounter = 0;

  constructor(config: ProviderConfig, globalOptions: GlobalOptions = {}) {
    this.config = config;
    this.workingDir = join(process.cwd(), '.cconv', 'working');
    
    if (globalOptions.verbose) {
      enableVerboseLogging();
    }
  }

  private async ensureWorkingDir(): Promise<void> {
    if (!existsSync(this.workingDir)) {
      await mkdir(this.workingDir, { recursive: true });
    }
  }

  private async runClaudeWithRetry<T>(prompt: string, schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>, sessionId?: string, lastError?: unknown): Promise<T> {
    if (sessionId && lastError && !(lastError as Error & { isExecutionError?: boolean }).isExecutionError) {
      // For format errors, send error correction prompt with session ID
      const errorPrompt = this.createErrorCorrectionPrompt(lastError);
      return this.runClaude(errorPrompt, schema, sessionId);
    }
    
    // For execution errors or initial attempts, run without session ID
    return this.runClaude(prompt, schema);
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
    
    errorMessage += '\nPlease provide a valid JSON array that conforms to the schema.';
    
    return errorMessage;
  }

  private async runClaude<T>(prompt: string, schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>, sessionId?: string): Promise<T> {
    // Ensure working directory exists
    await this.ensureWorkingDir();
    
    // Generate output file path
    const outputFile = join(this.workingDir, `${randomUUID()}.json`);
    
    // Convert Valibot schema to JSON Schema
    const jsonSchema = toJsonSchema(schema);
    
    // Add output file instruction and JSON Schema to prompt
    const enhancedPrompt = `${prompt}

## JSON Schema for Response
You must output JSON that conforms to this exact schema:
${JSON.stringify(jsonSchema, null, 2)}

IMPORTANT: Write your JSON response to the file: ${outputFile}
Do not output the JSON to stdout. Only write it to the specified file.`;
    const args: string[] = [];
    
    // Remove JSON output format since we'll use file-based output
    // args.push('--output-format', 'json');
    args.push('--print')
    
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
    args.push(enhancedPrompt);
    
    
    return new Promise((resolve, reject) => {
      let resolved = false;
      const timeoutMs = this.config.timeout || 120000; // Default 120 seconds
      const timeoutSec = Math.round(timeoutMs / 1000);
      
      // プロセスIDを生成
      const processId = ++this.processCounter;
      const prefix = `[claude-${processId}]`;
      
      const timeout = setTimeout(() => {
        if (!resolved) {
          if (logger.provider.enabled) {
            process.stderr.write(pc.gray(`${prefix} Command timed out after ${timeoutSec} seconds\n`));
          }
          claude.kill('SIGTERM');
          reject(new Error(`Claude command timed out after ${timeoutSec} seconds`));
        }
      }, timeoutMs);
      
      // 環境変数 CCONV_CLAUDE_PATH > config.command > 'claude' の優先順位で使用
      const command = process.env.CCONV_CLAUDE_PATH || this.config.command || 'claude';
      
      // 一貫性のため、logger出力もprocess.stderr.writeで直接出力
      if (logger.provider.enabled) {
        process.stderr.write(pc.gray(`${prefix} Executing: ${command} ${args.slice(0, -1).join(' ')} [prompt]\n`));
      }
      
      const claude = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,  // セキュリティのためshellは使わない
        windowsHide: true,
        env: { ...process.env },  // 環境変数を全て受け継ぐ
        detached: false
      });
      
      // Process is started, stderr will show progress
      
      // Set encoding for streams and increase buffer size
      claude.stdout.setEncoding('utf8');
      claude.stderr.setEncoding('utf8');
      
      // Increase the buffer size for stdout to handle large responses
      claude.stdout.setMaxListeners(0);

      let error = '';
      let stdoutBuffer = '';
      let stderrBuffer = '';

      // Helper function to process and output lines with prefix
      const processLines = (buffer: string, chunk: string, color: (str: string) => string): string => {
        buffer += chunk;
        const lines = buffer.split('\n');
        
        // 最後の要素は次のチャンクに繋がる可能性があるので保持
        const incomplete = lines.pop() || '';
        
        // 完全な行をすぐに出力
        lines.forEach(line => {
          // 空行も含めて全ての行を出力
          process.stderr.write(color(`${prefix} ${line}\n`));
        });
        
        return incomplete;
      };

      claude.stdout.on('data', (chunk) => {
        // When verbose is enabled, show all stdout in real-time with prefix
        if (logger.provider.enabled) {
          stdoutBuffer = processLines(stdoutBuffer, chunk, pc.gray);
        }
      });

      claude.stderr.on('data', (chunk) => {
        error += chunk;
        
        // Show claude's stderr output when in verbose mode
        if (logger.provider.enabled) {
          stderrBuffer = processLines(stderrBuffer, chunk, pc.red);
        }
      });

      claude.on('error', (err) => {
        if (logger.provider.enabled) {
          process.stderr.write(pc.gray(`${prefix} Process error: ${err.message}\n`));
        }
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          const errorMsg = `Command '${command}' not found. Please ensure Claude CLI is installed and in your PATH.`;
          if (logger.provider.enabled) {
            process.stderr.write(pc.gray(`${prefix} ${errorMsg}\n`));
          }
          reject(new Error(errorMsg));
        } else {
          reject(err);
        }
      });
      
      claude.on('exit', () => {
        // Don't log normal exits
      });

      claude.on('close', async (code) => {
        clearTimeout(timeout);
        resolved = true;
        
        // Process any remaining buffered output
        if (logger.provider.enabled) {
          // 残っているバッファがあれば出力（改行なし）
          if (stdoutBuffer) {
            process.stderr.write(pc.gray(`${prefix} ${stdoutBuffer}\n`));
          }
          if (stderrBuffer) {
            process.stderr.write(pc.red(`${prefix} ${stderrBuffer}\n`));
          }
        }
        
        if (code !== 0) {
          if (logger.provider.enabled) {
            process.stderr.write(pc.gray(`${prefix} Process failed (exit code: ${code})\n`));
          }
          if (error) {
            console.error(`${prefix} Claude stderr:`, error);
          }
          // Clean up output file if it exists
          try {
            if (existsSync(outputFile)) {
              await unlink(outputFile);
            }
          } catch {
            // Ignore cleanup errors
          }
          reject(new Error(`Claude process exited with code ${code}: ${error}`));
        } else {
          // Read the output file
          try {
            if (existsSync(outputFile)) {
              const fileContent = await readFile(outputFile, 'utf-8');
              
              // Validate that the file contains valid JSON
              try {
                JSON.parse(fileContent); // Validate JSON format
                if (logger.provider.enabled) {
                  process.stderr.write(pc.gray(`${prefix} Read result from file (${fileContent.length} bytes)\n`));
                  // Debug: Show first 200 chars of the content
                  const preview = fileContent.length > 200 ? fileContent.substring(0, 200) + '...' : fileContent;
                  process.stderr.write(pc.gray(`${prefix} File content preview: ${preview}\n`));
                }
              } catch (parseErr) {
                // Clean up the file before rejecting
                await unlink(outputFile);
                if (logger.provider.enabled) {
                  process.stderr.write(pc.red(`${prefix} Failed to parse JSON from file: ${parseErr}\n`));
                  process.stderr.write(pc.red(`${prefix} File content: ${fileContent}\n`));
                }
                reject(new Error(`Invalid JSON in output file: ${parseErr}`));
                return;
              }
              
              // Clean up the file after successful validation
              await unlink(outputFile);
              // Parse and validate with the provided schema
              try {
                const parsed = JSON.parse(fileContent);
                const validated = v.parse(schema, parsed);
                resolve(validated);
              } catch (validationError) {
                // Create enhanced error with validation details
                const error = new Error(`JSON validation failed`) as Error & { response?: string; validationError?: unknown };
                error.response = fileContent;
                error.validationError = validationError;
                reject(error);
              }
            } else {
              reject(new Error(`Output file not found: ${outputFile}`));
            }
          } catch (err) {
            reject(new Error(`Failed to read output file: ${err}`));
          }
        }
      });
    });
  }

  async generateRules(content: string): Promise<ReviewRule[]> {
    const ReviewRulesArraySchema = v.pipe(
      v.array(ReviewRuleSchema),
      v.minLength(1, 'At least one rule must be generated')
    );
    
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
        const result = await this.runClaudeWithRetry(prompt, ReviewRulesArraySchema, lastSessionId, lastError);
        
        // Log success if verbose
        if (logger.provider.enabled && this.processCounter > 0) {
          const prefix = `[claude-${this.processCounter}]`;
          process.stderr.write(pc.gray(`${prefix} Successfully generated ${result.length} rules\n`));
        }
        
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
    // Define schema for review results
    const ReviewResultSchema = v.object({
      file: v.literal(filePath),
      line: v.pipe(v.number(), v.minValue(1)),
      column: v.pipe(v.number(), v.minValue(1)),
      ruleId: v.literal(rule.id),
      message: v.string(),
      severity: v.literal(rule.severity || 'warning')
    });
    
    const ReviewResultsArraySchema = v.array(ReviewResultSchema);
    
    const prompt = `Review the following file based on this rule:

Rule ID: ${rule.id}
Description: ${rule.description}
Correct example: ${rule.correct}
Incorrect example: ${rule.incorrect}

Find all violations in the file. If no violations are found, output an empty array: []

File content:
${content}`;

    const results = await this.runClaude(prompt, ReviewResultsArraySchema);
    
    // Log success if verbose
    if (logger.provider.enabled && this.processCounter > 0) {
      const prefix = `[claude-${this.processCounter}]`;
      process.stderr.write(pc.gray(`${prefix} Found ${results.length} violations\n`));
    }
    
    return results;
  }

  async reviewDiff(filePath: string, diffContent: string, rule: ReviewRule): Promise<ReviewResult[]> {
    // Define schema for review results
    const ReviewResultSchema = v.object({
      file: v.literal(filePath),
      line: v.pipe(v.number(), v.minValue(1)),
      column: v.pipe(v.number(), v.minValue(1)),
      ruleId: v.literal(rule.id),
      message: v.string(),
      severity: v.literal(rule.severity || 'warning')
    });
    
    const ReviewResultsArraySchema = v.array(ReviewResultSchema);
    
    const prompt = `Review the following git diff based on this rule:

Rule ID: ${rule.id}
Description: ${rule.description}
Correct example: ${rule.correct}
Incorrect example: ${rule.incorrect}

Focus on the changes (additions and deletions) in the diff.
Find violations in the modified code. If no violations are found, output an empty array: []

Git diff:
${diffContent}`;

    const results = await this.runClaude(prompt, ReviewResultsArraySchema);
    
    // Log success if verbose
    if (logger.provider.enabled && this.processCounter > 0) {
      const prefix = `[claude-${this.processCounter}]`;
      process.stderr.write(pc.gray(`${prefix} Found ${results.length} violations in diff\n`));
    }
    
    return results;
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

## Instructions
1. Analyze the issue in the target line and surrounding context
2. Apply the rule's fix guidance to resolve the issue
3. Determine the exact line range that needs to be modified
4. Provide the original content and fixed content for that range
5. Explain your reasoning and confidence level
6. If the issue cannot be fixed, set success to false and explain why`;

    const fixResult = await this.runClaude(prompt, FixResultSchema);
    
    // Additional validation: endLine should be >= startLine
    if (fixResult.endLine < fixResult.startLine) {
      throw new Error(`End line (${fixResult.endLine}) cannot be less than start line (${fixResult.startLine})`);
    }
    
    // Log success if verbose
    if (logger.provider.enabled && this.processCounter > 0) {
      const prefix = `[claude-${this.processCounter}]`;
      process.stderr.write(pc.gray(`${prefix} Fix result: ${fixResult.success ? 'fix applied' : 'fix skipped'}\n`));
    }
    
    return fixResult;
  }

}