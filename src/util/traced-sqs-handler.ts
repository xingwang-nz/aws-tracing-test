import type { SQSEvent, SQSRecord, SQSBatchResponse } from "aws-lambda";
import { TraceId, TracingContext } from "./tracing-utils";
import { standardTracedEventExtractor } from "./traced-event-handler";

export type SqsRecordHandler<R = void> = (record: SQSRecord) => Promise<R>;

export const defaultExtractTraceId = (record: SQSRecord): string => {
  const traceIdAttr = record.messageAttributes?.["trace-id"]?.stringValue;
  if (traceIdAttr) return traceIdAttr;
  try {
    const traced = standardTracedEventExtractor(JSON.parse(record.body));
    const ctx = TraceId.fromTracedEvent(traced);
    return ctx.traceId;
  } catch {
    return TraceId.generate();
  }
};

/**
 * Higher-order wrapper for SQS consumer Lambdas that ensure each record is
 * executed inside a tracing context. Returns the partial-batch failures
 *
 * Sample usage:
 * export const handler = tracedSqsHandler(async (record) => { ... }, , { extract: extractor });
 */
export const tracedSqsHandler = <R = void>(
  handler: SqsRecordHandler<R>,
  options?: {
    extract?: (record: SQSRecord) => string | undefined;
    parallel?: boolean;
  },
): ((event: SQSEvent) => Promise<SQSBatchResponse>) => {
  const extract = options?.extract ?? defaultExtractTraceId;
  const parallel = Boolean(options?.parallel);

  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failed: string[] = [];

    const processRecord = async (record: SQSRecord): Promise<void> => {
      const traceId = extract(record) ?? TraceId.generate();
      try {
        await TracingContext.withTraceContext({ traceId }, async () => {
          await handler(record);
        });
      } catch (err) {
        console.error("message processing failed", record.messageId, err);
        failed.push(record.messageId);
      }
    };

    if (parallel) {
      await Promise.all(event.Records.map((record) => processRecord(record)));
    } else {
      for (const record of event.Records) {
        await processRecord(record);
      }
    }

    if (failed.length > 0) {
      return {
        batchItemFailures: failed.map((id) => ({ itemIdentifier: id })),
      };
    }
    return { batchItemFailures: [] };
  };
};
