import type { Context, Handler } from "aws-lambda";
import { logger } from "../util/logger-demo";
import { TraceId, TracingContext } from "../util/tracing-utils";
import { tracedEventHandler } from "../util/traced-event-handler";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import AWSXRay from "aws-xray-sdk-core";

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
  tracing: {
    receivedTraceId: string;
    contextTraceId: string;
    xrayTraceHeader?: string;
  };
  eventData?: any;
  businessExecution?: any;
}

const sfnClient = new SFNClient({});

const wrappedClient = AWSXRay.captureAWSv3Client(sfnClient) as SFNClient;

export const handler: Handler<EventBridgeEvent, StepFunctionControllerResult> =
  tracedEventHandler(
    async (event: EventBridgeEvent): Promise<StepFunctionControllerResult> => {
      const processingStart = Date.now();

      logger.info({
        message: "Step Functions controller received EventBridge event:",
        data: {
          eventId: event.id,
          source: event.source,
          detailType: event["detail-type"],
        },
      });

      // Extract trace ID from the event detail
      const receivedTraceId = event.detail.traceId;

      // Get trace ID from TracingContext (automatically generates if not exists)
      const contextTraceId = TracingContext.getTraceId();

      // Get X-Ray availability information using centralized utility
      const xrayAvailability = TraceId.getXRayAvailability();

      const result: StepFunctionControllerResult = {
        tracing: {
          receivedTraceId,
          contextTraceId,
          xrayTraceHeader: xrayAvailability.envVar,
        },
        eventData: {
          eventId: event.id,
          source: event.source,
          detailType: event["detail-type"],
          originalRequestData: event.detail.requestData,
          metadata: event.detail.metadata,
        },
      };

      // If a business state machine ARN is provided via environment, start execution
      const businessSfnArn = process.env.BUSINESS_SFN_ARN;
      if (businessSfnArn && businessSfnArn !== "") {
        try {
          // When running in Lambda with X-Ray enabled, we can wrap the SFN client
          // for trace propagation. The aws-xray-sdk-core integration is optional
          // here; we already import AWSXRay above.

          const startInput = JSON.stringify({
            receivedEvent: event,
            traceId: receivedTraceId,
          });

          const startCmd = new StartExecutionCommand({
            stateMachineArn: businessSfnArn,
            input: startInput,
          });

          const startRes = await sfnClient.send(startCmd);
          // const startRes = await wrappedClient.send(startCmd);
          logger.info({
            message: "Started business state machine",
            data: startRes,
          });

          result.businessExecution = {
            executionArn: startRes.executionArn,
            startDate: startRes.startDate,
          } as any;
        } catch (err) {
          logger.error({
            message: "Failed to start business state machine",
            data: { error: err },
          });
        }
      }

      logger.info({
        message: "Step Functions processing completed successfully",
        data: result,
      });

      return result;
    },
  );
