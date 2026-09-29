Read SPEC.md and RULES.md before any work.

File ownership (never edit files you don't own):
- Claude: src/engine/, src/bots/, src/coach/, tests/engine/, tests/bots/, tests/coach/, REQUESTS-claude.md
- Astra: src/ui/, src/explain/, src/export/, src/tracker/, src/data/, src/main.js, index.html, styles/, tests/explain/, tests/export/, tests/tracker/, tests/data/, tests/engine-extra/, tests/integration/, REQUESTS-astra.md
- Human only: SPEC.md, src/shared/schemas.js

If you need a change in a file you don't own, or in the schemas, don't edit it. Append a request to your own REQUESTS file describing the change and why, and work around it with a local adapter.
Only stage and commit files you own (never `git add .`). Commit after each working sub-part of a task, with a descriptive message, so progress survives interruptions. Don't run formatters or linters across the whole repo. Name all test files *.test.js. Run `node --test` before committing.
