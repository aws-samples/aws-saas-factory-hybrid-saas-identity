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
async function getSSMParameter(name) {
  try {
    const resp = await ssm.getParameter({ Name: name }).promise();
    return resp.Parameter;
  } catch (err) {
    return { Name: name, Value: null };
  }
}
async function getBaseParamsFromSsm() {
  const params = {
    Names: [ /* required */
      '/mysaasapp/oidcProviderEndPoint',
      '/mysaasapp/cognitoUserPoolId',
      '/mysaasapp/cognitoUserPoolRegion',
      '/mysaasapp/cognitoUserPoolDomainPrefix',
      '/mysaasapp/oidcClientEndPoint',
    ],

  };
  const response = [];
  await Promise.all(params.Names.map(async (name) => {
    const data = await getSSMParameter(name);
    response.push(data);
  }));
  return { Parameters: response };
}
function getParameterValue(parameterName, params) {
  console.log(`received params ${JSON.stringify(params)}`);
  console.log(`going to search for ${parameterName}`);
  const paramValue = params.Parameters.find((param) => param.Name.endsWith(`${parameterName}`));
  console.log('going to send', paramValue.Value);
  return paramValue.Value;
}
function putParameterValue(Name, Value, tenantId) {
  const params = {
    Name: `/mysaasapp/${tenantId}/${Name}`,
    Value,
    DataType: 'text',
    Description: `${tenantId} ${Name}`,
    Tier: 'Standard',
    Type: 'String',
  };
  return ssm.putParameter(params).promise();
}

async function startOidcProviderPipeline() {
  return codepipeline.startPipelineExecution({ name: 'Hybrid-SaaS-Identity_OidcProvider_CI-CD_pipeline' }).promise();
}

async function putPipelineParametersInSsm(pipelineExecutionId, body, token, tenantuuid) {
  /*
  The below parameters are written to ssm parameter store for the codepipeline execution
  created above.code build step will read these values to infer the tenant for which it
  is building and synthesizing. pipelineExecutionId is the only unique identifier that
  codebuild has available at runtime in the container. that is the reason why we are
  using it to record the tenant details.
  */
  console.log('Pipeline execution ID is', pipelineExecutionId);
  console.log('Input body is', body);
  const promises = [];
  promises.push(putParameterValue('dynamodbtablename', 'dynamodbTableName' in body ? body.dynamodbTableName : 'oidc-provider', pipelineExecutionId));
  promises.push(putParameterValue('loglevel', 'logLevel' in body ? body.logLevel : 'ERROR', pipelineExecutionId));
  promises.push(putParameterValue('token', token, pipelineExecutionId));
  promises.push(putParameterValue('tenantuuid', tenantuuid, pipelineExecutionId));

  if (body.vpcConfig) {
    promises.push(putParameterValue('subnet1', body.vpcConfig.subnetIds[0], pipelineExecutionId));
    promises.push(putParameterValue('subnet2', body.vpcConfig.subnetIds[1], pipelineExecutionId));
    promises.push(putParameterValue('securityGroup1', body.vpcConfig.securityGroupIds[0], pipelineExecutionId));
    promises.push(putParameterValue('securityGroup2', body.vpcConfig.securityGroupIds[1], pipelineExecutionId));
    promises.push(putParameterValue('vpcid', body.vpcConfig.vpcId, pipelineExecutionId));
  }
  return Promise.all(promises);
}
const sendResult = function (taskToken, error, output) {
  // send token back to sfn
  if (!error) {
    const params = {
      output: JSON.stringify(output),
      taskToken,
    };
    console.log(`Calling Step Functions to complete callback task with params ${JSON.stringify(params)}`);

    return stepfunctions.sendTaskSuccess(params).promise();
  }
  const params = {
    cause: output,
    error,
    taskToken,
  };
  console.log(`Calling Step Functions to complete callback task with params ${JSON.stringify(params)}`);

  return stepfunctions.sendTaskFailure(params).promise();
};
exports.handler = async function (event) {
  console.log(`received event ${JSON.stringify(event)}`);

  if (!event.input || event.input === '') {
    return { statusCode: 400, body: 'Tenant Federation is a POST operation, expects a JSON body' };
  }

  const { input: { body, body: { tenantIDPType }, tenantuuid }, token } = event;

  if (!tenantIDPType || tenantIDPType === '' || (tenantIDPType !== 'ldap' && tenantIDPType !== 'cognito')) {
    return { statusCode: 400, body: 'tenantIDPType is mandatory and has to be either LDAP or COGNITO' };
  }

  console.log('Authorizer has sent the tenantuuid', tenantuuid);

  // check if the input payload is asking for a VPC specific affinity for the federation
  // if yes, then go ahead and create a tenant specific oidc-provider by executing further
  // if VPC is not included in the request, then check if a base/non-vpc oidc-provider is already provisioned below.
  // check if ssm param /mysaasapp/oidcproviderendpoint is already populated, if yes, then it means
  // that there is a non-vpc oidcproviderendpoint already provisioned, use that instead and skip
  // creating another one. skip calling startOidcProviderPipeline() below.

  if (!body.vpcConfig) {
    console.log('vpcConfig is not present in the input, going to check if there is already a non-vpc oidcprovider created');
    const baseParams = await getBaseParamsFromSsm();
    console.log(`baseParams are ${JSON.stringify(baseParams)}`);
    const oidcProviderEndPoint = getParameterValue('oidcProviderEndPoint', baseParams);
    if (oidcProviderEndPoint) {
      console.log('Found an existing oidcprovider, going to return to the step function now and skip the codepipeline');
      await sendResult(token, null, { message: 'Non VPC Oidc Provider already available' });
      console.log('Done sending result to step function');
      return { statusCode: 200, body: JSON.stringify({ provisioned: true, message: 'Non-VPC oidc-provider already availble' }) };
    }
  }

  try {
    const pipelineexecutionResponse = await startOidcProviderPipeline();
    console.log('Pipeline execution ID is', pipelineexecutionResponse.pipelineExecutionId);
    const putPipelineParamerersResponse = await putPipelineParametersInSsm(pipelineexecutionResponse.pipelineExecutionId, body, token, tenantuuid);
    console.log('Pipeline Parameters response is', putPipelineParamerersResponse);
    console.log('Tenant Federation success');
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Tenant Federation success', putPipelineParamerersResponse }),
    };
  } catch (error) {
    console.log('Tenant Federation failed', error);
    await sendResult(token, error.message, error.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Tenant boostrap failed', error }),
    };
  }
};
