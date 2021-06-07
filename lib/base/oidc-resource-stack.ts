/* eslint-disable max-len */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-unused-vars */
/* eslint-disable no-new */
import * as cdk from '@aws-cdk/core';
import * as apigateway from '@aws-cdk/aws-apigateway';
import * as lambda from '@aws-cdk/aws-lambda';
import * as nodejslambda from '@aws-cdk/aws-lambda-nodejs';

const path = require('path');

interface OidcResourceStackProps extends cdk.StackProps{
  clientSecret: string;
  clientId: string;
  introspectionUrl: string
  cognitoPoolId: string
}

export default class OidcResourceStack extends cdk.Stack {
  public readonly resourceUrl :string ;

  constructor(scope: cdk.Construct, id: string, props: OidcResourceStackProps) {
    super(scope, id, props);

    const sampleFn = new nodejslambda.NodejsFunction(this, 'oidc-resource-function', {
      entry: `${path.join(path.resolve(__dirname, '..', '..'), 'resources', 'oidc-resource', 'sample')}/handler.js`,
      handler: 'hello',
      timeout: cdk.Duration.seconds(900),
      memorySize: 3008,
    });

    const authFn = new nodejslambda.NodejsFunction(this, 'oidc-resource-auth-function', {
      entry: `${path.join(path.resolve(__dirname, '..', '..'), 'resources', 'oidc-resource', 'authorizer')}/index.js`,
      handler: 'authorizerHandler',
      timeout: cdk.Duration.seconds(900),
      memorySize: 3008,
      environment: {
        AWS_CUSTOM_AUTHORIZER_CLIENT_SECRET: props.clientSecret,
        AWS_CUSTOM_AUTHORIZER_CLIENT_ID: props.clientId,
        AWS_CUSTOM_AUTHORIZER_INTROSPECTION_ENDPOINT: props.introspectionUrl,
        COGNITO_USER_POOL_ID: props.cognitoPoolId,
      },
    });
    const api = new apigateway.RestApi(this, 'oidc-resource-api', {
      restApiName: 'oidc-resource-api',
      description: 'This service serves unicorn cookies.',
    });

    const auth = new apigateway.TokenAuthorizer(this, 'oidc-resource-authorizer', {
      handler: authFn,
    });

    const getSampleIntegration = new apigateway.LambdaIntegration(sampleFn, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
    });

    api.root.addMethod('GET', getSampleIntegration, {
      authorizer: auth,
    });

    this.resourceUrl = api.url;
  }
}
