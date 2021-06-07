// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-console */
const { getTenant } = require('./helpers/get_tenant_item');
const { generatePolicy } = require('./helpers/generate-policy');
const { getSecret } = require('./helpers/get_secret');

/**
 * From the introspection result, confirm the authority to the access target.
 * If you are doing your own permission management, use this method to verify.
 */
// Currently it is an implementation that allows access if it is a valid token.
const confirmPermission = async (tenantContext, resource) => ({
  principalId: '*',
  effect: 'Allow',
  resource,
  authContext: {
    auth_endpoint: tenantContext.tenant.cognito.auth_endpoint,
    clientid: tenantContext.tenant.cognito.clientid,
    response_type: tenantContext.tenant.cognito.response_type,
    scope: tenantContext.tenant.cognito.scope,
    idp_identifier: tenantContext.tenant.cognito.idp_identifier,
    nonce: '123',
    clientsecret: tenantContext.tenantCognitoAppClientSecret,
  },
});

const authorizerHandler = async (event, context, callback) => {
  console.debug('received this event', JSON.stringify(event));
  console.debug('received this context', JSON.stringify(context));
  console.info('About to lookup tenant');
  const tenant = await getTenant(event.requestContext.domainPrefix);
  const tenantCognitoAppClientSecret = await getSecret(tenant.cognito.clientsecretarn);
  console.debug('token extracted', tenant);
  if (!tenant) {
    callback('Unauthorized');
    return;
  }
  const methodarn = event.methodArn;
  const split = methodarn.split('/');
  const allResourcesAllMethods = `${split.slice(0, split.length - 2).join('/')}/*`;

  console.debug('About to confirm permission for', allResourcesAllMethods);
  const {
    principalId, effect, resource, authContext,
  } = await confirmPermission({ tenant, tenantCognitoAppClientSecret }, allResourcesAllMethods);
  console.debug('Going to generate policy with, principalId, effect, resource, authContext', principalId, effect, resource, authContext);
  const policy = generatePolicy(principalId, effect, resource, authContext);
  console.debug('going to return this policy', JSON.stringify(policy));
  callback(undefined, policy);
};

module.exports = {
  authorizerHandler,
};
