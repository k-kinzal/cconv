# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
# Install dependencies
npm install

# Build the TypeScript project
npm run build

# Development mode with file watching
npm run dev

# Type checking without building
npm run typecheck

# Lint the codebase
npm run lint

# Run tests
npm test

# Run the CLI directly in development
npm run cconv [command] [options]
# OR
tsx src/bin/cconv.ts [command] [options]

# Prepare for publishing (lint, typecheck, build, test)
npm run prepublishOnly
```

## Architecture Overview

cconv is your coding standards, made executable. It transforms human-readable guidelines, conventions, and best practices into automated validators that can understand context and nuance. By treating your documentation as the source of truth, it creates living rules that evolve with your team's standards. The architecture follows a command-based pattern with clear separation of concerns:

### Core Flow
1. **Commands** (`src/commands/`) - Entry points for CLI operations
2. **Provider** (`src/services/claude-provider.ts`) - Handles AI communication with retry logic and session management
3. **Config Management** (`src/services/config-manager.ts`) - Manages `.cconv.yaml` configuration with schema validation
4. **Output Formatting** (`src/utils/output-formatter.ts`) - Supports multiple output formats (text, JSON, SARIF, reviewdog)

### Key Architectural Patterns

**Command Pattern**: Each CLI command (`add`, `review`, `fix`, etc.) is implemented as a separate module that:
- Accepts paths/globs or stdin input
- Uses ProviderFactory to create the appropriate AI provider
- Handles concurrent file processing with configurable limits
- Outputs results in the requested format

**AI Integration**: The ClaudeProvider implements retry logic with session management:
- Initial attempts run without session ID
- Format errors trigger retry with error correction prompt using the same session
- Execution errors trigger fresh attempts without session context

**Configuration Schema**: Uses Valibot for runtime validation of:
- Review rules with severity levels (error, warning, info)
- File inclusion/exclusion patterns
- Provider settings (command path, concurrency, timeouts)

**Diff Processing**: Special handling for git diffs:
- Parses unified diff format to extract file changes
- Focuses review only on modified lines
- Maps review results back to original file line numbers

### Important Implementation Details

- All async operations use `p-limit` for controlled concurrency
- JSON extraction from AI responses handles various formatting edge cases
- File patterns support glob syntax with default exclusions (node_modules, dist, etc.)
- SARIF output enables integration with CI/CD tools and IDEs
- The tool requires Claude CLI to be installed and accessible