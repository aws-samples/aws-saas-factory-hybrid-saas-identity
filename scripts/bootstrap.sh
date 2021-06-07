#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT
set -e 

# script takes two positional parameters as input
# 1- CodeCommit repository name
# 2- Route53 hosted zone id

# right now repositoryName is a positional param
# defaulting it below serves only one purpose 
# for catching a empty input on purpose
# like ./scripts/bootstrap.sh "" "Z09087593DPXFLFCDP9H2"


repositoryName="${1:-hsirepo}"
hostedZoneId=$2
region=$(aws configure get region)

# function to check if the repo already exists
# normalize the response to 255/0 and return
# aws cli 1.x returns a 255 currently if the repository does not exist
# aws cli 2.x returns a 254 currently if the repository does not exist

function check_repo_exists() {
  aws codecommit get-repository --repository-name $1 >/dev/null 2>/dev/null
  local retVal=$?
  if [ $retVal -eq 255 ] || [ $retVal -eq 254 ]; then 
      echo "$1 Repository Not found" > /dev/tty
      echo 255;
  else
      echo "$1 Repository found" > /dev/tty
      echo 0;
  fi
}

# function to create git remote with name cc
# normalize the response to 255/0 and return
# git currently returns a 128 is the remote with the same name already exists
# if the return code changes, change it here in future.

function check_remote_exists() {
  git remote add cc $1 >/dev/null 2>/dev/null
  local retVal=$?
  if [ $retVal -eq 128 ]; 
    then
      echo "$1 Remote already exists" > /dev/tty
      echo 255; 
    else
      echo "$1 Remote not found, created" > /dev/tty
      echo 0;
  fi
}

# create the codecommit repository after checking for its existence
echo "Going to check if $repositoryName exists"
repoexists=$(check_repo_exists $repositoryName)
echo "check repo exists has returned this: " $repoexists
# create repo only if it does not exist
if [ "$repoexists" -eq 255 ]
then
    repometadata=$(aws codecommit create-repository \
        --repository-name $repositoryName \
        --repository-description "hybrid saas identity deploy repo")
else
    echo "repository $1 already exists, moving ahead"        
fi

# repourl stitched from region and repository name
reposshurl="codecommit::${region}://${repositoryName}"

# create a remote named cc if it does not exist
# update the cc remote with the repourl if it already exists
echo "checking if remote cc exists"
remoteexists=$(check_remote_exists $reposshurl)
echo "check remote exists returned $remoteexists"
# set remote url only if it exists already
if [ "$remoteexists" -eq 255 ]
then
    echo "Branch cc exists, going to set upstream"
    git remote set-url cc $reposshurl
    
else
    echo "Branch cc does not exist, and was created"
fi


# pushing the current code to codecommit repository
git push --set-upstream cc master

# set post install script to execute
# this is used by npm to run install for all child folders under resources
chmod +x ./scripts/bootstrap/postinstall.sh

# performaing npm i to faciliatate local esbuild of lambda functions
npm i

# cdk deploy base app
npm run cdk deploy \
HSI--Pipeline--Base -- \
-a "npx ts-node bin/base_app.ts" \
-c codecommitrepo=$repositoryName  \
-c hostedzoneid=$hostedZoneId \
-o dist \
--require-approval never

# cdk deploy oidc provider pipeline
npm run cdk deploy \
HSI--Pipeline--OidcProvider -- \
-a "npx ts-node bin/oidcproviderpipeline.ts" \
-c codecommitrepo=$repositoryName \
-c dynamodbTableName=oidc-provider \
-c logLevel=DEBUG \
-o dist \
--require-approval never

# print outputs
{
echo "***************************************************************************"
echo "***************************************************************************"
echo "---------------------------------------------------------------------------"
echo "Use the below command to get the Api Gateway endpoint to onboard new tenant"
echo '''echo "$(aws ssm get-parameter --name /mysaasapp/tenantApiEndPoint --query 'Parameter.Value' --output text)onboard"'''
echo "---------------------------------------------------------------------------"
echo "Use the below command to get the Api Gateway endpoint to add federation to existing tenant"
echo '''echo "$(aws ssm get-parameter --name /mysaasapp/tenantApiEndPoint --query 'Parameter.Value' --output text)federation"'''
echo "***************************************************************************"
echo "***************************************************************************"
} 2>&1 | tee ./hsi.out/basestack.out
