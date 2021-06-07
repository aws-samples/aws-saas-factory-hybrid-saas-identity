/* eslint-disable no-console */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
const { DynamoDB } = require('aws-sdk');

const docClient = new DynamoDB.DocumentClient();

async function getTenant(tenantUuid) {
  const tenantsparams = {
    TableName: process.env.TENANTS_TABLE_NAME,
    Key: { id: tenantUuid },
  };
  try {
    const tenantsqueryresult = await docClient.get(tenantsparams).promise();

    console.log('Tenants Query succeeded.', JSON.stringify(tenantsqueryresult));
    return tenantsqueryresult.Item;
  } catch (err) {
    console.error('Unable to query. Error:', JSON.stringify(err, null, 2));
    throw err;
  }
}

module.exports = {
  getTenant,
};
