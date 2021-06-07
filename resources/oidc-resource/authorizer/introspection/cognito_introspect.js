/* eslint-disable no-param-reassign */
/* eslint-disable no-console */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/**
 * Code from https://github.com/awslabs/aws-support-tools/blob/master/Cognito/decode-verify-jwt/decode-verify-jwt.ts
 */

const { promisify } = require('util');
const Axios = require('axios');
const jsonwebtoken = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');

const cognitoPoolId = process.env.COGNITO_USER_POOL_ID || '';
const awsRegion = process.env.AWS_REGION;
if (!cognitoPoolId) {
  throw new Error('env var required for cognito pool');
}
const cognitoIssuer = `https://cognito-idp.${awsRegion}.amazonaws.com/${cognitoPoolId}`;
let cacheKeys;
const getPublicKeys = async () => {
  if (!cacheKeys) {
    const url = `${cognitoIssuer}/.well-known/jwks.json`;
    const publicKeys = await Axios.default.get(url);
    cacheKeys = publicKeys.data.keys.reduce((agg, current) => {
      const pem = jwkToPem(current);
      agg[current.kid] = { instance: current, pem };
      return agg;
    }, {});
    return cacheKeys;
  }

  return cacheKeys;
};
const verifyPromised = promisify(jsonwebtoken.verify.bind(jsonwebtoken));
const cognitoIntrospect = async (request) => {
  let result;
  try {
    console.debug(`user claim verfiy invoked for ${JSON.stringify(request)}`);
    const token = request;
    const tokenSections = (token || '').split('.');
    if (tokenSections.length < 2) {
      throw new Error('requested token is invalid');
    }
    const headerJSON = Buffer.from(tokenSections[0], 'base64').toString('utf8');
    const header = JSON.parse(headerJSON);
    const keys = await getPublicKeys();
    const key = keys[header.kid];
    if (key === undefined) {
      throw new Error('claim made for unknown kid');
    }
    const claim = await verifyPromised(token, key.pem);
    const currentSeconds = Math.floor((new Date()).valueOf() / 1000);
    if (currentSeconds > claim.exp || currentSeconds < claim.auth_time) {
      throw new Error('claim is expired or invalid');
    }
    if (claim.iss !== cognitoIssuer) {
      throw new Error('claim issuer is invalid');
    }
    if (claim.token_use !== 'access') {
      throw new Error('claim use is not access');
    }
    console.debug(`claim confirmed for ${claim.username}`);
    result = { userName: claim.username, clientId: claim.client_id, isValid: true };
  } catch (error) {
    result = {
      userName: '', clientId: '', error, isValid: false,
    };
  }
  return result;
};

module.exports = {
  cognitoIntrospect,
};
