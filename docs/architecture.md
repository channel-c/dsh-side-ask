# Architecture

The host half registers `/side` and `/btw`, owns `/side-chat` HTTP routes, and tracks side agents by parent session id. Each child uses DSH's native fork seed and parent preset. A seed ends at an accepted user question, completed step or completed turn; inherited queued inbox entries are canceled in the child before publication. The parent log remains untouched.

The initial provider/model/effort comes from the native model-selection projection's pending intent, then from the latest request header. The child receives its own durable `model/selection` event, so its picker and first request agree even before it has generated an answer.

The client registers an additive native right-sidebar tab and uses DSH UI primitives and design tokens. For model selection it retains the child through the client Session Controller and adapts the already registered native model component and its session-bound inject face. It does not redeclare or shadow `conversation.input.model`. DSH continues to own the model catalog, provider validation, errors and next-step switching behavior.

The side transcript excludes inherited events from the visible message list. Model-visible inherited history remains available. Reasoning and text stream through DSH's block assembler as distinct nodes. Quote text is encoded as reference data alongside the actual user question and rendered separately.

Selecting main text only updates a per-parent quote draft and opens the sidebar. It neither submits a prompt nor creates a side agent. Sending or opening the model picker creates the child lazily. Child creation is deduplicated on the host. Closing the tab disposes its agent and archives the session via the workspace registry.

The registry is process-local. There is no automatic post-creation parent synchronization or activity restoration after restart. The two sessions use the same working directory and native tool infrastructure; prompt isolation is not a filesystem sandbox.

## Validation

Run `npm run check` with Node.js 24. Regressions cover fork boundaries, pending inbox cancellation, initial/current model selection, both native slot load orders, quote encoding and draft separation, inherited transcript filtering, streaming reasoning, command identity and lifecycle/cancellation isolation. A live host is needed to verify the native model menu, actual provider generation, style parity and installation.
