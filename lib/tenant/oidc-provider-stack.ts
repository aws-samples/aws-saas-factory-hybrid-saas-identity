/* eslint-disable max-len */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-unused-vars */
/* eslint-disable no-new */
import * as cdk from '@aws-cdk/core';
import * as apigateway from '@aws-cdk/aws-apigateway';
import * as lambda from '@aws-cdk/aws-lambda';
import * as iam from '@aws-cdk/aws-iam';
import * as nodejslambda from '@aws-cdk/aws-lambda-nodejs';
import {
  Vpc, SubnetSelection, IVpc, SubnetType, Subnet, SecurityGroup,
} from '@aws-cdk/aws-ec2';
import * as ssm from '@aws-cdk/aws-ssm';

const path = require('path');

const layerArn = `arn:aws:lambda:${process.env.AWS_DEFAULT_REGION}:580247275435:layer:LambdaInsightsExtension:2`;

// takes in one param ddb table name
interface OidcProviderStackProps extends cdk.StackProps {
  dynamodbTableName: string;
  cognitoUserpoolId?: string;
  vpcid?: string
  vpcSubnets?: {subnet1?: string, subnet2?: string}
  securityGroups?: {securityGroup1?: string, securityGroup2?: string}
  logLevel: string
  pipelineExecutionId?: string
  tenantuuid?: string
}

export default class OidcProviderStack extends cdk.Stack {
  // exports out the oidc auth url
  public readonly authUrl :string ;

  public readonly tokenUrl :string ;

  public readonly introspectionUrl :string ;

  public readonly url :string ;

  public readonly lambdaCode: lambda.CfnParametersCode;

  constructor(scope: cdk.Construct, id: string, props: OidcProviderStackProps) {
    super(scope, id, props);
    let vpc;

    if (props.vpcid) {
      vpc = Vpc.fromLookup(this, 'vpc', { vpcId: props.vpcid });
    }

    const layer = lambda.LayerVersion.fromLayerVersionArn(this, 'LayerFromArn', layerArn);

    let vpcSubnets;
    const vpcSubnetSelection = [];
    if (props.vpcSubnets!.subnet1) vpcSubnetSelection.push(Subnet.fromSubnetId(this, 'subnet1', props.vpcSubnets!.subnet1));
    if (props.vpcSubnets!.subnet2) vpcSubnetSelection.push(Subnet.fromSubnetId(this, 'subnet2', props.vpcSubnets!.subnet2));
    if (vpcSubnetSelection.length === 0) {
      vpcSubnets = { subnetType: SubnetType.PRIVATE, onePerAz: true };
    } else {
      vpcSubnets = { subnets: vpcSubnetSelection };
    }
    const vpcSecurityGroupSelection = [];
    if (props.securityGroups!.securityGroup1) vpcSecurityGroupSelection.push(SecurityGroup.fromSecurityGroupId(this, 'securitygroup1', props.securityGroups!.securityGroup1));
    if (props.securityGroups!.securityGroup2) vpcSecurityGroupSelection.push(SecurityGroup.fromSecurityGroupId(this, 'securitygroup2', props.securityGroups!.securityGroup2));
    this.lambdaCode = lambda.Code.fromCfnParameters();
    const providerFn = new lambda.Function(this, 'oidc-provider-function', {
      code: this.lambdaCode,
      handler: 'handler.oidc',
      timeout: cdk.Duration.seconds(900), // +acm validation wait of 530 seconds
      memorySize: 3008,
      environment: {
        DEBUG: 'oidc-provider:*',
        AWS_DYNAMODB_TABLE_NAME: props.dynamodbTableName,
        LOG_LEVEL: props.logLevel,
      },
      vpcSubnets,
      vpc,
      securityGroups: vpcSecurityGroupSelection,
      layers: [layer],
      runtime: lambda.Runtime.NODEJS_12_X,
    });

    providerFn.addToRolePolicy(new iam.PolicyStatement({
      resources: [`arn:aws:dynamodb:*:*:table/${props.dynamodbTableName}`],
      actions: ['*'],
    }));
    providerFn.addToRolePolicy(new iam.PolicyStatement({
      resources: [`arn:aws:dynamodb:*:*:table/${props.dynamodbTableName}/index/type-index`],
      actions: ['*'],
    }));
    providerFn.addToRolePolicy(new iam.PolicyStatement({
      resources: [`arn:aws:dynamodb:*:*:table/${props.dynamodbTableName}/index/domain-index`],
      actions: ['*'],
    }));
    providerFn.addToRolePolicy(new iam.PolicyStatement({
      resources: [`arn:aws:dynamodb:*:*:table/${props.dynamodbTableName}/index/type-tenant_id-index`],
      actions: ['*'],
    }));

    providerFn.addToRolePolicy(new iam.PolicyStatement({
      resources: ['arn:aws:secretsmanager:*:*:secret:/mysaasapp/*'],
      actions: ['*'],
    }));

    providerFn.addToRolePolicy(new iam.PolicyStatement({
      resources: ['arn:aws:kms:*:*:alias:aws/secretsmanager'],
      actions: ['*'],
    }));

    providerFn.addToRolePolicy(new iam.PolicyStatement({
      resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`],
      actions: ['cognito-idp:AdminInitiateAuth', 'cognito-idp:ListUsers'],
    }));

    const api = new apigateway.RestApi(this, 'oidc-provider-api', {
      restApiName: 'oidc-provider-api',
      description: 'oidc provider api',
    });
    const proxy = api.root.addProxy({
      defaultIntegration: new apigateway.LambdaIntegration(providerFn),

      // "false" will require explicitly adding methods on the `proxy` resource
      anyMethod: true, // "true" is the default
    });

    /**
     *
     * Add the oidcprovider url to ssm parameter,
     * after checking if the invocation was with a VPC or not
     * There should ideally be only a single oidc-provider non-vpc function
     * And that singleton logic for non-vpc is handled in the caller of this stack.
     */
    const oidcProviderUrlParamName = props.vpcid ? `/mysaasapp/${props.pipelineExecutionId}/oidcProviderEndPoint` : '/mysaasapp/oidcProviderEndPoint';
    new ssm.StringParameter(this, 'oidcProviderEndPoint', {
      parameterName: oidcProviderUrlParamName,
      stringValue: api.url,
    });

    this.url = api.url;
    this.authUrl = `${api.url}auth`;
    this.tokenUrl = `${api.url}token`;
    this.introspectionUrl = `${api.url}token/introspection`;
  }
}
