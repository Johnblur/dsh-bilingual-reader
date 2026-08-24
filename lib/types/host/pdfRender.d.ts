export interface TextItem {
    x: number;
    y: number;
    fontSize: number;
    text: string;
}
export interface RenderedPage {
    imageDataUrl: string;
    width: number;
    height: number;
    items: TextItem[];
}
export declare function renderPage(file: string, pageNum: number, scale: number): Promise<RenderedPage>;
