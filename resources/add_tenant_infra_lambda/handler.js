/* eslint-disable no-console */
/* eslint-disable func-names */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
const AWS = require('aws-sdk');
const moment = require('moment');

const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
const documentClient = new AWS.DynamoDB.DocumentClient();
const ssm = new AWS.SSM();
const acm = new AWS.ACM({ region: 'us-east-1' });
const apigateway = new AWS.APIGateway();
const route53 = new AWS.Route53();
const secretsmanager = new AWS.SecretsManager();

const tenantRecord = require('./tenants-tenant.json');
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
  This Function should be the first one to be executed in Tenant onboarding:
  It executes the following actions:
  1. Checks if there is an existing tenant already for the domain/emaildomain.
    1a. if yes rejects.
    1b. Proceeds if not.
  2. Creates a tenant uuid.
  3. Creates the user who signed up as admin for the tenant with custom attribute tenantid.
  3. Creates a tenant record in the tenants ddb table.
  4. Creates the route53 A record in the hostedzone to allow tenant admin to log into the app.
*/
async function getBaseParamsFromSsm() {
  const params = {
    Names: [ /* required */
      '/mysaasapp/oidcProviderEndPoint',
      '/mysaasapp/cognitoUserPoolId',
      '/mysaasapp/cognitoUserPoolRegion',
      '/mysaasapp/cognitoUserPoolDomainPrefix',
      '/mysaasapp/oidcClientEndPoint',
      '/mysaasapp/hostedzoneid',
      '/mysaasapp/oidcClientRestApiId',
      '/mysaasapp/oidcClientCallBackEndPoint',
      '/mysaasapp/baseFeaturesStepFunctionArn',
    ],

  };
  return ssm.getParameters(params).promise();
}

function getParameterValue(parameterName, params) {
  // console.log(`received params ${JSON.stringify(params)}`);
  console.log(`going to search for ${parameterName}`);
  const paramValue = params.Parameters.find((param) => param.Name.endsWith(`${parameterName}`));
  console.log('going to send', paramValue.Value);
  return paramValue.Value;
}

function putParameterValue(paramName, Value, tenantId) {
  const param = {
    Name: `/mysaasapp/${tenantId}/${paramName}`,
    Value,
    DataType: 'text',
    Description: `${tenantId} ${paramName}`,
    Tier: 'Standard',
    Type: 'String',
  };
  return ssm.putParameter(param).promise();
}

async function createCNAMERecordInRoute53(hostedZone,
  resourceRecord) {
  return route53.changeResourceRecordSets({
    HostedZoneId: hostedZone,
    ChangeBatch: {
      Changes: [{
        Action: 'CREATE',
        ResourceRecordSet: {
          Name: resourceRecord.Name,
          Type: resourceRecord.Type,
          ResourceRecords: [
            {
              Value: resourceRecord.Value,
            },
          ],
          TTL: 300,
        },
      }],
    },
  }).promise();
}

async function createARecord(hostedZone,
  domainName,
  tenantEmailDomain,
  apigwDistributionDomain,
  apigwDistributionHostedZone) {
  return route53.changeResourceRecordSets({
    HostedZoneId: hostedZone,
    ChangeBatch: {
      Changes: [{
        Action: 'CREATE',
        ResourceRecordSet: {
          Name: `${domainName}.${tenantEmailDomain}`,
          Type: 'A',
          AliasTarget: {
            DNSName: apigwDistributionDomain,
            EvaluateTargetHealth: false,
            HostedZoneId: apigwDistributionHostedZone,
          },
        },
      }],
    },
  }).promise();
}

async function createBasePathMapping(restApiId, domainName) {
  return apigateway.createBasePathMapping({ domainName, restApiId, stage: 'dev' }).promise();
}

async function getApigwDomainName(domainName, cert, tenantUUId, tenantEmailDomain) {
  const params = {
    domainName: `${domainName}.${tenantEmailDomain}`, /* required */
    certificateArn: cert,
    endpointConfiguration: {
      types: [
        'EDGE',
      ],
    },
    securityPolicy: 'TLS_1_2',
    tags: {
      tenantId: tenantUUId,
    },
  };
  return apigateway.createDomainName(params).promise();
}

