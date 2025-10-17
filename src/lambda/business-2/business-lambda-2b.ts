import { Handler } from "aws-lambda";
import { TracedEvent } from "../../common/model/models";
import { logger } from "../../util/logger-demo";
import { tracedEventHandler } from "../../util/traced-event-handler";

export const handler: Handler<TracedEvent, TracedEvent> = tracedEventHandler(
  async (event: TracedEvent): Promise<TracedEvent> => {
    const processingStart = Date.now();

    logger.info({
      message: "business Lambda-2 received event:",
      data: event,
    });

    return event;
  },
);
