#!/usr/bin/env node
/* eslint-disable no-new */
/* eslint-disable import/no-unresolved */
/* eslint-disable import/extensions */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import PipelineStack from '../lib/base/base-pipeline-stack';

const baseapp = new cdk.App();

/**
 * Base infrastructure for HSI is packaged as a self mutating CDK pipeline.
 * When deployed and run this Pipeline will in turn deploy the HSI base infrastructure.
 */
new PipelineStack(baseapp, 'HSI/Pipeline/Base', {
  env: { region: process.env.CDK_DEFAULT_REGION, account: process.env.CDK_DEFAULT_ACCOUNT },
  repoName: baseapp.node.tryGetContext('codecommitrepo'),
  hostedZoneId: baseapp.node.tryGetContext('hostedzoneid'),
  cognitoUserPoolDomainPrefix: baseapp.node.tryGetContext('cognitouserpooldomainprefix'),
});
