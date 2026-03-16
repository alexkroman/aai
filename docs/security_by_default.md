# Secure by default

Every agent gets the same isolation out of the box. You don't need
to configure any of this.

## Sandbox

Agent code runs in a Deno Worker with all permissions disabled —
no file system, no network, no environment variables. Each worker
is a V8 isolate with its own heap and execution context, fully
memory-isolated from the host process and other workers.

## Distroless container

The server runs on `gcr.io/distroless/cc-debian12:nonroot` — no
shell, no package manager, no OS tools. The container contains
nothing but a single compiled binary running as a non-root user.

## Secrets

Secrets are stored on the server via `aai env add` and injected
at runtime through `ctx.env` — never bundled into your code.

## Fetch proxy

`fetch` works but is proxied through the host, which blocks
requests to private and internal addresses.

## Host boundary

Built-in tools (web search, fetch, etc.) run on the host outside
the sandbox. Your custom tools run inside it.

## Object-capability RPC

The worker communicates with the host via
[object-capability](https://en.wikipedia.org/wiki/Object-capability_model)
RPC (capnweb). The sandbox receives only the specific capabilities
it needs — fetch proxy, KV, tool execution — as unforgeable
references, not ambient authority.

## Code execution sandbox

The `run_code` built-in tool executes in a second layer of
sandboxing with a 30-second timeout.

## Encrypted at rest

Environment variables are encrypted with AES-256-GCM before
storage. Keys are derived via HKDF. Secrets are only decrypted
for the lifetime of a worker and discarded when the worker is
terminated after 5 minutes idle.

## Signed deploys

Deploy credentials use HMAC-SHA256 signed JWTs to prove agent
ownership.

## KV isolation

The built-in key-value store is scoped per deploy. Every key is
prefixed with a hash of your deploy credential and agent slug, so
one agent can never read, write, or list another agent's data —
even if they share the same server. Redeploying with a different
credential creates a completely separate keyspace.

## Vector isolation

Vector search uses the same per-deploy scoping as KV. Each
agent's embeddings live in a namespace derived from its deploy
credential and slug. Queries and upserts are confined to that
namespace, so agents cannot access each other's vector data.
