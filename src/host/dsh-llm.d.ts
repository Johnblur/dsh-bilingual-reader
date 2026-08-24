// src/host/dsh-llm.d.ts — type stub for the DSH-provided @deepseek-ai/dsh-llm.
// This package is NOT installed into the plugin (DSH supplies it at runtime and the
// host bundle externalizes it), so we declare the two creators we use for tsc.
declare module '@deepseek-ai/dsh-llm' {
  export function createUserMessage(input: { content: unknown; source?: unknown }): unknown;
  export function createAssistantMessage(input: { content: unknown; source?: unknown }): unknown;
}
