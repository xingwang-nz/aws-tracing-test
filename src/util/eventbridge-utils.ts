import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsRequest,
  PutEventsResponse,
} from "@aws-sdk/client-eventbridge";
import { wrapClientWithXRay } from "./xray-utils";
import { TracedEvent, TraceId, TracingContext } from "./tracing-utils";
import { logger } from "./logger-demo";

const ebClient = new EventBridgeClient({});

export class TracingEventBridge {
  private eventbridge: EventBridgeClient;
  private eventBusName: string;

  constructor(eventBusName: string) {
    this.eventbridge = wrapClientWithXRay(ebClient);
    this.eventBusName = eventBusName;
  }

  /**
   * Send an event to EventBridge with traceId propagation
   * When X-Ray is enabled, the wrapped client automatically handles X-Ray trace propagation
   */
  async sendTracingEvent({
    source,
    detailType,
    detail,
  }: {
    source: string;
    detailType: string;
    detail: TracedEvent | string;
  }): Promise<PutEventsResponse> {
    const detailPayload =
      typeof detail === "string" ? detail : JSON.stringify(detail);

    const eventParams: PutEventsRequest = {
      Entries: [
        {
          Source: source,
          DetailType: detailType,
          Detail: detailPayload,
          EventBusName: this.eventBusName,
        },
      ],
    };

    try {
      const command = new PutEventsCommand(eventParams);
      const result = await this.eventbridge.send(command);
      logger.info({
        message: `Successfully sent event to EventBridge: ${result.Entries?.[0]?.EventId}`,
      });
      return result;
    } catch (error) {
      logger.error({
        message: "Error sending event to EventBridge:",
        data: error,
      });
      throw error;
    }
  }
}
