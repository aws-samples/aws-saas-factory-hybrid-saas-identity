#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT


function delete_domain_mappings() {
  domain="${1:-thinkr.dev}"
  while : ; do
    aws apigateway get-domain-names --query "items[?ends_with(domainName, '$domain')]|[*].[domainName]" --output text $starting_token | while read -r line ; do
        if [[ -z "$line" ]]; then
          continue
        fi        
        echo "deleting $line" > /dev/tty
        aws apigateway delete-domain-name --domain-name "$line"
        echo "sleeping for 40 seconds, since delete-domain-name operation has a 1 transaction per 30 second quota https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html#api-gateway-control-service-limits-table" > /dev/tty
        sleep 40
    done
    next_token=$(aws apigateway get-domain-names --query NextToken --output text | grep -v None)
    if [[ -z "$next_token" ]]; then
      starting_token=""
      break
    else
      starting_token="--starting-token $next_token"
    fi
  done
  echo "Done deleting APIGW Custom domain mappings" > /dev/tty
}