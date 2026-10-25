# Offline Stellar network configuration check (Issue #26)

This standalone API checks **caller-supplied in-memory settings**, not files or a live network. It detects a definite conflict when a recognized selected network and a recognized exact network passphrase disagree. It also emits review-only diagnostics for unknown/custom settings, malformed URLs, and unfamiliar or self-hosted endpoint hostnames.

```js
import { analyzeNetworkConfig, NETWORK_PASSPHRASES } from "../../src/modules/network-config/index.mjs";

const result = analyzeNetworkConfig({
  network: "PUBLIC",
  networkPassphrase: NETWORK_PASSPHRASES.TESTNET,
  rpcUrl: "https://my-private-rpc.example.org",
});
console.log(result.status); // "confirmed-failure": known PUBLIC/Testnet contradiction
console.log(result.diagnostics.map(({ code, confidence }) => ({ code, confidence })));
```

Accepted fields are `network`, `networkPassphrase`, `horizonUrl` and `rpcUrl`. Known labels are `PUBLIC` (aliases `MAINNET`, `PUBNET`), `TESTNET` and `FUTURENET` (case-insensitive). Only their **exact** published passphrases count as recognized. For custom passphrases, this tool deliberately cannot prove that the network is wrong.

Output includes a `status` of `consistent`, `review-required`, or `confirmed-failure` and a deterministic `diagnostics` list. Each diagnostic has `code`, `field`, `confidence`, `message` and `guidance`, and endpoint diagnostics may include only a sanitized `hostname`. No URL credentials, port, path, query, fragment, or network passphrase is echoed. Providing passwords inside URLs triggers a warning. All status and message values are generic; user-supplied network names and passphrases are never copied into them.

## Safety limits

- **Offline**: no HTTP, file reads, credential access, or side effects. No mutation of the input object; property getters are not invoked.
- **No provider identity claims**: custom/self-hosted hosts are `review-required`, not failures. An exact first-party hostname match is merely a hint, **not** cryptographic proof of the connected network. There is no DNS, redirect, TLS, or RPC verification.
- **Known passphrase conflicts** produce `confirmed-failure`; unknown passphrases or non-standard network labels produce `review-required`. A `consistent` result only means known supplied static fields agree; it does **not** certify the actual endpoint or safety for Mainnet transactions.
- HTTP(S) URLs only, maximum 4096 input characters per endpoint. URL diagnostics omit sensitive URL components. Diagnostics retain hostnames only; hostnames can themselves be sensitive in private environments, so consider additional redaction before sharing reports.
- This module is not integrated with the root CLI. A later maintainer-led integration can choose how to display or act on these diagnostics.

Run the standalone tests with:

```sh
node --test tests/network-config.test.mjs
```

Or use the repository's existing verification:

```sh
npm ci
npm run build
npm test
npm run check:repo
```

References: [Stellar SDK network passphrases](https://stellar.github.io/js-stellar-base/global.html), [Stellar networks](https://developers.stellar.org/docs/networks), and [Stellar custom network setup](https://developers.stellar.org/docs/tools/quickstart/getting-started/connect-stellar-lab).
