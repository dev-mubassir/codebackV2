# Third-party notices

## OpenReply

Parts of Siffty's Auto DM feature (`backend/src/features/autodm/`) are adapted
from OpenReply, https://github.com/diwenne/openreply (commit 5760181). OpenReply
is not a dependency, submodule or vendored folder; the pieces below were
rewritten in this codebase's style. Every file with adapted code carries the
header comment "Adapted from OpenReply (MIT)".

| Siffty file | Adapted from |
|---|---|
| `backend/src/features/autodm/matcher.js` | `lib/utils/keyword-matcher.ts` |
| `backend/src/features/autodm/graph.js` | `lib/meta/client.ts` (button-template private reply / DM, follow status) |
| `backend/src/features/autodm/worker.js` | `lib/queue/dm-worker.ts` (follow-gate fail-open after a tap) |
| `backend/src/features/autodm/poller.js` | `lib/polling/comment-reconciler.ts` |
| `backend/src/features/autodm/intake.js` | `lib/meta/webhook.ts` (comment payload fields) |
| `backend/tests/autodm-matcher.test.js` | `__tests__/keyword-matcher.test.ts`, `__tests__/keyword-matcher-arabic-script.test.ts` |

```
MIT License

Copyright (c) 2026 Anish Raj
Copyright (c) 2026 Diwen Huang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
