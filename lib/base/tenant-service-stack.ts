/* eslint-disable max-len */
/* eslint-disable no-new */
import {
  Construct, Stack, StackProps, Duration,
} from '@aws-cdk/core';
import * as nodejslambda from '@aws-cdk/aws-lambda-nodejs';
import {
  PolicyStatement, Role, ServicePrincipal, Policy, Effect,
} from '@aws-cdk/aws-iam';
import { UserPool } from '@aws-cdk/aws-cognito';
import {
  RestApi, RequestAuthorizer, AwsIntegration, MethodLoggingLevel,
} from '@aws-cdk/aws-apigateway';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { LogGroup } from '@aws-cdk/aws-logs';
import * as ssm from '@aws-cdk/aws-ssm';

const path = require('path');

interface TenantServiceStackProps extends StackProps{
    oidcProviderTableName: string;
    tenantsTableName: string;
    federationCognitoUserpool: UserPool;
    hostedZoneId: string;
  }

export default class TenantServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: TenantServiceStackProps) {
    super(scope, id, props);
    const oidcproviderpipelineName = 'Hybrid-SaaS-Identity_OidcProvider_CI-CD_pipeline';
    /**
     * Tenant Infrastructure is created by two state machines:
     * 1. Tenant Onboarding Step Function
     * 2. Tenant Federation Step Function
     *
     * Both are fronted by APIGateway. Tenant Onboarding is open, no-Auth.
     * Tenant Federation however is availble only on /admin to Administrators.
     * These two can be invoked in tandem by an onboarding orchestration workflow as needed.
     *
     */

