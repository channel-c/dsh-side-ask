export declare function sidePromptContent(text: string, quote?: string): {
    type: 'text';
    text: string;
}[];
export declare function sidePromptParts(content: readonly unknown[] | undefined): {
    text: string;
    quote?: string;
};
