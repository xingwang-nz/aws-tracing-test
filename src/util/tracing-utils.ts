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

export type TraceContext = {
  traceId: string;
  parentId?: string;
  spanId?: string;
  xrayEnv?: string;
};

type XRaySegmentPartial = {
  trace_id?: string | null;
  id?: string | null;
  parent_id?: string | null;
};

export class TraceId {
  private static readonly TRACE_ID_HEADER = "X-Trace-Id";
  private static readonly XRAY_ENV_VAR = "_X_AMZN_TRACE_ID";
  private static readonly XRAY_TRACE_ID_REGEX =
    /(?:Root=)?1-([0-9a-f]{8})-([0-9a-f]{24})/i;

  private static getXRayEnv(): string | undefined {
    return (
      process.env[this.XRAY_ENV_VAR] ??
      process.env[this.XRAY_ENV_VAR.toLowerCase()]
    );
  }

  private static generate(): string {
    // X-Ray format: 1-<8 hex epoch seconds>-<24 hex random>
    const epoch = Math.floor(Date.now() / 1000)
      .toString(16)
      .padStart(8, "0");
    // 24 hex chars = 12 bytes
    const random = crypto.randomBytes(12).toString("hex");
    return `${epoch}${random}`;
  }

  /**
   * Extract TraceContext from API Gateway event headers and X-Ray.
   * Priority: x-trace-id ->  X-Ray context (env/segment) -> generate new
   */
  static fromAPIGatewayEvent(event: {
    headers?: { [key: string]: string | undefined };
  }): TraceContext {
    const headers = event.headers || {};
    // 1. explicit header
    let traceId = this.getHeader(headers, this.TRACE_ID_HEADER);

    // 2. X-Ray context (env/segment) for spanId/parentId
    const xrayCtx = this.extractXRayContext();
    if (!traceId) {
      if (xrayCtx.traceId) {
        // X-Ray
        traceId = xrayCtx.traceId;
      } else {
        // Generate new
        traceId = this.generate();
      }
    }

    return {
      traceId,
      spanId: xrayCtx.spanId,
      parentId: xrayCtx.parentId,
      xrayEnv: xrayCtx.xrayEnv,
    };
  }

  /**
   * Extract TraceContext from any traced event and X-Ray.
   *
   * Priority:
   *   1. event traceId
   *   2. X-Ray context (env/segment)
   *   3. Generate new
   */
  static fromTracedEvent(tracedEvent: TracedEvent): TraceContext {
    // 1. explicit traceId
    let traceId = tracedEvent.traceId;
    if (!traceId && tracedEvent.detail?.traceId) {
      traceId = tracedEvent.detail.traceId;
    }

    const xrayCtx = this.extractXRayContext();
    if (!traceId) {
      if (xrayCtx.traceId) {
        // 2. X-Ray
        traceId = xrayCtx.traceId;
      } else {
        // 3. Generate new
        traceId = this.generate();
      }
    }

    return {
      traceId,
      spanId: xrayCtx.spanId,
      parentId: xrayCtx.parentId,
      xrayEnv: xrayCtx.xrayEnv,
    };
  }

  /**
   * Extract X-Ray context (traceId/root, parentId, spanId, segment) from env or segment.
   * Priority: env (root, parent), then segment (trace_id, id, parent_id)
   */
  private static extractXRayContext(): TraceContext {
    let traceId: string | undefined;
    let parentId: string | undefined;
    const envVal = this.getXRayEnv();

    if (envVal) {
      // X-Ray env format: Root=1-...;Parent=...;Sampled=...
      const rootMatch = envVal.match(/Root=([^;]+)/);
      const parentMatch = envVal.match(/Parent=([^;]+)/);
      traceId = rootMatch ? this.extractRootTraceId(rootMatch[1]) : undefined;
      parentId = parentMatch ? parentMatch[1] : undefined;
    }

    const spanId = this.getCurrentSegment()?.id || undefined;
    const segmentParentId = this.getCurrentSegment()?.parent_id || undefined;

    console.log(`extractXRayContext`, {
      traceId,
      parentId,
      envVal,
      spanId,
      segmentParentId,
    });

    return { traceId: traceId ?? "", parentId, spanId, xrayEnv: envVal };
  }

  /**
   * Used for downstream http request.
   */
  static toHttpHeaders(traceId?: string): Record<string, string> {
    const id = traceId ?? TracingContext.getTraceId();
    return id ? { [this.TRACE_ID_HEADER]: id } : {};
  }

  private static getHeader(
    headers: Record<string, string | undefined>,
    headerName: string
  ): string | undefined {
    const target = headerName.toLowerCase();
    // case insensitive search
    for (const key in headers) {
      if (key.toLowerCase() === target) {
        return headers[key];
      }
    }
    return undefined;
  }

  private static extractRootTraceId(
    traceValue?: string | null
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

  static getXRayAvailability(): {
    isAvailable: boolean;
    envVar?: string;
  } {
    const ctx = TracingContext.getTraceContext();
    const envVar = ctx.xrayEnv || this.getXRayEnv();
    return { isAvailable: !!envVar, envVar };
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
        `[TraceId] aws-xray-sdk-core segment access failed: ${message}`
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

  static getTraceContext(): TraceContext {
    return this.getStore() || { traceId: "" };
  }

  static getTraceId(): string {
    return this.getTraceContext().traceId || "";
  }

  static getSpanId(): string | undefined {
    return this.getTraceContext().spanId;
  }

  static getParentId(): string | undefined {
    return this.getTraceContext().parentId;
  }

  /**
   * Run a function within a trace context
   */
  static async withTraceContext<T>(
    ctx: TraceContext,
    fn: () => Promise<T>
  ): Promise<T> {
    return await this.als.run(ctx, fn);
  }
}
