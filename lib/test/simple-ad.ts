/* eslint-disable max-len */
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT
/* eslint-disable no-unused-vars */
/* eslint-disable no-new */
import {
  Construct, Stack, StackProps, CfnOutput, Fn, Duration, Lazy,
} from '@aws-cdk/core';
import {
  SecurityGroup, SubnetType, Vpc, NatProvider,
} from '@aws-cdk/aws-ec2';
import * as nodejslambda from '@aws-cdk/aws-lambda-nodejs';
import { CfnSimpleAD } from '@aws-cdk/aws-directoryservice';
import { Secret } from '@aws-cdk/aws-secretsmanager';

const path = require('path');

export default class SimpleAdStack extends Stack {
  public readonly vpcId: string;

  public readonly subnetId1: string;

  public readonly subnetId2: string;

  public readonly securityGroupId1: string;

  public readonly securityGroupId2: string;

  public readonly testusergrouplambdaname: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const ldapDomain = 'auth.tenant-3.com';

    const vpc = new Vpc(this, 'TheVPC', {
      cidr: '10.0.0.0/21',
      maxAzs: 2,
      natGatewayProvider: NatProvider.gateway(),
      natGateways: 1,
    });
    const secret = new Secret(this, 'Secret', {
      secretName: '/mysaasapp/test/simplead/adminpass',
      generateSecretString: {
        excludeCharacters: "\"'\\",
      },
    });
    const ad = new CfnSimpleAD(this, 'Tenant IDP SimpleAD', {
      name: ldapDomain,
      password: secret.secretValue.toString(),
      size: 'Small',
      vpcSettings: {
        subnetIds: [vpc.privateSubnets[0].subnetId, vpc.privateSubnets[1].subnetId],
        vpcId: vpc.vpcId,
      },
    });
    const sg1 = new SecurityGroup(this, 'lambda-security-group-1', { vpc });
    const sg2 = new SecurityGroup(this, 'lambda-security-group-2', { vpc });

    /**
     * Create Tenant Infra Lambda Function.
     * This will be called by the onboarding Step function.
     */
    const addTestLdapUserGroupsFunction = new nodejslambda.NodejsFunction(this, 'AddTestLdapUserGroupsFunction', {
      entry: `${path.join(path.resolve(__dirname, '..', '..'), 'resources', 'add_ldap_user_group')}/index.js`,
      handler: 'handler',
      timeout: Duration.seconds(900), // +acm validation wait of 530 seconds
      memorySize: 3008,
      vpc,
      securityGroups: [sg1, sg2],
      environment: {
        LOG_LEVEL: 'DEBUG',
        LDAP_URL: `["ldap://${Fn.select(0, ad.attrDnsIpAddresses).toString()}:389", "ldap://${Fn.select(1, ad.attrDnsIpAddresses).toString()}:389"]`,
        LDAP_ADMIN_PASS: '/mysaasapp/test/simplead/adminpass',
        LDAP_ADMIN_USERNAME: `Administrator@${ldapDomain}`,
      },
    });

    secret.grantRead(addTestLdapUserGroupsFunction);

    this.vpcId = vpc.vpcId;
    this.subnetId1 = vpc.privateSubnets[0].subnetId;
    this.subnetId2 = vpc.privateSubnets[1].subnetId;
    this.securityGroupId1 = sg1.securityGroupId;
    this.securityGroupId2 = sg2.securityGroupId;
    this.testusergrouplambdaname = addTestLdapUserGroupsFunction.functionName;
    new CfnOutput(this, 'LDAP-IP1', { value: Fn.select(0, ad.attrDnsIpAddresses) });
    new CfnOutput(this, 'LDAP-IP2', { value: Fn.select(1, ad.attrDnsIpAddresses) });
    new CfnOutput(this, 'DirectoryID', { value: ad.ref });
  }
}
