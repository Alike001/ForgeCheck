export type RustDiagnostic={code:string;severity:'error'|'review';field:string;line:number;reference:string};
export type RustSdkDependency={name:string;package:'soroban-sdk';scope:string;versionRequirement:string|null;versionResolved:null;workspaceInherited:boolean};
export type RustManifestResult={status:'inspected'|'invalid'|'not-evaluated';packageName:string|null;crateTypes:string[];profiles:{name:string;settings:Record<string,string|number|boolean>}[];sdk:RustSdkDependency[];diagnostics:RustDiagnostic[]};
export declare function inspectCargoManifest(text:string,opts?:{workspaceToml?:string}):RustManifestResult;
export declare function inspectCargoManifestFile(path:string,opts?:{workspacePath?:string}):Promise<RustManifestResult>;