async function getDnsValidatedCertificate(domainName, hostedZoneId, tenantUUId, tenantEmailDomain) {
  console.log(`Domain Name is : ${domainName}.${tenantEmailDomain}`);
  console.log('idempotency token is', tenantUUId.replace(/-/g, ''));
  const params = {
    DomainName: `${domainName}.${tenantEmailDomain}`, /* required */
    IdempotencyToken: tenantUUId.replace(/-/g, ''),
    Options: {
      CertificateTransparencyLoggingPreference: 'ENABLED',
    },
    Tags: [
      {
        Key: 'tenantId',
        Value: tenantUUId,
      },
    ],
    ValidationMethod: 'DNS',
  };
  return acm.requestCertificate(params).promise();
}

async function getDNSRecordFromCertificate(certificateArn) {
  const params = {
    CertificateArn: certificateArn,
  };
  return acm.describeCertificate(params).promise();
}

async function createCognitoUserPoolClient(baseParams, tenantId, tenantEmailDomain) {
  const params = {
    ClientName: tenantId, /* required */
    UserPoolId: getParameterValue('cognitoUserPoolId', baseParams), /* required */
    AccessTokenValidity: 1, // in hours : 1 hour
    AllowedOAuthFlows: [
      'code',
      /* more items */
    ],
    AllowedOAuthFlowsUserPoolClient: true,
    AllowedOAuthScopes: [
      'phone', 'email', 'openid', 'profile',
      /* more items */
    ],
    CallbackURLs: [
      `https://${tenantId}.${tenantEmailDomain}/callback`,
      /* more items */
    ],
    ExplicitAuthFlows: [
      'ALLOW_ADMIN_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH',
      /* more items */
    ],
    GenerateSecret: true,
    IdTokenValidity: 1, // in hours : 1 hour
    PreventUserExistenceErrors: 'ENABLED',
    RefreshTokenValidity: 7, // in days : 7 days
    SupportedIdentityProviders: [
      'COGNITO',
      /* more items */
    ],
    TokenValidityUnits: {
      AccessToken: 'hours',
      IdToken: 'hours',
      RefreshToken: 'days',
    },
  };
  return cognitoidentityserviceprovider.createUserPoolClient(params).promise();
}

async function createTenantCognitoUserPool(tenantId) {
  const params = {
    PoolName: tenantId, /* required */
  };
  return cognitoidentityserviceprovider.createUserPool(params).promise();
}

async function createTenantCognitoUserPoolClient(baseParams, tenantId, tenantUserPoolId) {
  const params = {
    ClientName: tenantId, /* required */
    UserPoolId: tenantUserPoolId, /* required */
    ExplicitAuthFlows: [
      'ALLOW_ADMIN_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH',
      /* more items */
    ],
  };
  return cognitoidentityserviceprovider.createUserPoolClient(params).promise();
}

async function createAdminUser(emailID, userPoolId, tenantuuid) {
  const params = {
    UserPoolId: userPoolId, /* required */
    Username: emailID, /* required */
    DesiredDeliveryMediums: [
      'EMAIL',
      /* more items */
    ],
    UserAttributes: [
      {
        Name: 'custom:tenantid', /* required */
        Value: tenantuuid,
      },
      {
        Name: 'email', /* required */
        Value: emailID,
      },
      /* more items */
    ],
  };
  return cognitoidentityserviceprovider.adminCreateUser(params).promise();
}

async function createClientsecretInSecretsManager(tenantId, clientSecret) {
  const secretName = `/mysaasapp/${tenantId}/federationclientsecret`;
  const createSecretParams = {
    Name: secretName,
    Description: `App client secret for app ${tenantId}`,
    SecretString: clientSecret,
  };
  return secretsmanager.createSecret(createSecretParams).promise();
}

