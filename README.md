# reviewit

reviewit is your coding standards, made executable.

[![npm version](https://badge.fury.io/js/reviewit.svg)](https://badge.fury.io/js/reviewit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Prerequisites

- Node.js 18+
- Claude CLI

## Get started

```bash
npm install -g @k-kinzal/reviewit
```

## Usage

```
reviewit [options] [command]

Options:
  -V, --version                  output the version number
  -v, --verbose                  Enable verbose output
  --max-concurrency <number>     Maximum number of concurrent reviews (default: 5)
  --max-retries <number>         Maximum number of retries for failed requests (default: 3)
  -h, --help                     display help for command

Commands:
  add [path]                     Generate review rules from files or stdin
  list                           List all saved review rules
  show <id>                      Show details of a specific review rule
  fix <path>                     Review and fix issues in files
  help [command]                 display help for command
```

### Examples

```bash
# Add review rules from a documentation file
reviewit add docs/coding-standards.md

# Review all TypeScript files in src directory
reviewit src/**/*.ts

# Fix issues automatically
reviewit fix src/**/*.ts

# Use custom concurrency limit for large projects
reviewit --max-concurrency 10 src/**/*.ts

# Retry failed requests up to 5 times
reviewit --max-retries 5 add docs/

# Review git diff (focus on changes only)
git diff | reviewit
git diff HEAD~1 | reviewit
git diff main...feature-branch | reviewit

# Configure in .reviewit.yaml
provider:
  type: claude
  command: /path/to/claude
  maxConcurrency: 10
  maxRetries: 5
  model: sonnet
  addDir: ["/additional/path"]
```