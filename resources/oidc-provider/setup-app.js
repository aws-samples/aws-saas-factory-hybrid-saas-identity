// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-console */
const path = require('path')
const Log = require('@dazn/lambda-powertools-logger')
const Provider = require('oidc-provider')

const Koa = require('koa')
const render = require('koa-ejs')

const routes = require('./actions/interaction')
/**
 * Function to set up oidc provider app.
 * @param { Object } settings - Values for setting and initializing Provider.
 */
module.exports = async function setupApp(settings) {
  const app = new Koa()
  render(app, {
    cache: false,
    viewExt: 'ejs',
    layout: '_layout',
    root: path.join(__dirname, '..', 'views')
  })
  const provider = new Provider(settings.issure, settings.configuration)
  Log.debug('about to setup app with this config', settings.configuration)

  provider.app.proxy = true
  provider.app.keys = settings.secureKeys

  // If devInteraction is invalid, add your own interaction to the provider's router.
  Log.debug('Is dev interaction enabled?', settings.configuration.features.devInteractions.enabled);
  if (!settings.configuration.features.devInteractions.enabled) {
    Log.debug('going to get interactions')
    app.use(routes(provider).routes())
    return app
  }

  return provider.app
}

