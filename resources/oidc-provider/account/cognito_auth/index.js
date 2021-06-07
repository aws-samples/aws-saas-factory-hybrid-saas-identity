// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-console */
/* eslint-disable no-template-curly-in-string */
const { CognitoIdentityServiceProvider } = require('aws-sdk')
const jwt = require('jsonwebtoken')
const Account = require('..')
const Log = require('@dazn/lambda-powertools-logger')
const sharedConfig = {
  cognitoIdentityServiceProvider: new CognitoIdentityServiceProvider()
}

class CognitoAccount extends Account {
  constructor(id, claims, clientId, userPoolId, tenant_id) {
    Log.debug(`cognitoaccount: constructor calle with id ${id} and claims: ${claims}`)
    super(id, claims)
    this.clientId = clientId
    this.userPoolId = userPoolId
    this.tenant_id = tenant_id
  }

  async authenticate(email, password) {
    Log.debug(`cognitoaccount: authenticate from oidc/account/cognito just got invoked! and I have ${this.clientId} and ${this.userPoolId} `)
    return Promise.resolve()
      .then(() => new Promise((resolve, reject) => {
        // Try to log in as administrator using parameters passed from user.
        sharedConfig.cognitoIdentityServiceProvider.adminInitiateAuth({
          AuthFlow: 'ADMIN_NO_SRP_AUTH',
          ClientId: this.clientId,
          UserPoolId: this.userPoolId,
          AuthParameters: {
            USERNAME: email,
            PASSWORD: password
          }
        }, (error, data) => {
          if (error) {
            reject(error)
            return
          }
          Log.debug('cognitoaccount: Auth successful',data)
          resolve(data)
        })
      }))
      .then(data => {
        // Decode Cognito's id token and get user's sub.
        const idToken = jwt.decode(data.AuthenticationResult.IdToken)
        Log.debug('cognitoaccount: decoding JWT successful', idToken)
        return {
          sub: idToken.email,
          raw: data
        }
      })
  }

  async findAccount(ctx, id) {
    Log.debug(`cognitoaccount: about to find user ${id} in cognito in userpool ${this.userPoolId}`, ctx)
    return Promise.resolve()
      .then(() => new Promise((resolve, reject) => {
        sharedConfig.cognitoIdentityServiceProvider.listUsers({
          UserPoolId: this.userPoolId,
          Filter: `email = "${id}"`,
          Limit: 1
        }, (error, results) => {
          Log.debug('cognitoaccount: cognito listusers response', error, results)
          if (error || results.Users.length === 0) {
            reject((error) || new Error())
            return
          }
          resolve(results.Users[0])
        })
      }))
      .then(data => {
        Log.debug('cognitoaccount: cognito claims: received', data)
        // Return the value of Cognito's UserAttributes as claims.

        const claims = async (use, scope, claims, rejected) => {
          Log.debug(`cognitoaccount: claims was called with use: ${use}, scope: ${scope}, claims: ${claims}, rejected: ${rejected}, data: ${data}`)
          const clms = data.Attributes.reduce((acc, current) => {
            acc[current.Name] = current.Value
            return acc
          }, {})
          clms.tenantid=this.tenant_id
          Log.debug('cognitoaccount: claims will return!', clms)
          return clms

        }
        
        return new CognitoAccount(id, claims, this.userPoolId, this.clientId, this.tenant_id)
      })
  }
}

module.exports = CognitoAccount
