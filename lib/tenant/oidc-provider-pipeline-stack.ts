/* eslint-disable no-template-curly-in-string */
/* eslint-disable no-new */
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codecommit from '@aws-cdk/aws-codecommit';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipelineActions from '@aws-cdk/aws-codepipeline-actions';
import * as lambda from '@aws-cdk/aws-lambda';
import {
  App, Stack, StackProps, Duration,
} from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as nodejslambda from '@aws-cdk/aws-lambda-nodejs';
import { CodeCommitTrigger } from '@aws-cdk/aws-codepipeline-actions';

const path = require('path');

export interface PipelineStackProps extends StackProps {
  readonly lambdaCode: lambda.CfnParametersCode;
  readonly repoName: string
}

export class PipelineStack extends Stack {
  constructor(app: App, id: string, props: PipelineStackProps) {
    super(app, id, props);

    const pipelineName = 'Hybrid-SaaS-Identity_OidcProvider_CI-CD_pipeline';

    const code = codecommit.Repository.fromRepositoryName(this, 'ImportedRepo',
      props.repoName);

    const cdkBuild = new codebuild.PipelineProject(this, 'CdkBuild', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: ['chmod +x ./scripts/bootstrap/postinstall.sh', 'npm install --unsafe-perm', 'yum install -y jq'],
          },
          build: {
            commands: [
              'echo About to retrieve pipeline execution id',
              "pipelineexecutionid=$(aws codepipeline get-pipeline-state --name ${CODEBUILD_INITIATOR#codepipeline/} --query 'stageStates[?actionStates[?latestExecution.externalExecutionId==`'${CODEBUILD_BUILD_ID}'`]].latestExecution.pipelineExecutionId' --output text)",
              'echo pipelineexecutionid is ${pipelineexecutionid}',
              'dynamodbtablename=$(aws ssm get-parameter --name "/mysaasapp/${pipelineexecutionid}/dynamodbtablename" --output text --query Parameter.Value || "oidc-provider")',
              'echo dynamodbtablename is ${dynamodbtablename}',
              'loglevel=$(aws ssm get-parameter --name "/mysaasapp/${pipelineexecutionid}/loglevel" --output text --query Parameter.Value || "ERROR")',
              'echo loglevel is ${loglevel}',
              'tenantuuid=$(aws ssm get-parameter --name "/mysaasapp/${pipelineexecutionid}/tenantuuid" --output text --query Parameter.Value)',
              'echo tenantuuid is ${tenantuuid}',
              'vpcid=$(aws ssm get-parameter --name "/mysaasapp/${pipelineexecutionid}/vpcid" --output text --query Parameter.Value || true)',
              'echo vpcid is ${vpcid}',
              'subnet1=$(aws ssm get-parameter --name "/mysaasapp/${pipelineexecutionid}/subnet1" --output text --query Parameter.Value || true)',
              'echo subnet1 is ${subnet1}',
              'subnet2=$(aws ssm get-parameter --name "/mysaasapp/${pipelineexecutionid}/subnet2" --output text --query Parameter.Value || true)',
              'echo subnet2 is ${subnet2}',
              'securitygroup1=$(aws ssm get-parameter --name "/mysaasapp/${pipelineexecutionid}/securityGroup1" --output text --query Parameter.Value || true)',
              'echo securitygroup1 is ${securitygroup1}',
              'securitygroup2=$(aws ssm get-parameter --name "/mysaasapp/${pipelineexecutionid}/securityGroup2" --output text --query Parameter.Value || true)',
              'echo securitygroup2 is ${securitygroup2}',
              'npm run build',
              'if [[ ${vpcid} == "" ]]; then echo "Going to synth a non VPC oidc-provider" && npm run cdk synth HSI--Pipeline--OidcProvider -- -a "npx ts-node bin/oidcproviderpipeline.ts" -c tenantuuid=${tenantuuid} -c codecommitrepo=${codecommitrepo} -c dynamodbTableName=${dynamodbtablename} -c logLevel=${loglevel} -c pipelineexecutionid=${pipelineexecutionid} -o dist; fi',
              'if [[ ${vpcid} != "" ]]; then echo "Going to synth a VPC oidc-provider" && npm run cdk synth HSI--Pipeline--OidcProvider -- -a "npx ts-node bin/oidcproviderpipeline.ts" -c tenantuuid=${tenantuuid} -c subnet1=${subnet1} -c subnet2=${subnet2} -c securityGroup1=${securitygroup1} -c securityGroup2=${securitygroup2} -c dynamodbTableName=${dynamodbtablename} -c vpcid=${vpcid} -c logLevel=${loglevel} -c pipelineexecutionid=${pipelineexecutionid} -o dist; fi',
              'ls -lR dist',
            ],
          },
        },
        artifacts: {
          'base-directory': 'dist',
          files: [
            'OidcProviderStack.template.json',
          ],
        },
        env: {
          'git-credential-helper': 'yes',
          'parameter-store': {
            codecommitrepo: '/mysaasapp/codecommitrepo',

          },
          'exported-variables': ['tenantuuid'],
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
      actions: ['ssm:GetParameter*'],
    }));

    cdkBuild.addToRolePolicy(new iam.PolicyStatement({
      resources: [`arn:aws:codepipeline:${this.region}:${this.account}:${pipelineName}`],
      actions: ['codepipeline:GetPipelineState'],
    }));

    const lambdaBuild = new codebuild.PipelineProject(this, 'LambdaBuild', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'cd resources/oidc-provider',
              'npm install',
            ],
          },
        },
        artifacts: {
          'base-directory': 'resources/oidc-provider',
          files: [
            '**/*',
          ],
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_2_0,
      },
    });

    const sourceOutput = new codepipeline.Artifact();
    const cdkBuildOutput = new codepipeline.Artifact('CdkBuildOutput');
    const lambdaBuildOutput = new codepipeline.Artifact('LambdaBuildOutput');
    const finishOidcProviderPipelineFn = new nodejslambda.NodejsFunction(this, 'FinishOidcProviderPipelineFunction', {
      entry: `${path.join(path.resolve(__dirname, '..', '..'), 'resources', 'finish_oidc_provider_pipeline_lambda')}/handler.js`,
      handler: 'handler',
      timeout: Duration.seconds(900), // +acm validation wait of 530 seconds
      memorySize: 3008,
    });
    // Tenant Federation Lambda Policy to insert/read tenant specific ssm parameters
    finishOidcProviderPipelineFn.addToRolePolicy(new iam.PolicyStatement({
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/mysaasapp/*`],
      actions: ['ssm:GetParameter*', 'ssm:PutParameter*'],
    }));
    // Tenant Federation Lambda Policy to start oidcprovider codepipeline
    finishOidcProviderPipelineFn.addToRolePolicy(new iam.PolicyStatement({
      resources: [`arn:aws:states:${this.region}:${this.account}:stateMachine:*TenantFederationStateMachine*`],
      actions: ['states:SendTaskSuccess'],
    }));

    finishOidcProviderPipelineFn.addToRolePolicy(new iam.PolicyStatement({
      resources: [`arn:aws:codepipeline:${this.region}:${this.account}:${pipelineName}`],
      actions: ['codepipeline:PutJob*'],
    }));

    const sourceAction = new codepipelineActions.CodeCommitSourceAction({
      actionName: 'CodeCommit_Source',
      repository: code,
      branch: 'main',
      output: sourceOutput,
      trigger: CodeCommitTrigger.NONE,
    });
    const lambdaBuildAction = new codepipelineActions.CodeBuildAction({
      actionName: 'Lambda_Build',
      project: lambdaBuild,
      input: sourceOutput,
      outputs: [lambdaBuildOutput],
    });
    const cdkBuildAction = new codepipelineActions.CodeBuildAction({
      actionName: 'CDK_Build',
      variablesNamespace: 'cdkbuild',
      project: cdkBuild,
      input: sourceOutput,
      outputs: [cdkBuildOutput],
    });
    const oidcProviderPipelineDeployActionRole = new iam.Role(this, 'oidcProviderPipelineDeployActionRole', { assumedBy: new iam.ServicePrincipal('cloudformation.amazonaws.com') });
    oidcProviderPipelineDeployActionRole.addToPolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: ['*'],
    }));
    const oidcProviderPipelineActionRole = new iam.Role(this, 'oidcProviderPipelineActionRole', { assumedBy: new iam.AccountPrincipal(this.account) });
    oidcProviderPipelineActionRole.addToPolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: ['*'],
    }));
    const oidcProviderDeployAction = new codepipelineActions.CloudFormationCreateUpdateStackAction({
      actionName: 'Oidc_Provider_CFN_Deploy',
      role: oidcProviderPipelineActionRole,
      deploymentRole: oidcProviderPipelineDeployActionRole,
      templatePath: cdkBuildOutput.atPath('OidcProviderStack.template.json'),
      stackName: `OidcProviderDeploymentStack-${cdkBuildAction.variable('tenantuuid')}`,
      adminPermissions: true,
      parameterOverrides: {
        ...props.lambdaCode.assign(lambdaBuildOutput.s3Location),
      },
      extraInputs: [lambdaBuildOutput],
    });
    const comopletionLambdaInvokeAction = new codepipelineActions.LambdaInvokeAction({
      actionName: 'InvokeAction',
      userParameters: {
      // Parameters for the lambda function
        executionid: '#{codepipeline.PipelineExecutionId}',
      },
      lambda: finishOidcProviderPipelineFn,
    });
    const pipe = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName,
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Build',
          actions: [lambdaBuildAction, cdkBuildAction],
        },
        {
          stageName: 'Deploy',
          actions: [oidcProviderDeployAction],
        },
        {
          stageName: 'InvokeLambda',
          actions: [comopletionLambdaInvokeAction],
        },
      ],
    });
    pipe.addToRolePolicy(new iam.PolicyStatement({
      resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/OidcProviderDeploymentStack*`],
      actions: ['cloudformation:*'],
    }));
    oidcProviderDeployAction.addToDeploymentRolePolicy(new iam.PolicyStatement({
      resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/OidcProviderDeploymentStack*`],
      actions: ['cloudformation:*'],
    }));
    pipe.artifactBucket.grantRead(oidcProviderPipelineDeployActionRole);
    comopletionLambdaInvokeAction.actionProperties.role?.attachInlinePolicy(new iam.Policy(this, 'somefoo', {
      statements: [
        new iam.PolicyStatement({
          resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/*`],
          actions: ['ssm:GetParameter*', 'ssm:PutParameter*'],
        }),
        new iam.PolicyStatement({
          resources: [`arn:aws:states:${this.region}:${this.account}:stateMachine:*TenantFederationStateMachine*`],
          actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
        }),
        new iam.PolicyStatement({
          resources: [`arn:aws:codepipeline:${this.region}:${this.account}:${pipelineName}`],
          actions: ['codepipeline:PutJob*'],
        }),
      ],
    }));
  }
}
