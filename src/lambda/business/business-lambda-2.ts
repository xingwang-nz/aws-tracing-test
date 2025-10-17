import { Handler } from "aws-lambda";
import { TracedEvent } from "../../common/model/models";
import { logger } from "../../util/logger-demo";
import { tracedEventHandler } from "../../util/traced-event-handler";
import { TraceId, TracingContext } from "../../util/tracing-utils";

export const handler: Handler<TracedEvent, TracedEvent> = tracedEventHandler(
  async (event: TracedEvent): Promise<TracedEvent> => {
    // logger.info({
    //   message: "business Lambda-2 received event:",
    //   data: event,
    // });

    const receivedTraceId = event.detail?.traceId;
    const contextTraceId = TracingContext.getTraceId();
    const xrayAvailability = TraceId.getXRayAvailability();

    logger.info({
      message: "tracing info in business Lambda-2:",
      data: {
        receivedTraceId: receivedTraceId ?? null,
        contextTraceId,
        xrayTraceHeader: xrayAvailability.envVar,
      },
    });

    logger.info({
      message: "TraceId.getXRayAvailability",
      data: { xrayAvailability: TraceId.getXRayAvailability().envVar },
    });

    return event;
  },
);
