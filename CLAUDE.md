# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Git Workflow — Feature Branches & PRs

**NEVER commit directly to `main`.** All code changes must go through a
feature branch and a pull request.

```bash
# Start work
git checkout main && git pull
git checkout -b feat/<issue-id>-short-description

# Finish work — push branch and open PR
git push -u origin feat/<issue-id>-short-description
gh pr create --title "..." --body "..." --base main
```

- Branch naming: `feat/<issue-id>-slug`, e.g. `feat/ra-123-govuk-notify`
- One branch per `bd` issue
- PR title should reference the issue id
- Do **not** merge the PR yourself — leave it for human review

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until the PR is open and `bd dolt push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH BRANCH & OPEN PR** - This is MANDATORY:
   ```bash
   git push -u origin <branch-name>
   gh pr create --title "<issue-id>: ..." --body "..." --base main
   bd dolt push
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - Branch pushed, PR open, bd data synced
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- NEVER commit to `main` directly
- Work is NOT complete until `git push` of the feature branch succeeds and a PR is open
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Build & Test

_Add your build and test commands here_

```bash
# Example:
# npm install
# npm test
```

## Architecture Overview

_Add a brief overview of your project architecture_

## Conventions & Patterns

_Add your project-specific conventions here_
