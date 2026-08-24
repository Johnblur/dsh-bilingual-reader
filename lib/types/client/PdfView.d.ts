export interface PdfViewProps {
    file: string;
    onSelect?: (text: string) => void;
}
interface ReactPieces {
    h: (...args: any[]) => any;
    useState: (...args: any[]) => any;
    useEffect: (fn: () => void | (() => void), deps?: any[]) => void;
}
export declare function makePdfView({ h, useState, useEffect }: ReactPieces): (props: PdfViewProps) => any;
export {};
