#!/usr/bin/env node

import { program, Command } from 'commander';
import pc from 'picocolors';
import { addCommand } from '../commands/add.js';
import { listCommand } from '../commands/list.js';
import { showCommand } from '../commands/show.js';
import { reviewCommand } from '../commands/review.js';
import { fixCommand } from '../commands/fix.js';

program
  .name('reviewit')
  .description('AI-powered code review tool')
  .version('1.0.0')
  .option('-v, --verbose', 'Enable verbose output')
  .option('-c, --config <path>', 'Path to config file (default: .reviewit.yaml)');

program
  .command('add [paths...]')
  .description('Generate review rules from files, glob patterns, or stdin')
  .option('-o, --output <format>', 'Output format: text (default), json', 'text')
  .option('--max-retries <number>', 'Maximum number of retries for AI requests (default: 3)', parseInt)
  .option('--max-concurrency <number>', 'Maximum number of concurrent file reads (default: 5)', parseInt)
  .option('--timeout <seconds>', 'Timeout for AI requests in seconds (default: 120)', (value) => parseInt(value) * 1000)
  .action(async function(this: Command, paths: string[] | undefined) {
    const options = this.optsWithGlobals();
    // If no paths provided or empty array, pass undefined to read from stdin
    await addCommand(paths && paths.length > 0 ? paths : undefined, options);
  });

program
  .command('list')
  .description('List all saved review rules')
  .option('-o, --output <format>', 'Output format: text (default), json', 'text')
  .action(async function(this: Command) {
    const mergedOptions = this.optsWithGlobals();
    await listCommand(mergedOptions);
  });

program
  .command('show <id>')
  .description('Show details of a specific review rule')
  .option('-o, --output <format>', 'Output format: text (default), json', 'text')
  .action(async function(this: Command, id: string) {
    const options = this.optsWithGlobals();
    await showCommand(id, options);
  });

program
  .command('fix <paths...>')
  .description('Review and fix issues in files using glob patterns')
  .option('-o, --output <format>', 'Output format: text (default), json', 'text')
  .option('--max-concurrency <number>', 'Maximum number of concurrent reviews (default: 5)', parseInt)
  .option('--timeout <seconds>', 'Timeout for AI requests in seconds (default: 120)', (value) => parseInt(value) * 1000)
  .action(async function(this: Command, paths: string[]) {
    const options = this.optsWithGlobals();
    await fixCommand(paths, options);
  });

program
  .command('review [paths...]')
  .description('Review files against saved rules using glob patterns or diff from stdin')
  .option('-o, --output <format>', 'Output format: text (default), json, reviewdog, sarif', 'text')
  .option('--max-concurrency <number>', 'Maximum number of concurrent reviews (default: 5)', parseInt)
  .option('--min-severity <level>', 'Minimum severity level to show: critical, error, warning, info (default: info)', 'info')
  .option('--timeout <seconds>', 'Timeout for AI requests in seconds (default: 120)', (value) => parseInt(value) * 1000)
  .action(async function(this: Command, paths: string[] | undefined) {
    const options = this.optsWithGlobals();
    // If no paths provided and not a TTY, read from stdin
    if ((!paths || paths.length === 0) && !process.stdin.isTTY) {
      await reviewCommand(undefined, options);
    } else if (paths && paths.length > 0) {
      await reviewCommand(paths, options);
    } else {
      console.error(pc.red('Error: No paths provided and no input from stdin'));
      process.exit(1);
    }
  });

try {
  program.parse();
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  console.error(pc.red(`Error: ${errorMessage}`));
  process.exit(1);
}