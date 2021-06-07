#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT

function delete_cfn_stack() {
      echo "About to delete stack $1" > /dev/tty
      aws cloudformation delete-stack --stack-name $1
      aws cloudformation wait stack-delete-complete --stack-name $1
}


function delete_cfn_stacks() {
  stack1=$(aws cloudformation list-stacks --query 'StackSummaries[?starts_with(StackName, `Dev-AwsSaasFactoryHybridIdentityBaseStackoidcclient`)]|[*].[StackName]' --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --output text)
  if [ "$stack1" ]
    then
      delete_cfn_stack $stack1
  fi

  stack2=$(aws cloudformation list-stacks --query 'StackSummaries[?starts_with(StackName, `Dev-AwsSaasFactoryHybridIdentityBaseStacktenantservice`)]|[*].[StackName]' --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --output text)
  if [ "$stack2" ]
    then
      delete_cfn_stack $stack2
  fi
  stack3=$(aws cloudformation list-stacks --query 'StackSummaries[?starts_with(StackName, `Dev-AwsSaasFactoryHybridIdentityBaseStackoidcresource`)]|[*].[StackName]' --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --output text)
  if [ "$stack3" ]
    then
      delete_cfn_stack $stack3
  fi
  stack4=$(aws cloudformation list-stacks --query 'StackSummaries[?starts_with(StackName, `Dev-AwsSaasFactoryHybridIdentityBaseStack`)]|[*].[StackName]' --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --output text)
  if [ "$stack4" ]
    then
      delete_cfn_stack $stack4
  fi
  while : ; do
    aws cloudformation list-stacks --query 'StackSummaries[?starts_with(StackName, `OidcProviderDeploymentStack`)]|[*].[StackName]' --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --output text $starting_token | while read -r line ; do
      if [[ -z "$line" ]]; then
        continue
      fi      
      delete_cfn_stack $line
    done
    next_token=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query NextToken --output text | grep -v None)
    if [[ -z "$next_token" ]]; then
      starting_token=""
      break
    else
      starting_token="--starting-token $next_token"
    fi
  done
  echo "Done deleting Cloudformation stacks" > /dev/tty
}

