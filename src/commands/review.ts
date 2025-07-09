import { ProviderFactory } from '../services/provider-factory.js';
import { ConfigManager } from '../services/config-manager.js';
import { getFilePaths, readFileContent, readStdin } from '../utils/file-utils.js';
import { ReviewResult, FilePatterns } from '../types/index.js';
import { GlobalOptions } from '../types/options.js';
import { parseDiff, formatDiffForReview, DiffFile } from '../utils/diff-parser.js';
import { outputResult } from '../utils/output-formatter.js';
import { filterRulesBySeverity, getSeverityColor } from '../utils/severity.js';
import pc from 'picocolors';
import pLimit from 'p-limit';
import { minimatch } from 'minimatch';

async function filterDiffFilesByPatterns(diffFiles: DiffFile[], filePatterns?: FilePatterns): Promise<DiffFile[]> {
  if (!filePatterns) {
    return diffFiles;
  }
  
  const includePatterns = filePatterns.include || [];
  const excludePatterns = filePatterns.exclude || [];
  
  // Default exclude patterns
  const defaultExcludePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
    '**/build/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/vendor/**'
  ];
  
  const allExcludePatterns = [...defaultExcludePatterns, ...excludePatterns];
  
  return diffFiles.filter(diffFile => {
    const filePath = diffFile.path;
    
    // Check exclude patterns first
    for (const excludePattern of allExcludePatterns) {
      if (minimatch(filePath, excludePattern)) {
        return false;
      }
    }
    
    // If include patterns are specified, check them
    if (includePatterns.length > 0) {
      for (const includePattern of includePatterns) {
        if (minimatch(filePath, includePattern)) {
          return true;
        }
      }
      return false; // Not matched any include pattern
    }
    
    // If no include patterns, check against default extensions
    const defaultExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rb', '.php', '.c', '.cpp', '.cs'];
    return defaultExtensions.some(ext => filePath.endsWith(ext));
  });
}

