// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-console */
const { getToken } = require('./helpers/get-token');
const { generatePolicy } = require('./helpers/generate-policy');
const { getTenantById, getTenantBySubdomain } = require('./helpers/get_tenant_item');
const { cognitoIntrospect } = require('./introspection/cognito_introspect');

/**
 * From the introspection result, confirm the authority to the access target.
 * If you are doing your own permission management, use this method to verify.
 *
 * Every tenant in this architecture federates into the same Cognito user pool, so a
 * signature check against that pool succeeds for every tenant's users equally. Verifying
 * the token establishes *who* is calling, not *what they may do*, so a signature check
 * alone is not an authorization decision.
 *
 * What this method can enforce depends on how the request arrives:
 *
 *  - The tenant named in the token must exist. The claim is passed downstream as
 *    $context.authorizer.tenantUuid and drives which tenant the federation workflow
 *    provisions, so a claim naming no real tenant must never reach it.
 *
 *  - If the request arrived on a per-tenant domain, the tenant owning that domain must
 *    be the tenant in the token. This API is currently reached at its execute-api URL
 *    rather than a tenant domain (tenant subdomains are mapped to the oidc-client API),
 *    so this check is inert today; it is here so that mapping this API to tenant domains
 *    later does not silently reintroduce a cross-tenant path.
 *
 * It fails closed: a token with no tenant claim, a tenant that does not exist, a domain
 * owned by a different tenant, and any failed lookup all deny.
 *
 * NOT enforced here, and deliberately called out rather than left implicit: whether the
 * caller is *entitled* to run tenant federation for their tenant. The route comment in
 * the CDK stack describes this endpoint as available "only on /admin to Administrators",
 * but the shared user pool carries no role or group signal to check, so any authenticated
 * user of a tenant can currently trigger federation provisioning for that tenant. Closing
 * that requires an authorization signal the caller cannot set for themselves -- a Cognito
 * group surfaced in cognito:groups, or a role claim written only by an admin-side API --
 * and then a check for it here. Note that custom:tenantid is declared mutable on the
 * shared pool and no app client in this project sets WriteAttributes, so a custom
 * attribute is not a safe place to put that signal.
 */
const confirmPermission = async (introspectionResult, resource, requestedSubdomain) => {
  const principalId = (introspectionResult.sub)
    ? introspectionResult.sub
    : introspectionResult.client_id;
  const deny = { principalId: principalId || 'unknown', effect: 'Deny', resource };

  const tokenTenantUuid = introspectionResult.tenantUuid;
  if (!tokenTenantUuid) {
    console.warn('Denying: token carries no tenant claim');
    return deny;
  }

  let tokenTenant;
  let domainTenant;
  try {
    tokenTenant = await getTenantById(tokenTenantUuid);
    domainTenant = await getTenantBySubdomain(requestedSubdomain);
  } catch (err) {
    // A lookup failure must not become an allow.
    console.error('Denying: tenant lookup failed');
    return deny;
  }

  if (!tokenTenant || !tokenTenant.id) {
    console.warn('Denying: token names a tenant that does not exist');
    return deny;
  }

  if (domainTenant && domainTenant.id !== tokenTenantUuid) {
    // A valid token, but presented against a domain belonging to a different tenant.
    console.warn('Denying: token tenant does not own the requested domain');
    return deny;
  }

  return {
    principalId,
    effect: 'Allow',
    resource,
    authContext: introspectionResult,
  };
};

const authorizerHandler = async (event, context, callback) => {
  // The event and the token are deliberately not logged. The event carries the caller's
  // Authorization header, and writing a bearer token to CloudWatch puts a live credential
  // in the log group, where it outlives the request and is readable by anyone with logs
  // access.
  console.debug('authorizer invoked for', event.methodArn);
  const token = getToken(event.headers.Authorization);
  if (!token) {
    callback('Unauthorized');
    return;
  }
  const introspectionResult = await cognitoIntrospect(token);

  // Require a positive result. The previous `!active && !isValid` denied only when both
  // signals were falsy, so a result that was explicitly invalid still passed as long as
  // the other field happened to be truthy.
  const introspectionSucceeded = introspectionResult.isValid === true
    || introspectionResult.active === true;
  if (!introspectionSucceeded) {
    callback('Unauthorized');
    return;
  }

  console.info('About to confirm permission');
  const {
    principalId, effect, resource, authContext,
  } = await confirmPermission(
    introspectionResult,
    event.methodArn,
    event.requestContext && event.requestContext.domainPrefix,
  );
  console.info('Permission decision:', effect);
  const policy = generatePolicy(principalId, effect, resource, authContext);

  callback(undefined, policy);
};

module.exports = {
  authorizerHandler,
  confirmPermission,
};
