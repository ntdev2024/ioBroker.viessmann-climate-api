const REDACTED = "[REDACTED]";

const SENSITIVE_KEY = "access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|oauthCode|oauthPkceVerifier";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactKnownValues(text, sensitiveValues) {
  let result = text;
  for (const value of sensitiveValues || []) {
    if (typeof value !== "string" || value.length < 4) {
      continue;
    }
    const variants = new Set([value]);
    try {
      variants.add(encodeURIComponent(value));
      variants.add(new URLSearchParams({ value }).toString().slice("value=".length));
    } catch {
      // The raw value is still redacted if an unusual value cannot be encoded.
    }
    for (const variant of variants) {
      result = result.replace(new RegExp(escapeRegExp(variant), "g"), REDACTED);
    }
  }
  return result;
}

function removeUnsafeControlCharacters(text) {
  return Array.from(text, character => {
    const code = character.charCodeAt(0);
    const unsafe = (code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
    return unsafe ? "" : character;
  }).join("");
}

export function redactSensitiveText(value, { sensitiveValues = [] } = {}) {
  let text = value instanceof Error ? value.message : String(value ?? "");

  text = redactKnownValues(text, sensitiveValues);
  text = text.replace(/\bBearer\s+[^"'\r\n]*/gi, `Bearer ${REDACTED}`);
  text = text.replace(
    new RegExp(`((?:"|')?(?:${SENSITIVE_KEY})(?:"|')?\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^,\\s}&]+)`, "gi"),
    `$1"${REDACTED}"`
  );
  text = text.replace(new RegExp(`([?&\\s](?:${SENSITIVE_KEY}|code|code_verifier)=)[^&\\s]+`, "gi"), `$1${REDACTED}`);

  return removeUnsafeControlCharacters(text.replace(/[\r\n\t]+/g, " ")).trim();
}

export function safeErrorMessage(error, options) {
  return redactSensitiveText(error instanceof Error ? error.message : error, options);
}
