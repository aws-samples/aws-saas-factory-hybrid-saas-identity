/* eslint-disable func-names */
/* eslint-disable prefer-template */
/* eslint-disable no-console */
const ldap = require('ldapjs');
const Log = require('@dazn/lambda-powertools-logger');
const { promisify } = require('util');
const { getSecret } = require('./helpers/get_secret');

function searchPromise(client, base, opts) {
  return new Promise((resolve, reject) => {
    client.search(base, opts, (err, res) => {
      if (err) throw err;

      res.on('searchEntry', (entry) => {
        console.log('entry: ' + JSON.stringify(entry.object));
      });
      res.on('searchReference', (referral) => {
        console.log('referral: ' + referral.uris.join());
      });
      res.on('error', (error) => {
        console.error('error: ' + error.message);
        reject(error);
      });
      res.on('end', (result) => {
        console.log('status: ' + result.status);
        resolve(result);
      });
    });
  });
}

exports.handler = async function (event, context) {
  console.log(event);
  const client = ldap.createClient({
    url: JSON.parse(process.env.LDAP_URL),
  });
  const abind = promisify(client.bind).bind(client);
  const aadd = promisify(client.add).bind(client);
  const aunbind = promisify(client.unbind).bind(client);
  const amodify = promisify(client.modify).bind(client);
  const group1 = {
    cn: 'group1',
    objectclass: 'group',
    member: 'dc=auth,dc=tenant-3,dc=com',
    description: 'testing group1',
  };
  const group2 = {
    cn: 'group2',
    objectclass: 'group',
    member: 'dc=auth,dc=tenant-3,dc=com',
    description: 'testing group2',
  };
  const user1 = {
    cn: 'user1',
    sn: 'bar',
    sAMAccountName: 'user1',
    objectClass: [
      'top',
      'person',
      'organizationalPerson',
      'user',
    ],
    objectCategory: 'CN=Person,CN=Schema,CN=Configuration,DC=auth,DC=tenant-3,DC=com',
    distinguishedName: 'CN=user1,OU=Users,DC=auth,DC=tenant-3,DC=com',
    pwdLastSet: -1,
    userPassword: event.pass2,
  };
  const user2 = {
    cn: 'user2',
    sn: 'bar',
    sAMAccountName: 'user2',
    objectClass: [
      'top',
      'person',
      'organizationalPerson',
      'user',
    ],
    objectCategory: 'CN=Person,CN=Schema,CN=Configuration,DC=auth,DC=tenant-3,DC=com',
    distinguishedName: 'CN=user2,OU=Users,DC=auth,DC=tenant-3,DC=com',
    pwdLastSet: -1,
    userPassword: event.pass2,
  };
  const opts = {
    scope: 'sub',
    filter: '|(cn=user1)(cn=user2)',
    paged: true,
    sizeLimit: 200,
  };
  const change1 = new ldap.Change({
    operation: 'add',
    modification: {
      member: ['cn=user1,dc=auth,dc=tenant-3,dc=com'],
    },
  });
  const change2 = new ldap.Change({
    operation: 'add',
    modification: {
      member: ['cn=user2,dc=auth,dc=tenant-3,dc=com'],
    },
  });
  try {
    console.log('about to bind now');
    const ldapPass = await getSecret(process.env.LDAP_ADMIN_PASS);
    console.log('LDAP Admin user name:', process.env.LDAP_ADMIN_USERNAME);
    console.log('LDAP Admin password:', ldapPass);
    const bindResp = await abind(
      process.env.LDAP_ADMIN_USERNAME,
      ldapPass,
    );
    Log.info('Bind successfull, going to add groups now', bindResp);
    const addGroupResp1 = await aadd('cn=group1,dc=auth,dc=tenant-3,dc=com', group1);
    const addGroupResp2 = await aadd('cn=group2,dc=auth,dc=tenant-3,dc=com', group2);
    Log.info('Add Group successfull, going to add users now', addGroupResp1, addGroupResp2);
    const addUserResp1 = await aadd('cn=user1,dc=auth,dc=tenant-3,dc=com', user1);
    const addUserResp2 = await aadd('cn=user2,dc=auth,dc=tenant-3,dc=com', user2);
    Log.info('Add User successfull, going to add users to group next', addUserResp1, addUserResp2);
    const addUserToGroupResp1 = await amodify('cn=group1,dc=auth,dc=tenant-3,dc=com', change1);
    const addUserToGroupResp2 = await amodify('cn=group2,dc=auth,dc=tenant-3,dc=com', change2);
    Log.info('Add User to group successfull, will search next', addUserToGroupResp1, addUserToGroupResp2);
    const searchResp = await searchPromise(client, 'dc=auth,dc=tenant-3,dc=com', opts);
    Log.info('Search successfull, result: ', searchResp);
    context.succeed('success');
  } catch (error) {
    Log.error('error', error);
    await aunbind();
    Log.debug('ldap client disconnected');
    context.fail(error);
  }
  console.log('I am not waiting for this and ending the lambda run');
};