async function addTenantRecordToTenantsTable(tenant, baseParams) {
  tenantRecord.cognito.auth_endpoint = `https://${getParameterValue('cognitoUserPoolDomainPrefix', baseParams)}.auth.${getParameterValue('cognitoUserPoolRegion', baseParams)}.amazoncognito.com/oauth2/authorize`;
  tenantRecord.cognito.userpoolid = getParameterValue('cognitoUserPoolId', baseParams);
  tenantRecord.cognito.userpoolregion = getParameterValue('cognitoUserPoolRegion', baseParams);
  tenantRecord.cognito.idp_identifier = 'COGNITO';
  tenantRecord.cognito.clientsecretarn = `/mysaasapp/${tenant.subdomain}/federationclientsecret`;
  tenantRecord.cognito.clientid = tenant.cognito.clientid;
  tenantRecord.subdomain = tenant.subdomain;
  tenantRecord.emaildomain = tenant.emaildomain;
  tenantRecord.name = tenant.name;
  tenantRecord.tier = tenant.tier;
  tenantRecord.onboarded_date = moment().format('YYYY-MM-DD:hh:mm:ss');
  tenantRecord.id = tenant.id;

  const tenantRecordParams = {
    TableName: 'tenants',
    Item: tenantRecord,
  };

  documentClient.put(tenantRecordParams).promise();
}

async function createTenantConfig(event) {
  const {
    body: {
      tenantSubDomain,
      tenantName,
      tenantEmailDomain,
      tenantTier,
      tenantIDPType,
      emailId,
    },
    tenantuuid,
  } = event;

  if (!tenantName || tenantSubDomain === '') {
    return { statusCode: 400, body: 'tenantName, tenantSubDomain are mandatory' };
  }
  console.log('TenantID from the event', tenantSubDomain);
  console.log('TenantEmailDomain from the event', tenantEmailDomain);
  console.log('Tenant Name is ', tenantName);
  console.log('Tenant SubDomain is ', tenantSubDomain);
  console.log('Tenant Tier is ', tenantTier);
  console.log('Tenant IDP Type is ', tenantIDPType);
  console.log('Admin user email id is ', emailId);
  console.log('Tenant UUID is ', tenantuuid);

  console.log('Going to get HSI base params from parameter store');
  const baseParams = await getBaseParamsFromSsm();
  console.log('Done retreiving HSI base params from parameter store');
  const hostedZoneId = getParameterValue('hostedzoneid', baseParams);
  console.log(`hostedzoneid is ${hostedZoneId}`);
  const oidcClientRestApiId = getParameterValue('oidcClientRestApiId', baseParams);
  console.log(`oidcClientRestApiId is ${oidcClientRestApiId}`);
  const cognitoUserPoolId = getParameterValue('cognitoUserPoolId', baseParams);
  console.log(`userPoolId is ${cognitoUserPoolId}`);

  console.log('going to create tenantUuid in ssm parameter store');
  await putParameterValue('tenantUuid', tenantuuid, tenantSubDomain);
  console.log('Done creating tenantUuid in ssm parameter store');

  console.log('going to create tenantEmailDomain in ssm parameter store');
  await putParameterValue('tenantEmailDomain', tenantEmailDomain, tenantSubDomain);
  console.log('Done creating tenantEmailDomain in ssm parameter store');

  console.log('Going to create Cognito userpool client');
  const userPoolClient = await createCognitoUserPoolClient(baseParams,
    tenantSubDomain,
    tenantEmailDomain);
  console.log(`Done creating Cognito userpool client, ${JSON.stringify(userPoolClient)}`);

  console.log('going to create Cognito userpool client id in ssm parameter store');
  await putParameterValue('federationCognitoUserPoolAppClientId', userPoolClient.UserPoolClient.ClientId, tenantSubDomain);
  console.log('Done creating federationCognitoUserPoolAppClientId in ssm parameter store');

  console.log('Going to create Cognito userpool client secret in secrets manager');
  await createClientsecretInSecretsManager(tenantSubDomain,
    userPoolClient.UserPoolClient.ClientSecret);
  console.log('Done creating Cognito userpool client secret in secrets manager');

  console.log('Going to create Admin user in Cognito userpool');
  await createAdminUser(emailId, getParameterValue('cognitoUserPoolId', baseParams), tenantuuid);
  console.log('Done creating Admin user in Cognito userpool');

  console.log('Going to create tenant record in tenants table');
  await addTenantRecordToTenantsTable({
    emaildomain: tenantEmailDomain,
    id: tenantuuid,
    name: tenantName,
    onboarded_date: moment().format('YYYY-MM-DD:hh:mm:ss'),
    subdomain: tenantSubDomain,
    cognito: { clientid: userPoolClient.UserPoolClient.ClientId },
    tier: tenantTier,
  }, baseParams);
  console.log('Done creating tenant record in tenants table');
  return { baseParams };
}
/**
 *
 * @param {*} event object that includes tenantuuid, tenantId,
 */
