import { writeFile } from 'fs/promises';
import { ProviderFactory } from '../services/provider-factory.js';
import { ConfigManager } from '../services/config-manager.js';
import { getFilePaths, readFileContent } from '../utils/file-utils.js';
import { ReviewResult, FixResult } from '../types/index.js';
import { GlobalOptions } from '../types/options.js';
import { outputResult } from '../utils/output-formatter.js';
import pc from 'picocolors';
import pLimit from 'p-limit';

interface FileIssues {
  filePath: string;
  content: string;
  issues: ReviewResult[];
}

function applyFixToContent(content: string, fixResult: FixResult): string {
  if (!fixResult.success) {
    return content;
  }
  
  const lines = content.split('\n');
  const startIndex = fixResult.startLine - 1; // Convert to 0-based index
  const endIndex = fixResult.endLine - 1;     // Convert to 0-based index
  
  // Replace the lines in the specified range
  const fixedLines = fixResult.fixedContent.split('\n');
  lines.splice(startIndex, endIndex - startIndex + 1, ...fixedLines);
  
  return lines.join('\n');
}

export async function fixCommand(paths: string | string[], options: GlobalOptions = {}): Promise<void> {
  const provider = await ProviderFactory.create(options);
  const configManager = new ConfigManager(options.config);
  
  try {
    const config = await configManager.getConfig();
    const rules = config.rules || [];
    
    // Support both single path and multiple paths
    const inputPaths = Array.isArray(paths) ? paths : [paths];
    
    const filePaths = await getFilePaths(inputPaths, {
      filePatterns: config.filePatterns
    });
    
    if (filePaths.length === 0) {
      console.error(pc.red(`Error: No files found matching patterns: ${inputPaths.join(', ')}`));
      process.exit(1);
    }
    
    if (rules.length === 0) {
      console.error(pc.red('Error: No review rules found. Use "cconv add" to create rules.'));
      process.exit(1);
    }
    
    // Get maxConcurrency from provider config or options
    const providerConfig = config.provider;
    const maxConcurrency = options.maxConcurrency || providerConfig?.maxConcurrency || 5;
    const limit = pLimit(maxConcurrency);
    
    if (options.output !== 'json') {
      console.log(pc.blue(`Reviewing ${filePaths.length} files with ${rules.length} rules...\n`));
    }
    
    // Step 1: Review all files and collect issues
    const allResults: ReviewResult[] = [];
    const reviewTasks: Promise<void>[] = [];
    
    for (const filePath of filePaths) {
      const fileContent = await readFileContent(filePath);
      
      for (const rule of rules) {
        reviewTasks.push(
          limit(async () => {
            try {
              const results = await provider.reviewFile(filePath, fileContent, rule);
              allResults.push(...results);
            } catch {
              console.error(pc.yellow(`Warning: Failed to review ${filePath} with rule ${rule.id}`));
            }
          })
        );
      }
    }
    
    await Promise.all(reviewTasks);
    
    if (allResults.length === 0) {
      if (options.output === 'json') {
        outputResult({
          type: 'fix',
          data: {
            results: [],
            summary: {
              totalFixed: 0,
              filesFixed: 0
            }
          },
          success: true
        }, 'json');
      } else {
        console.log(pc.green('✓ No issues found to fix!'));
      }
      return;
    }
    
    // Step 2: Group issues by file
    const fileIssuesMap = new Map<string, FileIssues>();
    
    for (const result of allResults) {
      if (!fileIssuesMap.has(result.file)) {
        const content = await readFileContent(result.file);
        fileIssuesMap.set(result.file, {
          filePath: result.file,
          content,
          issues: []
        });
      }
      fileIssuesMap.get(result.file)!.issues.push(result);
    }
    
    if (options.output !== 'json') {
      console.log(pc.blue(`Found ${allResults.length} issues in ${fileIssuesMap.size} files. Starting fixes...\n`));
    }
    
    // Step 3: Fix issues file by file
    let totalFixed = 0;
    let filesFixed = 0;
    const fixResults: Array<{
      success: boolean;
      issue: ReviewResult;
      fix: FixResult;
    }> = [];
    
    for (const fileIssues of fileIssuesMap.values()) {
      const { filePath, issues } = fileIssues;
      
      // Sort issues by line number (descending) to fix from bottom to top
      // This prevents line number shifts from affecting subsequent fixes
      const sortedIssues = issues.sort((a, b) => b.line - a.line);
      
      if (options.output !== 'json') {
        console.log(pc.yellow(`Fixing ${sortedIssues.length} issues in ${filePath}...`));
      }
      
      let currentContent = fileIssues.content;
      let fileModified = false;
      
      for (const issue of sortedIssues) {
        try {
          // Find the rule for this issue
          const rule = rules.find(r => r.id === issue.ruleId);
          if (!rule) {
            console.error(pc.yellow(`Warning: Rule ${issue.ruleId} not found, skipping fix`));
            continue;
          }
          
          const fixResult = await provider.fixIssue(filePath, currentContent, issue, rule);
          
          if (fixResult.success) {
            const newContent = applyFixToContent(currentContent, fixResult);
            if (newContent !== currentContent) {
              currentContent = newContent;
              fileModified = true;
              totalFixed++;
              
              fixResults.push({
                success: true,
                issue,
                fix: fixResult
              });
              
              if (options.output !== 'json') {
                console.log(pc.green(`  ✓ Fixed ${issue.ruleId} at line ${issue.line}`));
                console.log(pc.gray(`    ${fixResult.description}`));
                console.log(pc.gray(`    Confidence: ${fixResult.confidence}%`));
                if (fixResult.reasoning) {
                  console.log(pc.gray(`    Reason: ${fixResult.reasoning}`));
                }
              }
            } else {
              fixResults.push({
                success: false,
                issue,
                fix: fixResult
              });
              
              if (options.output !== 'json') {
                console.log(pc.yellow(`  ⚠ Fix suggested but no changes made for ${issue.ruleId} at line ${issue.line}`));
              }
            }
          } else {
            fixResults.push({
              success: false,
              issue,
              fix: fixResult
            });
            
            if (options.output !== 'json') {
              console.log(pc.yellow(`  ⚠ Failed to fix ${issue.ruleId} at line ${issue.line}`));
              console.log(pc.gray(`    ${fixResult.description || 'No description provided'}`));
              if (fixResult.reasoning) {
                console.log(pc.gray(`    Reason: ${fixResult.reasoning}`));
              }
            }
          }
        } catch (error) {
          console.error(pc.yellow(`  ⚠ Error fixing ${issue.ruleId} at line ${issue.line}: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      }
      
      if (fileModified) {
        await writeFile(filePath, currentContent, 'utf-8');
        if (options.output !== 'json') {
          console.log(pc.green(`✓ Fixed ${filePath}`));
        }
        filesFixed++;
      } else {
        if (options.output !== 'json') {
          console.log(pc.gray(`- No fixes applied to ${filePath}`));
        }
      }
    }
    
    if (options.output === 'json') {
      outputResult({
        type: 'fix',
        data: {
          results: fixResults,
          summary: {
            totalFixed,
            filesFixed
          }
        },
        success: true
      }, 'json');
    } else {
      console.log(pc.green(`\n✓ Fixed ${totalFixed} issues in ${filesFixed} files`));
    }
  } catch (error) {
    if (options.output === 'json') {
      outputResult({
        type: 'fix',
        data: {
          results: [],
          summary: {
            totalFixed: 0,
            filesFixed: 0
          }
        },
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 'json');
    } else {
      console.error(pc.red('Error:' + (error instanceof Error ? ' ' + error.message : ' Unknown error')));
    }
    process.exit(1);
  }
}