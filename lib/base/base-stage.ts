/* eslint-disable no-new */
/* eslint-disable import/no-unresolved */
/* eslint-disable import/extensions */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
import {
  Construct, Stage, StageProps,
} from '@aws-cdk/core';
import AwsSaasFactoryHybridIdentityStack from './base-stack';

interface AwsSaasFactoryHybridIdentityStageProps extends StageProps{
  hostedZoneId: string;
  cognitoUserPoolDomainPrefix: string;
}
/**
 * Deployable unit of web service app
 */
export default class AwsSaasFactoryHybridIdentityStage extends Stage {
  constructor(scope: Construct, id: string, props: AwsSaasFactoryHybridIdentityStageProps) {
    super(scope, id, props);

    new AwsSaasFactoryHybridIdentityStack(this, 'AwsSaasFactoryHybridIdentityBaseStack', { hostedZoneId: props.hostedZoneId, cognitoUserPoolDomainPrefix: props.cognitoUserPoolDomainPrefix });
  }
}
