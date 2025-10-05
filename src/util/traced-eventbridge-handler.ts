import { TraceId, TracingContext } from "./tracing-utils";

export type EventBridgeTraceSource = {
  detail?: {
    traceId?: string;
    [key: string]: any;
  };
  [key: string]: any;
};

/**
 * Returns the event as-is since traceId is already in event.detail.traceId
 * (e.g, API Gateway events from eb-sf-agw-event.json)
 *
 */
export const standardEventBridgeExtractor = <EventType>(
  event: EventType,
): EventBridgeTraceSource => {
  // Standard EventBridge event structure: { detail: { traceId, traceHeader, ... } }
  // Return the entire event so fromTracedEventDetails can access event.detail.traceId
  return event as unknown as EventBridgeTraceSource;
};

/**
 *  { event: { detail: { event: { detail: { ... } } } } }
 */
export const s3EventExtractor = <EventType>(
  event: EventType,
): EventBridgeTraceSource => {
  const host = event as unknown as {
    event?: unknown;
    id?: unknown;
  };

  console.log("S3 Event Extractor - Processing event structure:", {
    hasTopLevelEvent: !!host.event,
    topLevelId: host.id,
  });

  // For S3 events, the structure is complex: { event: { detail: { event: { detail: { ... } } } } }
  if (host.event && typeof host.event === "object") {
    const nestedEvent = host.event as any;

    console.log("S3 Event Extractor - Nested event:", {
      hasDetail: !!nestedEvent.detail,
      hasNestedEvent: !!nestedEvent.detail?.event,
    });

    // Check if this follows the S3 pattern with event.detail.event
    if (nestedEvent.detail && nestedEvent.detail.event) {
      const innerEvent = nestedEvent.detail.event;
      console.log("S3 Event Extractor - Found inner event:", {
        hasDetail: !!innerEvent.detail,
        hasTraceId: !!innerEvent.detail?.traceId,
      });
      // Return the innermost event which should have the detail with traceId
      return innerEvent as EventBridgeTraceSource;
    }

    console.log("S3 Event Extractor - Using event directly");
    return nestedEvent as EventBridgeTraceSource;
  }

  // Fallback to treating the event as standard structure
  console.log("S3 Event Extractor - Using fallback to standard structure");
  return event as unknown as EventBridgeTraceSource;
};

// Default to standard EventBridge extractor
const defaultExtractor = standardEventBridgeExtractor;

export const tracedEventBridgeHandler = <EventType = any, ResultType = any>(
  handler: (event: EventType, traceId: string) => Promise<ResultType>,
  options?: {
    extract?: (event: EventType) => EventBridgeTraceSource;
  },
): ((event: EventType) => Promise<ResultType>) => {
  return async (event: EventType): Promise<ResultType> => {
    const extractor = options?.extract ?? defaultExtractor<EventType>;
    const traceSource = extractor(event);

    // Use the new generic method, passing the detail object directly
    const traceId = TraceId.fromTracedEventDetails(traceSource.detail || {});

    return TracingContext.withTraceId(traceId, async () => {
      return handler(event, traceId);
    });
  };
};
