/* eslint-disable max-len */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-unused-vars */
/* eslint-disable no-new */
import {
  Construct, Stack, StackProps, CfnOutput,
} from '@aws-cdk/core';
import {
  UserPool, UserPoolClient, CfnUserPoolUser, UserPoolDomain,
} from '@aws-cdk/aws-cognito';

export default class CognitoTestStack extends Stack {
  public readonly userPoolId1: string;

  public readonly userPoolId2: string;

  public readonly userPoolClientId1: string;

  public readonly userPool1Region: string;

  public readonly userPoolClientId2: string;

  public readonly userPool2Region: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const up1 = new UserPool(this, 'tenant-1-userpool', {
      userPoolName: 'tenant-1-userpool',
      userInvitation: {
        emailSubject: 'Hybrid SaaS Identity Test Cognito UserPool-1 user invitation',
        emailBody: 'please use this username: {username} and password: {####} to log in to your userpool and reset the password',
      },
    });
    const upc1 = new UserPoolClient(this, 'tenant-1-userpool-client', { userPool: up1, authFlows: { adminUserPassword: true } });

    const up2 = new UserPool(this, 'tenant-2-userpool', {
      userPoolName: 'tenant-2-userpool',
      userInvitation: {
        emailSubject: 'Hybrid SaaS Identity Test Cognito UserPool-2 user invitation',
        emailBody: 'please use this username: {username} and password: {####} to log in to your userpool and reset the password',
      },
    });
    const upc2 = new UserPoolClient(this, 'tenant-2-userpool-client', { userPool: up2, authFlows: { adminUserPassword: true } });

    this.userPoolId1 = up1.userPoolId;
    this.userPool1Region = this.region;
    this.userPoolId2 = up2.userPoolId;
    this.userPool2Region = this.region;
    this.userPoolClientId1 = upc1.userPoolClientId;
    this.userPoolClientId2 = upc2.userPoolClientId;
  }
}
