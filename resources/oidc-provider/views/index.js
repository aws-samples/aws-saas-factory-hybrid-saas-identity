// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
const ejs = require('ejs')

const layout = require('./layout.ejs')
const login = require('./login.ejs')
const interaction = require('./interaction.ejs')
const selectaccount = require('./select_account.ejs')

module.exports = {
  interaction: ejs.compile(interaction.toString('utf8')),
  layout: ejs.compile(layout.toString('utf8')),
  login: ejs.compile(login.toString('utf8')),
  select_account: ejs.compile(selectaccount.toString('utf8'))
}
