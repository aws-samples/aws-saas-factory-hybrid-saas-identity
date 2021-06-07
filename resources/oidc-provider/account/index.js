// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-console */
/* eslint-disable no-template-curly-in-string */
const url = require('url')
const Log = require('@dazn/lambda-powertools-logger')
/**
 * Account class corresponding to the interface of findById().
 */
class Account {
  static async signInErrorHandler(ctx, next) {
    Log.debug('signinerrorhandler from oidc/account just got invoked!')
    try {
      await next()
    } catch (error) {
      const redirectUrl = url.parse(ctx.oidc.urlFor('interaction', { grant: ctx.oidc.uuid })).pathname

      switch (error.code) {
        case 'NotAuthorizedException':
        case 'UserNotFoundException':
          // Even if the user does not exist, return NotAuthorizedException.
          ctx.redirect(`${redirectUrl}?error=NotAuthorizedException`)
          break
        case 'PasswordResetRequiredException':
        case 'UserNotConfirmedException':
          ctx.redirect(`${redirectUrl}?error=${error.code}`)
          break
        default:
          ctx.throw(500, 'server_error', { error_description: error.message })
          break
      }
    }
  }

  constructor(id, claims) {
    this.accountId = id
    this.claims = claims
  }
}

module.exports = Account
