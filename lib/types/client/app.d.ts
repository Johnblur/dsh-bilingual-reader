export declare function makeClientFactory(): (require: (m: string) => unknown) => {
    inject: string[];
    apply: (ctx: unknown) => void;
};
