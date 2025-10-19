import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsRequest,
  PutEventsResponse,
} from "@aws-sdk/client-eventbridge";
import { TracedEvent } from "../../../util/tracing-utils";
import { logger } from "../../../util/logger-demo";
import { XrayService } from "./xray-service";

const ebClient = new EventBridgeClient({});

class EventbusClient {
  private eventbridge: EventBridgeClient;
  private eventBusName: string;

  private constructor(eventBusName: string) {
    this.eventbridge = XrayService.wrapClientWithXRay(ebClient);
    this.eventBusName = eventBusName;
  }

  static forBus(eventBusName: string): EventbusClient {
    return new EventbusClient(eventBusName);
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
        data: error as Error,
      });
      throw error;
    }
  }
}

export const EventbusService = {
  client: EventbusClient,
};
