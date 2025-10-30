import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import { createBasicLambda, createTracedLambda } from "./utils/lambda-utils";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as logs from "aws-cdk-lib/aws-logs";
import * as destinations from "aws-cdk-lib/aws-logs-destinations";

export interface TvnzEventSenderStackProps extends cdk.StackProps {
  readonly eventBus: events.EventBus;
  readonly mockNrIngestionLambdaArn?: string;
}

export class TvnzEventSenderStack extends cdk.Stack {
  public readonly eventSenderLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: TvnzEventSenderStackProps) {
    super(scope, id, props);

    // Ingestion function: either import by ARN (if provided) or create a local
    // mock ingestion Lambda for testing.
    let ingestionFunction: lambda.IFunction;
    if (props.mockNrIngestionLambdaArn) {
      ingestionFunction = lambda.Function.fromFunctionArn(
        this,
        "ImportedMockNrIngest",
        props.mockNrIngestionLambdaArn,
      );
      // Imported function is expected to already allow invocation by
      // CloudWatch Logs (no extra permission added here).
    } else {
      const mockNrLambda = createBasicLambda(this, {
        id: "MockNrIngestLambda",
        functionName: "tvnz-mock-nr-ingestion-lambda",
        entryPath: path.join(
          __dirname,
          "..",
          "src",
          "lambda",
          "mock-nr-ingestion-lambda.ts",
        ),
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
      });

      // Allow CloudWatch Logs service from this account to invoke the function.
      mockNrLambda.addPermission("AllowCloudWatchLogsInvoke", {
        principal: new iam.ServicePrincipal("logs.amazonaws.com"),
        action: "lambda:InvokeFunction",
        // Restrict to same account — allows any Log Group in this account
        sourceAccount: this.account,
      });

      ingestionFunction = mockNrLambda;
    }

    this.eventSenderLambda = createTracedLambda(this, {
      id: "EventSenderLambda",
      functionName: "tvnz-event-sender",
      entryPath: path.join(__dirname, "../src/lambda/event-sender-lambda.ts"),
    });

    // If an EventBus was provided, grant PutEvents to the sender lambda and
    // set an environment variable so the runtime knows which bus to use.
    props.eventBus.grantPutEventsTo(this.eventSenderLambda);

    this.eventSenderLambda.addEnvironment(
      "EVENT_BUS_NAME",
      props.eventBus.eventBusName,
    );

    this.eventSenderLambda.role?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AWSXRayDaemonWriteAccess"),
    );

    // Create a subscription filter on the EventSender Lambda's log group to
    // forward all logs to the ingestion lambda (imported or local).
    new logs.SubscriptionFilter(
      this,
      `${this.eventSenderLambda.logGroup.node.id}-nr-subscription`,
      {
        filterName: `${ingestionFunction.functionName}`,
        logGroup: this.eventSenderLambda.logGroup,
        destination: new destinations.LambdaDestination(ingestionFunction),
        filterPattern: logs.FilterPattern.allEvents(),
      },
    );

    // Create an SNS topic and a subscription lambda that logs X-Ray info
    const tracingTopic = new sns.Topic(this, "TvnzTestTracingTopic", {
      topicName: "tvnz-test-tracing-topic",
    });

    const snsSubLambda = createTracedLambda(this, {
      id: "SnsSubscriptionLambda",
      functionName: "tvnz-sns-subscription-lambda",
      entryPath: path.join(
        __dirname,
        "../src/lambda/sns-subscription-lambda.ts",
      ),
    });

    // Subscribe the lambda to the topic
    tracingTopic.addSubscription(
      new subscriptions.LambdaSubscription(snsSubLambda),
    );

    // Grant publish permission to the event sender lambda and set env var
    tracingTopic.grantPublish(this.eventSenderLambda);
    this.eventSenderLambda.addEnvironment(
      "TRACING_SNS_TOPIC_ARN",
      tracingTopic.topicArn,
    );
  }
}
