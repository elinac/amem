const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|authorization|cookie|email)/i;
const SECRET_VALUE =
  /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const PHONE = /(?<!\d)(?:1[3-9]\d{9}|\+?\d{1,3}[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4})(?!\d)/g;

const MAX_STRING = 4000;

export function redactString(value: string, key = ""): string {
  if (SECRET_KEY.test(key)) return "[redacted]";
  let masked = value.replace(SECRET_VALUE, "[redacted]").replace(PHONE, "[redacted]");
  if (masked.length > MAX_STRING) {
    masked = `${masked.slice(0, MAX_STRING / 2)}…[truncated ${masked.length - MAX_STRING} chars]…${masked.slice(-MAX_STRING / 2)}`;
  }
  return masked;
}

export function redactDeep(value: unknown, key = ""): unknown {
  if (typeof value === "string") return redactString(value, key);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        redactDeep(v, k),
      ]),
    );
  }
  return value;
}

export function containsSecrets(text: string): boolean {
  SECRET_VALUE.lastIndex = 0;
  return SECRET_VALUE.test(text);
}
