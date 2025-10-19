import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import { createTracedLambda } from "./utils/lambda-utils";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";

export interface TvnzEventSenderStackProps extends cdk.StackProps {
  readonly eventBus: events.EventBus;
}

export class TvnzEventSenderStack extends cdk.Stack {
  public readonly eventSenderLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: TvnzEventSenderStackProps) {
    super(scope, id, props);

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
  }
}
