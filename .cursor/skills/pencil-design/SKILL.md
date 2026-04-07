---
name: pencil-design
description: >-
  Guide for integrating Pencil MCP design tool into the Blueprint pipeline.
  Use when working with .pen design files, generating UI mockups, extracting
  design specifications, or bridging Design Agent output to Pencil.
---

# Pencil Design Integration

## Overview
Pencil is a design tool accessed via MCP protocol. It reads/writes `.pen` files
(encrypted format — ONLY accessible via MCP tools, never via Read/Grep).

## MCP Tools Available

| Tool | Purpose |
|------|---------|
| `get_editor_state()` | Check current active .pen file |
| `open_document(path)` | Open existing or create new .pen file |
| `get_guidelines(topic)` | Get design rules (web-app, mobile-app, etc.) |
| `get_style_guide_tags` | List available style guide tags |
| `get_style_guide(tags)` | Get style guide for design task |
| `batch_get(patterns)` | Search/read nodes in .pen files |
| `batch_design(operations)` | Insert/update/delete design nodes |
| `snapshot_layout` | Check computed layout rectangles |
| `get_screenshot` | Visual validation of design output |
| `export_nodes` | Export to PNG/JPEG/WEBP/PDF |

## Design Agent → Pencil Workflow

1. Design Agent generates DESIGN.md with component specs
2. Use `get_guidelines(topic=web-app)` for Pencil design rules
3. Use `get_style_guide_tags` → `get_style_guide(tags)` for styling
4. Use `batch_design` to create mockup in .pen file
5. Use `get_screenshot` to validate visually
6. Export to `.blueprint/context/` for downstream agents

## batch_design Operations

```
foo=I("parent", { type:"frame", ... })   # Insert
baz=C("nodeId", "parent", { ... })       # Copy
U("nodeId", { content: "text" })         # Update
foo2=R("path", { type:"text", ... })     # Replace
D("nodeId")                              # Delete
M("nodeId", "parent", 2)                 # Move
G("nodeId", "ai", "prompt")             # Generate image
```

Max 25 operations per `batch_design` call.

## Rules
- NEVER read .pen files with Read/Grep — use MCP tools only
- Always use `get_editor_state()` first to check context
- Validate with `get_screenshot` after design changes
- Dark theme: bg #0a0a0a, text #ededed, accent #3b82f6
