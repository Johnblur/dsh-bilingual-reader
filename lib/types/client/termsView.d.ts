import type { ReaderController } from './reader.js';
interface ReactPieces {
    h: (...args: any[]) => any;
    useState: (...args: any[]) => any;
    useEffect: (fn: () => void | (() => void), deps?: any[]) => void;
}
export declare function makeTermsView({ h, useState, useEffect }: ReactPieces): (props: {
    controller?: ReaderController;
}) => any;
export {};
