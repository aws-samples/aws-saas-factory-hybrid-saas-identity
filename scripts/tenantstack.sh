#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT
set -e 

# Deploy the test stack, get the stack outputs into outputs.json
# Note you should not auto-verify email addresses like done here.
# especially if you use the email domain to interpret tenant
# done here only for ease of demo'ing the solution.


# get_random_password():
# inputs:
# This function gets a random password using secrets manager,
# it excludes certain characters to make the password play nice with shell commands.
function get_random_password() {
  local pass=$(aws secretsmanager get-random-password \
  --no-include-space \
  --exclude-characters "\"'\\" \
  --password-length 20 \
  --query RandomPassword \
  --output text)
  echo "$pass"
}

# get_secret_value():
# inputs:
# This function gets the simplead admin password from secrets manager,
# it assumes that the simplead stack was already deployed and the password is available to retrieve.
function get_secret_value() {
  local pass=$(aws secretsmanager get-secret-value \
  --secret-id '/mysaasapp/test/simplead/adminpass' \
  --query SecretString \
  --output text)
  echo "$pass"
}

# create_user():
# inputs: 
# postion:1, name:username, definition: email address
# postion:2, name:userpoolid, definition: cognito user pool id
# This function creates a user in the supplied userpoolid using the supplied emailid,
# it suppresses the usual email notification sent by cognito. use this only if you want to admin set password next.
# ***It is strongly discouraged to create email id based users in userpool in a federation scenario.****
function create_user() {
  aws cognito-idp admin-create-user \
    --user-pool-id $2 \
    --username $1 \
    --user-attributes Name=email,Value=$1 \
    --message-action SUPPRESS >/dev/null 2>&1
  if [ $? -eq 0 ]; then echo 0; else echo 1; fi
}

echo "creating hsi.out directory for temp files"

# Creating hsi out directory for temp output files
# this should already be inlcuded in the .gitgnore file.
# sensitive strings will be written, never checkin the files from this folder
# to your version control.
mkdir -p hsi.out

# check the aws cli version installed
# for V2 lambda invoke needs additional parameter
awscliversion=$(aws --version)
if [[ $awscliversion == aws-cli/2* ]];
then
  echo "AWS CLI version 2 detected"
  addnlParam="--cli-binary-format raw-in-base64-out"
else
  echo "AWS CLI version 1 detected"
  addnlParam=""
fi

echo "checking if email address is supplied in the input"

