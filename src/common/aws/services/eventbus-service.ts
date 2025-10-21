import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsRequest,
  PutEventsResponse,
} from "@aws-sdk/client-eventbridge";
import { TracedEvent, TracingContext } from "../../../util/tracing-utils";
import { logger } from "../../../util/logger-demo";
import { XrayService } from "./xray-service";

const ebClient = new EventBridgeClient({});

class EventbusClient {
  private eventbridge: EventBridgeClient;
  private readonly eventBusName: string;

  private constructor(eventBusName: string) {
    this.eventbridge = XrayService.wrapClientWithXRay(ebClient);
    this.eventBusName = eventBusName;
  }

  static forBus(eventBusName: string): EventbusClient {
    return new EventbusClient(eventBusName);
  }

  /**
   * Normalize a EventBridge detail value into an object
   * - JSON object string -> parsed object
   * - JSON primitives or non-JSON string -> { detail: value }
   * - Object -> as-is
   */
  // private helper to normalize detail payload
  private normalizeEventDetail(detail: TracedEvent | string): any {
    if (typeof detail === "string") {
      try {
        const parsed = JSON.parse(detail);
        return parsed && typeof parsed === "object"
          ? parsed
          : { detail: parsed };
      } catch {
        return { detail };
      }
    }
    return detail as TracedEvent;
  }

  async sendEvent({
    source,
    detailType,
    detail,
  }: {
    source: string;
    detailType: string;
    detail: TracedEvent | string;
  }): Promise<PutEventsResponse> {
    const currentTraceId = TracingContext.getTraceId();

    // normalize detail into an object, inject top-level traceId if present
    const detailObj = this.normalizeEventDetail(detail);
    const detailPayload = JSON.stringify(
      currentTraceId ? { ...detailObj, traceId: currentTraceId } : detailObj
    );

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
        data: error as Error,
      });
      throw error;
    }
  }
}

export const EventbusService = {
  client: EventbusClient,
};
