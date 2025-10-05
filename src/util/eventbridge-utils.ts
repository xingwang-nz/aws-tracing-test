import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsRequest,
  PutEventsResponse,
} from "@aws-sdk/client-eventbridge";
import AWSXRay from "aws-xray-sdk-core";
import { TraceId, TracingContext } from "./tracing-utils";

// Wrap EventBridge with X-Ray tracing when X-Ray is active
const createEventBridgeClient = (): EventBridgeClient => {
  let eventbridge = new EventBridgeClient({});

  // Check if X-Ray is available using centralized utility
  const xrayAvailability = TraceId.getXRayAvailability();

  if (xrayAvailability.isAvailable) {
    console.log("X-Ray detected, wrapping EventBridge client with tracing", {
      hasSegment: xrayAvailability.hasSegment,
      hasEnvVar: xrayAvailability.hasEnvVar,
    });
    eventbridge = AWSXRay.captureAWSv3Client(eventbridge) as EventBridgeClient;
  } else {
    console.log("No X-Ray detected, using unwrapped EventBridge client");
  }

  return eventbridge;
};

export interface TracingEventDetail {
  traceId?: string;
  timestamp: string;
  source: string;
  requestData?: any;
  metadata?: Record<string, any>;
}

export class TracingEventBridge {
  private eventbridge: EventBridgeClient;
  private eventBusName: string;

  constructor(eventBusName: string) {
    this.eventbridge = createEventBridgeClient();
    this.eventBusName = eventBusName;
  }

  /**
   * Send an event to EventBridge with trace ID propagation
   * When X-Ray is enabled, the wrapped SDK client automatically handles X-Ray trace propagation
   */
  async sendTracingEvent(
    source: string,
    detailType: string,
    detail: TracingEventDetail,
    traceHeader?: string,
  ): Promise<PutEventsResponse> {
    const eventDetail = {
      ...detail,
      metadata: {
        ...detail.metadata,
        sentAt: new Date().toISOString(),
        eventBus: this.eventBusName,
      },
    };

    // Only include traceHeader in event detail if explicitly provided
    if (traceHeader) {
      (eventDetail as any).traceHeader = traceHeader;
    }

    const eventParams: PutEventsRequest = {
      Entries: [
        {
          Source: source,
          DetailType: detailType,
          Detail: JSON.stringify(eventDetail),
          EventBusName: this.eventBusName,
        },
      ],
    };

    console.log(`Sending event to EventBridge bus '${this.eventBusName}':`, {
      source,
      detailType,
      traceId: detail.traceId,
      eventBusName: this.eventBusName,
    });

    try {
      const command = new PutEventsCommand(eventParams);
      const result = await this.eventbridge.send(command);

      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        console.error(
          "Failed to send some events:",
          result.Entries?.filter((entry) => entry.ErrorCode),
        );
        throw new Error(
          `Failed to send ${result.FailedEntryCount} events to EventBridge`,
        );
      }

      console.log(
        "Successfully sent event to EventBridge:",
        result.Entries?.[0]?.EventId,
      );
      return result;
    } catch (error) {
      console.error("Error sending event to EventBridge:", error);
      throw error;
    }
  }

  /**
   * Send API Gateway event with trace propagation
   * - Get TracingContext.getTraceId() from ALS for application-level tracing
   * - When X-Ray is available, the wrapped SDK automatically handles X-Ray trace propagation
   * - When no X-Ray, only sends traceId from TracingContext in event detail
   */
  async sendApiGatewayEvent(requestData: any): Promise<PutEventsResponse> {
    // Get trace ID from TracingContext (automatically generates if not exists)
    const traceId = TracingContext.getTraceId();

    // Check if X-Ray is enabled using centralized utility
    const xrayAvailability = TraceId.getXRayAvailability();

    if (xrayAvailability.isAvailable) {
      console.log(
        "X-Ray enabled, SDK wrapper will handle trace propagation automatically:",
        {
          traceIdFromALS: traceId,
          hasSegment: xrayAvailability.hasSegment,
          hasEnvVar: xrayAvailability.hasEnvVar,
          segmentId: xrayAvailability.segment?.id,
        },
      );
    } else {
      console.log("No X-Ray detected, sending trace ID in event detail only:", {
        traceIdFromALS: traceId,
      });
    }

    const detail: TracingEventDetail = {
      ...(traceId ? { traceId } : {}),
      timestamp: new Date().toISOString(),
      source: "api-gateway",
      requestData,
      metadata: {
        functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        requestId: requestData.requestId,
        xrayEnabled: xrayAvailability.isAvailable,
        traceSource: xrayAvailability.isAvailable
          ? "x-ray-sdk-wrapped"
          : "trace-id-only",
        xrayInfo: {
          hasSegment: xrayAvailability.hasSegment,
          hasEnvVar: xrayAvailability.hasEnvVar,
          segmentId: xrayAvailability.segment?.id,
        },
      },
    };

    // No need to pass traceHeader - X-Ray SDK wrapper handles this automatically
    return this.sendTracingEvent("tracing-test", "API Gateway Event", detail);
  }
}
