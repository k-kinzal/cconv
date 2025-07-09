import { ConfigManager } from '../services/config-manager.js';
import { GlobalOptions } from '../types/options.js';
import { outputResult } from '../utils/output-formatter.js';
import pc from 'picocolors';

export async function listCommand(options: GlobalOptions = {}): Promise<void> {
  const configManager = new ConfigManager(options.config);
  
  try {
    const config = await configManager.getConfig();
    const rules = config.rules || [];
    
    if (options.output === 'json') {
      outputResult({
        type: 'rules',
        data: rules,
        success: true
      }, 'json');
      return;
    }
    
    // Text format
    if (rules.length === 0) {
      console.log(pc.yellow('No review rules found. Use "cconv add" to create rules.'));
      return;
    }
    
    console.log(pc.bold(pc.cyan('Review Rules:\n')));
    
    for (const rule of rules) {
      console.log(pc.bold(`  ${rule.id}`));
      console.log(`    ${pc.gray(rule.description)}`);
      console.log();
    }
    
    console.log(pc.gray(`Total: ${rules.length} rules`));
  } catch (error) {
    if (options.output === 'json') {
      outputResult({
        type: 'rules',
        data: [],
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 'json');
    } else {
      console.error(pc.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
    process.exit(1);
  }
}