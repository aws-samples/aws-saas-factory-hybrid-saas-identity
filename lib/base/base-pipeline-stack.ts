/* eslint-disable import/no-unresolved */
/* eslint-disable import/extensions */
/* eslint-disable no-template-curly-in-string */
/* eslint-disable no-new */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codecommit from '@aws-cdk/aws-codecommit';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import {
  CodeCommitSourceAction, CodeBuildAction, StepFunctionInvokeAction,
} from '@aws-cdk/aws-codepipeline-actions';
import * as iam from '@aws-cdk/aws-iam';
import { App, Stack, StackProps } from '@aws-cdk/core';
import { CdkPipeline } from '@aws-cdk/pipelines';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as ssm from '@aws-cdk/aws-ssm';
import AwsSaasFactoryHybridIdentityStage from './base-stage';

export interface PipelineStackProps extends StackProps {
  readonly repoName: string,
  readonly hostedZoneId: string,
  readonly cognitoUserPoolDomainPrefix: string
}

export default class PipelineStack extends Stack {
  public readonly basePipeline: String;

  constructor(app: App, id: string, props: PipelineStackProps) {
    super(app, id, props);

    const code = codecommit.Repository.fromRepositoryName(this, 'ImportedRepo',
      props.repoName);
    new ssm.StringParameter(this, 'codecommitRepoName', {
      parameterName: '/mysaasapp/codecommitrepo',
      stringValue: props.repoName,
    });
    new ssm.StringParameter(this, 'hostedZoneId', {
      parameterName: '/mysaasapp/hostedzoneid',
      stringValue: props.hostedZoneId,
    });
    const sourceArtifact = new codepipeline.Artifact();
    const cloudAssemblyArtifact = new codepipeline.Artifact();

    const cdkBuild = new codebuild.PipelineProject(this, 'CdkBuild', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: ['chmod +x ./scripts/bootstrap/postinstall.sh', 'npm install --unsafe-perm'],
          },
          build: {
            commands: [
              'echo ${pipelineexecutionid}',
              'cognitouserpooldomainprefix=$(aws ssm get-parameter --name "/mysaasapp/cognitoUserPoolDomainPrefix" --query Parameter.Value --output text || true)',
              'if [[ ${cognitouserpooldomainprefix} == "" ]]; then echo "cognitoUserPoolDomainPrefix is empty" && cognitouserpooldomainprefix=${pipelineexecutionid} && aws ssm put-parameter --name "/mysaasapp/cognitoUserPoolDomainPrefix" --type "String" --value ${pipelineexecutionid}; else echo cognitoUserPoolDomainPrefix is "${cognitoUserPoolDomainPrefix}"; fi',
              'echo codecommitrepo is ${codecommitrepo}',
              'echo hostedzoneid is ${hostedzoneid}',
              'npm run build',
              'npm run cdk synth HSI--Pipeline--Base -- -a "npx ts-node bin/base_app.ts" -c codecommitrepo=${codecommitrepo} -c hostedzoneid=${hostedzoneid} -c cognitouserpooldomainprefix=${cognitouserpooldomainprefix} -o dist',
              'ls -lR dist',
            ],
          },
        },
        artifacts: {
          'base-directory': 'dist',
          files: [
            '**/*',
          ],
        },
        env: {
          'git-credential-helper': 'yes',
          'parameter-store': {
            codecommitrepo: '/mysaasapp/codecommitrepo',
            hostedzoneid: '/mysaasapp/hostedzoneid',
          },
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
        computeType: codebuild.ComputeType.MEDIUM,
        privileged: true,
      },
      environmentVariables:
      {
        CDK_DEFAULT_ACCOUNT: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: this.account,
        },
        CDK_DEFAULT_REGION: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: this.region,
        },
      },
    });
    cdkBuild.addToRolePolicy(new iam.PolicyStatement({
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/mysaasapp/*`],
      actions: ['ssm:GetParameter*', 'ssm:PutParameter*'],
    }));

    cdkBuild.addToRolePolicy(new iam.PolicyStatement({
      resources: [`arn:aws:codepipeline:${this.region}:${this.account}:Hybrid-SaaS-Identity*`],
      actions: ['codepipeline:GetPipelineState'],
    }));

    const pipeline = new CdkPipeline(this, 'Pipeline', {
      // The pipeline name
      pipelineName: 'Hybrid-SaaS-Identity_Base_CI-CD_pipeline',
      cloudAssemblyArtifact,

      // Where the source can be found
      sourceAction: new CodeCommitSourceAction({
        actionName: 'CodeCommit',
        branch: 'master',
        output: sourceArtifact,
        repository: code,
      }),

      // How it will be built and synthesized
      synthAction: new CodeBuildAction({
        actionName: 'CDK_Build',
        project: cdkBuild,
        input: sourceArtifact,
        outputs: [cloudAssemblyArtifact],
        environmentVariables: { pipelineexecutionid: { value: '#{codepipeline.PipelineExecutionId}' } },
      }),

    });

    const baseFeaturesStepFunctionArn = `arn:aws:states:${this.region}:${this.account}:stateMachine:mysaasapp-hsi-createbasefeatures`;
    const baseFeaturesStateMachine = sfn.StateMachine.fromStateMachineArn(this, 'baseFeaturesStateMachine', baseFeaturesStepFunctionArn);
    const baseFeaturesStateMachineInvokeAction1 = new StepFunctionInvokeAction({
      stateMachine: baseFeaturesStateMachine,
      stateMachineInput: { input: '{"oidcProviderDynamodbTable":"oidc-provider"}' },
      actionName: 'addBaseOidcProviderFeatures',
      runOrder: 100,
    });
    const hsiStage = new AwsSaasFactoryHybridIdentityStage(this, 'Dev', { env: { account: this.account, region: this.region }, hostedZoneId: props.hostedZoneId, cognitoUserPoolDomainPrefix: props.cognitoUserPoolDomainPrefix });
    const devstage = pipeline.addApplicationStage(hsiStage);
    devstage.addActions(baseFeaturesStateMachineInvokeAction1);
  }
}
