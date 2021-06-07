#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT


(cd resources/add_federation_configuration_lambda && npm install --only=prod)
(cd resources/add_ldap_user_group && npm install --only=prod)
(cd resources/add_tenant_federation_lambda_authorizer && npm install --only=prod)
(cd resources/add_tenant_infra_lambda && npm install --only=prod)
(cd resources/finish_oidc_provider_pipeline_lambda && npm install --only=prod)
(cd resources/oidc-client/oidc_client_function && npm install --only=prod)
(cd resources/oidc-provider && npm install --only=prod)
(cd resources/oidc-resource/authorizer && npm install --only=prod)
(cd resources/start_oidc_provider_pipeline_lambda && npm install --only=prod)
