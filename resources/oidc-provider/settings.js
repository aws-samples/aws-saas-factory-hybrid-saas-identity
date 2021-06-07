/* eslint-disable max-len */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-console */
/* eslint-disable no-param-reassign */

const Log = require('@dazn/lambda-powertools-logger');
const { DynamoDB } = require('aws-sdk');

const Adapter = require('oidc-provider-dynamodb-adapter');
const { interactionPolicy: { Prompt, base: policy } } = require('oidc-provider');
const LdapAccount = require('./account/ldap_auth');
const CognitoAccount = require('./account/cognito_auth');
const { getSecret } = require('./helpers/get_secret');

// copies the default policy, already has login and consent prompt policies
const interactions = policy();
const docClient = new DynamoDB.DocumentClient();
// create a requestable prompt with no implicit checks
const selectAccount = new Prompt({
  name: 'select_account',
  requestable: true,
});

// add to index 0, order goes select_account > login > consent
interactions.add(selectAccount, 0);

Log.debug('settings: interactions list: ', interactions);

async function extraAccessTokenClaims(ctx, token) {
  Log.debug('getsettings: extraAccessTokenClaims: ctx', ctx);
  Log.debug('getsettings: extraAccessTokenClaims: token', token);
  return {
    tenant_id: 'bar',
  };
}

Adapter.setConfig({
  // When running on lambda, parameters are unnecessary because using environment variables.
  dynamoDB: new DynamoDB(),
  tableName: process.env.AWS_DYNAMODB_TABLE_NAME,
});

function getbasesettings(clientId) {
  return {
    // findAccount: Account.findById,
    interactions: {
      policy: interactions,
      url(ctx, interaction) { // eslint-disable-line no-unused-vars
        return `/prod/${clientId}/interaction/${ctx.oidc.uid}`;
      },
    },
    adapter: Adapter,
    extraAccessTokenClaims,
  };
}

async function gettenantsettings(tenantId) {
  const tenantparams = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Key: {
      id: `tenant:${tenantId}`,
    },
  };

  try {
    const getTenantResult = await docClient.get(tenantparams).promise();
    Log.debug('Tenant record retrieved:', getTenantResult);
    const secrets = await Promise.all([getTenantResult.Item.configuration.jwks, getTenantResult.Item.configuration.cookies.keys].map(getSecret));
    Log.debug('Tenant secrets', secrets);
    getTenantResult.Item.configuration.jwks = JSON.parse(secrets[0]);
    getTenantResult.Item.configuration.cookies.keys = JSON.parse(secrets[1]);

    Log.debug('Tenant Get succeeded.', getTenantResult);
    return getTenantResult.Item;
  } catch (err) {
    Log.error('Unable to retrieve client. Error:', err);
    throw err;
  }
}

async function gettenant(clientId) {
  Log.debug('gettenant funciton received client_id', clientId);
  const clientParams = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Key: {
      id: `client:${clientId}`,
    },
  };

  try {
    const getclientresult = await docClient.get(clientParams).promise();

    Log.debug('Client Get succeeded.', getclientresult);
    return getclientresult.Item.tenant_id;
  } catch (err) {
    Log.error('Unable to retrieve client. Error:', err);
    throw err;
  }
}

async function getclients(tenantId) {
  const clients = [];
  Log.debug('Querying for clients');
  const clientsparams = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    IndexName: 'type-tenant_id-index',
    KeyConditionExpression: '#typ = :typval and tenant_id = :tenantid',
    ExpressionAttributeNames: {
      '#typ': 'type',
    },
    ExpressionAttributeValues: {
      ':typval': 'client',
      ':tenantid': tenantId,
    },
  };
  try {
    const clientsqueryresult = await docClient.query(clientsparams).promise();
    Log.debug('Clients Query succeeded.', clientsqueryresult);
    clientsqueryresult.Items.forEach((item) => {
      Log.debug('Client: ', item);
      delete item.id;
      delete item.type;
      delete item.tenant_id;
      clients.push(item);
    });
    return clients;
  } catch (err) {
    Log.error('Unable to query. Error:', err);
    throw err;
  }
}

async function getfeatures() {
  const featuresparams = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Key: {
      id: 'features',
    },
  };
  try {
    const featuresqueryresult = await docClient.get(featuresparams).promise();
    Log.debug('Features Query succeeded.', featuresqueryresult);
    delete featuresqueryresult.Item.id;
    delete featuresqueryresult.Item.type;
    return featuresqueryresult.Item;
  } catch (err) {
    Log.error('Unable to query. Error:', err);
    throw err;
  }
}

// TODO: change getsettings to accept tenant_id
async function getsettings(clientId) {
/**
 * Querying DynamoDB for Clients
 * @see https://github.com/panva/node-oidc-provider/blob/master/docs/configuration.md
 */
  try {
    Log.debug('client_id to be used for settings lookup', clientId);
    const tenantId = await gettenant(clientId);
    Log.debug('Looked up tenant_id for client_id', tenantId);
    const tenantconfig = await gettenantsettings(tenantId);
    Log.debug('received tenant config', tenantconfig);
    const clients = await getclients(tenantId);
    Log.debug('clients received', clients);
    const features = await getfeatures();
    Log.debug('features received', features);

    const retrievedsettings = {

      ...tenantconfig,
      configuration: {
        ...getbasesettings(clientId),
        ...tenantconfig.configuration,
        clients,
        features,
      },
    };
    Log.debug('retrieved settings', retrievedsettings);
    // if (tenantconfig.authtype === 'cognito') {
    //   retrievedsettings.configuration.findAccount = Account.findById
    // } else if (tenantconfig.authtype === 'ldap') {
    //   retrievedsettings.configuration.findAccount = Account.findById
    // } else {
    //   throw new Error('Tenant does not have a valid auth type')
    // }
    if (tenantconfig.authtype === 'cognito') {
      Log.debug(`going to create a cognitaccount object with clientid:${tenantconfig.clientId} and userpoolid:${tenantconfig.userPoolId} and tenantid:${tenantId}`);
      retrievedsettings.configuration.Account = new CognitoAccount(null, null, tenantconfig.clientId, tenantconfig.userPoolId, tenantId);
    } else if (tenantconfig.authtype === 'ldap') {
      retrievedsettings.configuration.Account = new LdapAccount(null, null, tenantconfig);
    } else {
      throw new Error('Tenant has invalid/unsupported auth type');
    }
    // delete retrievedsettings.configuration.id
    // delete retrievedsettings.configuration.domain
    // delete retrievedsettings.configuration.type
    // delete retrievedsettings.configuration.tenant_id
    Log.debug('Going to return retrived settings with findaccount', retrievedsettings);
    return retrievedsettings;
  } catch (err) {
    Log.error('Unable to query. Error:', err);
    throw err;
  }

/**
 * Values for setting and initializing Provider.
 * @see https://github.com/panva/node-oidc-provider/blob/master/docs/configuration.md
 */
}

module.exports = getsettings;
