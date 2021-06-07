/* eslint-disable no-console */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT

module.exports.hello = (event, context, callback) => {
  console.debug('here is the event', event);
  console.debug('here is the context', context);
  const response = {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Here is a warm unicorn cookie for you!',
      input: event,
    }),
  };

  callback(null, response);

  // Use this code if you don't use the http event with the LAMBDA-PROXY integration
  // callback(null, { message: 'Go Serverless v1.0! Your function executed successfully!', event });
};
