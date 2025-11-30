import { AsyncLocalStorage } from "async_hooks";
import AWSXRay from "aws-xray-sdk-core";
import crypto from "crypto";

export type TracedEvent = {
  traceId?: string;
  detail?: {
    traceId?: string;
    [key: string]: any;
  };
  [key: string]: any;
};

type TraceContext = {
  traceId: string;
  spanId?: string;
  xrayEnv?: string;
};

type XRaySegmentPartial = {
  trace_id?: string | null;
};

export class TraceId {
  private static readonly TRACE_ID_HEADER = "X-Trace-Id";
  private static readonly XRAY_ENV_VAR = "_X_AMZN_TRACE_ID";
  private static readonly XRAY_TRACE_ID_REGEX =
    /(?:Root=)?1-([0-9a-f]{8})-([0-9a-f]{24})/i;

  private static getXRayEnv(): string | undefined {
    // Prefer ALS context if present
    return (
      process.env[this.XRAY_ENV_VAR] ||
      process.env[this.XRAY_ENV_VAR.toLowerCase()]
    );
  }

  public static generate(): string {
    console.log("[TraceId] Generating new trace ID");
    const epoch = Math.floor(Date.now() / 1000)
      .toString(16)
      .padStart(8, "0");
    // 24 hex chars = 12 bytes
    const random = crypto.randomBytes(12).toString("hex");
    return `${epoch}${random}`;
  }

  /**
   * Extract trace ID from API Gateway event headers
   * Priority: x-trace-id -> X-Ray env -> X-Ray segment -> generate new
   */
  static fromAPIGatewayEvent(event: {
    headers?: { [key: string]: string | undefined };
  }): TraceContext {
    const headers = event.headers || {};
    const xrayAvailability = this.getXRayTracingAvailability();
    const xrayEnv = xrayAvailability.envVar;
    const segment = this.getCurrentSegment();
    const spanId = this.getSpanIdFromXRay(xrayEnv, segment);

    const explicitTraceId = this.getHeader(headers, this.TRACE_ID_HEADER);
    if (explicitTraceId) {
      console.log(
        `[TraceId] Extracted trace ID from header: ${explicitTraceId}`,
      );
      return { traceId: explicitTraceId, spanId, xrayEnv };
    }

    // Only use X-Ray env/segment if real tracing is enabled (segment.trace_id)
    if (xrayAvailability.isTracingEnabled) {
      const awsTraceFromEnv = this.extractRootTraceId(xrayEnv);
      if (awsTraceFromEnv) {
        console.log(
          `[TraceId] Extracted trace ID from X-Ray environment: ${awsTraceFromEnv}`,
        );
        return { traceId: awsTraceFromEnv, spanId, xrayEnv };
      }
      const awsTraceFromSegment = this.getRootTraceIdFromSegment(segment);
      if (awsTraceFromSegment) {
        console.log(
          `[TraceId] Extracted trace ID from X-Ray segment: ${awsTraceFromSegment}`,
        );
        return { traceId: awsTraceFromSegment, spanId, xrayEnv };
      }
    }

    // fallback: generate new trace ID
    return { traceId: this.generate(), spanId, xrayEnv };
  }

