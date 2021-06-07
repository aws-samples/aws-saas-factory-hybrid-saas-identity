/* eslint-disable no-async-promise-executor */
/* eslint-disable no-console */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT

// eslint-disable-next-line camelcase
import jwt_decode from 'jwt-decode';

const axios = require('axios');

const querystring = require('querystring');
const { getTenant } = require('./helpers/get_tenant_item');

module.exports.hello = async (event, context) => new Promise(async (resolve, reject) => {
  console.debug('here is the event', JSON.stringify(event));
  const { resource_endpoint: resourceEndpoint } = process.env;
  try {
    if (!event.queryStringParameters) {
      console.error('error: Expected Query String parameter "code"');
      resolve({ statusCode: 500, body: JSON.stringify({ message: 'Something went wrong!, you only get a cold cookie' }) });
    }
    const clientID = event.requestContext.authorizer.clientid;
    const clientSecret = event.requestContext.authorizer.clientsecret;
    const { auth_endpoint: authEndpoint } = event.requestContext.authorizer;
    const split = authEndpoint.split('/');
    const opUrl = split.slice(0, split.length - 1).join('/');

    const requestToken = event.queryStringParameters.code;
    const redirectUri = event.headers.Referer ? event.headers.Referer.split('?')[0] : event.headers.referer.split('?')[0];

    console.debug('Access Token API call input: ', JSON.stringify({
      requestToken, op_url: opUrl, clientID, clientSecret, redirectUri,
    }));

    // Call the token endpoint to retrieve access token, id token
    // using the clientID, clientSecret and the authorization code
    const accesstokenResponse = await axios({
      method: 'post',
      url: `${opUrl}/token`,
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      data: querystring.stringify({
        grant_type: 'authorization_code',
        code: requestToken,
        redirect_uri: redirectUri,
        client_id: clientID,
      }),
      auth: { username: clientID, password: clientSecret },
    });
    console.debug('got response back from token', JSON.stringify(accesstokenResponse.data));
    const accessToken = accesstokenResponse.data.access_token;
    const idToken = accesstokenResponse.data.id_token;

    const idTokenDecoded = jwt_decode(idToken);
    const accessTokenDecoded = jwt_decode(accessToken);
    // check if this token was issued for tenant
    // isolate cross-tenant access
    // A: lookup using the subdomain into tenants table to retrieve tenantUuid
    // B: custom:tenantid claim from the id token
    // C: reject if A != B

    const tenant = await getTenant(event.requestContext.domainPrefix);
    if (idTokenDecoded['custom:tenantid'] !== tenant.id) {
      resolve({
        statusCode: 403,
        body: JSON.stringify({
          message: 'Invalid tenantId presented, signout or refresh/login',
          tenantid_presented: idTokenDecoded['custom:tenantid'],
          tenantid: tenant.id,
        }),
      });
    }

    // Call SaaS API with the ID token to retrive a multi-tenant chocolate chip cookie
    // and nothing less. :)
    console.debug('Resource API call input: ', accessToken, resourceEndpoint);
    const oidcResourceResponse = await axios({
      method: 'get',
      url: resourceEndpoint,
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    console.debug('got response back', JSON.stringify(oidcResourceResponse.data));
    const oidcResourceResponseData = oidcResourceResponse.data.message;

    resolve({
      statusCode: 200,
      body: JSON.stringify({
        message: 'Alright!, you get a warm cookie',
        access_token: accessToken,
        access_token_header: jwt_decode(accessToken, { header: true }),
        access_token_payload: accessTokenDecoded,
        id_token: idToken,
        id_token_header: jwt_decode(idToken, { header: true }),
        id_token_payload: idTokenDecoded,
        code: requestToken,
        api_response: oidcResourceResponseData,
      }),
    });
  } catch (err) {
    console.error(JSON.stringify(err));
    reject(new Error({
      statusCode: 500,
      result: JSON.stringify({
        event, context, endpoint: resourceEndpoint, err,
      }),
    }));
  }
});
