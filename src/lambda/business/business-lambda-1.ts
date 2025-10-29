import { Handler } from "aws-lambda";
import { logger } from "../../util/logger-demo";
import { tracedEventHandler } from "../../util/traced-event-handler";
import { TracedEvent, TraceId, TracingContext } from "../../util/tracing-utils";

export const handler: Handler<TracedEvent, TracedEvent> = tracedEventHandler(
  async (event: TracedEvent): Promise<TracedEvent> => {
    // logger.info({
    //   message: "business Lambda-1 received event:",
    //   data: event,
    // });

    const receivedTraceId = event.traceId;
    const contextTraceId = TracingContext.getTraceId();
    const xrayAvailability = TraceId.getXRayTracingAvailability();

    logger.info({
      message: "tracing info in business Lambda-1:",
      data: {
        receivedTraceId: receivedTraceId ?? null,
        contextTraceId,
        xrayTraceHeader: xrayAvailability.envVar,
      },
    });

    logger.info({
      message: "TraceId.getXRayAvailability",
      data: { xrayAvailability: TraceId.getXRayTracingAvailability().envVar },
    });

    return event;
  }
);
