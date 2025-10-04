import pino from "pino";
import { AtLeastOne } from "./custom-utility";
import { TracingContext } from "./tracing-utils";

type LoggerOptions = {
  pinoOptions?: pino.LoggerOptions;
  maxDepth?: number;
};

type BaseLogData = {
  message?: string;
  data?: any;
};

export type LogOptions = {
  whitelist?: string[];
  skipRedaction?: boolean; // Override redaction behavior
};

export type LogData = AtLeastOne<BaseLogData, "message" | "data">;

export type LogPayload = LogData & { options?: LogOptions };

/**
 * Temporary demo logger to use pino for tracing logging demonstration
 */
export class LoggerDemo {
  private static instance: LoggerDemo;
  // private defaultMaxDepth: number;
  private pinoLogger: pino.Logger;

  private constructor(options?: LoggerOptions) {
    // this.defaultMaxDepth = options?.maxDepth || 10;
    this.pinoLogger = pino({
      level: "info",
      formatters: {
        level: (label: string) => {
          return { level: label };
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      ...options?.pinoOptions,
    });
  }

  public static getLogger(options?: LoggerOptions): LoggerDemo {
    if (!LoggerDemo.instance) {
      LoggerDemo.instance = new LoggerDemo(options);
    }
    return LoggerDemo.instance;
  }

  private getTracingFields(): Record<string, string> {
    const traceId = TracingContext.getTraceId();

    const fields: Record<string, string> = {};

    if (traceId) {
      fields.traceId = traceId;
    }

    return fields;
  }

  private processArgs(
    payload: LogData,
    options?: LogOptions,
  ): { message?: string; data?: any } {
    const message = payload.message;

    // If no data, return just the message
    if (payload.data === undefined) {
      return { message };
    }

    // Check if redaction should be skipped (default is to apply redaction)
    const shouldSkipRedaction = options?.skipRedaction ?? false;

    // skip masking
    if (shouldSkipRedaction) {
      return {
        message,
        data: payload.data,
      };
    }

    // Apply redaction with whitelist
    // const redactor = new ObjectRedactor({
    //     maxDepth: this.defaultMaxDepth,
    //     // whitelist: options?.whitelist || [],
    // });

    // apply redaction here
    return {
      message,
      data: payload.data,
    };
  }

  private log(
    level: "info" | "warn" | "debug" | "trace" | "error" | "fatal",
    payload: LogData,
    options?: LogOptions,
  ): void {
    const { message: msg, data: logData } = this.processArgs(payload, options);
    const tracingFields = this.getTracingFields();
    let metadata: Record<string, unknown> | undefined;

    if (logData instanceof Error) {
      metadata = { ...tracingFields, err: logData };
    } else if (logData && typeof logData === "object") {
      metadata = { ...tracingFields, ...logData };
    } else if (Object.keys(tracingFields).length > 0) {
      metadata = { ...tracingFields };
    }

    if (metadata && msg) {
      this.pinoLogger[level](metadata, msg);
    } else if (metadata) {
      this.pinoLogger[level](metadata);
    } else if (msg) {
      this.pinoLogger[level](msg);
    }
  }

  public info(payload: LogData, options?: LogOptions): void {
    this.log("info", payload, options);
  }

  public warn(payload: LogData, options?: LogOptions): void {
    this.log("warn", payload, options);
  }

  public debug(payload: LogData, options?: LogOptions): void {
    this.log("debug", payload, options);
  }

  public trace(payload: LogData, options?: LogOptions): void {
    this.log("trace", payload, options);
  }

  public error(payload: LogData, options?: LogOptions): void {
    const errorOptions = { skipRedaction: true, ...options };
    this.log("error", payload, errorOptions);
  }

  public fatal(payload: LogData, options?: LogOptions): void {
    const fatalOptions = { skipRedaction: true, ...options };
    this.log("fatal", payload, fatalOptions);
  }

  public getPinoLogger(): pino.Logger {
    return this.pinoLogger;
  }
}

export const logger = LoggerDemo.getLogger();
