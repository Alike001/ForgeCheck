export type WasmDiagnostic={code:string;severity:'error'|'review';offset:number;reference:string};
export type WasmSummary={status:'inspected'|'invalid';validFraming:boolean;version:number|null;byteLength:number;sections:{id:number;offset:number;byteLength:number;name?:string}[];customSections:string[];metadata:Record<string,boolean>;diagnostics:WasmDiagnostic[]};
export declare function inspectWasmArtifact(input:Uint8Array):WasmSummary;
export declare function inspectWasmArtifactFile(path:string):Promise<WasmSummary>;
