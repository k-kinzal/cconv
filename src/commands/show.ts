import { ConfigManager } from '../services/config-manager.js';
import { GlobalOptions } from '../types/options.js';
import { outputResult } from '../utils/output-formatter.js';
import pc from 'picocolors';

export async function showCommand(id: string, options: GlobalOptions = {}): Promise<void> {
  const configManager = new ConfigManager(options.config);
  
  try {
    const config = await configManager.getConfig();
    const rules = config.rules || [];
    const rule = rules.find(r => r.id === id);
    
    if (!rule) {
      if (options.output === 'json') {
        outputResult({
          type: 'rule',
          data: null,
          success: false,
          message: `Rule '${id}' not found`
        }, 'json');
      } else {
        console.error(pc.red(`Error: Rule '${id}' not found`));
      }
      process.exit(1);
    }
    
    if (options.output === 'json') {
      outputResult({
        type: 'rule',
        data: rule,
        success: true
      }, 'json');
      return;
    }
    
    // Text format
    console.log(pc.bold(`Rule: ${rule.id}\n`));
    console.log(pc.bold('Description:'));
    console.log(`  ${rule.description}\n`);
    
    console.log(pc.bold('Correct:'));
    console.log(rule.correct.split('\n').map(line => `  ${line}`).join('\n'));
    console.log();
    
    console.log(pc.bold('Incorrect:'));
    console.log(rule.incorrect.split('\n').map(line => `  ${line}`).join('\n'));
    console.log();
    
    console.log(pc.bold('Fix:'));
    console.log(`  ${rule.fix}`);
  } catch (error) {
    if (options.output === 'json') {
      outputResult({
        type: 'rule',
        data: null,
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 'json');
    } else {
      console.error(pc.red('Error:' + (error instanceof Error ? ' ' + error.message : ' Unknown error')));
    }
    process.exit(1);
  }
}