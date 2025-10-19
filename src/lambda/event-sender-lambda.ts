import type {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";
import { tracedApiGatewayHandler } from "../util/traced-api-gateway-handler";
import { logger } from "../util/logger-demo";
import { TracingContext } from "../util/tracing-utils";
import { TracingEventBridge } from "../util/eventbridge-utils";
import { TraceId } from "../util/tracing-utils";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import AWSXRay from "aws-xray-sdk-core";
import { wrapClientWithXRay } from "../util/xray-utils";

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

    const xrayAvailability = TraceId.getXRayAvailability();

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

        await eventBridge.sendApiGatewayEvent(requestBody);

        // Additionally publish to SNS topic for tracing test if configured
        const snsTopicArn = process.env.TRACING_SNS_TOPIC_ARN;
        if (snsTopicArn) {
          const baseSns = new SNSClient({});
          const sns: SNSClient = wrapClientWithXRay(baseSns);

          // Build a message that includes the tracing context

          // const traceHeader = xrayAvailability.isAvailable
          //   ? xrayAvailability.envVar
          //   : undefined;

          const publishInput = {
            TopicArn: snsTopicArn,
            Message: JSON.stringify({ body: requestBody }),
            // Message: JSON.stringify({ body: requestBody, traceHeader }),
            // MessageAttributes: traceHeader
            //   ? {
            //       XAmznTraceId: {
            //         DataType: "String",
            //         StringValue: traceHeader,
            //       },
            //     }
            //   : undefined,
          };

          try {
            console.info("Publishing to SNS topic", {
              snsTopicArn,
              // traceHeader,
            });
            const pub = new PublishCommand(publishInput as any);
            const pubRes = await sns.send(pub);
            console.info("SNS publish result", { messageId: pubRes.MessageId });
          } catch (err) {
            console.error("SNS publish failed", err);
          }
        }

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
              traceId: TracingContext.getTraceId(),
              xRay: xrayAvailability.envVar,
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