export async function reviewCommand(paths: string | string[] | undefined, options: GlobalOptions = {}): Promise<void> {
  const provider = await ProviderFactory.create(options);
  const configManager = new ConfigManager(options.config);
  
  try {
    const config = await configManager.getConfig();
    const allRules = config.rules || [];
    
    // Determine minimum severity level from options or config
    const minSeverity = options.minSeverity || config.minSeverity || 'info';
    
    // Filter rules by severity level
    const rules = filterRulesBySeverity(allRules, minSeverity);
    
    if (allRules.length === 0) {
      console.error(pc.red('Error: No review rules found. Use "cconv add" to create rules.'));
      process.exit(1);
    }
    
    if (rules.length === 0) {
      if (options.output === 'json') {
        outputResult({
          type: 'review',
          data: [],
          success: true,
          message: `No rules match minimum severity level '${minSeverity}'`
        }, 'json');
      } else if (options.output === 'reviewdog') {
        outputResult({
          type: 'review',
          data: [],
          success: true,
          message: `No rules match minimum severity level '${minSeverity}'`
        }, 'reviewdog');
      } else if (options.output === 'sarif') {
        outputResult({
          type: 'review',
          data: [],
          success: true,
          message: `No rules match minimum severity level '${minSeverity}'`
        }, 'sarif');
      } else {
        console.log(pc.yellow(`No rules match minimum severity level '${minSeverity}'. Available severity levels: critical, error, warning, info`));
      }
      return;
    }
    
    // Get maxConcurrency from provider config or options
    const providerConfig = config.provider;
    const maxConcurrency = options.maxConcurrency || providerConfig?.maxConcurrency || 5;
    const limit = pLimit(maxConcurrency);
    
    const allResults: ReviewResult[] = [];
    const reviewTasks: Promise<void>[] = [];
    
    // Check if reading from stdin (diff mode)
    if (!paths) {
      if (options.output !== 'json' && options.output !== 'reviewdog' && options.output !== 'sarif') {
        console.log(pc.blue('Reading diff from stdin...\n'));
      }
      const diffContent = await readStdin();
      const diffFiles = parseDiff(diffContent);
      
      if (diffFiles.length === 0) {
        console.error(pc.red('Error: No valid diff found in stdin'));
        process.exit(1);
      }
      
      // Apply filePatterns filtering to diff files
      const filteredDiffFiles = await filterDiffFilesByPatterns(diffFiles, config.filePatterns);
      
      if (filteredDiffFiles.length === 0) {
        if (options.output === 'json') {
          outputResult({
            type: 'review',
            data: [],
            success: true
          }, 'json');
        } else if (options.output === 'reviewdog') {
          outputResult({
            type: 'review',
            data: [],
            success: true
          }, 'reviewdog');
        } else if (options.output === 'sarif') {
          outputResult({
            type: 'review',
            data: [],
            success: true
          }, 'sarif');
        } else {
          console.log(pc.green('✓ No files in diff match the configured patterns.'));
        }
        return;
      }
      
      if (options.output !== 'json' && options.output !== 'reviewdog' && options.output !== 'sarif') {
        console.log(pc.blue(`Reviewing ${filteredDiffFiles.length} files from diff with ${rules.length} rules...\n`));
      }
      
      // Review each file in the diff
      for (const diffFile of filteredDiffFiles) {
        const diffFormatted = formatDiffForReview([diffFile]);
        
        for (const rule of rules) {
          reviewTasks.push(
            limit(async () => {
              try {
                const results = await provider.reviewDiff(diffFile.path, diffFormatted, rule);
                allResults.push(...results);
              } catch {
                console.error(pc.yellow(`Warning: Failed to review diff for ${diffFile.path} with rule ${rule.id}`));
              }
            })
          );
        }
      }
    } else {
      // Normal file review mode
      const inputPaths = Array.isArray(paths) ? paths : [paths];
      
      const filePaths = await getFilePaths(inputPaths, {
        filePatterns: config.filePatterns
      });
      
      if (filePaths.length === 0) {
        console.error(pc.red(`Error: No files found matching patterns: ${inputPaths.join(', ')}`));
        process.exit(1);
      }
      
      if (options.output !== 'json' && options.output !== 'reviewdog' && options.output !== 'sarif') {
        console.log(pc.blue(`Reviewing ${filePaths.length} files with ${rules.length} rules...\n`));
      }
      
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
    }
    
    await Promise.all(reviewTasks);
    
    if (allResults.length === 0) {
      if (options.output === 'json') {
        outputResult({
          type: 'review',
          data: [],
          success: true
        }, 'json');
      } else if (options.output === 'reviewdog') {
        outputResult({
          type: 'review',
          data: [],
          success: true
        }, 'reviewdog');
      } else if (options.output === 'sarif') {
        outputResult({
          type: 'review',
          data: [],
          success: true
        }, 'sarif');
      } else {
        console.log(pc.green('✓ No issues found!'));
      }
      return;
    }
    
    // Sort results by file and line
    allResults.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      if (a.line !== b.line) return a.line - b.line;
      return a.column - b.column;
    });
    
    if (options.output === 'json') {
      outputResult({
        type: 'review',
        data: allResults,
        success: false
      }, 'json');
      process.exit(2);
    }
    
    if (options.output === 'reviewdog') {
      outputResult({
        type: 'review',
        data: allResults,
        success: false
      }, 'reviewdog');
      process.exit(2);
    }
    
    if (options.output === 'sarif') {
      outputResult({
        type: 'review',
        data: allResults,
        success: false
      }, 'sarif');
      process.exit(2);
    }
    
    // Display results in text format
    for (const result of allResults) {
      const colorName = getSeverityColor(result.severity);
      const severityColor = (pc[colorName as keyof typeof pc] as typeof pc.gray) || pc.gray;
      console.error(
        `${result.file}:${result.line}:${result.column}: ` +
        `${severityColor(result.severity)} [${result.ruleId}] ${result.message}`
      );
    }
    
    console.error(pc.red(`\n✗ Found ${allResults.length} issues`));
    process.exit(2);
  } catch (error) {
    if (options.output === 'json') {
      outputResult({
        type: 'review',
        data: [],
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 'json');
    } else if (options.output === 'reviewdog') {
      outputResult({
        type: 'review',
        data: [],
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 'reviewdog');
    } else if (options.output === 'sarif') {
      outputResult({
        type: 'review',
        data: [],
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 'sarif');
    } else {
      console.error(pc.red('Error:' + (error instanceof Error ? ' ' + error.message : ' Unknown error')));
    }
    process.exit(1);
  }
}