#!/usr/bin/env node
/* eslint-disable import/no-unresolved */
/* eslint-disable import/extensions */
/* eslint-disable no-console */
/* eslint-disable no-new */

import { App } from '@aws-cdk/core';

import OidcProviderStack from '../lib/tenant/oidc-provider-stack';
import { PipelineStack } from '../lib/tenant/oidc-provider-pipeline-stack';

const app = new App();

const vpcSubnets = { subnet1: app.node.tryGetContext('subnet1'), subnet2: app.node.tryGetContext('subnet2') };
const securityGroups = { securityGroup1: app.node.tryGetContext('securityGroup1'), securityGroup2: app.node.tryGetContext('securityGroup2') };
const lambdaStack = new OidcProviderStack(app, 'OidcProviderStack', {
  env: { region: process.env.CDK_DEFAULT_REGION, account: process.env.CDK_DEFAULT_ACCOUNT },
  dynamodbTableName: app.node.tryGetContext('dynamodbTableName'),
  cognitoUserpoolId: app.node.tryGetContext('cognitouserpoolid'),
  vpcid: app.node.tryGetContext('vpcid'),
  vpcSubnets,
  securityGroups,
  logLevel: app.node.tryGetContext('logLevel'),
  pipelineExecutionId: app.node.tryGetContext('pipelineexecutionid'),
  tenantuuid: app.node.tryGetContext('tenantuuid'),
});

/**
 * Tenant Specific oidc_provider infrastrcuture for HSI is packaged as a CodePipeline.
 * When deployed and run this Pipeline will in turn deploy the oidc_provider.
 */
new PipelineStack(app, 'HSI/Pipeline/OidcProvider', {
  env: { region: process.env.CDK_DEFAULT_REGION, account: process.env.CDK_DEFAULT_ACCOUNT },
  lambdaCode: lambdaStack.lambdaCode,
  repoName: app.node.tryGetContext('codecommitrepo'),
});

app.synth();
