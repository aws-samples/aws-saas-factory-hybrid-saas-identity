/* eslint-disable max-len */
/* eslint-disable no-console */
/* eslint-disable func-names */
/* eslint-disable no-async-promise-executor */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT

const AWS = require('aws-sdk');
const { JWKS: { KeyStore } } = require('jose');
const uuid = require('uuid');
const { getTenant } = require('./helpers/get_tenant');

const tenantSettings = require('./oidc-provider-tenant.json');
const tenantAppClient = require('./oidc-provider-app-client.json');

const secretsmanager = new AWS.SecretsManager();
const documentClient = new AWS.DynamoDB.DocumentClient();
const ssm = new AWS.SSM();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();

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
/*
  This Function should be called to add/update/retrieve federation for an already onboarded tenant.
  for an add operation, it executes these series of steps.
  1. Create and store Tenant Cookie signing key in secrets manager
  2. Create and store Tenant JWKS in secrets manager
  3. Create Cognito user pool identity provider.
  4. Update Cognito user pool app client to use the identity provider from #3.
  5. Add tenant record to oidc-provider table
  6. Add client record to oidc-provider table.
  7. Update tenant record in tenants table and set idp_identifier, this gets used in the SaaS client App.
  It requires the follow ssm params as pre-requisties from the onboarding step.
*/
async function secretExists(secretalias) {
  const exists = await secretsmanager.describeSecret({ SecretId: secretalias }).promise()
    .then((response) => { console.log(`describe secret response is: ${response}`); return true; })
    .catch((error) => {
      console.log(`Error in describing secret, ${secretalias}, ${JSON.stringify(error)}`);
      if (error.code === 'ResourceNotFoundException') {
        return false;
      }
      throw error;
    });
  return exists;
}