  /**
   * Extract trace ID from any traced event structure.
   *
   * Priority:
   *   1. traceId
   *   2. X-Ray context (env/segment)
   *   3. Generate new
   */
  static fromTracedEvent(tracedEvent: TracedEvent): TraceContext {
    const xrayEnv = this.getXRayEnv();
    const segment = this.getCurrentSegment();
    const spanId = this.getSpanIdFromXRay(xrayEnv, segment);

    // explicit top-level traceId
    if (tracedEvent.traceId) {
      console.log("[TraceId] Extracted trace ID from traced event:", {
        traceId: tracedEvent.traceId,
      });
      return { traceId: tracedEvent.traceId, spanId, xrayEnv };
    }

    // explicit traceId in event detail
    if (tracedEvent.detail?.traceId) {
      console.log(
        `[TraceId] Extracted trace ID from traced event detail: ${tracedEvent.detail.traceId}`,
      );
      return {
        traceId: tracedEvent.detail.traceId,
        spanId,
        xrayEnv,
      };
    }

    const xrayAvailability = this.getXRayTracingAvailability();
    if (xrayAvailability.isTracingEnabled) {
      // X-Ray trace ID from env
      const awsTraceFromEnv = this.getRootTraceIdFromEnvironment();
      if (awsTraceFromEnv) {
        console.log(
          `[TraceId] Extracted trace ID from X-Ray environment: ${awsTraceFromEnv}`,
        );
        return { traceId: awsTraceFromEnv, spanId, xrayEnv };
      }

      // X-Ray trace ID from segment:
      const awsTraceFromSegment = this.getRootTraceIdFromSegment(segment);
      if (awsTraceFromSegment) {
        console.log(
          `[TraceId] Extracted trace ID from X-Ray segment: ${awsTraceFromSegment}`,
        );
        return { traceId: awsTraceFromSegment, spanId, xrayEnv };
      }
    }
    // Generate new trace ID
    return { traceId: this.generate(), spanId, xrayEnv };
  }
  /**
   * Extract spanId from X-Ray context.
   * If xrayEnv is present, use Parent= value. Otherwise, fallback to segment.id
   */
  private static getSpanIdFromXRay(
    xrayEnv?: string,
    segment?: any,
  ): string | undefined {
    if (xrayEnv) {
      // X-Ray env format: Root=...;Parent=...;Sampled=...
      const parentMatch = xrayEnv.match(/Parent=([\w-]+)/);
      if (parentMatch) {
        return parentMatch[1];
      }
    }
    // fallback: segment.id
    if (segment && typeof segment.id === "string") {
      return segment.id;
    }
    return undefined;
  }

  /**
   * Create headers for downstream http request.
   * If traceId is not provided, read from TracingContext, otherwise return an empty object.
   */
  static toHttpHeaders(traceId?: string): Record<string, string> {
    const id = traceId ?? TracingContext.getTraceId();
    return id ? { [this.TRACE_ID_HEADER]: id } : {};
  }

  private static getHeader(
    headers: Record<string, string | undefined>,
    headerName: string,
  ): string | undefined {
    const target = headerName.toLowerCase();
    // case in
    for (const key in headers) {
      if (key.toLowerCase() === target) {
        return headers[key];
      }
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
    return this.extractRootTraceId(this.getXRayEnv());
  }

  static getXRayTracingAvailability(): {
    isTracingEnabled: boolean;
    envVar?: string;
  } {
    const contextEnv = TracingContext.getXRayEnv();
    const xrayEnv = contextEnv ?? this.getXRayEnv();

    // If there's no xray env value, no x-ray propagation.
    if (!xrayEnv) {
      return { isTracingEnabled: false };
    }

    // Check Sampled flag (Sampled=1)
    const sampledMatch = xrayEnv.match(/Sampled=(\d)/);
    const isSampled = sampledMatch?.[1] === "1";

    // Check that a valid Root trace id exists in the env value
    const hasRoot = !!this.extractRootTraceId(xrayEnv);

    return {
      isTracingEnabled: Boolean(isSampled && hasRoot),
      envVar: xrayEnv,
    };
  }

  private static getRootTraceIdFromSegment(
    segment?: XRaySegmentPartial | null,
  ): string | undefined {
    return this.extractRootTraceId(segment?.trace_id ?? null);
  }

  private static getCurrentSegment(): XRaySegmentPartial | undefined {
    try {
      const sdk = AWSXRay as {
        getSegment?: () => XRaySegmentPartial | undefined;
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
 * Context utility to maintain traceId in execution context
 */
export class TracingContext {
  private static als = new AsyncLocalStorage<TraceContext>();

  private static getStore(): TraceContext | undefined {
    return this.als.getStore();
  }

  static getTraceId(): string {
    return this.getStore()?.traceId || "";
  }

  static getSpanId(): string | undefined {
    return this.getStore()?.spanId;
  }

  static getXRayEnv(): string | undefined {
    return this.getStore()?.xrayEnv;
  }

  static async withTraceContext<T>(
    ctx: TraceContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    const current = this.getStore() || {};
    const next = { ...current, ...ctx };
    return await this.als.run(next, fn);
  }
}
