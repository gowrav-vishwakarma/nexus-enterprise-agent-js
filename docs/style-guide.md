# Documentation style guide

**Who this is for:** Anyone writing or updating Nexus docs (humans and AI assistants).

## Key terms

- **Doc** — A markdown file in the `docs/` folder.
- **Parameter** — A named setting you pass when you build or run an agent.
- **Default** — The value Nexus uses when you leave a parameter out.

## Rules

1. **Define terms on first use.** Example: “A **large language model (LLM)** is the AI service that reads your messages and writes replies.”
2. **Spell out acronyms once.** Write “application programming interface (API)” once, then “API”.
3. **Use short sentences.** One idea per sentence when you can.
4. **Explain why before how.** Tell the reader what problem a feature solves, then show the steps.
5. **Annotate every parameter** with: required or optional, default value, and a plain-English description.
6. **Start major pages with “Who this is for”** and a **Key terms** box (5–8 bullets).
7. **Prefer plain words.** Say “save chat history to disk” instead of “persist sessions”.
8. **Link, don’t repeat.** Point to `docs/reference/` for full parameter tables.
9. **Keep examples runnable.** Point to `examples/` for copy-paste scripts.

## Parameter table format

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `exampleField` | No | `"hello"` | One sentence a beginner can understand. |
