import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TraceId, TracingContext } from "./tracing-utils";

/**
 * Higher order function to wrap AWS API Gateway Lambda handler with tracing context.
 * This function extracts a traceId from the incoming API Gateway event and sets up
 * a tracing context for the handler execution with traceId passed back to the handler
 * as a second argument.
 */
export const tracedApiGatewayHandler = (
  handler: (
    event: APIGatewayProxyEvent,
    traceId: string,
  ) => Promise<APIGatewayProxyResult>,
) => {
  return async (
    event: APIGatewayProxyEvent,
  ): Promise<APIGatewayProxyResult> => {
    const traceId = TraceId.fromAPIGatewayEvent(event);
    return TracingContext.withTraceId(traceId, () => handler(event, traceId));
  };
};
