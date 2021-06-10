#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT

function delete_cfn_stack() {
      echo "About to delete stack $1" > /dev/tty
      aws cloudformation delete-stack --stack-name $1
      aws cloudformation wait stack-delete-complete --stack-name $1
}

function get_stacks_starting_with {
  stackName="${1}"
  echo $(aws cloudformation list-stacks --query "StackSummaries[?starts_with(StackName, '$stackName')]|[*].[StackName]" --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --output text)
}


function delete_cfn_stacks() {
  # Delete the oidc provider stacks
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

  # Delete the oidc client stacks
  stack1=$(get_stacks_starting_with 'Dev-AwsSaasFactoryHybridIdentityBaseStackoidcclient')
  if [ "$stack1" ]
    then
      delete_cfn_stack $stack1
  fi

  # Delete the tenant service stack
  stack2=$(get_stacks_starting_with Dev-AwsSaasFactoryHybridIdentityBaseStacktenantservice)
  if [ "$stack2" ]
    then
      delete_cfn_stack $stack2
  fi

  # Delete the oidc resource stacks
  stack3=$(get_stacks_starting_with Dev-AwsSaasFactoryHybridIdentityBaseStackoidcresource)
  if [ "$stack3" ]
    then
      delete_cfn_stack $stack3
  fi

  # Delete the hsi base stack
  stack4=$(get_stacks_starting_with Dev-AwsSaasFactoryHybridIdentityBaseStack)
  if [ "$stack4" ]
    then
      delete_cfn_stack $stack4
  fi

  echo "Done deleting Cloudformation stacks" > /dev/tty
}

