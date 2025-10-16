import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsRequest,
  PutEventsResponse,
} from "@aws-sdk/client-eventbridge";
import AWSXRay from "aws-xray-sdk-core";
import { TraceId, TracingContext } from "./tracing-utils";

const baseClient = new EventBridgeClient({});
const wrappedClient = AWSXRay.captureAWSv3Client(
  baseClient,
) as EventBridgeClient;

const getEventBridgeClient = (): EventBridgeClient => {
  return TraceId.getXRayAvailability().isAvailable ? wrappedClient : baseClient;
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
    this.eventbridge = getEventBridgeClient();
    this.eventBusName = eventBusName;
  }

  /**
   * Send an event to EventBridge with traceId propagation
   * When X-Ray is enabled, the wrapped client automatically handles X-Ray trace propagation
   */
  async sendTracingEvent(
    source: string,
    detailType: string,
    detail: TracingEventDetail,
  ): Promise<PutEventsResponse> {
    const eventParams: PutEventsRequest = {
      Entries: [
        {
          Source: source,
          DetailType: detailType,
          Detail: JSON.stringify({
            ...detail,
            metadata: {
              ...detail.metadata,
              sentAt: new Date().toISOString(),
              eventBus: this.eventBusName,
            },
          }),
          EventBusName: this.eventBusName,
        },
      ],
    };

    try {
      const command = new PutEventsCommand(eventParams);
      const result = await this.eventbridge.send(command);
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
    const traceId = TracingContext.getTraceId();

    // Check if X-Ray is enabled
    const xrayAvailability = TraceId.getXRayAvailability();

    const detail: TracingEventDetail = {
      ...(traceId ? { traceId } : {}),
      timestamp: new Date().toISOString(),
      source: requestData.source || "api-gateway",
      requestData,
      metadata: {
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

    // No need to pass traceHeader - X-Ray wrapper handles this automatically
    return this.sendTracingEvent(
      requestData.source || "api-gateway",
      "API Gateway Event",
      detail,
    );
  }
}
