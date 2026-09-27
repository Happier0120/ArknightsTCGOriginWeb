type LogLevel = "info" | "warn" | "error";
type LogDetails = Record<string, unknown>;

const sensitiveKey = /token|secret|password|authorization|seed|gameState|cards|hand/i;

function sanitize(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitize(nestedValue, nestedKey),
      ]),
    );
  }
  return value;
}

export interface StructuredLoggerOptions {
  now?: () => number;
  write?: (line: string) => void;
}

export class StructuredLogger {
  private readonly now: () => number;
  private readonly write: (line: string) => void;

  constructor({ now = Date.now, write = console.log }: StructuredLoggerOptions = {}) {
    this.now = now;
    this.write = write;
  }

  info(event: string, details: LogDetails = {}) {
    this.emit("info", event, details);
  }

  warn(event: string, details: LogDetails = {}) {
    this.emit("warn", event, details);
  }

  error(event: string, details: LogDetails = {}) {
    this.emit("error", event, details);
  }

  private emit(level: LogLevel, event: string, details: LogDetails) {
    this.write(JSON.stringify({
      timestamp: new Date(this.now()).toISOString(),
      level,
      event,
      ...sanitize(details) as LogDetails,
    }));
  }
}
