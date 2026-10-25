/**
 * Offline-only network identity diagnostics for caller-supplied configuration.
 * Does not read files, make HTTP requests, or assume custom hosts' identities.
 */
export const NETWORK_PASSPHRASES = Object.freeze({
  PUBLIC: "Public Global Stellar Network ; September 2015",
  TESTNET: "Test SDF Network ; September 2015",
  FUTURENET: "Test SDF Future Network ; October 2022",
});

const LABELS = Object.freeze({
  PUBLIC: "PUBLIC",
  PUBNET: "PUBLIC",
  MAINNET: "PUBLIC",
  TESTNET: "TESTNET",
  FUTURENET: "FUTURENET",
});

// These are exact, familiar first-party hostnames, not a network discovery API.
// All other hostnames (including self-hosted RPC nodes) remain unverified.
const ENDPOINT_HINTS = Object.freeze({
  "horizon.stellar.org": "PUBLIC",
  "horizon-testnet.stellar.org": "TESTNET",
  "soroban-testnet.stellar.org": "TESTNET",
});

const ENDPOINT_FIELDS = ["horizonUrl", "rpcUrl"];
const MAX_URL_LENGTH = 4096;

function knownPassphrase(value) {
  if (typeof value !== "string") return null;
  return Object.entries(NETWORK_PASSPHRASES)
    .find(([, passphrase]) => value === passphrase)?.[0] ?? null;
}

function diagnostic(code, field, confidence, message, guidance, hostname) {
  return {
    code,
    field,
    confidence,
    message,
    guidance,
    ...(hostname === undefined ? {} : { hostname }),
  };
}

// Read data properties without invoking user-defined property getters.
function readField(object, field, diagnostics) {
  const descriptor = Object.getOwnPropertyDescriptor(object, field);
  if (descriptor && !("value" in descriptor)) {
    diagnostics.push(diagnostic(
      "UNSUPPORTED_ACCESSOR", field, "review-required",
      "This setting uses an accessor instead of a plain value.",
      "Supply a plain data object for offline validation.",
    ));
    return undefined;
  }
  return descriptor?.value;
}

function inspectEndpoint(field, value, diagnostics) {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) {
    diagnostics.push(diagnostic(
      "INVALID_ENDPOINT", field, "review-required",
      "Endpoint URL is missing, too large, or not a string.",
      "Provide a valid bounded HTTP(S) URL. The analyzer will not connect to it.",
    ));
    return null;
  }
  let url;
  try {
    url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname) throw new TypeError();
  } catch {
    diagnostics.push(diagnostic(
      "INVALID_ENDPOINT", field, "review-required",
      "Endpoint is not a valid HTTP(S) URL.",
      "Correct the endpoint URL and check its network identity separately.",
    ));
    return null;
  }

  // Never serialize URL, username, password, path, query, port, or fragment.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const hostname = host.length <= 120 ? host : "[hostname omitted]";
  if (url.username || url.password) {
    diagnostics.push(diagnostic(
      "URL_CREDENTIALS", field, "review-required",
      "Endpoint URL embeds user credentials.",
      "Move credentials to an appropriate secret or authorization mechanism.",
      hostname,
    ));
  }
  return { hostname, hint: Object.hasOwn(ENDPOINT_HINTS, host) ? ENDPOINT_HINTS[host] : null };
}

/**
 * @param {object} config A plain, in-memory object with optional network,
 *   networkPassphrase, horizonUrl and rpcUrl fields.
 * @returns {{status: 'consistent'|'review-required'|'confirmed-failure', diagnostics: object[]}}
 */
export function analyzeNetworkConfig(config) {
  const diagnostics = [];
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return {
      status: "review-required",
      diagnostics: [diagnostic(
        "INVALID_CONFIG", "config", "review-required",
        "Expected a plain network configuration object.",
        "Provide network identity settings as an in-memory object.",
      )],
    };
  }

  const networkValue = readField(config, "network", diagnostics);
  const passphraseValue = readField(config, "networkPassphrase", diagnostics);
  const network = typeof networkValue === "string"
    ? (LABELS[networkValue.trim().toUpperCase()] ?? null)
    : null;
  const passphraseNetwork = knownPassphrase(passphraseValue);

  if (networkValue !== undefined && !network) {
    diagnostics.push(diagnostic(
      "UNKNOWN_NETWORK", "network", "review-required",
      "Network label is unknown or invalid.",
      "Confirm custom network settings manually; do not assume the public networks.",
    ));
  }
  if (passphraseValue !== undefined && !passphraseNetwork) {
    diagnostics.push(diagnostic(
      "UNKNOWN_PASSPHRASE", "networkPassphrase", "review-required",
      "Network passphrase is not one of the recognized public network passphrases.",
      "Verify custom network identity independently before signing transactions.",
    ));
  }
  if (network && passphraseNetwork && network !== passphraseNetwork) {
    diagnostics.push(diagnostic(
      "NETWORK_PASSPHRASE_MISMATCH", "networkPassphrase", "confirmed-failure",
      "Selected network conflicts with the recognized network passphrase.",
      "Choose the matching network and passphrase before signing transactions.",
    ));
  }
  if (network && passphraseValue === undefined) {
    diagnostics.push(diagnostic(
      "MISSING_PASSPHRASE", "networkPassphrase", "review-required",
      "Network passphrase is missing.",
      "Confirm the network passphrase before constructing or signing transactions.",
    ));
  }
  if (!network && !diagnostics.some((d) => d.field === "network")) {
    diagnostics.push(diagnostic(
      "MISSING_NETWORK", "network", "review-required",
      "No recognized network label was supplied.",
      "Specify PUBLIC, TESTNET or FUTURENET, or verify the custom network independently.",
    ));
  }

  for (const field of ENDPOINT_FIELDS) {
    const info = inspectEndpoint(field, readField(config, field, diagnostics), diagnostics);
    if (!info) continue;
    if (info.hint && network && info.hint !== network) {
      diagnostics.push(diagnostic(
        "ENDPOINT_NETWORK_HINT", field, "review-required",
        "A known endpoint hostname suggests a different network.",
        "Check the intended network and the service's actual network identity.",
        info.hostname,
      ));
    } else if (!info.hint) {
      diagnostics.push(diagnostic(
        "UNVERIFIED_ENDPOINT", field, "review-required",
        "Endpoint network identity cannot be established offline.",
        "A custom or self-hosted endpoint is permitted; verify its actual network separately.",
        info.hostname,
      ));
    }
  }

  return {
    status: diagnostics.some((item) => item.confidence === "confirmed-failure")
      ? "confirmed-failure"
      : diagnostics.length ? "review-required" : "consistent",
    diagnostics,
  };
}
