export declare const inject: string[];
export declare function apply(ctx: {
    llm: unknown;
    webServer: unknown;
    effect: (fn: () => unknown, label?: string) => unknown;
}): void;
