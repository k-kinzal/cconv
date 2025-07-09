import { ProviderFactory } from '../services/provider-factory.js';
import { ConfigManager } from '../services/config-manager.js';
import { getFilePaths, readFileContent, readStdin } from '../utils/file-utils.js';
import { GlobalOptions } from '../types/options.js';
import { Config } from '../types/index.js';
import { outputResult } from '../utils/output-formatter.js';
import { logger, enableVerboseLogging } from '../utils/logger.js';
import pc from 'picocolors';
import pLimit from 'p-limit';

export async function addCommand(paths?: string | string[], options: GlobalOptions & { maxConcurrency?: number } = {}): Promise<void> {
  if (options.verbose) {
    enableVerboseLogging();
  }
  
  const provider = await ProviderFactory.create(options);
  const configManager = new ConfigManager(options.config);
  
  try {
    const config = await configManager.getConfig();
    let content = '';
    
    if (!paths && process.stdin.isTTY) {
      console.error(pc.red('Error: No path provided and no input from stdin'));
      process.exit(1);
    }
    
    let newRules;
    
    if (!paths) {
      logger.command.verbose('Reading from stdin...');
      content = await readStdin();
      
      if (options.output !== 'json') {
        console.log(pc.blue('Generating review rules...'));
      }
      logger.command.verbose('Analyzing content from stdin (%d characters)', content.length);
      newRules = await provider.generateRules(content);
      logger.command.verbose('Analysis complete - found %d rules', newRules.length);
    } else {
     
      const inputPaths = Array.isArray(paths) ? paths : [paths];
      logger.command.verbose('Scanning paths: %s', inputPaths.join(', '));
      
      const filePaths = await getFilePaths(inputPaths, {
        filePatterns: config.filePatterns
      });
      
      if (filePaths.length === 0) {
        console.error(pc.red(`Error: No files found matching patterns: ${inputPaths.join(', ')}`));
        process.exit(1);
      }
      
      logger.command.verbose('Found %d files to process', filePaths.length);
      
      if (options.output !== 'json') {
        console.log(pc.blue(`Generating review rules from ${filePaths.length} files...`));
      }
      
      // Process files in parallel with concurrency limit
      const maxConcurrency = options.maxConcurrency || 5;
      const limit = pLimit(maxConcurrency);
      
      // Process each file individually in parallel
      const allNewRules = await Promise.all(
        filePaths.map(filePath => 
          limit(async () => {
            logger.command.verbose('Reading: %s', filePath);
            const fileContent = await readFileContent(filePath);
            const fileWithPath = `// File: ${filePath}\n${fileContent}`;
            
            logger.command.verbose('Analyzing file: %s', filePath);
            const rules = await provider.generateRules(fileWithPath);
            logger.command.verbose('Found %d rules in %s', rules.length, filePath);
            return rules;
          })
        )
      );
      
      // Flatten all rules from all files
      newRules = allNewRules.flat();
      logger.command.verbose('Total rules found: %d', newRules.length);
    }
    

    logger.command.verbose('Loading existing configuration');
    const existingRules = config.rules || [];
    logger.command.verbose('Found %d existing rules', existingRules.length);
    
    
    logger.command.verbose('Merging rules...');
    const addedRules = [];
    const updatedRules = [];
    
    for (const newRule of newRules) {
      const existingIndex = existingRules.findIndex(rule => rule.id === newRule.id);
      
      if (existingIndex >= 0) {
        existingRules[existingIndex] = newRule;
        logger.command.verbose('Updating existing rule: %s', newRule.id);
        updatedRules.push(newRule);
        if (options.output !== 'json') {
          console.log(pc.green(`✓ Updated rule: ${newRule.id}`));
        }
      } else {
        existingRules.push(newRule);
        logger.command.verbose('Adding new rule: %s', newRule.id);
        addedRules.push(newRule);
        if (options.output !== 'json') {
          console.log(pc.green(`✓ Added rule: ${newRule.id}`));
        }
      }
    }
    
    
    const updatedConfig: Config = {
      ...config,
      rules: existingRules
    };
    logger.command.verbose('Saving configuration...');
    await configManager.saveConfig(updatedConfig);
    logger.command.verbose('Configuration saved successfully');
    
    if (options.output === 'json') {
      outputResult({
        type: 'rules',
        data: newRules,
        success: true,
        message: `Successfully processed ${newRules.length} rules`
      }, 'json');
    } else {
      console.log(pc.green(`\nSuccessfully processed ${newRules.length} rules`));
    }
  } catch (error) {
    if (options.output === 'json') {
      outputResult({
        type: 'rules',
        data: [],
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 'json');
    } else {
      console.error(pc.red('Error:' + (error instanceof Error ? ' ' + error.message : ' Unknown error')));
    }
    process.exit(1);
  }
}