import { ulid } from "ulid";
import { createHash } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import AWSXRay from "aws-xray-sdk-core";

type XRaySegmentLike = {
  trace_id?: string | null;
};

export class TraceId {
  private static readonly TRACE_ID_HEADER = "x-trace-id";
  private static readonly AWS_TRACE_HEADER = "X-Amzn-Trace-Id";
  private static readonly XRAY_ENV_VAR = "_X_AMZN_TRACE_ID";
  private static readonly XRAY_TRACE_ID_REGEX =
    /(?:Root=)?1-([0-9a-f]{8})-([0-9a-f]{24})/i;

  static generate(): string {
    return ulid();
  }

  /**
   * Extract trace ID from API Gateway event headers
   * Priority: x-trace-id -> X-Amzn-Trace-Id header -> X-Ray env -> X-Ray segment -> generate new
   */
  static fromAPIGatewayEvent(event: {
    headers?: { [key: string]: string | undefined };
  }): string {
    console.log(`Event: ${JSON.stringify(event)}`);

    const headers = event.headers || {};

    const explicitTraceId = this.getHeader(headers, this.TRACE_ID_HEADER);
    if (explicitTraceId) {
      return explicitTraceId;
    }

    const awsTraceHeader = this.getHeader(headers, this.AWS_TRACE_HEADER);
    const awsTraceFromHeader = this.extractRootTraceId(awsTraceHeader);
    if (awsTraceFromHeader) {
      console.log(`X-Ray trace ID from header: ${awsTraceFromHeader}`);
      return awsTraceFromHeader;
    }

    const awsTraceFromEnv = this.getRootTraceIdFromEnvironment();
    if (awsTraceFromEnv) {
      console.log(`X-Ray trace ID from env: ${awsTraceFromEnv}`);
      return awsTraceFromEnv;
    }

    const awsTraceFromSegment = this.getRootTraceIdFromSegment(
      this.getCurrentSegment(),
    );
    if (awsTraceFromSegment) {
      console.log(`X-Ray trace ID from segment: ${awsTraceFromSegment}`);
      return awsTraceFromSegment;
    }

    const generatedTraceId = this.generate();
    console.log(
      `No trace source found, generated new trace ID: ${generatedTraceId}`,
    );
    return generatedTraceId;
  }

  /**
   * Extract trace ID from EventBridge event payloads.
   *
   * Priority:
   *   1. Explicit trace identifiers (`traceId` on the event or the parsed detail payload).
   *   2. Any X-Ray compatible `traceHeader` values.
   *   3. Existing X-Ray context (env/segment).
   *   4. A Step Function execution identifier
   *   5. Generate new.
   */
  static fromEventBridgeEvent(event: {
    traceId?: unknown;
    traceHeader?: unknown;
    detail?: unknown;
    event?: unknown;
    stepFunctionExecutionId?: unknown;
    executionId?: unknown;
  }): string {
    const eventRecord = this.asRecord(event);
    const detail = this.parseDetail(eventRecord["detail"]);
    const metadata = this.asRecord(detail["metadata"]);

    const explicitTraceCandidates: Array<unknown> = [
      eventRecord["traceId"],
      detail["traceId"],
      metadata["traceId"],
    ];

    for (const candidate of explicitTraceCandidates) {
      const normalized = this.normalizeTraceId(candidate);
      if (normalized) {
        return normalized;
      }
    }

    const traceHeaderCandidates: Array<unknown> = [
      eventRecord["traceHeader"],
      detail["traceHeader"],
      metadata["traceHeader"],
    ];

    for (const candidate of traceHeaderCandidates) {
      const normalized = this.normalizeTraceId(candidate);
      const traceFromHeader = this.extractRootTraceId(normalized);
      if (traceFromHeader) {
        console.log(
          `X-Ray trace ID from EventBridge payload: ${traceFromHeader}`,
        );
        return traceFromHeader;
      }
    }

    const awsTraceFromEnv = this.getRootTraceIdFromEnvironment();
    if (awsTraceFromEnv) {
      console.log(`X-Ray trace ID from env: ${awsTraceFromEnv}`);
      return awsTraceFromEnv;
    }

    const awsTraceFromSegment = this.getRootTraceIdFromSegment(
      this.getCurrentSegment(),
    );
    if (awsTraceFromSegment) {
      console.log(`X-Ray trace ID from segment: ${awsTraceFromSegment}`);
      return awsTraceFromSegment;
    }

    const stepFunctionExecutionId = this.getStepFunctionExecutionId(
      eventRecord,
      detail,
      metadata,
    );
    if (stepFunctionExecutionId) {
      console.log(
        `Step Function execution ID fallback: ${stepFunctionExecutionId}`,
      );
      return stepFunctionExecutionId;
    }

    const generatedTraceId = this.generate();
    console.log(
      `No trace source found for EventBridge event, generated new trace ID: ${generatedTraceId}`,
    );
    return generatedTraceId;
  }

  /**
   * Create headers for downstream http request
   */
  static toHttpHeaders(traceId: string): Record<string, string> {
    return {
      [this.TRACE_ID_HEADER]: traceId,
    };
  }

