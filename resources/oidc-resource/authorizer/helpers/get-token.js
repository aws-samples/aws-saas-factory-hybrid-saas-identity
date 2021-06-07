// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
const getToken = authorizationToken => {
  if (!authorizationToken) {
    return undefined
  }

  if (!/^Bearer[ ]+([^ ]+)[ ]*$/i.test(authorizationToken)) {
    return undefined
  }

  return authorizationToken.slice(7)
}

module.exports = {
  getToken
}
