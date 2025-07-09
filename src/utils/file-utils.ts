import { readFile, stat } from 'fs/promises';
import { glob } from 'glob';
import { resolve, isAbsolute } from 'path';
import { FilePatterns } from '../types/config-schema.js';

export interface GlobOptions {
  filePatterns?: FilePatterns;
}

export async function getFilePaths(
  paths: string | string[], 
  options: GlobOptions = {}
): Promise<string[]> {
  // Normalize to array
  const inputPaths = Array.isArray(paths) ? paths : [paths];
  const allFiles = new Set<string>();
  
  // Get exclude patterns from options or use defaults
  const excludePatterns = options.filePatterns?.exclude || [
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
    '**/build/**',
    '**/coverage/**'
  ];
  
  for (const path of inputPaths) {
    // Check if it's a glob pattern
    if (isGlobPattern(path)) {
      // Handle glob pattern
      const matches = await glob(path, { 
        ignore: excludePatterns,
        absolute: true
      });
      matches.forEach(file => allFiles.add(file));
    } else {
      // Handle regular file/directory path
      const resolvedPath = isAbsolute(path) ? path : resolve(path);
      
      try {
        const stats = await stat(resolvedPath);
        
        if (stats.isFile()) {
          allFiles.add(resolvedPath);
        } else if (stats.isDirectory()) {
          // Default extensions if no include patterns specified
          const defaultPattern = `${resolvedPath}/**/*.{js,ts,jsx,tsx,py,java,go,rb,php,c,cpp,cs}`;
          const includePatterns = options.filePatterns?.include?.length 
            ? options.filePatterns.include.map(pattern => `${resolvedPath}/${pattern}`)
            : [defaultPattern];
          
          for (const pattern of includePatterns) {
            const matches = await glob(pattern, { 
              ignore: excludePatterns,
              absolute: true
            });
            matches.forEach(file => allFiles.add(file));
          }
        }
      } catch {
        // Path doesn't exist, might be a glob pattern without special characters
        const matches = await glob(path, { 
          ignore: excludePatterns,
          absolute: true
        });
        matches.forEach(file => allFiles.add(file));
      }
    }
  }
  
  return Array.from(allFiles).sort();
}

function isGlobPattern(path: string): boolean {
  return path.includes('*') || path.includes('?') || path.includes('[') || path.includes('{');
}

export async function readFileContent(filePath: string): Promise<string> {
  return await readFile(filePath, 'utf-8');
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  
  return Buffer.concat(chunks).toString('utf-8');
}