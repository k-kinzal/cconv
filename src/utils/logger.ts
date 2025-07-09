import pc from 'picocolors';

export interface Logger {
  verbose(format: string, ...args: unknown[]): void;
  provider(format: string, ...args: unknown[]): void;
  command(format: string, ...args: unknown[]): void;
  config(format: string, ...args: unknown[]): void;
  enabled: boolean;
}

class VerboseLogger {
  private static instance: VerboseLogger;
  private isEnabled = false;

  private constructor() {
    // We'll use our own formatting instead of pino transport
  }

  static getInstance(): VerboseLogger {
    if (!VerboseLogger.instance) {
      VerboseLogger.instance = new VerboseLogger();
    }
    return VerboseLogger.instance;
  }

  enable(): void {
    this.isEnabled = true;
  }

  disable(): void {
    this.isEnabled = false;
  }

  private getCategoryPrefix(category: string): string {
    const prefixes: Record<string, string> = {
      'provider': '[claude]',
      'command': '[cmd]',
      'config': '[config]',
      'verbose': '[debug]'
    };
    return prefixes[category] || `[${category}]`;
  }

  private log(category: string, format: string, ...args: unknown[]): void {
    if (!this.isEnabled) return;

    // Format the message using printf-style formatting
    let message = format;
    let argIndex = 0;
    
    message = message.replace(/%[sdo]/g, (match) => {
      if (argIndex >= args.length) return match;
      
      const arg = args[argIndex++];
      switch (match) {
        case '%s':
          return String(arg);
        case '%d':
          return Number(arg).toString();
        case '%o':
        case '%O':
          return JSON.stringify(arg, null, 2);
        default:
          return match;
      }
    });

    // Add any remaining args
    if (argIndex < args.length) {
      message += ' ' + args.slice(argIndex).map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
    }

    // Output in the required format with gray color
    const prefix = this.getCategoryPrefix(category);
    const formattedLine = pc.gray(`${prefix} ${message}`);
    process.stderr.write(`${formattedLine}\n`);
  }

  createLogger(category: string): Logger {
    const logger: Logger = {
      verbose: (format: string, ...args: unknown[]) => {
        this.log(category, format, ...args);
      },
      provider: (format: string, ...args: unknown[]) => {
        this.log(category, format, ...args);
      },
      command: (format: string, ...args: unknown[]) => {
        this.log(category, format, ...args);
      },
      config: (format: string, ...args: unknown[]) => {
        this.log(category, format, ...args);
      },
      enabled: false
    };
    
    // Use Object.defineProperty to create a getter that doesn't violate no-this-alias
    Object.defineProperty(logger, 'enabled', {
      get: () => this.isEnabled,
      enumerable: true,
      configurable: true
    });
    
    return logger;
  }
}

// Create singleton instance
const verboseLogger = VerboseLogger.getInstance();

// Export logger instances
export const logger = {
  verbose: verboseLogger.createLogger('verbose'),
  provider: verboseLogger.createLogger('provider'),
  command: verboseLogger.createLogger('command'),
  config: verboseLogger.createLogger('config')
};

// Enable verbose logging when --verbose flag is used
export function enableVerboseLogging(): void {
  verboseLogger.enable();
}