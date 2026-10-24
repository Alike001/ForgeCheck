export type Sep1Diagnostic = {code:string;severity:'error'|'review';field:string;line:number;reference:string};
export type Sep1Result = {
  status:'valid'|'invalid'|'not-evaluated'; valid:boolean; diagnostics:Sep1Diagnostic[];
  summary: null | {fields:string[];currencyCount:number;endpoints:Record<string,string>};
};
export declare function validateStellarToml(text:string):Sep1Result;
export declare function validateStellarTomlFile(path:string):Promise<Sep1Result>;
