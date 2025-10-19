import AWSXRay from "aws-xray-sdk-core";
import { TraceId } from "./tracing-utils";

interface AwsV3ClientLike {
  send: (...args: any[]) => Promise<any>;
  [key: string]: any;
}

const X_RAY_WRAPPED_FLAG = "__xray_wrapped__";

/**
 * Wrap an AWS SDK v3 client with the xray sdk when X-Ray is available.
 * - Returns the wrapped client when available
 * - Handles multiple calls to avoid double-wrapping
 * - Gracefully returns original client if wrapping fails.
 */
export const wrapClientWithXRay = <T extends AwsV3ClientLike>(
  client: T,
  options?: { force?: boolean; captureFn?: (c: any) => any },
): T => {
  const availability = TraceId.getXRayAvailability().isAvailable;
  if (!availability && !options?.force) {
    return client;
  }

  // avoid double-wrapping
  if ((client as any)[X_RAY_WRAPPED_FLAG]) {
    return client;
  }

  try {
    const capture = options?.captureFn ?? (AWSXRay as any).captureAWSv3Client;
    if (typeof capture !== "function") {
      return client;
    }

    const wrapped = capture(client as any) as T;
    try {
      (wrapped as any)[X_RAY_WRAPPED_FLAG] = true;
    } catch {
      // ignore if can't set property
    }

    return wrapped;
  } catch (err) {
    // don't break callers if wrapping fails
    return client;
  }
};