async function createTenantCert(event) {
  const {
    body: {
      tenantSubDomain,
      tenantEmailDomain,
    },
    tenantuuid,
    addTenantConfigResult: { baseParams },
  } = event;

  const hostedZoneId = getParameterValue('hostedzoneid', baseParams);
  console.log(`hostedzoneid is ${hostedZoneId}`);
  console.log(`Going to get a ACM public certificate for ${tenantSubDomain}`);
  const cert = await getDnsValidatedCertificate(
    tenantSubDomain,
    hostedZoneId,
    tenantuuid,
    tenantEmailDomain,
  );
  console.log(`Done creating ACM public certificate for ${tenantSubDomain}: ${JSON.stringify(cert)}`);
  return { cert };
}
async function createTenantAuth(event) {
  const {
    body: {
      tenantSubDomain,
    },
    tenantuuid,
    addTenantConfigResult: { baseParams },
  } = event;

  const hostedZoneId = getParameterValue('hostedzoneid', baseParams);
  console.log(`hostedzoneid is ${hostedZoneId}`);
  console.log(`Going to create internal cognito userpool for ${tenantSubDomain}`);
  const tenantUserPool = await createTenantCognitoUserPool(tenantSubDomain);
  console.log('Done creating internal cognito userpool');
  console.log(`Going to create userpool client for internal cognito userpool ${tenantSubDomain}`);
  const tenantUserPoolClient = await createTenantCognitoUserPoolClient(
    baseParams, tenantSubDomain, tenantUserPool.UserPool.Id,
  );
  console.log(`Done creating userpool client for internal cognito userpool ${tenantSubDomain}`);
  return {
    body: {
      tenantIDPType: 'cognito',
      dynamodbTableName: 'oidc-provider',
      logLevel: 'ERROR',
      cognitoConfig: {
        userPoolClientId: tenantUserPoolClient.UserPoolClient.ClientId,
        userPoolId: tenantUserPool.UserPool.Id,
        userPoolRegion: tenantUserPool.UserPool.region,
      },
    },
    tenantuuid,
  };
}
async function checkIfTenantCertisStable(event) {
  const {
    addTenantConfigResult: { baseParams },
    addTenantCertResult: { cert: { CertificateArn: certificateArn } },
  } = event;
  const hostedZoneId = getParameterValue('hostedzoneid', baseParams);
  console.log(`hostedzoneid is ${hostedZoneId}`);
  console.log(`Going to get the cert CNAME record ${certificateArn}`);
  const cnameRecord = await getDNSRecordFromCertificate(certificateArn);
  console.log(`Done retrieving the cert CNAME record ${JSON.stringify(cnameRecord)}`);

  console.log(`Going to add cert CNAME record to route53 hosted zone to validate the cert ${JSON.stringify(cnameRecord.Certificate.DomainValidationOptions[0].ResourceRecord)}`);
  if (!cnameRecord.Certificate.DomainValidationOptions[0].ResourceRecord) {
    return { continuewait: true };
  }
  return { continuewait: false };
}
async function checkIfTenantCertisValid(event) {
  const {
    addTenantCertResult: { cert: { CertificateArn: certificateArn } },
  } = event;
  console.log(`Going to get the cert CNAME record ${certificateArn}`);
  const cert = await getDNSRecordFromCertificate(certificateArn);
  console.log(`Done retrieving the cert record ${JSON.stringify(cert)}`);

  console.log(`Certificate Status is ${JSON.stringify(cert.Certificate.Status)}`);
  if (cert.Certificate.Status !== 'ISSUED') {
    return { continuewait: true };
  }
  return { continuewait: false };
}
async function createCNAMERecord(event) {
  const {
    addTenantConfigResult: { baseParams },
    addTenantCertResult: { cert: { CertificateArn: certificateArn } },
  } = event;
  const hostedZoneId = getParameterValue('hostedzoneid', baseParams);
  console.log(`hostedzoneid is ${hostedZoneId}`);
  console.log(`Going to get the cert CNAME record ${certificateArn}`);
  const cnameRecord = await getDNSRecordFromCertificate(certificateArn);
  console.log(`Done retrieving the cert CNAME record ${JSON.stringify(cnameRecord)}`);

  console.log(`Going to add cert CNAME record to route53 hosted zone to validate the cert ${JSON.stringify(cnameRecord.Certificate.DomainValidationOptions[0].ResourceRecord)}`);
  const route53ChangeResult = await createCNAMERecordInRoute53(hostedZoneId,
    cnameRecord.Certificate.DomainValidationOptions[0].ResourceRecord);
  console.log('Done adding cert CNAME record to route53 hosted zone');
  return { route53ChangeResult };
}