async function createCookieKeysAddToSecrets(tenantId) {
  console.log(`REQUEST RECEIVED:\n${JSON.stringify(tenantId)}`);
  let responseData; let
    responseStatus;
  try {
    console.log('Creating cookie keys as secret in AWS Secrets Manager...');

    const cookieKey1 = (await secretsmanager.getRandomPassword({
      PasswordLength: 86,
    }).promise()).RandomPassword;
    const cookieKey2 = (await secretsmanager.getRandomPassword({
      PasswordLength: 86,
    }).promise()).RandomPassword;

    const cookieSecretsParams = {
      Description: `Cookie keys for ${tenantId}`,
      Name: `/mysaasapp/${tenantId}/cookie-secrets`,
      SecretString: JSON.stringify([cookieKey1, cookieKey2]),
    };

    return secretsmanager.createSecret(cookieSecretsParams).promise()
      .then((secretResponse) => {
        responseData = {
          SecretArn: secretResponse.ARN,
          SecretName: secretResponse.Name,
          SecretVersionId: secretResponse.secretVersionId,

        };
        console.log(`Create secret response data: ${JSON.stringify(responseData)}`);
        responseStatus = 'SUCCESS';
        return (responseData);
      })
      .catch((err) => {
        responseStatus = 'FAILED';
        responseData = { Error: 'Creation of tenant cookie secret failed.' };
        console.log(`${responseData.Error}:\n`, err);
        return (responseStatus, responseData, err);
      });
  } catch (err) {
    console.log(err);
    throw err;
  }
}
async function createJwksAddToSecrets(tenantId) {
  return new Promise(async (resolve, reject) => {
    console.log(`REQUEST RECEIVED:\n${JSON.stringify(tenantId)}`);

    const keystore = new KeyStore();
    keystore.generateSync('EC', 'P-256');
    keystore.generateSync('EC', 'P-384');
    keystore.generateSync('EC', 'P-521');
    keystore.generateSync('RSA', 1024);

    let responseData; let
      responseStatus;
    try {
      console.log('Creating JWKS as secret in AWS Secrets Manager...');

      const params = {
        Description: `JWKS for ${tenantId}`,
        Name: `/mysaasapp/${tenantId}/jwks`,
        SecretString: JSON.stringify(keystore.toJWKS(true)),
      };

      const secretResponse = await secretsmanager.createSecret(params).promise();

      responseData = {
        SecretArn: secretResponse.ARN,
        SecretName: secretResponse.Name,
        SecretVersionId: secretResponse.secretVersionId,
      };
      console.log(`Create secret response data: ${JSON.stringify(responseData)}`);
      responseStatus = 'SUCCESS';
      resolve(responseData);
    } catch (err) {
      responseStatus = 'FAILED';
      responseData = { Error: 'Update of tenant jwks secret failed.' };
      console.log(`${responseData.Error}:\n`, err);
      reject(responseStatus, err);
    }
  });
}
async function ldapPasswordAddToSecrets(tenantId, password) {
  console.log(`REQUEST RECEIVED:\n${JSON.stringify(tenantId)}`);
  let responseData; let
    responseStatus;
  try {
    const ldapPasswordSecretsParams = {
      Description: `Cookie keys for ${tenantId}`,
      Name: `/mysaasapp/${tenantId}/ldapuserpassword`,
      SecretString: password,
    };

    return secretsmanager.createSecret(ldapPasswordSecretsParams).promise()
      .then((secretResponse) => {
        responseData = {
          SecretArn: secretResponse.ARN,
          SecretName: secretResponse.Name,
          SecretVersionId: secretResponse.secretVersionId,

        };
        console.log(`Create secret response data: ${JSON.stringify(responseData)}`);
        responseStatus = 'SUCCESS';
        return (responseData);
      })
      .catch((err) => {
        responseStatus = 'FAILED';
        responseData = { Error: 'Creation of ldap password as secret failed.' };
        console.log(`${responseData.Error}:\n`, err);
        return (responseStatus, responseData, err);
      });
  } catch (err) {
    console.log(err);
    throw err;
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
  return ssm.getParameters(params).promise();
}
async function getTenantParamsFromSsm(tenantId) {
  const params = {
    Names: [ /* required */
      `/mysaasapp/${tenantId}/tenantUuid`,
      `/mysaasapp/${tenantId}/tenantEmailDomain`,
      `/mysaasapp/${tenantId}/tenantOidcProviderAppClientUuid`,
      `/mysaasapp/${tenantId}/federationCognitoUserPoolAppClientId`,

    ],

  };
  return ssm.getParameters(params).promise();
}
async function getExecutionParamsFromSsm(pipelineExecutionId) {
  const params = {
    Names: [ /* required */
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
async function createCognitoIdentityProvider(baseParams, tenantParams, tenantId, clientSecret, oidcProviderEndPoint) {
  const tenantOidcProviderAppClientUuid = getParameterValue('tenantOidcProviderAppClientUuid', tenantParams);
  const tenantSpecificoidcProviderEndPoint = `${oidcProviderEndPoint}${tenantOidcProviderAppClientUuid}`;
  console.log(`retrieved params: ${tenantOidcProviderAppClientUuid}\n${oidcProviderEndPoint}\n${tenantSpecificoidcProviderEndPoint}`);
  const params = {
    ProviderDetails: { /* required */
      client_id: getParameterValue('tenantOidcProviderAppClientUuid', tenantParams),
      client_secret: clientSecret,
      attributes_request_method: 'GET',
      oidc_issuer: tenantSpecificoidcProviderEndPoint,
      authorize_url: `${tenantSpecificoidcProviderEndPoint}/auth`,
      token_url: `${tenantSpecificoidcProviderEndPoint}/token`,
      attributes_url: `${tenantSpecificoidcProviderEndPoint}/me`,
      jwks_uri: `${tenantSpecificoidcProviderEndPoint}/jwks`,
      authorize_scopes: 'openid profile email tenant',
    },
    ProviderName: tenantId, /* required */
    ProviderType: 'OIDC', /* required */
    UserPoolId: getParameterValue('cognitoUserPoolId', baseParams), /* required */
    AttributeMapping: {
      username: 'sub',
      email_verified: 'email_verified',
      'custom:tenantid': 'tenantid',
      email: 'email',
    },
    IdpIdentifiers: [tenantId],
  };
  console.log(`About to create cognito user pool identity provider ${tenantId}`);
  return cognitoidentityserviceprovider.createIdentityProvider(params).promise();
}
async function updateCognitoUserPoolClient(baseParams, tenantParams, tenantId) {
  const params = (await cognitoidentityserviceprovider.describeUserPoolClient({
    ClientId: getParameterValue('federationCognitoUserPoolAppClientId', tenantParams), /* required */
    UserPoolId: getParameterValue('cognitoUserPoolId', baseParams), /* required */
  }).promise()).UserPoolClient;
  params.SupportedIdentityProviders.push(tenantId);
  delete params.ClientSecret;
  delete params.LastModifiedDate;
  delete params.CreationDate;
  console.log(`About to update cognito user pool app client ${getParameterValue('federationCognitoUserPoolAppClientId', tenantParams)}`);
  return cognitoidentityserviceprovider.updateUserPoolClient(params).promise();
}
async function addTenantRecordToOidcProviderTable(baseParams, tenantParams, tenantId, payload, oidcProviderEndPoint) {
  if (payload.tenantIDPType.toUpperCase() === 'COGNITO') {
    tenantSettings.clientId = payload.cognitoConfig.userPoolClientId;
    tenantSettings.userPoolId = payload.cognitoConfig.userPoolId;
    tenantSettings.userPoolRegion = payload.cognitoConfig.userPoolRegion;
  } else {
    tenantSettings.ldapsuffix = payload.ldapConfig.ldapSuffix;
    tenantSettings.ldapurl = payload.ldapConfig.ldapUrl;
    tenantSettings.vpcConfig = payload.vpcConfig;
    tenantSettings.ldapuser = payload.ldapConfig.ldapUser;
    await ldapPasswordAddToSecrets(tenantId, payload.ldapConfig.ldapUserPassword);
    tenantSettings.ldapuserpassword = `/mysaasapp/${tenantId}/ldapuserpassword`;
  }
  tenantSettings.authtype = payload.tenantIDPType;
  tenantSettings.id = `tenant:${getParameterValue('tenantUuid', tenantParams)}`;
  tenantSettings.tenant_id = getParameterValue('tenantUuid', tenantParams);
  tenantSettings.tenantEmailDomain = getParameterValue('tenantEmailDomain', tenantParams);
  tenantSettings.domain = getParameterValue('tenantEmailDomain', tenantParams);
  tenantSettings.issure = oidcProviderEndPoint;
  tenantSettings.configuration.jwks = `/mysaasapp/${tenantId}/jwks`;
  tenantSettings.configuration.cookies.keys = `/mysaasapp/${tenantId}/cookie-secrets`;
  console.log('Done setting tenant settings', JSON.stringify(tenantSettings));

  const tenantSettingsParams = {
    TableName: 'oidc-provider',
    Item: tenantSettings,
  };
  console.log(`About to add tenant record to oidc-provider table tenant: ${getParameterValue('tenantUuid', tenantParams)}`);
  return documentClient.put(tenantSettingsParams).promise();
}
async function addTenantAppClientRecordToOidcProviderTable(baseParams, tenantParams, tenantId, clientSecret) {
  // setting tenant_app_client placeholders to values passed from the step function
  const tenantOidcProviderAppClientUuid = uuid.v4();
  const secretName = `/mysaasapp/${tenantId}/oidcappclientsecret`;

  const createSecretParams = {
    Name: secretName,
    Description: `App client secret for app ${tenantId}`,
    SecretString: clientSecret,
  };
  const secretResponse = await secretsmanager.createSecret(createSecretParams).promise();
  const responseData = {
    SecretArn: secretResponse.ARN,
    SecretName: secretResponse.Name,
    SecretVersionId: secretResponse.secretVersionId,
    clientSecret,
  };
  console.log(`Update secret response data: ${JSON.stringify(responseData)}`);

  console.log('About to add tenantOidcProviderAppClientUuid parmeter to ssm param store');

  const putParamResponseData = await putParameterValue('tenantOidcProviderAppClientUuid', tenantOidcProviderAppClientUuid, tenantId);

  console.log(`Done adding tenantOidcProviderAppClientUuid parmeter to ssm param store ${putParamResponseData}`);

  console.log('About to build oidc provider tenant app client record');
  tenantAppClient.id = `client:${tenantOidcProviderAppClientUuid}`;
  tenantAppClient.client_id = tenantOidcProviderAppClientUuid;
  tenantAppClient.client_secret = clientSecret;
  tenantAppClient.client_uri = `https://cognito-idp.${getParameterValue('cognitoUserPoolRegion', baseParams)}.amazonaws.com/${getParameterValue('cognitoUserPoolId', baseParams)}`;
  tenantAppClient.redirect_uris = [`https://${getParameterValue('cognitoUserPoolDomainPrefix', baseParams)}.auth.${getParameterValue('cognitoUserPoolRegion', baseParams)}.amazoncognito.com/oauth2/idpresponse`];
  tenantAppClient.tenant_id = getParameterValue('tenantUuid', tenantParams);
  console.log('Done setting tenant app settings', JSON.stringify(tenantAppClient));

  console.log('About to add oidc provider tenant app client record to DDB');
  const tenantAppClientParams = {
    TableName: 'oidc-provider',
    Item: tenantAppClient,
  };
  return documentClient.put(tenantAppClientParams).promise();
}
async function UpdateTenantRecordInTenantsTable(tenantParams, tenantId) {
  const tenantRecordParams = {
    TableName: 'tenants',
    Key: { id: getParameterValue('tenantUuid', tenantParams) },
    UpdateExpression: 'set cognito.idp_identifier = :r',
    ExpressionAttributeValues: {
      ':r': tenantId,
    },

  };
  console.log('About to update tenant record in tenants dynamodb table');
  return documentClient.update(tenantRecordParams).promise();
}

exports.handler = async function (event) {
  console.log(`received event ${JSON.stringify(event)}`);

  if (!event.body || event.body === '') {
    return { statusCode: 400, body: 'Tenant Federation is a POST operation, expects a JSON body' };
  }

  const {
    body, body: { tenantIDPType }, tenantuuid, taskresult: { pipelineExecutionId },
  } = event;

  if (!tenantIDPType || tenantIDPType === '' || (tenantIDPType.toUpperCase() !== 'LDAP' && tenantIDPType.toUpperCase() !== 'COGNITO')) {
    return { statusCode: 400, body: 'tenantIDPType is mandatory and has to be either LDAP or COGNITO' };
  }

  console.log('Authorizer has sent the tenantuuid', tenantuuid);

  // retrieve tenant record and get tenantID
  console.debug(`about to get tenant record for tenantUUID: ${tenantuuid}`);
  const { subdomain: tenantId } = await getTenant(tenantuuid);
  console.debug(`tenant-id is ${tenantId}`);

  const clientSecret = (await secretsmanager.getRandomPassword({
    PasswordLength: 86,
  }).promise()).RandomPassword;

  let oidcProviderEndPoint;
  if (!body.vpcConfig) {
    console.log('Did not find vpcConfig, going to search for base oidcProviderEndPoint');
    const baseParams = await getBaseParamsFromSsm();
    oidcProviderEndPoint = getParameterValue('oidcProviderEndPoint', baseParams);
  } else {
    console.log('Found vpcConfig, going to search for execution specific oidcProviderEndPoint');
    const executionParams = await getExecutionParamsFromSsm(pipelineExecutionId);
    oidcProviderEndPoint = getParameterValue('oidcProviderEndPoint', executionParams);
  }

  const responses = await Promise.all([getBaseParamsFromSsm(), getTenantParamsFromSsm(tenantId)]);
  const baseParams = responses[0];
  console.log('base parameters retrieved from ssm parameter store: ', baseParams);
  let tenantParams;
  [, tenantParams] = responses;
  console.log('tenant parameters retrieved from ssm parameter store: ', tenantParams);

  // eslint-disable-next-line max-len
  // console.log('Federation Cognito User Pool ID is ', getParameterValue('cognitoUserPoolId', baseParams));

  /*
  check if the tenant was already bootstrapped for federation using tenant subdomain from the request
  and checking if there are secrets already created for federationclientsecret, cookie-secrets, jwks
  In future when there is a usecase to update the existing federation,
  then there might not be any value in checking existence of secrets beyond validating
  whether it is a true update vs insert operation.
  The ssm way of checking was introduced to support operations within a codepipeline,
  could be done by checking for existence of a tenant record in the oidc-provider table as well,
  if run within lambda.
  */

  /** TO-DO *****
   * check if the idp_type input request is cognito, then check if the base oidc-provider is available,
   * if not create it using the same pipeline, not just the lambda function, but the api, permission etc as well.
   */
  const cookiesecrets = secretExists(`/mysaasapp/${tenantId}/cookie-secrets`);
  const jwks = secretExists(`/mysaasapp/${tenantId}/jwks`);
  const secrets = await Promise.all([cookiesecrets, jwks]);
  if (secrets.reduce((p, c) => p && c)) {
    console.log(`Tenant ${tenantId} already boostrapped`);
    return {
      statusCode: 500,
      body: `Tenant ${tenantId} already boostrapped`,
    };
  }
  const cookieSecret = createCookieKeysAddToSecrets(tenantId);
  const jwksSecret = createJwksAddToSecrets(tenantId);

  try {
    const tenantFederationAssets = await Promise.all([cookieSecret, jwksSecret]);
    const tenantRecordOidcProviderTable = await addTenantRecordToOidcProviderTable(baseParams, tenantParams, tenantId, body, oidcProviderEndPoint);
    console.log(`add tenant record to oidc-provider table result, ${tenantRecordOidcProviderTable}`);
    const tenantRecordTenantsTable = await UpdateTenantRecordInTenantsTable(tenantParams, tenantId);
    console.log(`update tenant record in tenants dynamodb table result, ${tenantRecordTenantsTable}`);
    const tenantAppClientRecordOidcProviderTable = await addTenantAppClientRecordToOidcProviderTable(baseParams, tenantParams, tenantId, clientSecret);
    console.log(`add oidc provider tenant app client record to oidc-provider table result, ${tenantAppClientRecordOidcProviderTable}`);
    console.log('Going to pull tenant parameters again');
    tenantParams = await getTenantParamsFromSsm(tenantId);
    const cognitoIdentityProvider = await createCognitoIdentityProvider(baseParams, tenantParams, tenantId, clientSecret, oidcProviderEndPoint);
    console.log(`create cognito user pool identity provider result, ${cognitoIdentityProvider}`);
    const cognitoUserPoolClient = await updateCognitoUserPoolClient(baseParams, tenantParams, tenantId);
    console.log(`update cognito user pool app client result, ${cognitoUserPoolClient}`);
    console.log('Tenant Federation success', JSON.stringify(tenantFederationAssets));
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Tenant Federation success', tenantFederationAssets }),
    };
  } catch (error) {
    console.log('Tenant Federation failed', error);
    return new Error(JSON.stringify({ message: 'Tenant boostrap failed', error }));
  }
};
