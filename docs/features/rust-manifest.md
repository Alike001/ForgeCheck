# Offline Soroban Cargo manifest inspector (issue #23)

An independent read-only Node.js 22+ inspector for local Rust Cargo manifests. It does not run Cargo, rustc, build.rs, package scripts, network requests, or external services. **It is not integrated with the ForgeCheck CLI.**

```js
import { inspectCargoManifestFile, inspectCargoManifest } from './src/modules/rust-manifest/index.mjs';
const result = await inspectCargoManifestFile('/path/to/crate/Cargo.toml', {
  workspacePath: '/path/to/workspace/Cargo.toml' // optional, explicit; never auto-discovered
});
console.log(result.sdk, result.crateTypes, result.profiles, result.diagnostics);
// Alternatively inspectCargoManifest(tomlText, { workspaceToml: parentText });
```

Results contain `status` (`inspected`, `invalid`, or `not-evaluated`), optional package name, declared library `crate-type` strings, profile settings, `sdk` declarations, and typed diagnostics. `sdk[]` entries separate `name` (dependency alias), `package` (`soroban-sdk`), scope, **`versionRequirement`** (declared range or `null`) and **`versionResolved: null`**. Never treat a Cargo requirement as a lockfile resolution, build success, target selection or protocol compatibility.

The supported TOML subset includes ordinary tables, dotted keys, simple strings, booleans, numbers, inline tables, arrays and array-of-tables. Unsupported (possibly valid) TOML syntax gives `not-evaluated` with an explanatory review diagnostic; malformed syntax gives `invalid`. Duplicate or conflicting declarations are not silently overridden. Input is capped at **1 MiB** and file access rejects symlinks.

Coverage: `[dependencies]`, `[build-dependencies]`, `[dev-dependencies]`, direct `soroban-sdk = "..."`, `{version=...}` inline tables, `package="soroban-sdk"` renamed dependencies, and `workspace=true` inheritance from an explicitly supplied workspace manifest or one in the same document. A workspace-only declaration is distinguished from an actual crate use. Explicitly reports unknown versions, unresolved workspace inheritance, non-registry dependencies and unsupported target-specific sections. Profile summary covers `[profile.*]` fields such as `opt-level`, `lto`, `codegen-units`, `panic`, `strip` and `debug` as declarations only.

Limitations: target-specific dependency tables and advanced Cargo/TOML features aren't resolved; inherited `package.*.workspace` fields aren't followed; proc-macro/build-script capabilities aren't investigated; no lockfile or artifact is read. This module makes no claim that the crate produces deployable Soroban Wasm.

Run `node --test tests/rust-manifest.test.mjs` from the repository root.

**Sources:** [Cargo dependency reference](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html), [Cargo workspaces](https://doc.rust-lang.org/cargo/reference/workspaces.html), [Soroban Rust SDK](https://github.com/stellar/rs-soroban-sdk).
