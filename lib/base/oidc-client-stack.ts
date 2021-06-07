/* eslint-disable max-len */
/* eslint-disable no-new */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
import * as cdk from '@aws-cdk/core';
import * as apigateway from '@aws-cdk/aws-apigateway';
import * as nodejslambda from '@aws-cdk/aws-lambda-nodejs';
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as ssm from '@aws-cdk/aws-ssm';
import { PolicyStatement } from '@aws-cdk/aws-iam';

const path = require('path');

interface OidcClientStackProps {
  oidcResourceUrl: string
  tenantsTableName: string
}

/**
 * OIDC Client CDK construct that acts as a one stop shop headless client
 * that uses redirects to receive authorization code from OP
 * Authorizer serves the purpose to inspect the request path for sub domain,
 * uses subdomain to lookup tenant config from dynamodb table
 * that gives the cognito app client ID to use later in the auth call.
 * Proxy Lambda function eventually exchanges the code for a token from cognito
 * uses the token to call warm cookie service. To do all of this, needs two inputs
 * @param {String}  oidcResource_url OIDC resource url
 * @param {String}  tenantsTableName Name of Dynamodb Table that has the tenants information
 *  especiialy the cognito app client id.
 */
export default class OidcClientStack extends cdk.Stack {
  public readonly clientCallbackUrl :string ;

  public readonly clientUrl :string ;

