// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/**
 * Using API Gateway and Lambda dynamically changes the directory path.
 * A helper method for getting those information.
 * @param { Object } event - Event passed from API Gateway.
 */

const getMountOption = event => {
  const Log = require('@dazn/lambda-powertools-logger')
  Log.debug('received this event', event)
  const resource = event.resource //'/{proxy+}'
  const appPath = `/${event.pathParameters.proxy}` // '/8048732e-d0b3-4f5e-9c8d-e49cd69152aa/.well-known/openid-configuration'
  const requestContextPath = event.requestContext.path //'/prod/8048732e-d0b3-4f5e-9c8d-e49cd69152aa/.well-known/openid-configuration'
  var newAppPath = appPath.split('/')

  newAppPath.splice(1,1)
  newAppPath = newAppPath.join('/')

  // Directory specified by API Gateway setting.
  const internal = resource.split('/').slice(0, -1).join('/')
  // Directory that appears due to external factors,
  // such as execute-api or custom domain path settings.
  const external = requestContextPath
    .substring(0, requestContextPath.length - (newAppPath.length + internal.length))

  const directory = external + internal
  Log.debug(`directory is ${directory} `)



  // A value to overwrite the path from lambda so that it is the path assumed by app
  const rewriteEventPath = external + internal + newAppPath
  Log.debug(`rewrite event path is ${rewriteEventPath}`)

  // If root of API Gateway and root of custom domain, mountOption does not exist.
  return (directory.length > 0) ? { directory, rewriteEventPath } : undefined
}

module.exports = {
  getMountOption
}
