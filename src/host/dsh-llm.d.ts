// src/host/dsh-llm.d.ts — type stub for the DSH-provided @deepseek-ai/dsh-llm.
// Not installed into the plugin (DSH supplies it at runtime; host bundle externalizes it).
// NOTE: `deepFreeze` was removed from dsh-llm's public exports in 0.1.2-rc.1 — do NOT
// import it from there (it now lives in the private @deepseek-ai/dsh-util-values dep).
declare module '@deepseek-ai/dsh-llm' {
  export function createUserMessage(input: { content: unknown; source?: unknown }): unknown;
  export function createAssistantMessage(input: { content: unknown; source?: unknown }): unknown;
  export class BlockAssembler {
    push(chunk: unknown): void;
    finish: { kind: string; failure?: { message?: string } };
    blocks(): Array<{ type: string; text?: string }>;
  }
}
