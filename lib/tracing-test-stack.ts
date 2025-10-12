import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as sfnTasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as iam from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as path from "path";
import { createTracedLambda } from "./lambda-utils";

export class TracingTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Lambda function with X-Ray tracing enabled
    const tracingTestLambda = createTracedLambda(this, {
      id: "TracingTestLambda",
      functionName: "tracing-test-lambda",
      entryPath: path.join(
        __dirname,
        "../src/lambda/tracing-test-lambda/index.ts",
      ),
    });

    // Custom EventBridge event bus with X-Ray tracing
    const tracingEventBus = new events.EventBus(this, "TracingEventBus", {
      eventBusName: "tracing-test",
    });

    // Grant the lambda permission to publish events to the custom event bus
    tracingEventBus.grantPutEventsTo(tracingTestLambda);

    // Add environment variable for the event bus ARN
    tracingTestLambda.addEnvironment(
      "EVENT_BUS_NAME",
      tracingEventBus.eventBusName,
    );

    // Step Functions controller lambda
    const sfControllerLambda = createTracedLambda(this, {
      id: "SfControllerLambda",
      functionName: "tracing-test-sf-controller-lambda",
      entryPath: path.join(
        __dirname,
        "../src/lambda/tracing-test-sf-controller-lambda/index.ts",
      ),
    });

    // Business Lambda function
    const businessLambda = createTracedLambda(this, {
      id: "BusinessLambda",
      functionName: "tracing-test-lambda-business",
      entryPath: path.join(
        __dirname,
        "../src/lambda/tracing-test-lambda-business/index.ts",
      ),
    });

    // Business Step Functions state machine
    const businessProcessTask = new sfnTasks.LambdaInvoke(
      this,
      "BusinessProcessTask",
      {
        lambdaFunction: businessLambda,
        outputPath: "$",
      },
    );

    const businessDefinition = businessProcessTask;

    // Create CloudWatch Log Group for Business Step Functions
    const businessStepFunctionLogGroup = new logs.LogGroup(
      this,
      "BusinessStepFunctionLogGroup",
      {
        logGroupName: "/aws/stepfunctions/tracing-test-sf-business",
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    const businessStepFunction = new stepfunctions.StateMachine(
      this,
      "BusinessStepFunction",
      {
        stateMachineName: "tracing-test-sf-business",
        definition: businessDefinition,
        tracingEnabled: true,
        logs: {
          destination: businessStepFunctionLogGroup,
          level: stepfunctions.LogLevel.ALL,
          includeExecutionData: true,
        },
      },
    );

    // Grant the controller lambda permission to start business step function executions
    businessStepFunction.grantStartExecution(sfControllerLambda);

    // Add environment variable for the business step function ARN
    sfControllerLambda.addEnvironment(
      "BUSINESS_STEP_FUNCTION_ARN",
      businessStepFunction.stateMachineArn,
    );

    // Step Functions state machine
    const processEventTask = new sfnTasks.LambdaInvoke(
      this,
      "ProcessEventTask",
      {
        lambdaFunction: sfControllerLambda,
        outputPath: "$",
      },
    );

    const definition = processEventTask;

    // Create CloudWatch Log Group for Step Functions
    const stepFunctionLogGroup = new logs.LogGroup(
      this,
      "StepFunctionLogGroup",
      {
        logGroupName: "/aws/stepfunctions/tracing-test-sf",
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    const tracingStepFunction = new stepfunctions.StateMachine(
      this,
      "TracingStepFunction",
      {
        stateMachineName: "tracing-test-sf",
        definition,
        tracingEnabled: true,
        logs: {
          destination: stepFunctionLogGroup,
          level: stepfunctions.LogLevel.ALL,
          includeExecutionData: true,
        },
      },
    );

    // EventBridge rule to trigger Step Functions
    const eventRule = new events.Rule(this, "TracingEventRule", {
      eventBus: tracingEventBus,
      eventPattern: {
        source: ["tracing-test"],
        detailType: ["API Gateway Event"],
      },
    });

    // Add Step Functions as target
    eventRule.addTarget(
      new targets.SfnStateMachine(tracingStepFunction, {
        input: events.RuleTargetInput.fromEventPath("$"),
      }),
    );

    // REST API Gateway with X-Ray tracing enabled
    const api = new apigateway.RestApi(this, "TracingTestApi", {
      restApiName: "tracing-test-api",
      description: "API Gateway with X-Ray tracing for testing data flow",
      deployOptions: {
        stageName: "dev",
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
        ],
      },
    });

    // Create /api resource
    const apiResource = api.root.addResource("api");

    // Create /api/test-tracing resource
    const testTracingResource = apiResource.addResource("test-tracing");

    // Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(
      tracingTestLambda,
      {
        requestTemplates: { "application/json": '{ "statusCode": "200" }' },
        proxy: true,
      },
    );

    // Add POST method to /api/test-tracing
    testTracingResource.addMethod("POST", lambdaIntegration, {
      operationName: "TestTracing",
      methodResponses: [
        {
          statusCode: "200",
          responseModels: {
            "application/json": apigateway.Model.EMPTY_MODEL,
          },
        },
        {
          statusCode: "400",
          responseModels: {
            "application/json": apigateway.Model.ERROR_MODEL,
          },
        },
      ],
    });

    // Output the API URL
    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
      description: "API Gateway URL",
      exportName: "TracingTestApiUrl",
    });

    // Output the specific endpoint
    new cdk.CfnOutput(this, "TestTracingEndpoint", {
      value: `${api.url}api/test-tracing`,
      description: "POST endpoint for testing tracing",
      exportName: "TestTracingEndpoint",
    });

    // Output the Step Functions ARN
    new cdk.CfnOutput(this, "StepFunctionArn", {
      value: tracingStepFunction.stateMachineArn,
      description: "Step Functions ARN",
      exportName: "TracingStepFunctionArn",
    });

    // Output the EventBridge bus ARN
    new cdk.CfnOutput(this, "EventBusArn", {
      value: tracingEventBus.eventBusArn,
      description: "Custom EventBridge bus ARN",
      exportName: "TracingEventBusArn",
    });

    // Output the Lambda function name
    new cdk.CfnOutput(this, "LambdaFunctionName", {
      value: tracingTestLambda.functionName,
      description: "Lambda function name",
      exportName: "TracingTestLambdaName",
    });

    // Output the Step Functions controller lambda name
    new cdk.CfnOutput(this, "SfControllerLambdaName", {
      value: sfControllerLambda.functionName,
      description: "Step Functions controller lambda name",
      exportName: "SfControllerLambdaName",
    });

    // Output the Step Functions Log Group name
    new cdk.CfnOutput(this, "StepFunctionLogGroupName", {
      value: stepFunctionLogGroup.logGroupName,
      description: "Step Functions CloudWatch Log Group name",
      exportName: "StepFunctionLogGroupName",
    });

    // Output the Business Step Functions ARN
    new cdk.CfnOutput(this, "BusinessStepFunctionArn", {
      value: businessStepFunction.stateMachineArn,
      description: "Business Step Functions ARN",
      exportName: "BusinessStepFunctionArn",
    });

    // Output the Business Lambda function name
    new cdk.CfnOutput(this, "BusinessLambdaName", {
      value: businessLambda.functionName,
      description: "Business Lambda function name",
      exportName: "BusinessLambdaName",
    });

    // Output the Business Step Functions Log Group name
    new cdk.CfnOutput(this, "BusinessStepFunctionLogGroupName", {
      value: businessStepFunctionLogGroup.logGroupName,
      description: "Business Step Functions CloudWatch Log Group name",
      exportName: "BusinessStepFunctionLogGroupName",
    });
  }
}
