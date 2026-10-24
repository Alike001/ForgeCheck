# Offline Soroban Wasm artifact inspector (issue #24)

A bounded, standalone Node.js 22+ structural inspector. **It is not integrated with the ForgeCheck CLI.** No contract is executed, compiled, instantiated, deployed or uploaded, and no wallet or network is used.

```js
import { inspectWasmArtifactFile, inspectWasmArtifact } from './src/modules/wasm-inspector/index.mjs';
const report = await inspectWasmArtifactFile('/path/to/contract.wasm');
// Or inspectWasmArtifact(new Uint8Array(wasmBytes));
console.log(report.status, report.sections, report.customSections, report.metadata, report.diagnostics);
```

Results distinguish `invalid` framing from successfully `inspected` framing. Reports contain a boolean `validFraming`, binary version, byte count, section offsets and sizes, custom section names, the presence of `contractspecv0`, `contractmetav0`, `contractenvmetav0`, and non-sensitive diagnostics. Absence of these **optional** metadata sections produces review notes, not a claim of invalid Wasm or nondeployability.

The scanner checks `\0asm` magic, binary format version 1, unsigned LEB128 section lengths (maximum five encoded bytes), payload bounds, legal section IDs, single occurrence and ordering of standard sections (including the special data-count position), valid UTF-8 custom section names, and custom-name boundaries. Bounds: **16 MiB** total artifact, **4,096 sections**, **256 UTF-8 bytes** per custom section name. Oversized, incomplete, incorrectly ordered and malformed framing fails explicitly; content is never executed. Symbolic links are refused by the file API.

**Limitations:** This is a *framing and name inspector*, not a full Wasm binary decoder, Wasm validator, contract spec parser, Soroban protocol checker or guarantee of deployability. Internal section payloads are treated as opaque; metadata can be present but invalid. Finding a `start` section only triggers a review note and does not cause execution. File names/metadata section names should still be treated as untrusted.

Run `node --test tests/wasm-inspector.test.mjs` from the repository root.

**Sources:** [WebAssembly binary format](https://www.w3.org/TR/wasm-core-2/), [Stellar contract build metadata](https://developers.stellar.org/docs/tools/cli/cookbook/contract-build-meta).
