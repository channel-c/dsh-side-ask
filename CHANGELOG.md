# Changelog

## 0.3.4 — 2026-11-03

- Rename the project and package to DSH Side Ask (`dsh-side-ask`).
- Use neutral wording in documentation, command descriptions, source identifiers and release assets.
- Keep the existing side-chat routes, commands and session behavior.

## 0.3.3 — 2026-11-03

- Native DSH right-sidebar side conversations, with main-chat history captured at an accepted question or completed step.
- Selected main-chat text becomes a removable quote attachment before sending.
- Native DSH model/effort menu scoped to the child session; preserve the current parent selection at creation, including pending changes.
- Stream reasoning separately from final answers; native send, stop and copy interactions.
- Cancel inherited pending inbox entries in the child so parent work cannot become a side question.
- Reuse the registered model component without redeclaring the main composer's slot; cover both plugin load orders in regression tests.
- Remove development-only session debug/dump routes from the release.
- Document supported host versions, shared-workspace behavior, cache limitations and session lifetime.

Based on the MIT-licensed upstream project [zclDragon/dsh-side-chat](https://github.com/zclDragon/dsh-side-chat).
