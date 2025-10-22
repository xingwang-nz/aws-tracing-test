import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TraceId, TracingContext } from "./tracing-utils";

/**
 * Higher order function to wrap AWS API Gateway Lambda handler with tracing context.
 * Extract a traceId from the incoming API Gateway event or X-Ray context and sets up
 * a tracing context for the handler execution.
 * Injects `X-Trace-Id` response header with the trace ID.
 */
export const tracedApiGatewayHandler = (
  handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>
) => {
  return async (
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> => {
    const traceContext = TraceId.fromAPIGatewayEvent(event);
    // Run the handler inside the tracing context
    const result = await TracingContext.withTraceContext(traceContext, () =>
      handler(event)
    );

    return {
      ...result,
      headers: {
        ...(result.headers ?? {}),
        ...TraceId.toHttpHeaders(traceContext.traceId),
      },
    } as APIGatewayProxyResult;
  };
};
