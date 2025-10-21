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

type XRaySegmentPartial = {
  trace_id?: string | null;
};

export class TraceId {
  private static readonly TRACE_ID_HEADER = "X-Trace-Id";
  private static readonly XRAY_ENV_VAR = "_X_AMZN_TRACE_ID";
  private static readonly XRAY_TRACE_ID_REGEX =
    /(?:Root=)?1-([0-9a-f]{8})-([0-9a-f]{24})/i;

  static generate(): string {
    // X-Ray format: 1-<8 hex epoch seconds>-<24 hex random>
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
  }): string {
    const headers = event.headers || {};

    const explicitTraceId = this.getHeader(headers, this.TRACE_ID_HEADER);
    // const awsTraceHeader = this.getHeader(headers, this.AWS_TRACE_HEADER);
    const awsTraceFromEnv = this.getRootTraceIdFromEnvironment();

    console.log(`Found explicit trace ID in headers: ${explicitTraceId}`);
    // console.log(`${this.AWS_TRACE_HEADER} from header: ${awsTraceHeader}`);
    console.log(`${this.XRAY_ENV_VAR} from env: ${awsTraceFromEnv}`);

    if (explicitTraceId) {
      return explicitTraceId;
    }

    // const awsTraceFromHeader = this.extractRootTraceId(awsTraceHeader);
    // if (awsTraceFromHeader) {
    //   return awsTraceFromHeader;
    // }

    if (awsTraceFromEnv) {
      return awsTraceFromEnv;
    }

    const awsTraceFromSegment = this.getRootTraceIdFromSegment(
      this.getCurrentSegment()
    );

    if (awsTraceFromSegment) {
      console.log(`X-Ray trace ID from segment: ${awsTraceFromSegment}`);
      return awsTraceFromSegment;
    }

    const generatedTraceId = this.generate();
    console.log(
      `No trace source found, generated new trace ID: ${generatedTraceId}`
    );
    return generatedTraceId;
  }

  /**
   * Extract trace ID from any traced event structure.
   *
   * Priority:
   *   1. traceId
   *   2. X-Ray context (env/segment)
   *   3. Generate new
   */
  static fromTracedEvent(tracedEvent: TracedEvent): string {
    // explicit top-level traceId
    if (tracedEvent.traceId) {
      return tracedEvent.traceId;
    }

    // explicit traceId in event detail
    if (tracedEvent.detail?.traceId) {
      return tracedEvent.detail.traceId;
    }

    // X-Ray trace ID from env
    const awsTraceFromEnv = this.getRootTraceIdFromEnvironment();
    if (awsTraceFromEnv) {
      return awsTraceFromEnv;
    }

    // X-Ray trace ID from segment:
    const awsTraceFromSegment = this.getRootTraceIdFromSegment(
      this.getCurrentSegment()
    );
    if (awsTraceFromSegment) {
      return awsTraceFromSegment;
    }

    // Generate new trace ID
    return this.generate();
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
    headerName: string
  ): string | undefined {
    const target = headerName.toLowerCase();
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

  static getRootTraceIdFromEnvironment(): string | undefined {
    return this.extractRootTraceId(
      process.env[this.XRAY_ENV_VAR] ??
        process.env[this.XRAY_ENV_VAR.toLowerCase()]
    );
  }

  /**
   * Check if X-Ray is available including X-Ray segment and environment variable
   */
  static getXRayAvailability(): {
    isAvailable: boolean;
    hasSegment: boolean;
    hasEnvVar: boolean;
    segment?: any;
    envVar?: string;
  } {
    let hasSegment = false;
    let hasEnvVar = false;
    let segment: any = undefined;
    let envVar: string | undefined = undefined;

    // First check for X-Ray environment variable (present when X-Ray is enabled)
    envVar =
      process.env._X_AMZN_TRACE_ID ??
      process.env[this.XRAY_ENV_VAR.toLowerCase()];
    hasEnvVar = !!envVar;

    // Only attempt to access AWSXRay.getSegment when X-Ray is active
    if (hasEnvVar) {
      try {
        segment = AWSXRay.getSegment();
        hasSegment = !!segment;
      } catch (error) {
        // No segment available or SDK not configured
      }
    }

    const isAvailable = hasSegment || hasEnvVar;

    return {
      isAvailable,
      hasSegment,
      hasEnvVar,
      segment,
      envVar,
    };
  }

  static getRootTraceIdFromSegment(
    segment?: XRaySegmentPartial | null
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

  static getTraceId(): string {
    const existingTraceId = this.getStore()?.traceId;
    return existingTraceId || "";
  }

  static clear(): void {
    (this as any).als = new AsyncLocalStorage<Record<string, string>>();
  }

  static async withTraceId<T>(
    traceId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const current = this.getStore() || {};
    const next = { ...current, traceId };
    return await this.als.run(next, fn);
  }
}
