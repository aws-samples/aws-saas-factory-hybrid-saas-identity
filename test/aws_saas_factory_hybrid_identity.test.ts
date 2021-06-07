/* eslint-disable no-undef */
/* eslint-disable import/no-unresolved */
/* eslint-disable import/extensions */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import AwsSaasFactoryHybridIdentityStack from '../lib/base/base-stack';

test('Empty Stack', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new AwsSaasFactoryHybridIdentityStack(app, 'MyTestStack', { hostedZoneId: '123', cognitoUserPoolDomainPrefix: '123' });
  // THEN
  expectCDK(stack).to(matchTemplate({
    Resources: {},
  }, MatchStyle.EXACT));
});

/*
        // Step-1
        const tenant_userpool = new cognito.UserPool(this, tenantId+'_userpool', {
            userPoolName: tenantId+'-auth-provider',
            standardAttributes: {
            fullname: {
                required: true,
                mutable: false,
            },
            address: {
                required: false,
                mutable: true,
            },
            email: {
                required: false,
                mutable: true,
            },
            profilePicture: {
                required: false,
                mutable: true,
            },
            givenName: {
                required: false,
                mutable: true,
            }
            },
            customAttributes: {
            'tenantid': new cognito.StringAttribute({ minLen: 5, maxLen: 15, mutable: false }),
            },
        });
        // Step-2
        const tenant_app_client = tenant_userpool.addClient(tenantId+'_app_client', {
            generateSecret: true,
            userPoolClientName: "oidc-provider",
            preventUserExistenceErrors: true,
            supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
            authFlows: {
            adminUserPassword: true
            },

        });

        new ssm.StringParameter(this, 'tenant_backend_app_client', {
            parameterName: '/mysaasapp/'+tenantId+'/tenant_backend_app_client',
            stringValue: tenant_app_client.userPoolClientId
        });
        new ssm.StringParameter(this, 'tenant_backend_userpool', {
            parameterName: '/mysaasapp/'+tenantId+'/tenant_backend_userpool',
            stringValue: tenant_userpool.userPoolId
        });
        this.tenantBackendCognitoUserPoolAppClientId = tenant_app_client.userPoolClientId
*/
