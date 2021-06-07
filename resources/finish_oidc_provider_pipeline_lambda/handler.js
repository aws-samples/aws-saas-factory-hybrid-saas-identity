/* eslint-disable max-len */
/* eslint-disable no-console */
/* eslint-disable func-names */
/* eslint-disable no-async-promise-executor */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT

const AWS = require('aws-sdk');

const ssm = new AWS.SSM();

const codepipeline = new AWS.CodePipeline();
const stepfunctions = new AWS.StepFunctions();

/**
 *
 * Funtion that creates tenant specific infrastructure by establishing a tenantuuid,
 * adding that to the tenant DB, and then kicking off codepipeline that creates
 * the services defined in tenant onboarding stack
 * @param {*} event
 * @param {*} context
 * @param {*} callback
 * @param {*} body.tenantId
 * @param {*} body.tenantEmailDomain

 */

const putJobSuccess = function (jobId) {
  const jobSuccessparams = {
    jobId,
    outputVariables: {
      testRunId: Math.floor(Math.random() * 1000).toString(),
      dateTime: Date(Date.now()).toString(),
    },
  };
  console.log('going to put job success result for codepipeline', JSON.stringify(jobSuccessparams));
  return codepipeline.putJobSuccessResult(jobSuccessparams).promise();
};

// Notify AWS CodePipeline of a failed job
const putJobFailure = function (message, jobId) {
  const jobFailureparams = {
    jobId,
    failureDetails: {
      message: JSON.stringify(message),
      type: 'JobFailed',
    },
  };
  console.log('going to put job failure result for codepipeline', JSON.stringify(jobFailureparams));
  return codepipeline.putJobFailureResult(jobFailureparams).promise();
};
async function getTenantParamsFromSsm(pipelineExecutionId) {
  const params = {
    Names: [ /* required */
      `/mysaasapp/${pipelineExecutionId}/tenantuuid`,
      `/mysaasapp/${pipelineExecutionId}/token`,
      `/mysaasapp/${pipelineExecutionId}/oidcProviderEndPoint`,
    ],

  };
  return ssm.getParameters(params).promise();
}
function getParameterValue(parameterName, params) {
  console.log(`received params ${params}`);
  console.log(`going to search for ${parameterName}`);
  const paramValue = params.Parameters.find((param) => param.Name.endsWith(`${parameterName}`));
  console.log('going to send', paramValue.Value);
  return paramValue.Value;
}
const sendResult = function (pipelineExecutionId, taskToken) {
  // send token back to sfn
  const params = {
    output: JSON.stringify({ pipelineExecutionId }),
    taskToken,
  };
  console.log(`Calling Step Functions to complete callback task with params ${JSON.stringify(params)}`);

  return stepfunctions.sendTaskSuccess(params).promise();
};
exports.handler = async function (event, context) {
  let jobId;
  try {
    // Retrieve the Job ID from the Lambda action
    jobId = event['CodePipeline.job'].id;

    // Retrieve the value of UserParameters from the Lambda action configuration in AWS CodePipeline,
    // in this case it is the Commit ID of the latest change of the pipeline.
    const pipelineExecutionId = JSON.parse(event['CodePipeline.job'].data.actionConfiguration.configuration.UserParameters).executionid;

    // Get Step Funcion token using the executionid
    // const tokenParamResponse = await ssm.getParameter({ Name: `/mysaasapp/${pipelineExecutionId}/token` }).promise();
    const tenantParams = await getTenantParamsFromSsm(pipelineExecutionId);
    console.log('token parameter response', tenantParams);
    const token = getParameterValue('token', tenantParams);
    // Notify StepFunction and AWS CodePipeline of a successful job

    await sendResult(pipelineExecutionId, token);
    console.log('Done sending result to step function');
    await putJobSuccess(jobId);
    console.log('Done marking Code Pipeline job as success');
    context.succeed('success');
  } catch (err) {
    console.log('Error occured!!', JSON.stringify(err));
    await putJobFailure(err, jobId);
    context.fail(err);
  }
};
