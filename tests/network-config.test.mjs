import test from "node:test";
import assert from "node:assert/strict";
import { analyzeNetworkConfig, NETWORK_PASSPHRASES } from "../src/modules/network-config/index.mjs";

const inspect = (config) => analyzeNetworkConfig(config);
const hasCode = (result, code) => result.diagnostics.some((x) => x.code === code);

test("matching named networks and exact passphrases are consistent", () => {
  for (const network of ["PUBLIC", "TESTNET", "FUTURENET"]) {
    assert.deepEqual(inspect({ network, networkPassphrase: NETWORK_PASSPHRASES[network] }), {
      status: "consistent", diagnostics: [],
    });
  }
  assert.equal(inspect({ network: "mainnet", networkPassphrase: NETWORK_PASSPHRASES.PUBLIC }).status, "consistent");
  assert.equal(inspect({ network: "pubnet", networkPassphrase: NETWORK_PASSPHRASES.PUBLIC }).status, "consistent");
});

test("a known public-to-testnet mismatch is a confirmed failure", () => {
  const result = inspect({ network: "PUBLIC", networkPassphrase: NETWORK_PASSPHRASES.TESTNET });
  assert.equal(result.status, "confirmed-failure");
  assert.equal(hasCode(result, "NETWORK_PASSPHRASE_MISMATCH"), true);
});

test("a known futurenet-to-mainnet mismatch is a confirmed failure", () => {
  const result = inspect({ network: "FUTURENET", networkPassphrase: NETWORK_PASSPHRASES.PUBLIC });
  assert.equal(result.status, "confirmed-failure");
});

test("custom network name/passphrase is review required, not a fabricated failure", () => {
  const result = inspect({ network: "my-private-chain", networkPassphrase: "private custom passphrase" });
  assert.equal(result.status, "review-required");
  assert.equal(hasCode(result, "UNKNOWN_NETWORK"), true);
  assert.equal(hasCode(result, "UNKNOWN_PASSPHRASE"), true);
});

test("self-hosted endpoint is not condemned even with a known network", () => {
  const result = inspect({
    network: "TESTNET", networkPassphrase: NETWORK_PASSPHRASES.TESTNET,
    rpcUrl: "http://127.0.0.1:8000/rpc",
  });
  assert.equal(result.status, "review-required");
  assert.equal(hasCode(result, "UNVERIFIED_ENDPOINT"), true);
  assert.equal(result.diagnostics[0].hostname, "127.0.0.1");
});

test("unknown hostnames including a testnet-looking hostname never establish network identity", () => {
  const result = inspect({
    network: "PUBLIC", networkPassphrase: NETWORK_PASSPHRASES.PUBLIC,
    horizonUrl: "https://testnet.example.org/path",
  });
  assert.equal(result.status, "review-required");
  assert.equal(hasCode(result, "NETWORK_PASSPHRASE_MISMATCH"), false);
  assert.equal(hasCode(result, "UNVERIFIED_ENDPOINT"), true);
});

test("special object-property hostname is treated as unverified", () => {
  const result = inspect({network: "PUBLIC", networkPassphrase: NETWORK_PASSPHRASES.PUBLIC, rpcUrl: "https://constructor"});
  assert.equal(result.status, "review-required");
  assert.equal(hasCode(result, "UNVERIFIED_ENDPOINT"), true);
});

test("matching known official endpoint hostname is accepted", () => {
  const result = inspect({
    network: "TESTNET", networkPassphrase: NETWORK_PASSPHRASES.TESTNET,
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
  });
  assert.equal(result.status, "consistent");
});

test("contradictory official endpoint is only a review hint, not proof", () => {
  const result = inspect({
    network: "PUBLIC", networkPassphrase: NETWORK_PASSPHRASES.PUBLIC,
    horizonUrl: "https://horizon-testnet.stellar.org",
  });
  assert.equal(result.status, "review-required");
  assert.equal(hasCode(result, "ENDPOINT_NETWORK_HINT"), true);
});

test("malformed and unsupported scheme URLs produce bounded diagnostics", () => {
  for (const url of ["not an url", "ftp://example.org", "https://%zz", "x".repeat(5000), 42]) {
    const result = inspect({ network: "PUBLIC", networkPassphrase: NETWORK_PASSPHRASES.PUBLIC, rpcUrl: url });
    assert.equal(result.status, "review-required");
    assert.equal(hasCode(result, "INVALID_ENDPOINT"), true);
  }
});

test("URL credentials, private paths, query and fragment are never echoed", () => {
  const secretValues = ["alicePrivate", "passwordPrivate", "pathPrivate", "tokenPrivate", "fragmentPrivate"];
  const config = {
    network: "TESTNET", networkPassphrase: NETWORK_PASSPHRASES.TESTNET,
    rpcUrl: "https://alicePrivate:passwordPrivate@node.example.org:9000/pathPrivate?token=tokenPrivate#fragmentPrivate",
  };
  const result = inspect(config);
  const serialized = JSON.stringify(result);
  assert.equal(result.status, "review-required");
  assert.equal(hasCode(result, "URL_CREDENTIALS"), true);
  for (const value of secretValues) assert.equal(serialized.includes(value), false);
  assert.equal(result.diagnostics[0].hostname, "node.example.org");
  assert.equal(serialized.includes(":9000"), false);
});

test("missing or unrecognized network identity requires human review", () => {
  assert.equal(hasCode(inspect({network: "TESTNET"}), "MISSING_PASSPHRASE"), true);
  assert.equal(inspect({networkPassphrase: NETWORK_PASSPHRASES.TESTNET}).status, "review-required");
  assert.equal(inspect({}).status, "review-required");
  assert.equal(inspect({network: "PUBLIC", networkPassphrase: "custom"}).status, "review-required");
});

test("invalid config types and scalar types are handled without leaking inputs", () => {
  for (const value of [null, undefined, "testnet", [], 10]) {
    assert.equal(hasCode(inspect(value), "INVALID_CONFIG"), true);
  }
  const result = inspect({network: {apiKey:"hidden"}, networkPassphrase: 42});
  assert.equal(result.status, "review-required");
  assert.equal(JSON.stringify(result).includes("hidden"), false);
});

test("input object and nested values remain unchanged", () => {
  const config = Object.freeze({network: "PUBLIC", networkPassphrase: NETWORK_PASSPHRASES.TESTNET,
    rpcUrl: "https://user:pw@custom.example.net/",});
  const original = JSON.stringify(config);
  inspect(config);
  assert.equal(JSON.stringify(config), original);
});

test("passphrases require exact matching (no silent trimming)", () => {
  const result = inspect({network: "TESTNET", networkPassphrase: NETWORK_PASSPHRASES.TESTNET + " "});
  assert.equal(result.status, "review-required");
  assert.equal(hasCode(result, "UNKNOWN_PASSPHRASE"), true);
});

test("accessors are not invoked or leaked", () => {
  let called = 0;
  const config = { network: "TESTNET", networkPassphrase: NETWORK_PASSPHRASES.TESTNET };
  Object.defineProperty(config, "rpcUrl", { enumerable:true, get() { called++; throw Error("private-token"); } });
  const result = inspect(config);
  assert.equal(called, 0);
  assert.equal(result.status, "review-required");
  assert.equal(hasCode(result, "UNSUPPORTED_ACCESSOR"), true);
  assert.equal(JSON.stringify(result).includes("private-token"), false);
});
