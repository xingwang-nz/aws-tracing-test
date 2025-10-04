import type {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";
import { tracedApiGatewayHandler } from "../util/traced-api-gateway-handler";
import { logger } from "../util/logger-demo";

type ParsedBody = Record<string, unknown>;

// const sleep = (ms: number): Promise<void> =>
//   new Promise((resolve) => setTimeout(resolve, ms));

const parseRequestBody = (body: string | null): ParsedBody => {
  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body) as ParsedBody;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Could not parse request body as JSON:", message);
    return { raw: body };
  }
};

const getUserAgent = (event: APIGatewayProxyEvent): string | undefined =>
  event.headers?.["User-Agent"] ?? event.headers?.["user-agent"];

export const handler: APIGatewayProxyHandler = tracedApiGatewayHandler(
  async (
    event: APIGatewayProxyEvent,
    tracingId,
  ): Promise<APIGatewayProxyResult> => {
    logger.info({ message: "Event received:", data: event });

    try {
      const processingStart = Date.now();
      const processingDuration = Date.now() - processingStart;

      const requestBody = parseRequestBody(event.body ?? null);

      const response: APIGatewayProxyResult = {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "Content-Type,X-Amz-Date,Authorization,X-Api-Key",
          "X-Trace-Id": process.env._X_AMZN_TRACE_ID ?? "",
        },
        body: JSON.stringify(
          {
            message: "Tracing test successful!",
            timestamp: new Date().toISOString(),
            requestId: event.requestContext.requestId,
            functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
            requestData: {
              method: event.httpMethod,
              path: event.path,
              body: requestBody,
              userAgent: getUserAgent(event),
            },
            processing: {
              duration: processingDuration,
              version: "1.0.0",
            },
            tracing: {
              enabled: true,
              traceId: tracingId,
            },
          },
          null,
          2,
        ),
      };

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ message: "Error processing request:", data: error });

      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          message: "Internal server error",
          error: message,
          timestamp: new Date().toISOString(),
          requestId: event.requestContext.requestId,
        }),
      };
    }
  },
);
