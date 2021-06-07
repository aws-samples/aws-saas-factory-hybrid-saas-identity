// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-console */
const { getToken } = require('./helpers/get-token');
const { generatePolicy } = require('./helpers/generate-policy');
const { cognitoIntrospect } = require('./introspection/cognito_introspect');

/**
 * From the introspection result, confirm the authority to the access target.
 * If you are doing your own permission management, use this method to verify.
 */
// Currently it is an implementation that allows access if it is a valid token.
// change this and check if the domain prefix from route53 matches to
// the tenantuuid info from ddb. reject it if not.
const confirmPermission = async (introspectionResult, resource) => ({
  principalId: (introspectionResult.sub) ? introspectionResult.sub : introspectionResult.client_id,
  effect: 'Allow',
  resource,
  authContext: introspectionResult,
});

const authorizerHandler = async (event, context, callback) => {
  console.debug('received this event', event);
  console.debug('received this context', context);
  console.debug('About to call token extract');
  const token = getToken(event.headers.Authorization);
  console.debug('token extracted', token);
  if (!token) {
    callback('Unauthorized');
    return;
  }
  console.debug('About to call introstpect with token', token);
  const introspectionResult = await cognitoIntrospect(token);

  console.debug('introspection introspectionResult', introspectionResult);

  if (!introspectionResult.active && !introspectionResult.isValid) {
    callback('Unauthorized');
    return;
  }
  console.info('About to confirm permission');
  const {
    principalId, effect, resource, authContext,
  } = await confirmPermission(introspectionResult, event.methodArn);
  console.debug('Going to generate policy with, principalId, effect, resource, authContext', principalId, effect, resource, authContext);
  const policy = generatePolicy(principalId, effect, resource, authContext);

  callback(undefined, policy);
};

module.exports = {
  authorizerHandler,
};
