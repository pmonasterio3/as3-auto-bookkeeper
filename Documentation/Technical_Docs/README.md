# Technical Documentation

**Last Updated:** December 29, 2025

This folder contains technical documentation for the AS3 Auto Bookkeeper system. Documentation is organized by category for easy reference.

---

## Core Architecture

| Document | Purpose |
|----------|---------|
| **SYSTEM_BOUNDARIES.md** | **START HERE** - Defines component responsibilities and separation of concerns |
| **TRUTH_SOURCE.md** | Business rules and data integrity principles |
| **THREE_AGENT_ARCHITECTURE.md** | Three-agent workflow design (Agent 1, 2, 3) |

---

## Agent 1 (Expense Validation)

**Start Here:** `AGENT1_UPDATE_GUIDE.md`

| Document | Purpose |
|----------|---------|
| **AGENT1_UPDATE_GUIDE.md** | **Master guide** - Complete update instructions for all Agent 1 nodes |
| **AGENT1_MATCH_BANK_TRANSACTION_CODE.md** | Code for Match Bank Transaction node |
| **AGENT1_AI_PROMPT.md** | AI Agent system message |
| **AGENT1_PARSE_AI_DECISION_CODE.md** | Bulletproof Parse AI Decision code |
| **AGENT1_UPDATE_STATUS_NODES.md** | Field configurations for status update nodes |

---

## Agent 2 (QBO Posting)

| Document | Purpose |
|----------|---------|
| **AGENT2_HANDOFF.md** | Agent 1 → Agent 2 handoff specification |
| **AGENT2_IMPLEMENTATION_GUIDE.md** | Complete Agent 2 implementation guide |
| **QBO_LIVE_IMPLEMENTATION.md** | QuickBooks Online integration details |

---

## n8n Workflow Fixes

| Document | Purpose | Status |
|----------|---------|--------|
| **N8N_MATCH_BANK_TRANSACTION_FIX.md** | Bank transaction matching improvements | ✅ Applied |
| **N8N_AI_RECEIPT_TOOL_FIX.md** | AI receipt tool configuration | ✅ Applied |
| **N8N_BANK_TRANSACTION_FIX.md** | Bank transaction data flow fix | ✅ Applied |
| **N8N_HUMAN_APPROVED_PROCESSOR_FIX.md** | Human approved processor vendor fix | ✅ Applied |
| **N8N_VALIDATE_RECEIPT_FIX.md** | Receipt validation improvements | ✅ Applied |
| **N8N_PRE_MATCH_FIX.md** | Pre-match logic improvements | ✅ Applied |
| **N8N_SIMPLIFICATION_GUIDE.md** | Workflow simplification strategy | Reference |
| **N8N_WORKFLOW_REBUILD_GUIDE.md** | Complete workflow rebuild guide | Reference |
| **N8N_HTTP_REQUEST_GOTCHAS.md** | Common HTTP request pitfalls | Reference |
| **N8N_MONDAY_SUBITEM_FAILED_APPROACHES.md** | Failed approaches (what NOT to do) | Archive |

---

## UI/Frontend

| Document | Purpose |
|----------|---------|
| **UI_QUEUE_INTEGRATION_SPEC.md** | Web app queue integration specification |
| **BANK_TRANSACTION_PICKER.md** | Bank transaction picker component spec |

---

## Implementation & Planning

| Document | Purpose |
|----------|---------|
| **IMPLEMENTATION_ACTION_PLAN.md** | Phased implementation roadmap |
| **PROJECT_CHANGELOG.md** | **Historical record** - All fixes, changes, and lessons learned |

---

## Quick Start

### For New Developers

1. Read `SYSTEM_BOUNDARIES.md` - Understand what each component does
2. Read `TRUTH_SOURCE.md` - Learn business rules
3. Read `PROJECT_CHANGELOG.md` - See what problems were already solved
4. Review `AGENT1_UPDATE_GUIDE.md` - Current state of Agent 1

### For Updating Agent 1

1. Start with `AGENT1_UPDATE_GUIDE.md`
2. Follow step-by-step instructions for each node
3. Reference individual component docs as needed
4. Update `PROJECT_CHANGELOG.md` with any new fixes

### For Debugging

1. Check `PROJECT_CHANGELOG.md` for similar past issues
2. Review `N8N_*_FIX.md` files for relevant workflows
3. Consult `SYSTEM_BOUNDARIES.md` to ensure proper separation of concerns
4. Check `N8N_HTTP_REQUEST_GOTCHAS.md` and `N8N_MONDAY_SUBITEM_FAILED_APPROACHES.md` for known pitfalls

---

## Documentation Standards

### File Naming

- **AGENT#_**: Agent-specific implementation docs
- **N8N_**: n8n workflow fixes and guides
- **UI_**: Frontend/web app specifications
- Architecture/system docs: Use descriptive names (SYSTEM_BOUNDARIES, TRUTH_SOURCE, etc.)

### Content Structure

All documentation should include:
- **Last Updated:** Date stamp
- **Purpose:** Clear description of what the doc covers
- **Status:** If applicable (Implemented, In Progress, Archive)
- **Related Docs:** Links to related documentation

### Maintenance

- Update `PROJECT_CHANGELOG.md` when fixes are completed
- Add "Last Updated" date when making changes
- Archive outdated approaches (don't delete - they provide context)
- Keep `AGENT#_UPDATE_GUIDE.md` files current with latest code

---

## Recent Major Updates

**December 29, 2025:**
- Bulletproof Parse AI Decision code (multi-layer approval detection)
- Bank transaction matching improvements (±3 day tolerance, word-based matching)
- Date inversion auto-correction (RECEIPT_DATE extraction)
- Consolidated Agent 1 documentation into master update guide

See `PROJECT_CHANGELOG.md` for complete history.

---

**Questions?** Start with `SYSTEM_BOUNDARIES.md` or consult `PROJECT_CHANGELOG.md` for historical context.
