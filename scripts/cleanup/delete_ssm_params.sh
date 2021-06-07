#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT

function delete_params() {
  defaultpath="/mysaasapp"
  path="${1:-$defaultpath}"
  while : ; do
    names=$(aws ssm get-parameters-by-path --path "$path" --query 'Parameters[*].Name' --output text --recursive --max-items 10 $starting_token | grep -v None)
    if [[ -z "$names" ]]; then
      break
    fi
    echo "deleting $names" > /dev/tty
    aws ssm delete-parameters --names $names
    echo "deletion current set done, fetching next set" > /dev/tty
    next_token=$(aws ssm get-parameters-by-path --path "$path" --query NextToken --recursive --output text --max-items 10 | grep -v None)
    if [[ -z "$next_token" ]]; then
      echo "Next token not found, going to break" > /dev/tty
      starting_token=""
      break
    else
      echo "Next token found, $next_token" > /dev/tty
      starting_token="--starting-token $next_token"
    fi
  done
  echo "Done deleting parameters" > /dev/tty
}