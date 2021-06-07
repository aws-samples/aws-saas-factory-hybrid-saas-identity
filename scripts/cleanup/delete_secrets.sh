#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT



function delete_secrets() {
  defaultpath="/mysaasapp"
  path="${1:-$defaultpath}"
  while : ; do
    aws secretsmanager list-secrets --filters "Key=name,Values=$path" --query "SecretList[*].[ARN]" --output text --max-items 10 $starting_token | while read -r line ; do
        if [[ -z "$line" ]]; then
          continue
        fi
        echo "deleting $line" > /dev/tty
        aws secretsmanager delete-secret --force-delete-without-recovery --secret-id $line
    done
    next_token=$(aws secretsmanager list-secrets --filters "Key=name,Values=$path" --query NextToken --output text --max-items 10 | grep -v None)
    if [[ -z "$next_token" ]]; then
      echo "Next token not found, going to break" > /dev/tty
      starting_token=""
      break
    else
      echo "Next token found, $next_token" > /dev/tty
      starting_token="--starting-token $next_token"
    fi
  done
  echo "Done deleting secrets" > /dev/tty
}