# REVIEW Task 3b (builder Codex, reviewer Claude Sonnet, tests Dev)
- Plan critique (Claude): REVISE -> local must win on merge; track removals; explicit userTouchedRef; no hydratedRef skip. Applied.
- Code review 1 (Claude): CHANGES, 1 MAJOR: stale old-draft entries could merge into a new draftId. Fix loop 1 (Codex): publishPlan(initialEntries) on a real draftId transition.
- Code review 2 (Claude): APPROVE.
- Gate task3b-r3: lint 0, build 0, e2e 20/23 (= baseline), clinics 0. Probe 05: composerKeepsItemWithoutFirebase = true (was false), POST 503 path.
- Screenshots: /workspace/ai-logs/task3b/shots/before-composer-item-lost.png, after-composer-item-kept.png
