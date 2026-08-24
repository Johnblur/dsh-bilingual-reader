// src/host/dsh-llm.d.ts — type stub for the DSH-provided @deepseek-ai/dsh-llm.
// Not installed into the plugin (DSH supplies it at runtime; host bundle externalizes it).
declare module '@deepseek-ai/dsh-llm' {
  export function deepFreeze<T>(value: T): T;
  export function createUserMessage(input: { content: unknown; source?: unknown }): unknown;
  export function createAssistantMessage(input: { content: unknown; source?: unknown }): unknown;
  export class BlockAssembler {
    push(chunk: unknown): void;
    finish: { kind: string; failure?: { message?: string } };
    blocks(): Array<{ type: string; text?: string }>;
  }
}
