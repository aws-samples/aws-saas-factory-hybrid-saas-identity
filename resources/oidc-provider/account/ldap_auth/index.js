// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-console */
const ldap = require('ldapjs')
const url = require('url')
const Account = require('..')
const { getSecret } = require('../../helpers/get_secret')
const Log = require('@dazn/lambda-powertools-logger')
//tenantconfig.ldapurl, tenantconfig.ldapsuffix, tenantconfig.domain, tenant_id
//ldapurl, ldapsuffix, domain, tenant_id
class LDAPAccount extends Account {
  constructor(id, claims, tenantconfig) {
    super(id, claims)
    this.tenantconfig = tenantconfig

  }
 
  async authenticate(email, password) {
    Log.debug('authenticate from oidc/account/cognito just got invoked!')
    return Promise.resolve()
      .then(() => new Promise((resolve, reject) => {

        const client = ldap.createClient({
          url: this.tenantconfig.ldapurl
        })

        const opts = {
          filter: `(&(cn=${email.split('@')[0]})(objectClass=user))`,
          scope: 'sub'
        }

        client.bind(email, password, err => {
          if (err) {
            Log.debug(err.message)
            client.unbind(error => { if (error) { Log.debug(error.message) } else { Log.debug('ldap client disconnected') } reject(err) })
          } else {
            Log.debug("Bind successfull, going to search now")
            var user
            client.search(this.tenantconfig.ldapsuffix, opts, (err, res) => {
              res.on('searchEntry', entry => {
                user = entry.object
                Log.debug('ldap user found', entry.object)
                
              })
              res.on('searchReference', referral => {
                Log.debug('ldap referral: ' + referral.uris.join());
              });
              res.on('error', err => {
                Log.error('ldap error: ' + err.message);
                reject(err)
              });
              res.on('end', result => {
                Log.debug('ldap search ended: ',result);
                resolve({sub:user.sAMAccountName ,raw:user})
              });
            })
          }
        })
      }))
  }

  async findAccount(ctx, id) {
    Log.debug(`ldapaccount: about to find user ${id} in ldap ${this.tenantconfig.ldapurl}`, ctx)
    return Promise.resolve()
      .then(() => new Promise(async (resolve, reject) => {

        const client = ldap.createClient({
          url: this.tenantconfig.ldapurl
        })

        const opts = {
          filter: `(&(cn=${id})(objectClass=user))`,
          scope: 'sub'
        }

        const tenantLdapUserPassword = await getSecret(this.tenantconfig.ldapuserpassword)

        Log.debug(`ldapaccount: going to bind with user:${this.tenantconfig.ldapuser} and password:${tenantLdapUserPassword}`)

        client.bind(this.tenantconfig.ldapuser, tenantLdapUserPassword, err => {
          if (err) {
            Log.error(err.message)
            client.unbind(error => { if (error) { Log.debug(error.message) } else { Log.debug('ldap client disconnected') } reject(err) })
          } else {
            Log.debug("Bind successfull, going to search now")
            var user
            client.search(this.tenantconfig.ldapsuffix, opts, (err, res) => {
              res.on('searchEntry', entry => {
                user = entry.object
                Log.debug('ldap user found', entry.object)
                
              })
              res.on('searchReference', referral => {
                Log.debug('ldap referral: ' + referral.uris.join());
              });
              res.on('error', err => {
                Log.error('ldap error: ' + err.message);
                reject(err)
              });
              res.on('end', result => {
                Log.debug('ldap search ended: ',result);
                resolve([{ "Name":"sub","Value": user.sAMAccountName },{"Name":"email","Value": user.sAMAccountName+'@'+this.tenantconfig.domain},{"Name":"tenantid","Value":this.tenantconfig.tenant_id}])
              });
            })
          }
        })



        
      }))
      .then(data => {
        // Return the value of Cognito's UserAttributes as climes.
        const claims = async (use, scope, claims, rejected) => {
          Log.debug(`ldapaccount: claims was called with use: ${use}, scope: ${scope}, claims: ${claims}, rejected: ${rejected}, data: ${data}`)
          
          const clms = data.reduce((acc, current) => {
            acc[current.Name] = current.Value
            return acc
          }, {})
          clms.tenantid=this.tenantconfig.tenant_id
          Log.debug('ldapaccount: claims will return!', clms)
          return clms
        }
        return new LDAPAccount(id, claims, this.tenantconfig.ldapurl, this.tenantconfig.ldapsuffix, this.tenantconfig.domain, this.tenantconfig.tenant_id)
      })
  }
}
module.exports = LDAPAccount
