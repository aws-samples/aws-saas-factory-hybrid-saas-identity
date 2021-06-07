// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-console */
const { strict: assert } = require('assert')
const querystring = require('querystring')
const isEmpty = require('lodash/isEmpty')
const bodyParser = require('koa-body')
const { inspect } = require('util')
// const createHttpError = require('http-errors')
const Router = require('koa-router')
const { renderError } = require('oidc-provider/lib/helpers/defaults')() // make your own, you'll need it anyway
const url = require('url')
const Account = require('../account')
const Log = require('@dazn/lambda-powertools-logger')
const keys = new Set()
const debug = obj => querystring.stringify(Object.entries(obj).reduce((acc, [key, value]) => {
  keys.add(key)
  if (isEmpty(value)) return acc
  acc[key] = inspect(value, { depth: null })
  return acc
}, {}), '<br/>', ': ', {
  encodeURIComponent(value) { return keys.has(value) ? `<strong>${value}</strong>` : value }
})

module.exports = provider => {
  Log.debug(`interactionjas: is called with ${provider}`)
  const router = new Router()
  const { constructor: { errors: { SessionNotFound } } } = provider

  router.use(async (ctx, next) => {
    ctx.set('Pragma', 'no-cache')
    ctx.set('Cache-Control', 'no-cache, no-store')
    try {
      await next()
    } catch (err) {
      Log.debug('interactionjas: caught an error', err)
      if (err instanceof SessionNotFound) {
        ctx.status = err.status
        const { message: error, errorDescription } = err
        renderError(ctx, { error, errorDescription }, err)
      } else {
        throw err
      }
    }
  })

  router.get('/interaction/:uid', async (ctx, next) => {
    Log.debug('interactionjas: is called the interaction for Uid')
    const {
      uid, prompt, params, session
    } = await provider.interactionDetails(ctx.req, ctx.res)
    Log.debug(`interactionjas: got back interaction details udi = ${uid} prompt=  ${prompt}, params= ${params} and session = ${session}`)
    Log.debug('interactionjas: Going to find client', params.client_id)
    const client = await provider.Client.find(params.client_id)
    Log.debug('interactionjas: found client', client)
    switch (prompt.name) {
      case 'select_account': {
        Log.debug('interactionjas: prompt is select_account with session', session)
        if (!session) {
          Log.debug('interactionjas: oops session not found!')
          return provider.interactionFinished(ctx.req, ctx.res, {
            select_account: {}
          }, { mergeWithLastSubmission: false })
        }
        const account = await provider.Account.findAccount(ctx, session.accountId)
        const { email } = await account.claims('prompt', 'email', { email: null }, [])
        return ctx.render('select_account', {
          client,
          uid,
          email,
          details: prompt.details,
          params,
          title: 'Sign-in',
          session: session ? debug(session) : undefined,
          dbg: {
            params: debug(params),
            prompt: debug(prompt)
          }
        })
      }
      case 'login': {
        Log.debug('interactionjas: prompt is login')
        return ctx.render('login', {
          client,
          uid,
          details: prompt.details,
          params,
          title: 'Let me Sign-in',
          session: session ? debug(session) : undefined,
          dbg: {
            params: debug(params),
            prompt: debug(prompt)
          }
        })
      }
      case 'consent': {
        Log.debug('interactionjas: prompt is consent')
        return ctx.render('interaction', {
          client,
          uid,
          details: prompt.details,
          params,
          title: 'Authorize',
          session: session ? debug(session) : undefined,
          dbg: {
            params: debug(params),
            prompt: debug(prompt)
          }
        })
      }
      default:
        Log.debug('interactionjas: prompt is default')
        return next()
    }
  })

  const body = bodyParser({
    text: false, json: false, patchNode: true, patchKoa: true
  })

  router.post('/interaction/:uid/login', body, async ctx => {
    Log.debug('interactionjas: is called the interaction for login')
    // const { prompt: { name } } = await provider.interactionDetails(ctx.req, ctx.res)
    const {
      uid, prompt, params, session
    } = await provider.interactionDetails(ctx.req, ctx.res)
    assert.equal(prompt.name, 'login')
    Log.debug('request is: ', ctx.request)
    Log.debug('login params', ctx.request.body.username, ctx.request.body.password)

    const authResult = await provider.Account.authenticate(ctx.request.body.username, ctx.request.body.password)

    Log.debug('interactionjas: account authentication result', authResult)

    const result = {
      select_account: {}, // make sure its skipped by the interaction policy since we just logged in
      login: {
        account: authResult.sub
      }
    }

    return provider.interactionFinished(ctx.req, ctx.res, result, {
      mergeWithLastSubmission: false
    })
  })

  router.post('/interaction/:uid/continue', body, async ctx => {
    Log.debug('interactionjas: is called the interaction for continue')
    const interaction = await provider.interactionDetails(ctx.req, ctx.res)
    const { prompt: { name, details } } = interaction
    assert.equal(name, 'select_account')

    if (ctx.request.body.switch) {
      if (interaction.params.prompt) {
        const prompts = new Set(interaction.params.prompt.split(' '))
        prompts.add('login')
        interaction.params.prompt = [...prompts].join(' ')
      } else {
        interaction.params.prompt = 'login'
      }
      await interaction.save()
    }

    const result = { select_account: {} }
    return provider.interactionFinished(ctx.req, ctx.res, result, {
      mergeWithLastSubmission: false
    })
  })

  router.post('/interaction/:uid/confirm', body, async ctx => {
    Log.debug('interactionjas: is called the interaction for confirm')
    const { prompt: { name, details } } = await provider.interactionDetails(ctx.req, ctx.res)
    assert.equal(name, 'consent')

    const consent = {}

    // any scopes you do not wish to grant go in here
    //   otherwise details.scopes.new.concat(details.scopes.accepted) will be granted
    consent.rejectedScopes = []

    // any claims you do not wish to grant go in here
    //   otherwise all claims mapped to granted scopes
    //   and details.claims.new.concat(details.claims.accepted) will be granted
    consent.rejectedClaims = []

    // replace = false means previously rejected scopes and claims remain rejected
    // changing this to true will remove those rejections in favour of just what you rejected above
    consent.replace = false

    const result = { consent }
    return provider.interactionFinished(ctx.req, ctx.res, result, {
      mergeWithLastSubmission: true
    })
  })

  router.get('/interaction/:uid/abort', async ctx => {
    Log.debug('interactionjas: is called the interaction for abort')
    const result = {
      error: 'access_denied',
      error_description: 'End-User aborted interaction'
    }

    return provider.interactionFinished(ctx.req, ctx.res, result, {
      mergeWithLastSubmission: false
    })
  })

  return router
}