async function createIngress(event) {
  const {
    body: {
      tenantSubDomain,
      tenantEmailDomain,
    },
    addTenantConfigResult: { baseParams },
    addTenantCertResult: { cert: { CertificateArn: certificateArn } },
    tenantuuid,
  } = event;
  const hostedZoneId = getParameterValue('hostedzoneid', baseParams);
  console.log(`hostedzoneid is ${hostedZoneId}`);
  const oidcClientRestApiId = getParameterValue('oidcClientRestApiId', baseParams);
  console.log(`oidcClientRestApiId is ${oidcClientRestApiId}`);
  const cognitoUserPoolId = getParameterValue('cognitoUserPoolId', baseParams);
  console.log(`userPoolId is ${cognitoUserPoolId}`);
  console.log('Going to create a API Gateway Custom domain next');
  const apigwDomain = await getApigwDomainName(
    tenantSubDomain,
    certificateArn,
    tenantuuid,
    tenantEmailDomain,
  );
  console.log(`Done creating API Gateway Custom domain next ${JSON.stringify(apigwDomain)}`);

  console.log('Going to create API Gateway basepath mapping for custom domain and oidc client rest api');
  const basePath = await createBasePathMapping(oidcClientRestApiId, apigwDomain.domainName);
  console.log(`Done creating API Gateway basepath mapping for custom domain and oidc client rest api, ${JSON.stringify(basePath)}`);

  console.log(`Going to create Route53 A record for ${tenantSubDomain}`);
  const route53ARecordCreationResponse = await createARecord(hostedZoneId,
    tenantSubDomain,
    tenantEmailDomain,
    apigwDomain.distributionDomainName,
    apigwDomain.distributionHostedZoneId);
  console.log(`Done creating Route53 A record for ${tenantSubDomain}`);
  return { route53ARecordCreationResponse };
}
exports.handler = async function (event) {
  console.log(`received event ${JSON.stringify(event)}`);
  if (!event.body || event.body === '') {
    return { statusCode: 400, body: 'Onboard Tenant is a POST operation, expects a JSON body' };
  }
  if (!event.step || event.step === '' || !(['CONFIG', 'CERT', 'CNAME', 'INGRESS', 'CERTBAKED', 'CERTVALID', 'TENANTAUTH'].includes(event.step))) {
    return { statusCode: 400, body: 'Specify a valid step, CONFIG' };
  }
  let result;
  try {
    switch (event.step) {
      case 'CONFIG':
        result = await createTenantConfig(event.body);
        break;
      case 'TENANTAUTH':
        result = await createTenantAuth(event.body);
        break;
      case 'CERT':
        result = await createTenantCert(event.body);
        break;
      case 'CERTBAKED':
        result = await checkIfTenantCertisStable(event.body);
        break;
      case 'CNAME':
        result = await createCNAMERecord(event.body);
        break;
      case 'CERTVALID':
        result = await checkIfTenantCertisValid(event.body);
        break;
      case 'INGRESS':
        result = await createIngress(event.body);
        break;
      default:
        console.log('Not a valid choice');
    }
    return result;
  } catch (error) {
    console.log(`Tenant bootstrap failed at ${event.step}`, error);
    return error;
  }
};

/*  TODO: Wrtie step status to dynamodb. write asset info to dynamodb.
    TODO: add validation for params in body
*/
