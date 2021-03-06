// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
const generatePolicy = (principalId, effect, resource, authContext) => ({

  principalId,
  policyDocument: {
    Version: '2012-10-17',
    Statement: [{
      Action: 'execute-api:Invoke',
      Effect: effect,
      Resource: resource,
    }],
  },
  ...((authContext) ? { context: authContext } : undefined),
});

module.exports = {
  generatePolicy,
};
