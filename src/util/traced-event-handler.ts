import { TracedEvent, TraceId, TracingContext } from "./tracing-utils";

/**
 * Extract a TracedEvent from an incoming payload.
 *
 * Precedence:
 * 1) Top-level 'traceId' or 'detail.traceId' — return input.
 * 2) 'inpu.event' with 'traceId' or 'detail.traceId' — return 'event'.
 * 3) Fallback — return input.
 */
export const standardTracedEventExtractor = <EventType>(
  event: EventType
): TracedEvent => {
  const asTracedEvent = event as unknown as TracedEvent;

  // If top-level traceId or detail.traceId exists, return as-is
  if (asTracedEvent.traceId || asTracedEvent.detail?.traceId) {
    return asTracedEvent;
  }

  // If wrapped under `event` (StepFunction wrappers prefer)
  const possibleWrapped = (asTracedEvent as any).event as
    | TracedEvent
    | undefined;
  if (possibleWrapped && typeof possibleWrapped === "object") {
    if (possibleWrapped.traceId || possibleWrapped.detail?.traceId) {
      return possibleWrapped;
    }
  }

  return asTracedEvent;
};

/**
 * Higher order function to wrap Lambda function in Integration Step function with tracing context
 */
export const tracedEventHandler = <EventType = any, ResultType = any>(
  handler: (event: EventType) => Promise<ResultType>,
  options?: {
    extract?: (event: EventType) => TracedEvent;
  }
): ((event: EventType) => Promise<ResultType>) => {
  return async (event: EventType): Promise<ResultType> => {
    const extractor =
      options?.extract ?? standardTracedEventExtractor<EventType>;
    const tracedEvent = extractor(event);
    const ctx = TraceId.fromTracedEvent(tracedEvent);
    return TracingContext.withTraceContext(ctx, async () => {
      return handler(event);
    });
  };
};