    /**
     * Tenant Rest API
     */
    const tenantApi = new RestApi(this, 'mysaasapp-tenant-service', {
      restApiName: 'mysaasapp-tenant-service',
      description: 'This tenant microservice handles tenant lifecycle right from onboarding, modifications to offboarding',
      deployOptions: {
        loggingLevel: MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
    });

    /**
     * Authorizer function for tenant federation api
     */
    const authFn = new nodejslambda.NodejsFunction(this, 'tenant-auth-function', {
      entry: `${path.join(path.resolve(__dirname, '..', '..'), 'resources', 'add_tenant_federation_lambda_authorizer')}/index.js`,
      handler: 'authorizerHandler',
      timeout: Duration.seconds(900), // +acm validation wait of 530 seconds
      memorySize: 3008,
      environment: {
        COGNITO_USER_POOL_ID: props.federationCognitoUserpool.userPoolId,
      },
    });

    /**
     * Request authorizer keys on host name, e.g. tenant-2.thinkr.dev will cache policy
     * for all subsequent invocations from the same host name.
     */
    const auth = new RequestAuthorizer(this, 'oidc-authorizer', {
      handler: authFn,
      identitySources: ['method.request.header.Host'],
    });

    /**
     * Create Tenant Infra Lambda Function.
     * This will be called by the onboarding Step function.
     */
    const createTenantInfraFn = new nodejslambda.NodejsFunction(this, 'AddTenantInfraFunction', {
      entry: `${path.join(path.resolve(__dirname, '..', '..'), 'resources', 'add_tenant_infra_lambda')}/handler.js`,
      handler: 'handler',
      timeout: Duration.seconds(900), // +acm validation wait of 530 seconds
      memorySize: 3008,
    });

    // Tenant Infra Lambda Policy to insert/read tenant specific ssm parameters
    createTenantInfraFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/mysaasapp/*`],
      actions: ['ssm:GetParameter*', 'ssm:PutParameter*'],
    }));

    // Tenant Infra Lambda Policy to start federation step function execution
    createTenantInfraFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:states:${this.region}:${this.account}:stateMachine:*TenantFederationStateMachine*`],
      actions: ['states:StartExecution'],
    }));

    // Tenant Infra Lambda Policy to insert/read tenant specific secrets
    createTenantInfraFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:/mysaasapp/*`],
      actions: ['secretsmanager:*Secret*'],
    }));

    // Tenant Infra Lambda Policy to generate tenant secrets
    createTenantInfraFn.addToRolePolicy(new PolicyStatement({
      resources: ['*'],
      actions: ['secretsmanager:GetRandomPassword'],
    }));

    // Tenant Infra Lambda Policy to create tenant specific Cognito userpool components
    createTenantInfraFn.addToRolePolicy(new PolicyStatement({
      resources: [props.federationCognitoUserpool.userPoolArn],
      actions: ['cognito-idp:*'],
    }));

    // Tenant Infra Lambda Policy to write/read tenant specific items
    // into oidcprovider/tenants DynamoDB table
    createTenantInfraFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:dynamodb:*:*:table/${props.oidcProviderTableName}`, `arn:aws:dynamodb:*:*:table/${props.tenantsTableName}`],
      actions: ['dynamodb:Put*', 'dynamodb:G*', 'dynamodb:Q*', 'dynamodb:S*'],
    }));

    // Tenant Infra Lambda Policy to create acm ceertificate for tenant subdomain
    createTenantInfraFn.addToRolePolicy(new PolicyStatement({
      resources: ['*'],
      actions: ['acm:RequestCertificate', 'acm:AddTagsToCertificate', 'acm:DescribeCertificate'],
    }));

    // Tenant Infra Lambda Policy to create apigw custom domain and attach cloudfront distribution
    createTenantInfraFn.addToRolePolicy(new PolicyStatement({
      resources: ['*'],
      actions: ['apigateway:PUT', 'cloudfront:UpdateDistribution'],
    }));

    createTenantInfraFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:apigateway:${this.region}::/domainnames`, `arn:aws:apigateway:${this.region}::/domainnames/*`],
      actions: ['apigateway:POST'],
    }));

    createTenantInfraFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:apigateway:${this.region}::/domainnames`, `arn:aws:apigateway:${this.region}::/domainnames/*`],
      actions: ['apigateway:POST'],
    }));

    createTenantInfraFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:route53:::hostedzone/${props.hostedZoneId}`],
      actions: ['route53:ChangeResourceRecordSets'],
    }));

    /**
     * Start OIDC Provider CodePipeline Lambda Function.
     * This will be called by the federation Step function.
     */
    const startOidcProviderPipelineFn = new nodejslambda.NodejsFunction(this, 'StartOidcProviderPipelineFunction', {
      entry: `${path.join(path.resolve(__dirname, '..', '..'), 'resources', 'start_oidc_provider_pipeline_lambda')}/handler.js`,
      handler: 'handler',
      timeout: Duration.seconds(900), // +acm validation wait of 530 seconds
      memorySize: 3008,
    });

    // Tenant Federation Lambda Policy to start oidcprovider codepipeline
    startOidcProviderPipelineFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:codepipeline:${this.region}:${this.account}:${oidcproviderpipelineName}`],
      actions: ['codepipeline:StartPipelineExecution'],
    }));
    startOidcProviderPipelineFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:states:${this.region}:${this.account}:stateMachine:*TenantFederationStateMachine*`],
      actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
    }));

    // Tenant Federation Lambda Policy to insert/read tenant specific ssm parameters
    startOidcProviderPipelineFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/mysaasapp/*`],
      actions: ['ssm:GetParameter*', 'ssm:PutParameter*'],
    }));

    const addFederationConfigFn = new nodejslambda.NodejsFunction(this, 'AddFederationConfigFunction', {
      entry: `${path.join(path.resolve(__dirname, '..', '..'), 'resources', 'add_federation_configuration_lambda')}/handler.js`,
      handler: 'handler',
      timeout: Duration.seconds(900), // +acm validation wait of 530 seconds
      memorySize: 3008,
      environment: {
        TENANTS_TABLE_NAME: props.tenantsTableName,
      },
    });
    addFederationConfigFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:dynamodb:*:*:table/${props.oidcProviderTableName}`, `arn:aws:dynamodb:*:*:table/${props.tenantsTableName}`],
      actions: ['dynamodb:Put*', 'dynamodb:G*', 'dynamodb:Q*', 'dynamodb:S*', 'dynamodb:U*'],
    }));

    // Tenant Federation Lambda Policy to insert/read tenant specific secrets
    addFederationConfigFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:/mysaasapp/*`],
      actions: ['secretsmanager:*Secret*'],
    }));

    // Tenant Federation Lambda Policy to generate tenant secrets
    addFederationConfigFn.addToRolePolicy(new PolicyStatement({
      resources: ['*'],
      actions: ['secretsmanager:GetRandomPassword'],
    }));

    // Tenant Federation Lambda Policy to insert/read tenant specific ssm parameters
    addFederationConfigFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/mysaasapp/*`],
      actions: ['ssm:GetParameter*', 'ssm:PutParameter*'],
    }));

    // Tenant Federation Lambda Policy to create tenant specific Cognito userpool components
    addFederationConfigFn.addToRolePolicy(new PolicyStatement({
      resources: [props.federationCognitoUserpool.userPoolArn],
      actions: ['cognito-idp:*'],
    }));

    /**
     * Tenant Federation State machine
     */

    // Lambda Invoke step to start the oidc provider code pipeline.
    // This uses a task wait pattern where a token is passed from sfc -> Lambda
    // Lambda stores this token in dynamodb, with the execution id of the codepipeline
    // codepipeline retrieves this token and passes it on to another lambda that it
    // invokes as part of the pipeline at the end to signal completion back to sfn.
    // sfn->lambda->codepipeline->lambda->sfn
    const startPipelineJob = new tasks.LambdaInvoke(this, 'Start OIDC Provider CodePipeline Execution', {
      lambdaFunction: startOidcProviderPipelineFn,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      timeout: Duration.hours(2),
      // Lambda's result is in the attribute `Payload`
      resultPath: '$.taskresult',
      payload: sfn.TaskInput.fromObject({
        token: sfn.JsonPath.taskToken,
        input: sfn.JsonPath.entirePayload,
      }),
    });

    // Lambda Invoke step to add federation config to dynamodb, ssm, secrets manager.
    const addConfigJob = new tasks.LambdaInvoke(this, 'Add Federation Config', {
      lambdaFunction: addFederationConfigFn,
    });

    // Federation state machine definition.
    const definition = startPipelineJob
      .next(addConfigJob);

    // Cloud Watch Log group for Federation state machine definition.
    const sfnLogGroup = new LogGroup(this, 'tenantFederationStateMachineLogGroup');

    // Federation state machine resource declaration.
    // For debugging purpose the log level has been elevated,
    // you may want to lower this once it matures.
    const tenantFederationStateMachine = new sfn.StateMachine(this, 'TenantFederationStateMachine', {
      definition,
      timeout: Duration.minutes(120),
      logs: { level: sfn.LogLevel.ALL, destination: sfnLogGroup },
    });

    // IAM role that APIgateway assumes to call federtion sfn
    const credentialsRoleForTenantFederationStateMachine = new Role(this, 'HsiFederationApiGatewaySfnInvokeRole', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
    });

    // Giving APIGateway role enough permissions to start the execution of sfn.
    credentialsRoleForTenantFederationStateMachine.attachInlinePolicy(
      new Policy(this, 'credentialsPolicyFortenantFederationStateMachine', {
        statements: [
          new PolicyStatement({
            actions: ['states:StartExecution'],
            effect: Effect.ALLOW,
            resources: [tenantFederationStateMachine.stateMachineArn],
          }),
        ],
      }),
    );

    // Tenant federation resource for rest api
    const federationSfn = tenantApi.root.addResource('federation');

    // rest api integration for Tenant federation
    // Key thing to note here is the request template,
    // where input has the input body, as well as the tenantuuid from the authorizer context.
    const newFederationIntegration = new AwsIntegration({
      service: 'states',
      action: 'StartExecution',
      integrationHttpMethod: 'POST',
      options: {
        credentialsRole: credentialsRoleForTenantFederationStateMachine,
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': '{"done": true}',
            },
          },
        ],
        requestTemplates: {
          'application/json': `{
            "input": "{\\"body\\":$util.escapeJavaScript($input.json('$')), \\"tenantuuid\\":\\"$context.authorizer.tenantUuid\\"}",
            "stateMachineArn": "${tenantFederationStateMachine.stateMachineArn}"
          }`,
        },
      },
    });

    // Tenant federation Rest API method PUT for tenant federation.
    // currently only insert is handled.
    // existing tenant is detected by existing ssm params and rejected.
    // TODO: add tenant federation remove method DELETE
    // TODO: Currently federation is a insert only operation
    // TODO: Even though the codepipeline does add update behavior
    // TODO: Config is add only, not update in this reference implementaiton.
    federationSfn.addMethod('PUT', newFederationIntegration, {
      authorizer: auth,
      methodResponses: [{ statusCode: '200' }],
    });

    /**
     * Tenant Infra State Machine
     * This statemachine repeatedly calls the same lambda function with a different step name
     * Each step output is appended to the result path.
     * That way it is uniquely accessible in the subsequent steps.
     * Each Step is purposefully supressing the metadata in the response, and only retrieving the payload.
     *
     */

    // This step retrieves base stack config, adds tenant specific params to ssm.
    // Creates necessary secrets like JWKS, Cookie Signing keys
    const addTenantConfig = new tasks.LambdaInvoke(this, 'Add Tenant Config', {
      lambdaFunction: createTenantInfraFn,
      payloadResponseOnly: true,
      resultPath: '$.addTenantConfigResult',
      payload: sfn.TaskInput.fromObject({
        step: 'CONFIG',
        body: sfn.JsonPath.entirePayload,
      }),
    });

    // This creates the tenant specific Cognito userpool, userpoolclient
    const addTenantUserPool = new tasks.LambdaInvoke(this, 'Add Tenant UserPool', {
      lambdaFunction: createTenantInfraFn,
      payloadResponseOnly: true,
      resultPath: '$.addTenantUserPool',
      payload: sfn.TaskInput.fromObject({
        step: 'TENANTAUTH',
        body: sfn.JsonPath.entirePayload,
      }),
    });

    const addFederationToInternalCognitoUserPool = new tasks.StepFunctionsStartExecution(this, 'Internal Cognito federation workflow', {
      stateMachine: tenantFederationStateMachine,
      inputPath: '$.body.addTenantUserPool',
    });

    // This step creates a ACM cert for the tenant subdomain. e.g. tenant-1.thinkr.dev
    const addTenantCert = new tasks.LambdaInvoke(this, 'Add Tenant Cert', {
      lambdaFunction: createTenantInfraFn,
      payloadResponseOnly: true,
      resultPath: '$.addTenantCertResult',
      payload: sfn.TaskInput.fromObject({
        step: 'CERT',
        body: sfn.JsonPath.entirePayload,
      }),
    });

    // This step checks if the domain validation entries are available on describe cert
    // which may take some time after the cert creation in the previous step.
    const isTenantCertBaked = new tasks.LambdaInvoke(this, 'Is Tenant Cert Baked', {
      lambdaFunction: createTenantInfraFn,
      payloadResponseOnly: true,
      resultPath: '$.tenantCertCheckBakedResult',
      payload: sfn.TaskInput.fromObject({
        step: 'CERTBAKED',
        body: sfn.JsonPath.entirePayload,
      }),
    });

    // This step adds the CNAME entries from the cert to Route53 hosted zone for DNS validation.
    const addTenantCNAME = new tasks.LambdaInvoke(this, 'Add Tenant CNAME', {
      lambdaFunction: createTenantInfraFn,
      payloadResponseOnly: true,
      resultPath: '$.addTenantCNAMEResult',
      payload: sfn.TaskInput.fromObject({
        step: 'CNAME',
        body: sfn.JsonPath.entirePayload,
      }),
    });

    // This step checks if the ACM Cert status has settled to 'ISSUED' indicating DNS Validation has completed.
    const isTenantCertValid = new tasks.LambdaInvoke(this, 'Is Tenant Cert Valid', {
      lambdaFunction: createTenantInfraFn,
      payloadResponseOnly: true,
      resultPath: '$.tenantCertCheckValidResult',
      payload: sfn.TaskInput.fromObject({
        step: 'CERTVALID',
        body: sfn.JsonPath.entirePayload,
      }),
    });

    // This step takes the validated ACM cert, uses it to create a custom domain on apigw for the teanant
    // Creates a A record in route53 hosted zone to point the tenant subdomain to the
    // apigw custom domain cloud front distribution.
    const addTenantIngress = new tasks.LambdaInvoke(this, 'Add Tenant Ingress', {
      lambdaFunction: createTenantInfraFn,
      payloadResponseOnly: true,
      resultPath: '$.addTenantIngressResult',
      payload: sfn.TaskInput.fromObject({
        step: 'INGRESS',
        body: sfn.JsonPath.entirePayload,
      }),
    });

    // 30 second wait , used for ACM Cert baking.
    const waitX = new sfn.Wait(this, 'Wait X Seconds', {
      time: sfn.WaitTime.duration(Duration.seconds(30)),
    });

    // 60 second wait, used for ACM Cert DNS validation.
    const waitY = new sfn.Wait(this, 'Wait Y Seconds', {
      time: sfn.WaitTime.duration(Duration.seconds(60)),
    });

    // clugy stitching together of sfn steps into a definition
    // TODO: refactor/flatten this to avoid this pseudo chainback hell
    // more appealing visual in the docs here at [project root/images/tenant_infra_workflow.png]
    const addTenantInfraSfnDefinition = addTenantConfig
      .next(addTenantUserPool)
      .next(addFederationToInternalCognitoUserPool)
      .next(addTenantCert)
      .next(waitX)
      .next(isTenantCertBaked)
      .next(new sfn.Choice(this, 'Cert Baked?')
        .when(sfn.Condition.booleanEquals('$.tenantCertCheckBakedResult.continuewait', true), waitX)
        .when(sfn.Condition.booleanEquals('$.tenantCertCheckBakedResult.continuewait', false),
          addTenantCNAME.next(waitY).next(isTenantCertValid).next(new sfn.Choice(this, 'Cert Valid?')
            .when(sfn.Condition.booleanEquals('$.tenantCertCheckValidResult.continuewait', true), waitY)
            .when(sfn.Condition.booleanEquals('$.tenantCertCheckValidResult.continuewait', false), addTenantIngress))));

    // log group for tenant infra sfn
    const addTenantInfraSfnLogGroup = new LogGroup(this, 'tenantInfraStateMachineLogGroup');

    // Tenant Onboarding State Machine declaration
    const tenantInfraStateMachine = new sfn.StateMachine(this, 'TenantInfraStateMachine', {
      definition: addTenantInfraSfnDefinition,
      timeout: Duration.minutes(120),
      logs: { level: sfn.LogLevel.ALL, destination: addTenantInfraSfnLogGroup },
    });

    // This role is assumed by apigateway to invoke Tenant Onboarding sfn
    const credentialsRoleFortenantInfraStateMachine = new Role(this, 'HsiTenantInfraApiGatewaySfnInvokeRole', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
    });

    // giving permission to invoke the sfn.
    credentialsRoleFortenantInfraStateMachine.attachInlinePolicy(
      new Policy(this, 'credentialsPolicyFortenantInfraStateMachine', {
        statements: [
          new PolicyStatement({
            actions: ['states:StartExecution'],
            effect: Effect.ALLOW,
            resources: [tenantInfraStateMachine.stateMachineArn],
          }),
        ],
      }),
    );

    // tenant federation resource for rest api
    const tenantInfraSfn = tenantApi.root.addResource('onboard');

    // rest api integration for tenant federation sfn
    const onboardIntegration = new AwsIntegration({
      service: 'states',
      action: 'StartExecution',
      integrationHttpMethod: 'POST',
      options: {
        credentialsRole: credentialsRoleFortenantInfraStateMachine,
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': '{"done": true}',
            },
          },
        ],
        requestTemplates: {
          'application/json': `{
            "input": "{\\"body\\":$util.escapeJavaScript($input.json('$')), \\"tenantuuid\\":\\"$context.requestId\\"}",
            "stateMachineArn": "${tenantInfraStateMachine.stateMachineArn}"
          }`,
        },
      },
    });

    // Tenant federation Rest API method PUT for tenant federation.
    // currently only insert is handled.
    // existing tenant is detected by existing ssm params and rejected.
    // TODO: add tenant offboarding method DELETE
    tenantInfraSfn.addMethod('PUT', onboardIntegration, {
      methodResponses: [{ statusCode: '200' }],
    });

    new ssm.StringParameter(this, 'tenantApiEndPoint', {
      parameterName: '/mysaasapp/tenantApiEndPoint',
      stringValue: tenantApi.url,
    });
  }
}
