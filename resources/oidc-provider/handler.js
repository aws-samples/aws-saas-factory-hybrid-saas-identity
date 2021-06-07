// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
const { handleRequest } = require('./index')

exports.oidc = async (event, context) => handleRequest(event, context)
