// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-console */
/* eslint-disable no-param-reassign */
const Log = require('@dazn/lambda-powertools-logger')
const serverless = require('aws-serverless-express')
const path = require('path')
const logger = require('koa-logger')
const Koa = require('koa')
const Provider = require('oidc-provider')
const helmet = require('koa-helmet')
const mount = require('koa-mount')
const render = require('koa-ejs')
const set = require('lodash/set');
const { getMountOption } = require('./helpers/get-mount-option')
const getsettings = require('./settings')
const routes = require('./actions/interaction')
const querystring = require('querystring')
var jwt = require('jsonwebtoken');

/**
 * A function for handling requests within the handler of lambda.
 * @param { Object } event - Event passed from API Gateway.
 * @param { Object } context - Lambda context.
 * @param { Function } callback - Lambda callback.
 * @param { ?Object } settings - Values for setting and initializing Provider.
 */
const handleRequest = async (event, context) => {
  const mountOption = getMountOption(event)
  Log.info('mount option is', mountOption)
  const client_id = event.path.split('/')[1]
  const settings = await getsettings(client_id)
  Log.info('OIDC-Provider: Settings retrieved', settings)
  const provider = new Provider(settings.issure+client_id, settings.configuration)
  const koaApp = new Koa()
  Log.info(`going to set the koa view render root to: ${path.resolve("views/login.ejs")}`)

  render(koaApp, {
    cache: false,
    viewExt: 'ejs',
    layout: 'layout',
    root: path.join(__dirname, 'views'),
  })
  Log.info('about to setup app with this config', settings.configuration)

  koaApp.proxy = true
  koaApp.keys = settings.secureKeys
  koaApp.use(helmet())
  koaApp.use(logger())
  set(settings.configuration, 'cookies.short.secure', true)
  set(settings.configuration, 'cookies.long.secure', true)

  // If devInteraction is invalid, add your own interaction to the provider's router.
  Log.info('Is dev interaction enabled?', settings.configuration.features.devInteractions.enabled)
  if (!settings.configuration.features.devInteractions.enabled) {
    Log.info('going to get interactions')
    provider.app.use(routes(provider).routes())
  }
  Log.info('OIDC-Provider: App setup done')
  // If mountOption exists, mount the application in the directory and rewrite the event path
  // in order to properly perform processing such as redirect.
  Log.info('OIDC-Provider: Mount option exists', mountOption, event)
  koaApp.use(mount(mountOption.directory, provider.app))
  event.path = mountOption.rewriteEventPath
  Log.info('here are the routes', routes(provider).routes())
  Log.info(`here are may be routes again ${routes(provider).stack.map(i => i.path)}`)
  const server = serverless.createServer(koaApp.callback())
  return new Promise((resolve, reject) => {
    serverless.proxy(
      server,
      event,
      { ...context, succeed: process.env.IS_OFFLINE ? context.succeed : resolve }

    )
  })
}

module.exports = { handleRequest }