  constructor(scope: cdk.Construct, id: string, props: OidcClientStackProps) {
    super(scope, id);

    /** * API ** */

    const api = new apigateway.RestApi(this, 'oidc-client', {
      restApiName: 'oidc-client-api',
      description: 'This is mysaasapp client/backend headless mostly application that serves the purpose of vending warm cookies for signed-in users',
      deploy: false,
    });

    const table = dynamodb.Table.fromTableAttributes(this, 'TenantsTable', {
      tableName: props.tenantsTableName,
      globalIndexes: ['subdomain-index'],
    });

    /**
     * Authorizer function: Uses domain prefix, and path as lookup to retrieve tenant settings to be
     * used later in the mock context to stitch together the Cognito Auth URL.
     */

    const authFn = new nodejslambda.NodejsFunction(this, 'oidc-auth-function', {
      entry: `${path.join(path.resolve(__dirname, '..', '..'), 'resources', 'oidc-client', 'authorizer')}/index.js`,
      handler: 'authorizerHandler',
      timeout: cdk.Duration.seconds(900), // +acm validation wait of 530 seconds
      memorySize: 3008,
      environment: {
        TENANTS_TABLE_NAME: props.tenantsTableName,
      },
    });
    // Give Auth function read access to tenants table
    table.grantReadData(authFn);

    // Auth Lambda Policy to insert/read tenant specific secrets
    authFn.addToRolePolicy(new PolicyStatement({
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:/mysaasapp/*`],
      actions: ['secretsmanager:*Secret*'],
    }));

    const auth = new apigateway.RequestAuthorizer(this, 'oidc-authorizer', {
      handler: authFn,
      identitySources: ['method.request.header.Host'],
    });

    /**
     *
     * root -> [GET] redirect always to Auth endpoint
    */
    const getMockIntegration = new apigateway.MockIntegration({

      passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      requestTemplates: {
        'application/json': '{ "statusCode": 200 }',
      },
      integrationResponses: [{
        statusCode: '302',
        responseTemplates: { 'application/json': '#set($context.responseOverride.header.Location = $context.authorizer.auth_endpoint+"?client_id="+$context.authorizer.clientid+"&response_type="+$context.authorizer.response_type+"&scope="+$context.authorizer.scope+"&identity_provider="+$context.authorizer.idp_identifier+"&redirect_uri="+"https://"+$context.domainName+"/callback")' },
      }],

    });
    api.root.addMethod('GET', getMockIntegration, {
      authorizer: auth,
      requestParameters: { 'method.request.querystring.scope': true },
      methodResponses: [{ statusCode: '302', responseParameters: { 'method.response.header.Location': true } }],
    });

    /**
     *
     * callback [GET] code from OIDCP after Auth, redirects to getuserinfo
     *
    */

    const getCallback = api.root.addResource('callback');

    const getCallbackIntegration = new apigateway.MockIntegration({

      passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      requestTemplates: {
        'application/json': '{ "statusCode": 200 }',
      },

      integrationResponses: [{
        statusCode: '200',
        responseTemplates: { 'text/html': '#set($context.responseOverride.header.Content-Type = "text/html") <html><head><title>HTML from API Gateway/Lambda</title> <script type = "text/javascript">if((window.location.hash != "") || (window.location.href!= "")){let windowlocnew = window.location.toString(); windowlocnew = windowlocnew.replace("#","?"); windowlocnew = windowlocnew.replace("callback","userinfo");  window.location.replace(windowlocnew);}</script></head><body><h1>HTML from API Gateway/Lambda</h1></body></html>' },
      }],
    });
    getCallback.addMethod('GET', getCallbackIntegration, {
      methodResponses: [{ statusCode: '200' }],
    });

    /**
     * userinfo [GET] gets a warm cookie
     *
     */

    const clientFn = new nodejslambda.NodejsFunction(this, 'oidc-client-function', {
      entry: `${path.join(path.resolve(__dirname, '..', '..'), 'resources', 'oidc-client', 'oidc_client_function')}/handler.js`,
      handler: 'hello',
      timeout: cdk.Duration.seconds(900),
      memorySize: 3008,
      environment: {
        resource_endpoint: props.oidcResourceUrl,
        TENANTS_TABLE_NAME: props.tenantsTableName,
      },
    });
    const getUserInfo = api.root.addResource('userinfo');

    const getUserInfoIntegration = new apigateway.LambdaIntegration(clientFn);

    getUserInfo.addMethod('GET', getUserInfoIntegration, { authorizer: auth }); // GET /

    // Give client function read access to tenants table
    table.grantReadData(clientFn);

    /**
     *
     * admin app
     */
    const getAdminMockIntegration = new apigateway.MockIntegration({

      passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      requestTemplates: {
        'application/json': '{ "statusCode": 200 }',
      },
      integrationResponses: [{
        statusCode: '302',
        responseTemplates: { 'application/json': '#set($context.responseOverride.header.Location = $context.authorizer.auth_endpoint+"?client_id="+$context.authorizer.clientid+"&response_type="+$context.authorizer.response_type+"&scope="+$context.authorizer.scope+"&identity_provider=COGNITO&redirect_uri="+"https://"+$context.domainName+"/callback")' },
      }],

    });
    const getAdminResource = api.root.addResource('admin');
    getAdminResource.addMethod('GET', getAdminMockIntegration, {
      authorizer: auth,
      requestParameters: { 'method.request.querystring.scope': true },
      methodResponses: [{ statusCode: '302', responseParameters: { 'method.response.header.Location': true } }],
    });

    const deployment = new apigateway.Deployment(this, 'Deployment', { api });

    const stage = new apigateway.Stage(this, 'dev', {
      stageName: 'dev',
      deployment,
      loggingLevel: apigateway.MethodLoggingLevel.INFO,
      dataTraceEnabled: true,
    });

    api.deploymentStage = stage;

    new ssm.StringParameter(this, 'oidcClientEndPoint', {
      parameterName: '/mysaasapp/oidcClientEndPoint',
      stringValue: api.url,
    });

    new ssm.StringParameter(this, 'oidcClientCallBackEndPoint', {
      parameterName: '/mysaasapp/oidcClientCallBackEndPoint',
      stringValue: `${api.url}/callback`,
    });
    new ssm.StringParameter(this, 'oidcClientRestApiId', {
      parameterName: '/mysaasapp/oidcClientRestApiId',
      stringValue: api.restApiId,
    });

    this.clientCallbackUrl = `${api.url}/callback`;
    this.clientUrl = api.url;
  }
}
