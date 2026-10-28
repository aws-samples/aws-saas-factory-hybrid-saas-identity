/* eslint-disable no-console */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
const { DynamoDB } = require('aws-sdk');

const docClient = new DynamoDB.DocumentClient();

/**
 * Look up a tenant by its uuid (the tenants table partition key).
 * Returns undefined when no such tenant exists, which callers must treat as a denial.
 */
async function getTenantById(tenantUuid) {
  if (!tenantUuid) {
    return undefined;
  }
  try {
    const result = await docClient.get({
      TableName: process.env.TENANTS_TABLE_NAME,
      Key: { id: tenantUuid },
    }).promise();
    // Deliberately logging only whether a record was found: the item carries tenant
    // configuration, including identity provider details.
    console.log('Tenant lookup by id completed, found:', Boolean(result.Item));
    return result.Item;
  } catch (err) {
    console.error('Unable to read tenants table. Error:', JSON.stringify(err, null, 2));
    throw err;
  }
}

/**
 * Resolve the tenant that owns a subdomain, e.g. 'tenant-2' for tenant-2.thinkr.dev.
 *
 * Returns undefined when no tenant claims the subdomain. Note that this API is reached
 * at its execute-api URL rather than a per-tenant domain, so for this authorizer the
 * usual result is undefined; it is only meaningful if the API is later mapped to tenant
 * domains. This is the same lookup the oidc-client authorizer performs, duplicated here
 * because each Lambda is bundled from its own directory.
 */
async function getTenantBySubdomain(subdomain) {
  if (!subdomain) {
    return undefined;
  }
  try {
    const result = await docClient.query({
      TableName: process.env.TENANTS_TABLE_NAME,
      IndexName: 'subdomain-index',
      KeyConditionExpression: '#subdomain = :subdomain',
      ExpressionAttributeNames: { '#subdomain': 'subdomain' },
      ExpressionAttributeValues: { ':subdomain': subdomain },
    }).promise();
    console.log('Tenant lookup by subdomain completed, matches:', result.Count);
    return result.Items[0];
  } catch (err) {
    console.error('Unable to query tenants table. Error:', JSON.stringify(err, null, 2));
    throw err;
  }
}

module.exports = {
  getTenantById,
  getTenantBySubdomain,
};
