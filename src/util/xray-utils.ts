import AWSXRay from "aws-xray-sdk-core";
import { TraceId } from "./tracing-utils";

/**
 * Wrap an AWS SDK v3 client with the aws-xray-sdk-core capture helper when X-Ray
 * is available. Returns the wrapped client when available, otherwise returns
 * the original client.
 */
export const wrapClientWithXRay = <T extends object>(client: T): T => {
  return TraceId.getXRayAvailability().isAvailable
    ? (AWSXRay.captureAWSv3Client(client as any) as unknown as T)
    : client;
};
