import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as sfnTasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import * as httpApigateway from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { createTracedLambda } from "./lambda-utils";

export class TracingTestStack2 extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Custom EventBridge event bus with X-Ray tracing
    const integrationEventBus = new events.EventBus(
      this,
      "tvnz-test-integration-event-bus",
      {
        eventBusName: "tvnz-test-integration-event-bus",
      },
    );

    //    integrationEventBus.grantPutEventsTo(tracingTestLambda);

    const sfControllerLambda = createTracedLambda(this, {
      id: "tvnz-test-sf-controller-lambda",
      functionName: "tvnz-test-sf-controller-lambda",
      entryPath: path.join(
        __dirname,
        "../src/lambda/tvnz-test-sf-controller-lambda.ts",
      ),
    });

    // Business Lambdas invoked by the new business Step Function
    const businessLambda1 = createTracedLambda(this, {
      id: "tvnz-test-tracing-business-lambda1",
      functionName: "tvnz-test-tracing-business-lambda1",
      entryPath: path.join(
        __dirname,
        "../src/lambda/business/tracing-business-lambda1.ts",
      ),
    });

    const businessLambda2 = createTracedLambda(this, {
      id: "tvnz-test-tracing-business-lambda2",
      functionName: "tvnz-test-tracing-business-lambda2",
      entryPath: path.join(
        __dirname,
        "../src/lambda/business/tracing-business-lambda2.ts",
      ),
    });

    // Step Function definition for business workflow: Lambda1 -> Lambda2
    const businessTask1 = new sfnTasks.LambdaInvoke(this, "BusinessTask1", {
      lambdaFunction: businessLambda1,
      outputPath: "$",
    });

    const businessTask2 = new sfnTasks.LambdaInvoke(this, "BusinessTask2", {
      lambdaFunction: businessLambda2,
      outputPath: "$",
    });

    // Create CloudWatch Log Group for Step Functions (used by both state machines)
    const stepFunctionLogGroup = new logs.LogGroup(
      this,
      "StepFunctionLogGroup",
      {
        logGroupName: "/aws/stepfunctions/tvnz-test-tracing-sf-lg",
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    const businessStateMachine = new stepfunctions.StateMachine(
      this,
      "BusinessStateMachine",
      {
        stateMachineName: "tvnz-business-state-machine",
        definition: businessTask1.next(businessTask2),
        tracingEnabled: true,
        logs: {
          destination: stepFunctionLogGroup,
          level: stepfunctions.LogLevel.ALL,
          includeExecutionData: true,
        },
      },
    );

    // Allow controller Lambda to start the business state machine
    businessStateMachine.grantStartExecution(sfControllerLambda);

    // Expose the business state machine ARN to the controller Lambda
    sfControllerLambda.addEnvironment(
      "BUSINESS_SFN_ARN",
      businessStateMachine.stateMachineArn,
    );

    const processEventTask = new sfnTasks.LambdaInvoke(
      this,
      "ProcessEventTask",
      {
        lambdaFunction: sfControllerLambda,
        outputPath: "$",
      },
    );
    const integrationStepFunction = new stepfunctions.StateMachine(
      this,
      "IntegrationStepFunction",
      {
        stateMachineName: "tvnz-test-integration-sf",
        definition: processEventTask,
        tracingEnabled: true,
        logs: {
          destination: stepFunctionLogGroup,
          level: stepfunctions.LogLevel.ALL,
          includeExecutionData: true,
        },
      },
    );

    // EventBridge rule to trigger Step Functions
    const integrationEventRule = new events.Rule(this, "IntegrationEventRule", {
      eventBus: integrationEventBus,
      eventPattern: {
        source: ["tracing-test"],
        detailType: ["API Gateway Event"],
      },
    });

    // Add Step Functions as target
    integrationEventRule.addTarget(
      new targets.SfnStateMachine(integrationStepFunction, {
        input: events.RuleTargetInput.fromEventPath("$"),
      }),
    );

    const restApi = new apigateway.RestApi(this, "IntegrationRestApi", {
      restApiName: "tvnz-integration-rest-api",
      deployOptions: {
        stageName: "dev",
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        // Enable full request/response data logging to CloudWatch so the
        // integration payloads (and headers) are visible for debugging.
        dataTraceEnabled: true,
      },
    });

    // Role assumed by API Gateway to call EventBridge
    const apiGwRole = new iam.Role(this, "ApiGwEventsRole", {
      assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      description: "Role for API Gateway to PutEvents to EventBridge",
    });

    // Allow PutEvents to the specific event bus
    apiGwRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["events:PutEvents"],
        resources: [integrationEventBus.eventBusArn],
      }),
    );

    apiGwRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
        resources: ["*"],
      }),
    );

    // Base integration options similar to your snippet
    const baseEventsIntegrationOptions: apigateway.IntegrationOptions = {
      credentialsRole: apiGwRole,
      requestParameters: {
        // target and content-type are literals
        "integration.request.header.X-Amz-Target": "'AWSEvents.PutEvents'",
        "integration.request.header.Content-Type":
          "'application/x-amz-json-1.1'",
        // Always send API Gateway's X-Ray trace id to the integration so the
        // downstream call carries a valid X-Amzn-Trace-Id header. The
        // original client-provided x-trace-id (if any) is still included in
        // the event Detail.TraceId via the request template above.
        "integration.request.header.X-Amzn-Trace-Id": "context.awsXrayTraceId",
      },
      integrationResponses: [
        {
          statusCode: "200",
          responseTemplates: {
            "application/json": `
                            #set($b = $util.parseJson($input.body))
                            {
                            "failedEntryCount": $b.FailedEntryCount,
                            "entries": $b.Entries
                            }`.trim(),
          },
        },
        {
          statusCode: "400",
          selectionPattern: "4\\d{2}",
          responseTemplates: {
            "application/json": `
                            #if($input.path('$.message'))
                                {"error":"Bad Request","message":"$util.escapeJavaScript($input.path('$.message'))"}
                            #else
                                {"error":"Bad Request","message":"$util.escapeJavaScript($input.body)"}
                            #end
                            `.trim(),
          },
        },
        {
          statusCode: "500",
          selectionPattern: "5\\d{2}",
          responseTemplates: {
            "application/json": JSON.stringify({
              error: "Internal Server Error",
              message: "Failed to send event",
            }),
          },
        },
      ],
    };

    // VTL docs:
    // https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-mapping-template-reference.html
    const eventRequestTemplates = () => ({
      "application/json": `

       {
                "Entries": [
                    {
                    "Source": "tracing-test",
                    "DetailType": "API Gateway Event",
                    "Detail": "$util.escapeJavaScript($input.body)",
                    "EventBusName": "${integrationEventBus.eventBusName}"
                    }
                ]
                }

                `.trim(),
    });

    const buildPutEvent = () =>
      new apigateway.AwsIntegration({
        service: "events",
        action: "PutEvents",
        integrationHttpMethod: "POST",
        options: {
          ...baseEventsIntegrationOptions,
          requestTemplates: eventRequestTemplates(),
        },
      });

    // Expose a resource and method on the RestApi that forwards to EventBridge
    const integrationResource = restApi.root.addResource("integration");
    integrationResource.addMethod("POST", buildPutEvent(), {
      methodResponses: [
        { statusCode: "200" },
        { statusCode: "400" },
        { statusCode: "500" },
      ],
      requestParameters: {
        "method.request.header.x-trace-id": false,
      },
    });
  }
}
