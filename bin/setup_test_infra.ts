#!/usr/bin/env node
/* eslint-disable no-new */
/* eslint-disable import/no-unresolved */
/* eslint-disable import/extensions */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
import 'source-map-support/register';
import {
  Stack, StackProps, App, CfnOutput,
} from '@aws-cdk/core';
import SimpleAdStack from '../lib/test/simple-ad';
import CognitoTestStack from '../lib/test/cognito-userpools';

/**
 * Base infrastructure for HSI is packaged as a self mutating CDK pipeline.
 * When deployed and run this Pipeline will in turn deploy the HSI base infrastructure.
 */
const testInfraApp = new App();

class TestStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);
    const simpleAd = new SimpleAdStack(this, 'SimpleADStack', {
      env: { region: process.env.CDK_DEFAULT_REGION, account: process.env.CDK_DEFAULT_ACCOUNT },
      stackName: 'SimpleADStack',
    });
    const cognitoTestPools = new CognitoTestStack(this, 'CognitoTestStack', {
      env: { region: process.env.CDK_DEFAULT_REGION, account: process.env.CDK_DEFAULT_ACCOUNT },
      stackName: 'CognitoTestStack',
    });
    new CfnOutput(this, 'Tenant-1-User-Pool-ID', { value: cognitoTestPools.userPoolId1 });
    new CfnOutput(this, 'Tenant-2-User-Pool-ID', { value: cognitoTestPools.userPoolId2 });
    new CfnOutput(this, 'Tenant-1-User-Pool-Region', { value: cognitoTestPools.userPool1Region });
    new CfnOutput(this, 'Tenant-2-User-Pool-Region', { value: cognitoTestPools.userPool2Region });
    new CfnOutput(this, 'Tenant-1-User-Pool-Client-ID', { value: cognitoTestPools.userPoolClientId1 });
    new CfnOutput(this, 'Tenant-2-User-Pool-Client-ID', { value: cognitoTestPools.userPoolClientId2 });
    new CfnOutput(this, 'VPC ID', { value: simpleAd.vpcId });
    new CfnOutput(this, 'Subnet-1 ID', { value: simpleAd.subnetId1 });
    new CfnOutput(this, 'Subnet-2 ID', { value: simpleAd.subnetId2 });
    new CfnOutput(this, 'lambda-security-group-1 ID', { value: simpleAd.securityGroupId1 });
    new CfnOutput(this, 'lambda-security-group-2 ID', { value: simpleAd.securityGroupId2 });
    new CfnOutput(this, 'testusergrouplambdaname', { value: simpleAd.testusergrouplambdaname });
  }
}

new TestStack(testInfraApp, 'TestStackApp', {
  env: { region: process.env.CDK_DEFAULT_REGION, account: process.env.CDK_DEFAULT_ACCOUNT },
});
testInfraApp.synth();
