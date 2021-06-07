#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT


function delete_acm_certs() {
  domain="${1:-thinkr.dev}"
  while : ; do
    aws acm list-certificates --query "CertificateSummaryList[?ends_with(DomainName, '$domain')]|[*].[CertificateArn]" --output text $starting_token | while read -r line ; do
        if [[ -z "$line" ]]; then
          continue
        fi        
        echo "deleting $line" > /dev/tty
        aws acm delete-certificate --certificate-arn "$line"
    done
    next_token=$(aws acm list-certificates --query NextToken --output text | grep -v None)
    if [[ -z "$next_token" ]]; then
      starting_token=""
      break
    else
      starting_token="--starting-token $next_token"
    fi
  done
  echo "Done deleting ACM Certificates" > /dev/tty
}