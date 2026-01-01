# N8N Legacy Documentation Archive

**Status: DEPRECATED - For Reference Only**
**Archived: December 31, 2025**

---

## Why This Exists

This folder contains documentation from the **n8n-based expense automation system** that was replaced by AWS Lambda in December 2025.

**DO NOT USE THESE DOCS FOR THE CURRENT SYSTEM.**

The current system uses:
- **Supabase Edge Functions** for webhook handling and receipt fetching
- **AWS Lambda** for expense processing, matching, and QBO posting
- **No n8n workflows** - n8n has been completely removed

---

## What's In Here

| Document | Original Purpose |
|----------|------------------|
| `n8n-workflow-spec.md` | n8n workflow specifications |
| `N8N_*.md` | Various n8n fixes and troubleshooting |
| `AGENT1_*.md` | n8n Agent 1 (expense processor) docs |
| `AGENT2_*.md` | n8n Agent 2 (human review processor) docs |
| `THREE_AGENT_ARCHITECTURE.md` | Original 3-agent n8n design |
| `MIGRATION_SPEC_N8N_TO_LAMBDA.md` | Migration planning document |
| `MIGRATION_FIX_PLAN.md` | Migration fix planning |
| `CODE_CHANGES_REFERENCE.md` | Code changes during migration |

---

## When To Reference This

- Understanding historical decisions
- Debugging issues that may have roots in the old system
- Understanding the migration context

---

## Current System Documentation

For the **current Lambda-based system**, see:
- `../Technical_Docs/LAMBDA_ARCHITECTURE.md` - System architecture
- `../Technical_Docs/EDGE_FUNCTION_GUIDE.md` - Edge Function details
- `../Technical_Docs/TROUBLESHOOTING.md` - Common issues and fixes
- `../Technical_Docs/PROJECT_CHANGELOG.md` - Change history

---

*This archive was created when n8n was permanently shut down on December 31, 2025.*
