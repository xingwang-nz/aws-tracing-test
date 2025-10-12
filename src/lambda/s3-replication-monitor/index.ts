import { Handler } from "aws-lambda";
import { logger } from "../../util/logger-demo";

type S3ReplicationRecord = {
  eventVersion: string;
  eventSource: "aws:s3";
  eventName:
    | "Replication:OperationFailedReplication"
    | "Replication:OperationNotTracked"
    | "Replication:OperationMissedThreshold"
    | "Replication:OperationReplicatedAfterThreshold";
  eventTime: string;
  awsRegion: string;
  userIdentity?: {
    principalId: string;
  };
  requestParameters?: {
    sourceIPAddress: string;
  };
  responseElements?: {
    "x-amz-request-id": string;
    "x-amz-id-2": string;
  };
  s3: {
    s3SchemaVersion?: string;
    configurationId: string;
    bucket: {
      name: string;
      ownerIdentity?: {
        principalId: string;
      };
      arn: string;
    };
    object: {
      key: string;
      size: number;
      eTag: string;
      versionId?: string;
      sequencer: string;
    };
  };
  replicationEventData: {
    replicationRuleId: string;
    destinationBucket: string;
    s3Operation: string;
    requestTime: string;
    failureReason?: string;
    threshold?: number;
    replicationTime?: number;
  };
};

type S3ReplicationEvent = {
  Records: S3ReplicationRecord[];
};

export const handler: Handler<S3ReplicationEvent, void> = async (event) => {
  try {
    logger.info({
      message: "Received S3 replication events",
      data: {
        recordsCount: event.Records?.length || 0,
        eventType: "s3-replication-event",
      },
    });

    for (const record of event.Records) {
      await processReplicationRecord(record);
    }
  } catch (error) {
    logger.error({
      message: "Error processing S3 replication event",
      data: {
        error: error instanceof Error ? error.message : String(error),
        recordsCount: event.Records?.length || 0,
        eventType: "s3-replication-event-error",
        fullEvent: event,
      },
    });
    throw error;
  }
};

const processReplicationRecord = async (
  record: S3ReplicationRecord,
): Promise<void> => {
  const { eventName } = record;

  // Log based on event name with appropriate level
  switch (eventName) {
    case "Replication:OperationFailedReplication":
      logger.error({
        message: "S3 replication operation failed",
        data: record,
      });
      break;
    case "Replication:OperationMissedThreshold":
      logger.warn({
        message: "S3 replication missed threshold",
        data: record,
      });
      break;
    case "Replication:OperationNotTracked":
      logger.warn({
        message: "S3 replication not tracked",
        data: record,
      });
      break;
    case "Replication:OperationReplicatedAfterThreshold":
      logger.info({
        message: "S3 replication completed after threshold",
        data: record,
      });
      break;
    default:
      logger.info({
        message: "S3 replication event received",
        data: record,
      });
  }
};
