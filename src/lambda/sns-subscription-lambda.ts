import type { SNSEvent, Handler } from "aws-lambda";
import AWSXRay from "aws-xray-sdk-core";
import { logger } from "../util/logger-demo";

export const handler: Handler<SNSEvent, void> = async (event) => {
  logger.info({
    message: "SNS subscription lambda invoked",
    data: { records: event.Records.length },
  });

  // Log X-Ray environment and segment info
  logger.info({
    message: "_X_AMZN_TRACE_ID",
    data: process.env._X_AMZN_TRACE_ID ?? "missing",
  });
  try {
    const seg = AWSXRay.getSegment && AWSXRay.getSegment();
    logger.info({
      message: "AWSXRay.getSegment",
      data: seg
        ? { id: (seg as any).id, trace_id: (seg as any).trace_id }
        : null,
    });
  } catch (err) {
    logger.warn({ message: "Unable to read X-Ray segment", data: String(err) });
  }

  for (const record of event.Records) {
    try {
      logger.info({
        message: "SNS record detail",
        data: {
          messageId: record.Sns.MessageId,
          message: record.Sns.Message,
          attributes: record.Sns.MessageAttributes,
        },
      });
    } catch (error) {
      logger.error({ message: "Error processing SNS record", data: error });
    }
  }
};
