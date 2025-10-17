import type { Context, Handler } from "aws-lambda";
import { logger } from "../util/logger-demo";
import { TraceId, TracingContext } from "../util/tracing-utils";

// Input from Step Functions - can be any structure
interface BusinessLambdaInput {
  traceId?: string;
  businessData?: any;
  metadata?: Record<string, any>;
  [key: string]: any;
}

interface BusinessLambdaResult {
  statusCode: number;
  message: string;
  timestamp: string;
  tracing: {
    receivedTraceId?: string;
    contextTraceId?: string;
    xrayAvailable: boolean;
    xrayTraceHeader?: string;
  };
  businessResult: {
    processed: boolean;
    processingTime: number;
  };
}

export const handler: Handler<
  BusinessLambdaInput,
  BusinessLambdaResult
> = async (
  input: BusinessLambdaInput,
  context: Context,
): Promise<BusinessLambdaResult> => {
  const processingStart = Date.now();

  logger.info({
    message: "Business Lambda received input:",
    data: {
      inputKeys: Object.keys(input),
      requestId: context.awsRequestId,
      functionName: context.functionName,
    },
  });

  try {
    // Extract trace ID from input if available
    const receivedTraceId = input.traceId;

    // Get trace ID from TracingContext (automatically generates if not exists)
    const contextTraceId = TracingContext.getTraceId();

    // Get X-Ray availability information
    const xrayAvailability = TraceId.getXRayAvailability();

    // Log trace information for verification
    logger.info({
      message: "Business Lambda - Trace ID analysis:",
      data: {
        receivedTraceId: receivedTraceId || "not provided",
        contextTraceId,
        xrayAvailable: xrayAvailability.isAvailable,
        xrayTraceHeader: xrayAvailability.envVar ? "present" : "missing",
        xrayInfo: {
          hasSegment: xrayAvailability.hasSegment,
          hasEnvVar: xrayAvailability.hasEnvVar,
          segmentId: xrayAvailability.segment?.id,
        },
      },
    });

    // Simulate some business processing
    logger.info({
      message: "Processing business logic...",
      data: {
        traceId: contextTraceId,
        businessData: input.businessData,
        metadata: input.metadata,
      },
    });

    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 100));

    const processingTime = Date.now() - processingStart;

    const result: BusinessLambdaResult = {
      statusCode: 200,
      message: "Business processing completed successfully",
      timestamp: new Date().toISOString(),
      tracing: {
        receivedTraceId,
        contextTraceId,
        xrayAvailable: xrayAvailability.isAvailable,
        xrayTraceHeader: xrayAvailability.envVar,
      },
      businessResult: {
        processed: true,
        processingTime,
      },
    };

    logger.info({
      message: "Business Lambda processing completed",
      data: result,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({
      message: "Error in business Lambda:",
      data: error,
    });

    const processingTime = Date.now() - processingStart;

    return {
      statusCode: 500,
      message: `Business processing error: ${message}`,
      timestamp: new Date().toISOString(),
      tracing: {
        receivedTraceId: input.traceId,
        contextTraceId: TracingContext.getTraceId(),
        xrayAvailable: false,
        xrayTraceHeader: process.env._X_AMZN_TRACE_ID,
      },
      businessResult: {
        processed: false,
        processingTime,
      },
    };
  }
};
