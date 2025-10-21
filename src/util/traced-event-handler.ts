import { TracedEvent, TraceId, TracingContext } from "./tracing-utils";

/**
 * Extract a TracedEvent from an incoming payload.
 *
 * Precedence:
 * 1) Top-level `traceId` or `detail.traceId` — return input.
 * 2) `event` wrapper with `traceId` — return `event`.
 * 3) Fallback — return input.
 */
export const standardEventExtractor = <EventType>(
  event: EventType
): TracedEvent => {
  const asTraced = event as unknown as TracedEvent;

  // If top-level traceId or nested detail.traceId exists, return as-is
  if (asTraced.traceId || asTraced.detail?.traceId) {
    return asTraced;
  }

  // If wrapped under `event` (StepFunction wrappers prefer)
  const possibleWrapped = (asTraced as any).event as TracedEvent | undefined;
  if (possibleWrapped && typeof possibleWrapped === "object") {
    if (possibleWrapped.traceId || possibleWrapped.detail?.traceId) {
      return possibleWrapped;
    }
  }

  return asTraced;
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
    const extractor = options?.extract ?? standardEventExtractor<EventType>;
    const tracedEvent = extractor(event);
    const traceId = TraceId.fromTracedEvent(tracedEvent);
    return TracingContext.withTraceId(traceId, async () => {
      return handler(event);
    });
  };
};