if [ $# -eq 0 ]
  then
    echo "No arguments supplied, you need to supply an email address"
    echo "command format: ./tenantstack.sh your-email-address.com"
fi

if [ -z "$1" ]
  then
    echo "You need to supply an email address with the shell command as argument:"
    echo "command format: ./tenantstack.sh your-email-address.com"
fi

echo "Deploying Test CDK Stack next..."

npm run cdk deploy TestStackApp -- \
-a "npx ts-node bin/setup_test_infra.ts" \
-o dist \
--outputs-file hsi.out/outputs.json \
--require-approval never

echo "Done deploying Test CDK Stack"

echo "Going to create test users next..."

# Use the UserpoolID to create one test user in userpool1
Tenant1UserPoolID=$(cat ./hsi.out/outputs.json | jq '.TestStackApp.Tenant1UserPoolID' -r)
Tenant1UserPoolClientID=$(cat ./hsi.out/outputs.json | jq '.TestStackApp.Tenant1UserPoolClientID' -r)
Tenant1UserPoolRegion=$(cat ./hsi.out/outputs.json | jq '.TestStackApp.Tenant1UserPoolRegion' -r)

echo "UserpoolID-1 is ${Tenant1UserPoolID}"

echo "Going to create $1 in userpool ${Tenant1UserPoolID} next..."

user1created=$(create_user $1 $Tenant1UserPoolID)
if [ $user1created = 0 ]
  then 
    echo "User $1 Created in $Tenant1UserPoolID"; 
  else 
    echo "User $1 already exists in $Tenant1UserPoolID"; 
fi
Tenant1User1Pass=$(get_random_password)

echo "Going to set password for $1 in userpool ${Tenant1UserPoolID} next..."

aws cognito-idp admin-set-user-password \
    --user-pool-id $Tenant1UserPoolID \
    --username $1 \
    --password "$Tenant1User1Pass" \
    --permanent

# Use the UserpoolID to create one test user in userpool2
Tenant2UserPoolID=$(cat ./hsi.out/outputs.json | jq '.TestStackApp.Tenant2UserPoolID' -r)
Tenant2UserPoolClientID=$(cat ./hsi.out/outputs.json | jq '.TestStackApp.Tenant2UserPoolClientID' -r)
Tenant2UserPoolRegion=$(cat ./hsi.out/outputs.json | jq '.TestStackApp.Tenant2UserPoolRegion' -r)

echo "UserpoolID-2 is ${Tenant2UserPoolID}"

echo "Going to create $1 in userpool ${Tenant2UserPoolID} next..."

user2created=$(create_user $1 $Tenant2UserPoolID)

echo "Going to set password for $1 in userpool ${Tenant2UserPoolID} next..."

if [ $user2created = 0 ]
  then 
    echo "User $1 created in $Tenant2UserPoolID"; 
  else 
    echo "User $1 already exists in $Tenant2UserPoolID"; 
fi

echo "Going to get a random password from secrets manager"
Tenant2User1Pass=$(get_random_password)

echo "Going to set password for $1 in userpool ${Tenant2UserPoolID} next..."
aws cognito-idp admin-set-user-password \
    --user-pool-id $Tenant2UserPoolID \
    --username $1 \
    --password "$Tenant2User1Pass" \
    --permanent

# Create user1/group1,user2/group2 in Simple Active Directory
echo "Going to run Lambda function that creates test users in SimpleAd next..."

# Get the Lambda function name
TestUserGroupLambdaName=$(cat ./hsi.out/outputs.json | jq '.TestStackApp.testusergrouplambdaname' -r)
echo "testusergrouplambdaname: ${TestUserGroupLambdaName}"

# Get random passwords for two test users from secrets manager and passing it to lambda function as event.
# ****Note don't do this for your existing ldap server. only done here as convenience for testing****
# to print out the passwords to console to test out HSI.
Tenant3User1Pass=$(get_random_password)
Tenant3User2Pass=$(get_random_password)

# SimpleAD Admin user is already created, retrieving the password next from secrets mgr
Tenant3AdminPass=$(get_secret_value)
Tenant3LDAPIP1=$(cat ./hsi.out/outputs.json | jq '.SimpleADStack.LDAPIP1' -r)
Tenant3LDAPIP2=$(cat ./hsi.out/outputs.json | jq '.SimpleADStack.LDAPIP2' -r)
Tenant3LDAPVPC=$(cat ./hsi.out/outputs.json | jq '.TestStackApp.VPCID' -r)
Tenant3LDAPDID=$(cat ./hsi.out/outputs.json | jq '.SimpleADStack.DirectoryID' -r)
Tenant3SG1=$(cat ./hsi.out/outputs.json | jq '.TestStackApp.lambdasecuritygroup1ID' -r)
Tenant3SG2=$(cat ./hsi.out/outputs.json | jq '.TestStackApp.lambdasecuritygroup2ID' -r)
Tenant3SUBNET1=$(cat ./hsi.out/outputs.json | jq '.TestStackApp.Subnet1ID' -r)
Tenant3SUBNET2=$(cat ./hsi.out/outputs.json | jq '.TestStackApp.Subnet2ID' -r)

# Invoking the lambda now
LambdaResponse=$(aws lambda invoke \
    --function-name ${TestUserGroupLambdaName} $addnlParam \
    --payload "{\"pass1\":\"${Tenant3User1Pass}\", \"pass2\":\"${Tenant3User2Pass}\"}" \
    hsi.out/response.json)

# check if the lambda succeeded
LambdaError=$(echo $LambdaResponse | jq '.FunctionError' -r)
if [ "$LambdaError" = "Unhandled" ]
  then 
    echo "Error in Lambda"
    echo "Please check cloudwatch logs for lambda function: $TestUserGroupLambdaName"
  else
    {
      echo "Done creating test users in SimpleAd";
      echo "resetting simple ad user password one more time"
      Tenant3User1Pass=$(get_random_password)
      Tenant3User2Pass=$(get_random_password)
      aws ds reset-user-password --directory-id $Tenant3LDAPDID --user-name user1 --new-password $Tenant3User1Pass
      aws ds reset-user-password --directory-id $Tenant3LDAPDID --user-name user2 --new-password $Tenant3User2Pass
      # Printing out everything needed for testing.
      echo "***************************************************************************"
      echo "***************************************************************************"
      echo "Use the below credentials to test out tenant-1, tenant-2, tenant-3."
      echo "Space included after -password: is not part of the actual password. do not copy that."
      echo "***************************************************************************"
      echo "***************************************************************************"
      echo "Use this for Tenant-1 with Cognito as backend IDP"
      echo "Tenant-1 Userpool1 user1 username:${1} and password: ${Tenant1User1Pass}"
      echo "---------------------------------------------------------------------------"
      echo """
      {
        \"tenantIDPType\" : \"cognito\",
        \"dynamodbTableName\":\"oidc-provider\",
        \"logLevel\": \"ERROR\",
        \"cognitoConfig\" : {
            \"userPoolClientId\" : \"${Tenant1UserPoolClientID}\",
            \"userPoolId\" : \"${Tenant1UserPoolID}\",
            \"userPoolRegion\" : \"${Tenant1UserPoolRegion}\"
        }
      }
      """
      echo "---------------------------------------------------------------------------"
      echo "Use this for Tenant-2 with Cognito as backend IDP"
      echo "Tenant-2 Userpool2 user1 username:${1} and password: ${Tenant2User1Pass}"
      echo "---------------------------------------------------------------------------"    
      echo """
      {
        \"tenantIDPType\" : \"cognito\",
        \"dynamodbTableName\":\"oidc-provider\",
        \"logLevel\": \"ERROR\",
        \"cognitoConfig\" : {
            \"userPoolClientId\" : \"${Tenant2UserPoolClientID}\",
            \"userPoolId\" : \"${Tenant2UserPoolID}\",
            \"userPoolRegion\" : \"${Tenant2UserPoolRegion}\"
        }
      }
      """
      echo "---------------------------------------------------------------------------"
      echo "Use this for Tenant-3 with SimpleAD as backend IDP"
      echo "Tenant-3 LDAP user1/group1 username: user1@auth.tenant-3.com and password: ${Tenant3User1Pass}"
      echo "Tenant-3 LDAP user2/group2 username: user2@auth.tenant-3.com and password: ${Tenant3User2Pass}"
      echo "Tenant-3 LDAP Admin username: Administrator@auth.tenant-3.com and password: ${Tenant3AdminPass}"
      echo "---------------------------------------------------------------------------"    
      echo """
      {
        \"tenantIDPType\" : \"ldap\",
        \"dynamodbTableName\":\"oidc-provider\",
        \"logLevel\": \"ERROR\",
        \"ldapConfig\" : {
            \"ldapSuffix\" : \"dc=auth,dc=tenant-3,dc=com\",
            \"ldapUrl\" : \"ldap://${Tenant3LDAPIP1}\",
            \"ldapUser\": \"Administrator@auth.tenant-3.com\",
            \"ldapUserPassword\": \"${Tenant3AdminPass}\"
        },
        \"vpcConfig\": {
            \"vpcId\":\"${Tenant3LDAPVPC}\",
            \"securityGroupIds\": [\"${Tenant3SG1}\", \"${Tenant3SG2}\"],
            \"subnetIds\": [\"${Tenant3SUBNET1}\", \"${Tenant3SUBNET1}\"]
        }
      }
      """   
      echo "---------------------------------------------------------------------------"
      echo "***************************************************************************"
      echo "***************************************************************************"
    } 2>&1 | tee ./hsi.out/tenantstack.out
fi
