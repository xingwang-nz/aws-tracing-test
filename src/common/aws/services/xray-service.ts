import AWSXRay from "aws-xray-sdk-core";
import { TraceId } from "../../../util/tracing-utils";

interface AwsV3Client {
  send: (...args: any[]) => Promise<any>;
  [key: string]: any;
}

const X_RAY_WRAPPED_FLAG = "__xray_wrapped__";

export const XrayService = {
  /**
   * Wrap an AWS SDK v3 client with the xray sdk when X-Ray is available.
   * - Returns the wrapped client when available
   * - Handles multiple calls to avoid double-wrapping
   * - Gracefully returns original client if wrapping fails.
   */
  wrapClientWithXRay: <T extends AwsV3Client>(
    client: T,
    options?: { force?: boolean }
  ): T => {
    const availability = TraceId.getXRayTracingAvailability().isTracingEnabled;
    if (!availability && !options?.force) {
      console.log("X-Ray not available, returning original client");
      return client;
    }

    // avoid double-wrapping
    if (client[X_RAY_WRAPPED_FLAG]) {
      return client;
    }

    try {
      const wrapped = AWSXRay.captureAWSv3Client(client as any) as T;
      (wrapped as any)[X_RAY_WRAPPED_FLAG] = true;
      return wrapped;
    } catch (err) {
      // don't break callers if wrapping fails
      return client;
    }
  },
};
