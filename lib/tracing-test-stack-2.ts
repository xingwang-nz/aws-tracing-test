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
import { createTracedLambda } from "./utils/lambda-utils";

export interface TvnzTracingTestStack2Props extends cdk.StackProps {
  readonly eventBus: events.EventBus;
}

export class TvnzTracingTestStack2 extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TvnzTracingTestStack2Props) {
    super(scope, id, props);

    // This stack now focuses on the REST API integration. Integration
    // EventBus and StepFunctions were moved to a dedicated
    // TvnzIntegrationEventBusStack to allow reuse across multiple APIs.

    const restApi = new apigateway.RestApi(this, "IntegrationRestApi", {
      restApiName: "tvnz-test-integration-2-rest-api",
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

    // NOTE: The EventBus is now owned by TvnzIntegrationEventBusStack.
    // The API Gateway role permissions should be set in that stack or
    // applied here by referencing the bus ARN when available.

    // Require the EventBus construct to be passed in so we can grant precise
    // permissions and use its tokenized name in the integration mapping template.

    // Grant API Gateway PutEvents to the provided EventBus ARN
    apiGwRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["events:PutEvents"],
        resources: [props.eventBus.eventBusArn],
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
    // Use the EventBus construct's name token directly in the VTL template.
    const busNameToken = props.eventBus.eventBusName;

    const eventRequestTemplates = () => ({
      "application/json": `{
        "Entries": [
          {
            "Source": "api-gateway",
            "DetailType": "API Gateway Event",
            "Detail": "$util.escapeJavaScript($input.body)",
            "EventBusName": "${busNameToken}"
          }
        ]
      }`.trim(),
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
