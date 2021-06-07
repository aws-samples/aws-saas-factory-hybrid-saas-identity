// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable func-names */
/* eslint-disable no-console */
const AWS = require('aws-sdk');

const documentClient = new AWS.DynamoDB.DocumentClient();
const features = require('./features.json');

/**
 *
 * Funtion that reads the cognito userpool client secret and stores it in secret manager
 * @param {*} event
 * @param {*} context
 * @param {*} callback
 */
exports.handler = async function (event) {
  const promise = new Promise((resolve, reject) => {
    try {
      const { oidcProviderDynamodbTable } = event;

      const params = {
        TableName: oidcProviderDynamodbTable,
        Item: features,
      };

      documentClient.put(params).promise()
        .then((data) => {
          console.log('Success, Default Features added.', data);
          resolve('Default Features added.');
        })
        .catch((err) => {
          console.log('Error, Default Features not added.', err);
          reject(err);
        });
    } catch (error) {
      reject(error);
    }
  });
  return promise;
};
