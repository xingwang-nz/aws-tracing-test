import type {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";
import { tracedApiGatewayHandler } from "../util/traced-api-gateway-handler";
import { logger } from "../util/logger-demo";
import { TraceId, TracingContext } from "../util/tracing-utils";
import { TracingEventBridge } from "../util/eventbridge-utils";

type ParsedBody = Record<string, unknown>;

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
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    logger.info({ message: "Handler invoked" });
    logger.info({ message: "Event received:", data: event });

    try {
      const processingStart = Date.now();

      const requestBody = parseRequestBody(event.body ?? null);

      // Send event to EventBridge with trace propagation
      const eventBusName = process.env.EVENT_BUS_NAME;
      if (eventBusName) {
        const eventBridge = new TracingEventBridge(eventBusName);

        // TracingContext.getTraceId() automatically handles trace ID generation
        console.log("Sending EventBridge event using TracingContext:", {
          traceId: TracingContext.getTraceId(),
          xrayEnvVar: process.env._X_AMZN_TRACE_ID ? "present" : "missing",
        });

        // await eventBridge.sendApiGatewayEvent({
        //   method: event.httpMethod,
        //   path: event.path,
        //   body: requestBody,
        //   userAgent: getUserAgent(event),
        //   requestId: event.requestContext.requestId,
        //   headers: event.headers,
        // });

        await eventBridge.sendApiGatewayEvent(requestBody);

        logger.info({
          message: "Event sent to EventBridge",
          data: {
            eventBusName,
            tracingContextId: TracingContext.getTraceId(),
          },
        });
      } else {
        logger.warn({ message: "EVENT_BUS_NAME not configured" });
      }

      const processingDuration = Date.now() - processingStart;

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
              traceId: TracingContext.getTraceId(),
              eventSent: !!eventBusName,
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
