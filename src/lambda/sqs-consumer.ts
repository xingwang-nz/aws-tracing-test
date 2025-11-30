import type { SQSEvent, SQSRecord } from "aws-lambda";
import { TraceId, TracingContext } from "../util/tracing-utils";
import { logger, LoggerDemo } from "../util/logger-demo";
import { tracedSqsHandler } from "../util/traced-sqs-handler";

// async function processMessage(record: SQSRecord) {
//   logger.info({
//     message: `processing ${record.messageId}`,
//     data: JSON.parse(record.body),
//   });
// }

export const handler = tracedSqsHandler(async (record: SQSRecord) => {
  logger.info({
    message: `processing ${record.messageId}`,
    data: JSON.parse(record.body),
  });
});
