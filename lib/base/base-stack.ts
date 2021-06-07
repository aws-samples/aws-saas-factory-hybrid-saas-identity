/* eslint-disable max-len */
/* eslint-disable no-unused-vars */
/* eslint-disable no-new */
/* eslint-disable import/no-unresolved */
/* eslint-disable import/extensions */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
import {
  Construct, Stack, StackProps, Duration, RemovalPolicy, BundlingDockerImage,
} from '@aws-cdk/core';
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as cognito from '@aws-cdk/aws-cognito';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as nodejslambda from '@aws-cdk/aws-lambda-nodejs';
import * as ssm from '@aws-cdk/aws-ssm';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import OidcClientStack from './oidc-client-stack';
import OidcResourceStack from './oidc-resource-stack';
import TenantServiceStack from './tenant-service-stack';

const uuid = require('uuid');
const path = require('path');

interface AwsSaasFactoryHybridIdentityStackProps extends StackProps{
  hostedZoneId: string;
  cognitoUserPoolDomainPrefix: string;
}
export default class AwsSaasFactoryHybridIdentityStack extends Stack {
  constructor(scope: Construct, id: string, props: AwsSaasFactoryHybridIdentityStackProps) {
    super(scope, id, props);

    // common components
    // tenant creation step function
    // example stack to show hybrid saas identity
    // we will create a ddb table called oidc-provider, cognito user pool called tenant1,
    // cognito app client with ADMIN_SRP_AUTH enabled.
    // bootstrap it with default config, features, tenant and client
    // we will then pass on these parameters to oidc-provider, oidc-resource,
    // oidc-client in that order

    // first up dynamodb table
    // TODO change this from a static name to a ref
    const oidcProviderTable = new dynamodb.Table(this, 'oidc-provider-table', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      tableName: 'oidc-provider',
      removalPolicy: RemovalPolicy.DESTROY,

    });
    // adding a GSI on "type" because OIDC-provider-dynamodb-adapter needs this
    oidcProviderTable.addGlobalSecondaryIndex({
      indexName: 'type-index',
      partitionKey: { name: 'type', type: dynamodb.AttributeType.STRING },
    });
    // adding a GSI on "domain" because OIDC-provider needs this
    oidcProviderTable.addGlobalSecondaryIndex({
      indexName: 'domain-index',
      partitionKey: { name: 'domain', type: dynamodb.AttributeType.STRING },
    });

    // adding a GSI on "domain" because OIDC-provider needs this
    oidcProviderTable.addGlobalSecondaryIndex({
      indexName: 'type-tenant_id-index',
      partitionKey: { name: 'type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
    });

    // next up we will create a cognito user pool and client with adminSRP auth,
    // sneaking in a tenantid custom attribute.
    const federationCognitoUserpool = new cognito.UserPool(this, 'saas-op', {
      userPoolName: 'saas-op',
      customAttributes: {
        tenantid: new cognito.StringAttribute({ minLen: 5, maxLen: 36, mutable: true }),
      },

    });

    federationCognitoUserpool.addDomain('saas-op-domain', { cognitoDomain: { domainPrefix: props.cognitoUserPoolDomainPrefix || 'somefoo' } });

    // tenants dynamodb table
    // TODO change this from a static name to a ref
    const tenantsTable = new dynamodb.Table(this, 'tenants-table', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      tableName: 'tenants',
      removalPolicy: RemovalPolicy.DESTROY,

    });

    // adding a GSI on "domain" because OIDC-provider needs this
    tenantsTable.addGlobalSecondaryIndex({
      indexName: 'subdomain-index',
      partitionKey: { name: 'subdomain', type: dynamodb.AttributeType.STRING },
    });

    const createDefaultSettingsLambda = new nodejslambda.NodejsFunction(this, 'DefaultSettingsFunc', {
      entry: `${path.join(path.resolve(__dirname, '..', '..'), 'resources', 'add_default_features_lambda')}/handler.js`,
      handler: 'handler',
      timeout: Duration.seconds(900), // +acm validation wait of 530 seconds
      memorySize: 3008,
    });

    oidcProviderTable.grantReadWriteData(createDefaultSettingsLambda);

    const createBaseFeatures = new tasks.LambdaInvoke(this, 'Default Features Bootstrap', {
      lambdaFunction: createDefaultSettingsLambda,
      outputPath: '$.Payload',
    });

    const createBaseFeaturesStateMachineDefinition = createBaseFeatures;

    const createBaseFeaturesStateMachine = new sfn.StateMachine(this, 'createBaseFeaturesStateMachine', {
      definition: createBaseFeaturesStateMachineDefinition,
      timeout: Duration.minutes(5),
      stateMachineName: 'mysaasapp-hsi-createbasefeatures',
    });

    const oidcResource = new OidcResourceStack(this, 'oidc-resource', {
      clientSecret: 'not_needed_for_cognito_introspection',
      clientId: 'not_needed_for_cognito_introspection',
      introspectionUrl: 'not_needed_for_cognito_introspection',
      cognitoPoolId: federationCognitoUserpool.userPoolId,
    });

    const oidcClient = new OidcClientStack(this, 'oidc-client', {
      oidcResourceUrl: oidcResource.resourceUrl,
      tenantsTableName: 'tenants',
    });

    const tenantService = new TenantServiceStack(this, 'tenant-service', {
      oidcProviderTableName: 'oidc-provider',
      tenantsTableName: 'tenants',
      federationCognitoUserpool,
      hostedZoneId: props.hostedZoneId,
    });

    const ssmparamCognitoUserPoolId = new ssm.StringParameter(this, 'cognitoUserPoolId', {
      parameterName: '/mysaasapp/cognitoUserPoolId',
      stringValue: federationCognitoUserpool.userPoolId,
    });
    const ssmparamCognitoUserPoolRegion = new ssm.StringParameter(this, 'cognitoUserPoolRegion', {
      parameterName: '/mysaasapp/cognitoUserPoolRegion',
      stringValue: Stack.of(this).region,
    });
    const ssmparamBaseFeaturesStepFunctionArn = new ssm.StringParameter(this, 'baseFeaturesStepFunctionArn', {
      parameterName: '/mysaasapp/baseFeaturesStepFunctionArn',
      stringValue: createBaseFeaturesStateMachine.stateMachineArn,
    });
  }
}
