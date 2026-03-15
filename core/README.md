# @aai/core

Internal plumbing for the [AAI](https://jsr.io/@aai) voice agent framework.
Provides the wire protocol, worker entry, RPC transport, and shared types used
by `@aai/server` and `@aai/ui`.

> **Note:** This package is an internal dependency. Use
> [`@aai/sdk`](https://jsr.io/@aai/sdk) to build agents and
> [`@aai/ui`](https://jsr.io/@aai/ui) for client UIs.

## Usage

```ts
import type { ClientMessage, ServerMessage } from "@aai/core/protocol";
import type { AgentConfig } from "@aai/core/types";
```
