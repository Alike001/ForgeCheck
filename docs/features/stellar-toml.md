# Offline SEP-1 stellar.toml validator (issue #22)

A standalone, zero-dependency Node.js 22+ API. The module does not fetch `stellar.toml` from domains, check CORS, confirm signing-key ownership, query endpoints, or execute code. **It is not wired into the ForgeCheck CLI.**

```js
import { validateStellarTomlFile, validateStellarToml } from './src/modules/stellar-toml/index.mjs';
const result = await validateStellarTomlFile('/absolute/path/to/stellar.toml');
// Or validateStellarToml(tomlText) if your application already holds the text.
console.log(result.status, result.diagnostics, result.summary);
```

- `status: 'valid'` means the **supported subset** has no definite errors; it does not certify SEP compliance. `invalid` means syntax/structure or supported-field validation failed. `not-evaluated` means the TOML contains unsupported syntax and validation cannot honestly conclude either way.
- Each diagnostic includes `code`, `severity` (`error` or `review`), field, 1-based line number where available, and a SEP-1 source URL. No source lines or raw secrets are echoed.
- Supported TOML constructs: tables (`[DOCUMENTATION]`), array-of-tables (`[[CURRENCIES]]`), dotted keys, quoted strings, literal strings, arrays, inline tables, booleans, decimal numbers, comments and blank lines. **Unsupported but potentially legal TOML** (date/time literals, quoted keys, multiline strings, specialized numbers) yields an explicit `not-evaluated` review diagnostic. Duplicate fields and repeated tables are errors.
- Supported SEP-1 fields include `VERSION`, `NETWORK_PASSPHRASE`, `ACCOUNTS`, `SIGNING_KEY`, `URI_REQUEST_SIGNING_KEY`, `TRANSFER_SERVER`, `TRANSFER_SERVER_SEP0024`, `FEDERATION_SERVER`, `KYC_SERVER`, `WEB_AUTH_ENDPOINT`, `WEB_AUTH_FOR_CONTRACTS_ENDPOINT`, `HORIZON_URL`, several other URLs, `[DOCUMENTATION]` basics, and `[[CURRENCIES]]` (code, issuer, contract and external `toml` references). Unknown extension fields are tolerated if parsed.
- No optional field is demanded just because it is common. The validator verifies the **shape** of `G...` public keys but does not check Stellar StrKey checksums or control of any account. URL validation checks protocol/syntax, not remote availability. Queries and fragments are stripped from returned endpoint summaries to avoid echoing embedded tokens.
- `[[CURRENCIES]]` entries support direct code/issuer and reference-only `toml` forms; malformed types, empty/invalid codes, duplicate (code, issuer) pairs, mixed `toml` references and wrong URL types fail closed. Currency schema is a deliberately limited subset of SEP-1, not a substitute for complete protocol conformance testing.
- File reads are limited to **100 KiB**, the maximum SEP-1 document size, and refuse symlinks. Errors are redacted. All work stays local.

Run `node --test tests/stellar-toml.test.mjs` from the repository root.

**Sources:** [SEP-1 specification](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md), [Stellar SEP-1 guidance](https://developers.stellar.org/docs/build/apps/example-application-tutorial/anchor-integration/sep1).
