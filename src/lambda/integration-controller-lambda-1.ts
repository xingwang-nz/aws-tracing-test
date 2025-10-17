import type { Context, Handler } from "aws-lambda";
import { logger } from "../util/logger-demo";
import { TraceId, TracingContext } from "../util/tracing-utils";
import { tracedEventHandler } from "../util/traced-event-handler";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import AWSXRay from "aws-xray-sdk-core";

// Create Step Functions client with X-Ray tracing when available
const createSFNClient = (): SFNClient => {
  let sfnClient = new SFNClient({});

  // Check if X-Ray is available using centralized utility
  const xrayAvailability = TraceId.getXRayAvailability();

  if (xrayAvailability.isAvailable) {
    console.log("X-Ray detected, wrapping SFN client with tracing");
    sfnClient = AWSXRay.captureAWSv3Client(sfnClient) as SFNClient;
  } else {
    console.log("No X-Ray detected, using unwrapped SFN client");
  }

  return sfnClient;
};

const sfnClient = createSFNClient();

// EventBridge event structure from Step Functions
interface EventBridgeEvent {
  id: string;
  version: string;
  account: string;
  time: string;
  region: string;
  source: string;
  "detail-type": string;
  detail: {
    traceId: string;
    timestamp: string;
    source: string;
    requestData?: any;
    metadata?: Record<string, any>;
    traceHeader?: string;
  };
}

interface StepFunctionControllerResult {
  statusCode: number;
  message: string;
  timestamp: string;
  tracing: {
    receivedTraceId: string;
    extractedTraceId: string;
    xrayTraceHeader?: string;
    propagatedCorrectly: boolean;
  };
  eventData?: any;
  businessExecution?: any;
  processingDuration: number;
}

export const handler: Handler<EventBridgeEvent, StepFunctionControllerResult> =
  tracedEventHandler(
    async (
      event: EventBridgeEvent,
      traceId: string,
    ): Promise<StepFunctionControllerResult> => {
      const processingStart = Date.now();

      logger.info({
        message: "Step Functions controller received EventBridge event:",
        data: {
          eventId: event.id,
          source: event.source,
          detailType: event["detail-type"],
          providedTraceId: traceId,
        },
      });

      try {
        // Extract trace ID from the event detail
        const receivedTraceId = event.detail.traceId;

        // Extract trace ID using our TraceId utility to validate propagation
        const extractedTraceId = TraceId.fromTracedEvent(event);

        // Get trace ID from TracingContext (automatically generates if not exists)
        const contextTraceId = TracingContext.getTraceId();

        // Get X-Ray availability information using centralized utility
        const xrayAvailability = TraceId.getXRayAvailability();

        // Check if trace ID was propagated correctly
        const propagatedCorrectly = receivedTraceId === extractedTraceId;

        logger.info({
          message: "Trace ID analysis:",
          data: {
            receivedTraceId,
            extractedTraceId,
            contextTraceId,
            xrayAvailable: xrayAvailability.isAvailable,
            xrayTraceHeader: xrayAvailability.envVar ? "present" : "missing",
            propagatedCorrectly,
            originalSource: event.detail.source,
            eventMetadata: event.detail.metadata,
            xrayInfo: {
              hasSegment: xrayAvailability.hasSegment,
              hasEnvVar: xrayAvailability.hasEnvVar,
            },
          },
        });

        // Prepare data for business Step Function
        const businessStepFunctionArn = process.env.BUSINESS_STEP_FUNCTION_ARN;
        let businessExecutionResult = null;

        if (businessStepFunctionArn) {
          const businessInput = {
            traceId: contextTraceId,
            businessData: {
              originalEventId: event.id,
              source: event.detail.source,
              requestData: event.detail.requestData,
            },
            metadata: {
              controllerTraceId: contextTraceId,
              timestamp: new Date().toISOString(),
              xrayEnabled: xrayAvailability.isAvailable,
            },
          };

          logger.info({
            message: "Preparing to trigger business Step Function",
            data: {
              businessStepFunctionArn,
              businessInput,
              traceId: contextTraceId,
            },
          });

          try {
            // Generate unique execution name with trace ID
            const executionName = `business-execution-${contextTraceId}-${Date.now()}`;

            const startExecutionCommand = new StartExecutionCommand({
              stateMachineArn: businessStepFunctionArn,
              name: executionName,
              input: JSON.stringify(businessInput),
            });

            const executionResult = await sfnClient.send(startExecutionCommand);

            businessExecutionResult = {
              status: "started",
              executionArn: executionResult.executionArn,
              executionName: executionName,
              startDate: executionResult.startDate,
              input: businessInput,
            };

            logger.info({
              message: "Successfully started business Step Function execution",
              data: businessExecutionResult,
            });
          } catch (sfnError) {
            const sfnMessage =
              sfnError instanceof Error ? sfnError.message : String(sfnError);
            logger.error({
              message: "Failed to start business Step Function execution",
              data: { error: sfnMessage, businessStepFunctionArn },
            });

            businessExecutionResult = {
              status: "failed",
              error: sfnMessage,
              input: businessInput,
            };
          }
        } else {
          logger.warn({
            message: "BUSINESS_STEP_FUNCTION_ARN environment variable not set",
          });
        }

        const processingDuration = Date.now() - processingStart;

        const result: StepFunctionControllerResult = {
          statusCode: 200,
          message: "Successfully processed EventBridge event in Step Functions",
          timestamp: new Date().toISOString(),
          tracing: {
            receivedTraceId,
            extractedTraceId,
            xrayTraceHeader: xrayAvailability.envVar,
            propagatedCorrectly,
          },
          eventData: {
            eventId: event.id,
            source: event.source,
            detailType: event["detail-type"],
            originalRequestData: event.detail.requestData,
            metadata: event.detail.metadata,
          },
          businessExecution: businessExecutionResult,
          processingDuration,
        };

        logger.info({
          message: "Step Functions processing completed successfully",
          data: result,
        });

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({
          message: "Error processing EventBridge event in Step Functions:",
          data: error,
        });

        const processingDuration = Date.now() - processingStart;

        return {
          statusCode: 500,
          message: `Error processing event: ${message}`,
          timestamp: new Date().toISOString(),
          tracing: {
            receivedTraceId: event.detail?.traceId || "unknown",
            extractedTraceId: "error",
            xrayTraceHeader: process.env._X_AMZN_TRACE_ID,
            propagatedCorrectly: false,
          },
          eventData: {
            eventId: event.id,
            error: message,
          },
          processingDuration,
        };
      }
    },
  );
