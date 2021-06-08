#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT

parent_path=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )

cd "$parent_path"

# import library functions

source ./cleanup/delete_cfn.sh
source ./cleanup/delete_domain.sh
source ./cleanup/delete_secrets.sh
source ./cleanup/delete_ssm_params.sh
source ./cleanup/delete_acm_certs.sh

# adjust the defaults here before you run the cleanup script
repositoryName=hsirepo
hostedZoneId=$1
path=/mysaasapp

# Get the domain name from the hosted zone
echo "Getting the domain name from hosted zone"
domain=$(aws route53 get-hosted-zone --id $hostedZoneId --query "HostedZone.Name" --output text | sed 's/.$//')
echo "Domain name is $domain"

# Delete Api Gateway Base path mappings
echo "Deleting custom domain mappings"
delete_domain_mappings $domain

# Delete secrets from secrets manager
echo "Deleting secrets from secrets manager"
delete_secrets $path

# Delete parameters from systems manager parameter store
echo "Deleting parameters from systems manager parameter store"
delete_params $path

# Delete stacks from cloudformation
echo "Deleting stacks from cloudformation"
delete_cfn_stacks

# Delete ACM Certs
echo "Deleting ACM Certs"
delete_acm_certs $domain

# Destroy Test Stack
npm run cdk destroy -- -a "npx ts-node bin/setup_test_infra.ts" --force --all

# Destroy Oidc Provider Pipeline Stack
npm run cdk destroy HSI--Pipeline--OidcProvider -- -a "npx ts-node bin/oidcproviderpipeline.ts" --force

# Destroy base Stack
npm run cdk destroy HSI--Pipeline--Base -- -a "npx ts-node bin/base_app.ts" -c codecommitrepo=$repositoryName -c hostedzoneid=$hostedZoneId --force

# Print the warning about Route53, S3 buckets, Code Commit repo
echo "There will still be records in route53 hosted zone, and code commit repo that could have been part of pre-requisites. For safety reasons, this script did not delete them. Please delete them manually. Also, there would typically be artifact buckets created in S3 by codepipeline. please delete them manually."
