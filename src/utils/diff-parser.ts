import parseGitDiff from 'parse-git-diff';

// Types for parse-git-diff output
interface ParsedChange {
  type: 'AddedLine' | 'DeletedLine' | 'UnchangedLine';
  content: string;
  lineAfter?: number;
  lineBefore?: number;
}

interface ParsedChunk {
  type: 'Chunk';
  fromFileRange?: { start: number; lines: number };
  toFileRange?: { start: number; lines: number };
  changes?: ParsedChange[];
}

interface ParsedFile {
  type: 'ModifiedFile' | 'AddedFile' | 'DeletedFile' | 'RenamedFile' | 'BinaryFile';
  path: string;
  pathBefore?: string;
  pathAfter?: string;
  chunks?: ParsedChunk[];
}

interface ParsedDiff {
  files: ParsedFile[];
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export function parseDiff(diffContent: string): DiffFile[] {
  const parsed = parseGitDiff(diffContent) as ParsedDiff;
  
  return parsed.files.filter((file: ParsedFile) => {
    // Skip binary files and other non-text changes
    return file.type !== 'BinaryFile' && file.chunks && file.chunks.length > 0;
  }).map((file: ParsedFile) => {
    let additions = 0;
    let deletions = 0;
    
    // Get the file path
    const path = file.type === 'RenamedFile' ? file.pathAfter! : file.path;
    const oldPath = file.type === 'RenamedFile' ? file.pathBefore : undefined;
    
    // Count additions and deletions
    for (const chunk of file.chunks || []) {
      if (chunk.type === 'Chunk' && chunk.changes) {
        for (const change of chunk.changes) {
          if (change.type === 'AddedLine') additions++;
          else if (change.type === 'DeletedLine') deletions++;
        }
      }
    }
    
    return {
      path,
      oldPath,
      additions,
      deletions,
      hunks: (file.chunks || [])
        .filter((chunk: ParsedChunk) => chunk.type === 'Chunk' && chunk.changes)
        .map((chunk: ParsedChunk) => ({
          oldStart: chunk.fromFileRange?.start || 0,
          oldLines: chunk.fromFileRange?.lines || 0,
          newStart: chunk.toFileRange?.start || 0,
          newLines: chunk.toFileRange?.lines || 0,
          lines: chunk.changes!.map((change: ParsedChange) => {
            const type = change.type === 'AddedLine' ? 'add' : 
                         change.type === 'DeletedLine' ? 'delete' : 
                         'context';
            return {
              type,
              content: change.content,
              oldLine: change.lineAfter || undefined,
              newLine: change.lineBefore || undefined
            };
          })
        }))
    };
  });
}

export function formatDiffForReview(files: DiffFile[]): string {
  const parts: string[] = [];
  
  for (const file of files) {
    parts.push(`File: ${file.path}`);
    if (file.oldPath && file.oldPath !== file.path) {
      parts.push(`Renamed from: ${file.oldPath}`);
    }
    parts.push(`Changes: +${file.additions} -${file.deletions}\n`);
    
    for (const hunk of file.hunks) {
      parts.push(`Lines ${hunk.newStart}-${hunk.newStart + hunk.newLines - 1}:`);
      
      for (const line of hunk.lines) {
        const lineNum = line.newLine || line.oldLine || 0;
        const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
        parts.push(`${lineNum.toString().padStart(4)} ${prefix} ${line.content}`);
      }
      parts.push('');
    }
  }
  
  return parts.join('\n');
}