  private static getHeader(
    headers: Record<string, string | undefined>,
    headerName: string,
  ): string | undefined {
    return headers[headerName] ?? headers[headerName.toLowerCase()];
  }

  private static asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private static parseDetail(detail: unknown): Record<string, unknown> {
    if (typeof detail === "string") {
      try {
        const parsed = JSON.parse(detail);
        return this.asRecord(parsed);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[TraceId] Failed to parse EventBridge detail payload: ${message}`,
        );
        return {};
      }
    }

    return this.asRecord(detail);
  }

  // TODO: adjust candidate based on the realevent input structure
  private static getStepFunctionExecutionId(
    source: Record<string, unknown>,
    _detail: Record<string, unknown>,
    _metadata: Record<string, unknown>,
  ): string | undefined {
    const nestedEvent = this.asRecord(source["event"]);
    return this.normalizeTraceId(nestedEvent["id"]);
  }

  private static normalizeTraceId(candidate: unknown): string | undefined {
    if (typeof candidate === "string") {
      return candidate;
    }

    if (typeof candidate === "number" || typeof candidate === "bigint") {
      return candidate.toString();
    }

    return undefined;
  }

  private static extractRootTraceId(
    traceValue?: string | null,
  ): string | undefined {
    if (!traceValue) {
      return undefined;
    }

    const match = traceValue.match(this.XRAY_TRACE_ID_REGEX);
    if (!match) {
      return undefined;
    }

    return `${match[1]}${match[2]}`;
  }

  static getRootTraceIdFromEnvironment(): string | undefined {
    return this.extractRootTraceId(
      process.env[this.XRAY_ENV_VAR] ??
        process.env[this.XRAY_ENV_VAR.toLowerCase()],
    );
  }

  static getRootTraceIdFromSegment(
    segment?: XRaySegmentLike | null,
  ): string | undefined {
    return this.extractRootTraceId(segment?.trace_id ?? null);
  }

  private static getCurrentSegment(): XRaySegmentLike | undefined {
    try {
      const sdk = AWSXRay as {
        getSegment?: () => XRaySegmentLike | undefined;
      };
      return sdk.getSegment?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[TraceId] aws-xray-sdk-core segment access failed: ${message}`,
      );
      return undefined;
    }
  }
}

/**
 * CorrelationId utilities for S3 Event -> EventBus -> Step Functions pipelines
 * @deprecated use TraceId instead
 */
export class CorrelationId {
  static generate(): string {
    return ulid();
  }

  /**
   * Extract correlation ID from S3 event
   * Format: s3-{bucketName}-{objectKey-hash}-{timestamp}
   */
  static fromS3Event(event: {
    bucket?: { name?: string };
    object?: { key?: string };
    eventTime?: string;
  }): string {
    const bucketName = event.bucket?.name || "unknown";
    const objectKey = event.object?.key || "unknown";
    const timestamp = event.eventTime
      ? new Date(event.eventTime).getTime().toString()
      : Date.now().toString();

    return `s3-${bucketName}-${this.simpleHash(objectKey)}-${timestamp}`;
  }

  /**
   * Extract correlation ID from Hummingbird event
   * Format: {source}-{scheduledTitleId}-{timestamp}
   */
  static fromHummingbirdEvent(event: {
    id?: string;
    source?: string;
    scheduledTitleId?: string | number;
    time?: string;
  }): string {
    if (event.scheduledTitleId) {
      const timestamp = event.time
        ? new Date(event.time).getTime().toString()
        : Date.now().toString();
      const source = event.source || "hb";
      return `${source}-${event.scheduledTitleId}-${timestamp}`;
    }
    return event.id || this.generate();
  }

  private static simpleHash(str: string): string {
    return createHash("sha1").update(str).digest("hex").slice(0, 8);
  }
}

/**
 * Context utility to maintain traceId/correlationId in execution context
 */
export class TracingContext {
  private static als = new AsyncLocalStorage<Record<string, string>>();

  private static getStore(): Record<string, string> | undefined {
    return this.als.getStore();
  }

  static setTraceId(traceId: string): void {
    const store = this.getStore();
    if (store) {
      store.traceId = traceId;
    } else {
      // create a new store for the current execution
      this.als.enterWith({ traceId });
    }
  }

  static getTraceId(): string | undefined {
    return this.getStore()?.traceId;
  }

  static setCorrelationId(correlationId: string): void {
    const store = this.getStore();
    if (store) {
      store.correlationId = correlationId;
    } else {
      this.als.enterWith({ correlationId });
    }
  }

  static getCorrelationId(): string | undefined {
    return this.getStore()?.correlationId;
  }

  static getCurrentId(): string | undefined {
    return this.getTraceId() || this.getCorrelationId();
  }

  static clear(): void {
    (this as any).als = new AsyncLocalStorage<Record<string, string>>();
  }

  static async withTraceId<T>(
    traceId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const current = this.getStore() || {};
    const next = { ...current, traceId };
    return await this.als.run(next, fn);
  }

  static async withCorrelationId<T>(
    correlationId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const current = this.getStore() || {};
    const next = { ...current, correlationId };
    return await this.als.run(next, fn);
  }
}
