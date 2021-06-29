# Hybrid SaaS Identity developer guide

- [Introduction](#introduction)
    - [Identity in a SaaS environment](#identity-in-a-saas-environment)
    - [Exploring a Sample Environment](#exploring-a-sample-environment)
    - [Hybrid SaaS Identity - conceptual model](#hybrid-saas-identity---conceptual-model)
    - [Hybrid SaaS Identity - reference solution](#hybrid-saas-identity---reference-solution)

- [The Baseline Infrastructure](#the-baseline-infrastructure)

- [Per-tenant Infrastructure](#per-tenant-infrastructure)

- [Tenant Routing](#tenant-routing)

- [Tenant Onboarding](#tenant-onboarding)

- [Tenant Federation](#tenant-federation)

- [AuthN/AuthZ](#authnauthz)

- [Scaling](#scaling)

- [Monitoring](#monitoring)
    - [Monitor base infrastructure deployment](#monitor-base-infrastructure-deployment)
    - [Monitor Test Tenant infrastructure deployment](#monitor-test-tenant-infrastructure-deployment)
    - [Monitor tenant provisioning](#monitor-tenant-provisioning)
    - [Monitor federation](#monitor-federation)
- [Cleanup](#cleanup)
    - [Delete tenant federation setting](#delete-tenant-federation-setting)
    - [Delete tenant](#delete-tenant)
    - [Delete HSI solution](#delete-hsi-solution)
- [Conclusion](#conclusion)

## Introduction

### Identity in a SaaS environment
In a typical software-as-a-service (SaaS) environment, your SaaS application would rely on an identity provider (IDP) to authenticate users access to the system within the context of a given tenant. This IDP accepts the authentication request, authenticates the user, and issues tokens that include the data about the user and its tenant context.

To support this experience, SaaS providers will often leverage one of the existing IDPs (Amazon Cognito, Okta, etc.) to implement their identity experience. This allows them to manage and control the entire footprint of their identity experience. The diagram below provides a high-level view of this model where tenant users are authenticated against an IDP managed by the SaaS provider.

<img src="./resources/images/saas_identity_nirvana.png" alt="drawing" width="800"/>

Figure 1: Typical SaaS Identity landscape

While this model maximizes control for the SaaS provider, there are instances where business or customer requirements may add some complexity to this approach. In some instances, customers may come to you that have existing IDPs. These customers may be unwilling to use your internally managed IDP for their solution. The example below provides a view of what this scenarios might look like.

<img src="./resources/images/saas_identity_real_world.png" alt="drawing" width="800"/>

Figure 2: SaaS Identity in reality

In this diagram, you’ll see that we have three tenants that are using three different identity experiences. Tenant2 is using our internally managed IDP solution, while Tenant1 and Tenant 3 are using their own identity providers.

While this may seem like a classic identity federation model, it presents some specific challenges for our SaaS environment. How do you onboard tenants with these external identity providers? How do you generate tenant-aware tokens when using external identity providers that have no tenant context? How do we make all this work seamlessly without impacting the downstream implementation of our services that rely on these tokens?

This is the precise focus of the solution that we’ve created. Our goal here is to outline an approach that supports a mix of internal and external identity providers without undermining our need to have a frictionless onboarding and authentication experience.

### Exploring a Sample Environment

To better understand this problem, let’s look at a sample environment. If we go back to our prior example and fill in some more details, you can start to see how/where the support for multiple IDPs introduces some challenges in our environment.

<img src="./resources/images/saas_identity_real_world_details.png" alt="drawing" width="800"/>

Figure 3: SaaS Identity in reality with IDP details

See tenant-1 in this picture, this is a tenant who has their users in their own IDP, which happens to be OpenID Connect compliant. Tenant-2 is ok with using SaaS providers IDP. Tenant-3, just like tenant-1 has its own IDP, which happens to be a simple directory server, LDAP compatible. This mix of SaaS providers own identity solution with a mix of externally hosted identity solutions introduce complexity into the identity layer which traverses throughout the SaaS architecture, let's look at the challenge more next.

Identity is a fundamental service in SaaS control plane that is used throughout the architecture at various levels to make granular decisions about permissions and provide least privileged access to underlying resources at run time. SaaS builders rely on Identity artifacts to enforce these policy decisions dynamically. Introducing disparate tenant specific identity systems could force the SaaS builders to develop their own custom logic to handle the tenant specific nuances in these identity artifacts. Sooner, rather later this could get out of hand from a management standpoint, but more importantly hard to trace bugs could be introduced. So, instead, we need a centralized mechanism that hides away these complexities from the SaaS builder. Let’s look at how a SaaS provider could tie these disparate identity systems together and still provide a cohesive experience to the SaaS developers using Hybrid SaaS Identity next.

### Hybrid SaaS Identity - conceptual model

<img src="./resources/images/saas_identity_conceptual_model.png" alt="drawing" width="800"/>

Figure 4: Hybrid SaaS Identity conceptual model

The hybrid SaaS identity solution is mainly comprised of three components that work together to orchestrate the authentication experience. Let's look at each one and its responsibilities:

Authentication manager: This is the core component, that has responsibilities to support the Identity uses cases of the SaaS providers IDP on one hand and on the other side it manages the connectivity to the tenant specific IDP backend. It acts as an adapter in that sense to translate and map the tenant specific IDP nuances back to the SaaS providers IDP needs. You can imagine this as the orchestrator of the solution.

Identity enrichment manager: This component is all about adding the additional tenant context to the identity artifact the results from a AuthN/AuthZ operation. Naturally this component would rely on the Authentication manager to handle the tenant specific nuances. It will also rely on the tenant configuration component to glean necessary information about the tenant.

Tenant configuration: a tenant microservice is typically used to centrally manage tenant information and policies. For this solution, we’ll also use this service to manage tenant configuration information that connects, translates, and maps tenants back the tenant specific IDP constructs that are used in their environment.

### Hybrid SaaS Identity - reference solution

Now that you have a conceptual view of the problem, let’s dig into the specifics of how these concepts are brought to life in the solution we’ve created. Below is a diagram that provide more context on the underlying implementation of the solution:

<img src="./resources/images/saas_identity_reference_solution.png" alt="drawing" width="800"/>

Figure 5: Hybrid SaaS Identity reference solution

SaaS builders often use OpenID Connect (OIDC) compliant identity provider (IDP) for their web applications and API's. SaaS Builders on AWS use Amazon Cognito for their AuthN/Z, which is an OpenID Connect compliant IDP. A core component of HSI is open source OIDC provider called [node-oidc-provider](https://github.com/panva/node-oidc-provider) extended to be multi-tenant by configuration. HSI is designed to be pluggable with out-of-the-box modules for connecting to LDAP and Amazon Cognito. HSI is architected on AWS serverless stack with the pooled multi-tenancy [pattern](https://d0.awsstatic.com/whitepapers/saas-solutions-on-aws-final.pdf) and because of that is can be easily used for silo style deployments as well.

We built HSI as a serverless application using mainly Amazon Cognito,
Amazon API Gateway, AWS Lambda, Amazon DynamoDB as key services among
several other. For deployment it is packaged as a CDK construct, as well
as CDK App. From a SaaS architectural style perspective, it is built as
pooled multi-tenant, so you can use a single HSI deployment to support
multiple tenants. Since it is packaged as a CDK app it is fairly
straightforward to deploy a silo instance of HSI for a single tenant. We
will look at all the infrastructure components in depth in the new few
sections when we visit the baseline and tenant specific modules. HSI at
this point is written in Nodejs and CDK portion of the solution is
written in Typescript. Here is a diagram depicting HSI architecture at a
high level.

As you can see OIDC Proxy is the central component within the solution,
and as mentioned at the beginning, this proxy layer is built using Node
OIDC Provider. We leverage Cognito UserPool Identity provider to
federate the AuthN to OIDC Proxy. OIDC Proxy than executes the AuthN
request with the backend IDP that is preconfigured for that incoming
request's tenant context. OIDC Proxy has built in modules that currently
support Cognito, LDAP type backend IDP’s. OIDC Proxy hosts a sign in
page built using Koa framework. Persistence is provided using DynamoDB,
Parameter store and Secrets Manager.

Remaining components in this architecture support the reference solution
to showcase the capabilities of HSI. In most cases they are just mock
functionality, for example, the SaaS App is just a hello world style
application that just prints the JWT tokens to the browser window. We
will look at these further in the next two sections where we look at the
baseline and tenant infrastructure in detail.

## The Baseline Infrastructure

When you consume HSI and deploy it for the first time, you will create
the bare minimum serverless stack that represents the baseline
infrastructure, we call it baseline because this is without any tenants
onboarded and is in fact needed to onboard tenants. Here is a list of Cloudformation stacks that form the baseline stack.

|Name|Resources|Description|
|----|---------|-----------|
|HSI--Pipeline--Base|CDKPipeline, CodeBuild, SSM Parameters|Self-Mutating CDK Pipeline that deploys the remaining Base Stacks.|
|HSI--Pipeline--OidcProvider|CodePipeline, CodeBuild, Lambda Function|CodePipeline that creates the oidc-provider Function, API.|
|Dev-AwsSaaSFactoryHybridIdentityBaseStackBaseStack|Cognito UserPool, DynamoDB tables, Step Function, SSM Parameters, Secrets Manager|Creates the Cognito userpool that hosts the federation Identity provider, client, configuration, Also creates the step function that adds to base features configuration to the DynamoDB table used by oidc-provider.|
|Dev-AwsSaaSFactoryHybridIdentityBaseStacktenantservice*|Tenant API, Lambda Functions, Step Functions|Tenant microservice with onboard, federation features.|
|Dev-AwsSaaSFactoryHybridIdentityBaseStackoidcresource*|Resource API, Lambda Function|Sample resource API that just echoes back the decoded JWT tokens.|
|Dev-AwsSaasFactoryHybridIdentityBaseStackoidcclient*|Client API, Lambda Function, SSM Parameters|Sample client that redirects straight to login page after looking up tenant using the Authorizer context.|

Here is
quick list of all components that comprise the baseline infrastructure
with a brief description of each.

| HSI Code repository                        | Code Commit repository                                                                              | Hosts the HSI code in your AWS Account. Necessary as the source stage of the self-mutating base stack pipeline.                                                                                                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HSI Base CI/CD pipeline                    | CodePipeline, CDK Pipeline                                                                          | Self-Mutating Code pipeline that actually deploys the rest of the base stack.                                                                                                                                                                                                                                                                                 |
| Oidc-provider table                        | DynamoDB Table, GSI                                                                                 | Persistence layer for oidc-provider [OIDC proxy]. Single storage that could be shared between all instances of the OIDC proxy.                                                                                                                                                                                                                              |
| SaaS provider Cognito UserPool             | Cognito UserPool                                                                                    | SaaS Identity provider that could “host” a bunch of tenants.                                                                                                                                                                                                                                                                                                  |
| Tenants table                              | DynamoDB Table, GSI                                                                                 | Persistence layer for tenant micro-service that stores the definition, configuration associated with each tenant. Includes information like tenant UUID, UserPool ID, UserPool App Client ID. Look at an example here.                                                                                                                                        |
| Oidc-Provider features state machine       | Step Function, AWS Lambda                                                                           | Adds the base set of features that suit the SaaS provider, these features tune the way oidc-provider behaves at run time. Look at the default we use here. Read more about these in the upstream node-oidc project [here](https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#features).                                                     |
| Oidc resource [SaaS backend API]         | CDK Construct, Amazon API Gateway, Lambda Authorizer, AWS Lambda                                    | Packaged as a CDK Construct, this simple API just checks the validity of the JWT token in the incoming request and responds with a warm cookie message and decoded JWT contents.                                                                                                                                                                              |
| Oidc client [SaaS App/ Front end client] | CDK Construct, Amazon API Gateway, Lambda Authorizer, AWS Lambda                                     | This is a purposefully minimal front end app built to retain the focus on the identity aspects of the solution. It uses a combination of Amazon API Gateway VTL to redirect / or /admin to the corresponding Cognito UserPool after looking up these details based on the subdomain. The lookup response is cached at the authorizer for performance reasons. |
| Tenant micro-service                       | CDK Construct, Amazon API Gateway, AWS Step Functions, Lambda Authorizer, AWS Lambda, DynamoDB Table | Tenant micro-service that has /onboard and /federate functionality. Both these operations are orchestrated by Step Functions and implemented by Lambda functions. We will go through these in depth in the tenant onboarding section of this guide.                                                                                                           |
| Base Parameters                            | AWS Systems Manager Parameter store.                                                                | Various baseline infrastructure stack parameters used here and to support tenant specific components are stored in parameter store for easy retrieval/lookup in CDK / CloudFormation.                                                                                                                                                                         |

As you can see in the diagram below, the general principle we followed
for categorizing some component of the architecture to be included in
baseline was to see if it is necessary regardless of a tenant or to
support onboarding one later.

<img src="./resources/images/base_infrastructure.png" alt="drawing" width="800"/>

Figure. 6: Hybrid SaaS Identity baseline infrastructure

## Per-tenant Infrastructure

Once the baselines infrastructure is in place, it is time to onboard a
tenant on to HSI. As part of provisioning, you would essentially create
a combination of configuration data in parameter store, DynamoDB,
secrets manager in addition to core AWS service components. These two
types of tenant specific infrastructure elements are usually spread
across two categories of activities within HSI namely ingress and
federation. This reference solution has included them as resources in a
tenant micro-service that you can invoke over http. More about
onboarding later in the next section. Here is an exhaustive list of all
components that are created per each tenant.

|Tenant Item|DynamoDB item|Tenant config stored as item in tenants table.|
|--- |--- |--- |
|Tenant Certificate|ACM Cert|ACM Certificate for tenant subdomain|
|Tenant Subdomain mapping|APIGW subdomain mapping|Mapping tenant subdomain to oidc-client api base path using the tenant certificate.|
|Tenant Subdomain DNS entry|Route53 A record|Tenant Subdomain mapped to the APIGW CloudFront distribution ID.|
|Oidc-provider proxy|CDK oidc-provider construct|Two situations when you would need to create a new instance of oidc-provider: If the tenant backend IDP needs VPC connectivity then oidc-provider needs to be deployed to that VPC or a peered VPC. If the tenant needs to be sharded to a new oidc-provider to limit blast radius.|
|Tenant Secrets|Secrets Manager|Each tenant will have its own JWKS, Cookie signing key and client secret.|
|UserPool Identity provider|Cognito UserPool Identity provider|Each tenant will have an Identity Provider created in Cognito.|
|UserPool App Client|Cognit UserPool App Client|Each tenant will have an App Client enabled to use the tenant specific Identity Provider only.|
|Tenant oidc-provider config|DynamoDB item|Each tenant will be defined in oidc-provider using a json configuration record that will define attributes like custom claim mappings, backend IDP details, JWT issuer among other key aspects. More about this in the authentication section.|
|Tenant Client oidc-provider config|DynamoDB item|Each tenant will get a client created in oidc-provider with a corresponding client secret. More about this in the authentication section.|

<img src="./resources/images/tenant_infrastructure.png" alt="drawing" width="800"/>

Figure. 7: Hybrid SaaS Identity Tenant specific infrastructure

## Tenant Routing

The north-south traffic flow of tenant specific traffic is handled at
two different levels in this reference solution. There is flexibility
however, in the manner which this can be configured with just few
requirements from an oidc-provider perspective. We will start with what
is offered out of the box in this reference solution and call out the
unique requirements as we move along. Let’s start with ingress, the
front gate of our SaaS client. In ingress we adopted sub-domain-based
routing, which, simply put, takes the subdomain part of the host header,
looks up the tenant information associated with that subdomain and
determines the UserPool ID, UserPool App Client ID to use for the
authorize api call with Cognito. There is additional information that is
retrieved as well such as claims, identity provider etc.

<img src="./resources/images/ingress_routing.png" alt="drawing" width="800"/>

Figure. 8: Hybrid SaaS Identity tenant ingress routing

Here is a brief step by step:

1.  Browser seeks tenant-1.thinkr.dev

2.  Route53 DNS service responds with the CloudFront distribution for
    APIGW.

3.  APIGW Custom domain mapping points this incoming request to the
    oidc-client base path.

4.  Oidc-client [SaaS App] invokes the Lambda Authorizer

5.  Lambda Authorizer looks up tenant information based on subdomain and
    retrieves the authentication information necessary [As shown
    below] and adds it to context.

6.  Api Gateway uses the context information added by the authorizer and
    issues a http 302 with the URL stitched as shown below.

Below table lists all those details and explains each one in detail.

| $context.authorizer.auth_endpoint  | Auth Endpoint  | Authorize endpoint of Cognito UserPool |
| ----------------------------------- | -------------- | -------------------------------------- |
| $context.authorizer.clientid        | App Client ID  | Cognito UserPool App Client ID         |
| $context.authorizer.response_type  | Response type  | OAuth response type                    |
| $context.authorizer.scope           | Scope          | OAuth Scopes                           |
| $context.authorizer.idp_identifier | IDP Identifier | Cognito UserPool Identifier            |

http 302 redirect URL format:

$context.authorizer.auth_endpoint+"?client_id="+$context.authorizer.clientid+"\&response_type="+$context.authorizer.response_type+"\&scope="+$context.authorizer.scope+"\&identity_provider="+$context.authorizer.idp_identifier+"\&redirect_uri="+"https://"+$context.domainName+"/callback"

## Tenant Onboarding

HSI follows a pooled architecture model for the SaaS client and resource
API. Onboarding a tenant is handled by a step function orchestrator that
sets up the A-record in Route53 hosted zone, ACM certificate, adds
Cognito app client and a tenant configuration item to DynamoDB. This
onboarding step function is fronted by API Gateway resource /onboard
that accepts http PUT request with the following payload, with
parameters as explained in the table.

```json
{
    "tenantEmailDomain":"thinkr.dev",
    "tenantName":"tenant-one",
    "tenantSubDomain":"tenant-1",
    "emailId":"admin+tenant1@amazon.com"
}
```

| tenantEmailDomain | Domain name of the email                  |
| ----------------- | ----------------------------------------- |
| tenantName        | Name of the tenant                        |
| tenantSubDomain   | Subdomain assigned to the tenant          |
| emailId           | Email address of the tenant administrator |

In HSI onboarding is an unauthenticated request following a typical
signup page on a SaaS home page. Once the http call is fired, api
gateway immediately responds back with an acknowledgement.
Asynchronously the step function executes the steps depicted in the
following diagram.

<img src="./resources/images/tenant_onboarding.png" alt="drawing" width="800"/>

Figure. 9: Hybrid SaaS Identity Tenant provisioning workflow

All of the 10 steps outlined are run using the same lambda function
under “resources/add_tenant_infra_lambda”. Each time step function
invokes the function synchronously using a handle representative of the
step it is trying to execute. Step functions can handle multiple
concurrent executions, so this would give you an implicit queuing
mechanism for tenant onboarding. For more control have the onboard api
add a message to a queue and pull the messages from the queue using a
lambda worker at a defined rate.

An admin user is created in the Cognito UserPool with the supplied email
address as the username. Admin user will get a verification email with
temporary password that can be used to log on to . Once the admin user
goes through the password setting process and logs in successfully, they
will see a JSON response printed to the browser as shown below. We are
doing this to highlight the JWT tokens vended by Cognito and show the
custom claim tenantuuid that we have injected using oidc-provider. Here
is a quick screenshot of how the response looks like in firefox browser.

<img src="./resources/images/admin_id_token.png" alt="drawing" width="400"/>

Figure. 10: Sample ID token as a result of an admin user login
## Tenant Federation

An authenticated admin can add federation backend IDP details to the
tenant they belong to. To do that they take the id_token from the
output of the /admin page and use it as the authorization header to fire
the /federation api call with this payload for adding a LDAP type of
IDP.
```json
{
    "tenantIDPType" : "ldap",
    "dynamodbTableName":"oidc-provider",
    "logLevel": "ERROR",
    "ldapConfig" : {
        "ldapSuffix" : "dc=auth,dc=tenant-3,dc=com",
        "ldapUrl" : "ldap://<SIMPLE_AD_DNS>"
    },
    "vpcConfig": {
        "vpcId":"vpc-0b51f09045aa361d7",
        "securityGroupIds": ["sg-0fe5172df5d73d0c4", "sg-08251e9f1a4618263"],
        "subnetIds": ["subnet-08cb3f2277a9f06d5", "subnet-05e133a384c681e6c"]
    }
}
```
To add a Cognito type backend IDP, payload would be
```json
{

    "tenantIDPType" : "cognito",
    "dynamodbTableName":"oidc-provider",
    "logLevel": "ERROR",
    "cognitoConfig" : {
        "userPoolClientId" : "1qtsaja074feikah5qo1i3dqv9",
        "userPoolId" : "us-east-1_nkg3dWz6c",
        "userPoolRegion" : "us-east-1"
    }
}
```

Similar to onboard api call, federation too, kicks off a step function
execution as shown in the below diagram. The first step of the
federation workflow checks if a oidc-provider needs to be deployed with
a vpc attachment, if not it checks if a non-vpc oidc-provider is
available to reuse it for the current tenant. Oidc-provider creation is
handled by a CodePipeline, step function uses a task token wait pattern
for the first step. Completion of the first step is signaled back to
step function either by the
“resources/start_oidc_provider_pipeline_lambda” or by the
“resources/finish_oidc_provider_pipeline_lambda” lambda function
depending on whether the oidc-provider CodePipeline was run.

<img src="./resources/images/federation_provisioning.png" alt="drawing" width="800"/>

Figure. 11: Hybrid SaaS Identity Tenant federation workflow

The second step of the federation workflow adds the remaining pieces of
configuration and AWS services necessary to support the federation as
listed in the below table

| Secrets                            | Adds JWKS, client Secret, cookie signing key                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant record – oidc-provider      | Adds tenant item to oidc-provider table with backend IDP details supplied in the payload.                                             |
| Tenant record – tenants            | Updates the item in tenants table to indicate the switch of idp_identifier from Cognito to the new customer owned identity provider. |
| App Client record – oidc-provider  | Adds client item to oidc-provider table.                                                                                              |
| Cognito UserPool Identity Provider | Creates identity provider with details pointing to the oidc-provider.                                                                 |
| Cognito UserPool App Client        | Updates App Client allowed identity providers list to include the identity provider create above.                                     |

With this a tenant should be setup with federation to their supplied
backend IDP. A regular non-admin user can go to the tenant subdomain
page to test out the federation experience.

https://tenant-subdomain.saasdomain.tld

Opening up that url in a browser should redirect the user to the login
page hosted on oidc-provider instead of Cognito. Once they type in valid
credentials and sign in, the response they see on the page should be
similar to what the admin user sees on the admin page. The custom claim
“custom:tenantid” should still be populated, the key difference being
where the custom claim was generated which in case of federation would
be oidc-provider. To know more about what happened behind the scenes to
make this end-to-end authentication flow with federation possible head
to the next section where we look at authentication flow in depth.

## AuthN/AuthZ

If we zoom in on just the identity aspects of the solution, a pattern
emerges here and it is worth spending some time understanding this in
detail because we leverage it not only to support different flavors of
multi-tenant architecture styles but also scale. A key design aspect of
Oidc-provider is that it is registered as an oidc identity provider in
Cognito. In pooled oidc-provider deployment you have a single Ax\`pi
Gateway endpoint for more than one tenant. From an isolation standpoint
it is important to have tenant specific JWT signing keys even in a
pooled architecture. OIDC spec has a mechanism for consumers of the JWT
tokens to lookup these keys using well-known/openid-configuration
endpoint on the provider. When Cognito performs the initial
openid-configuration lookup upon registering oidc-provider as an
identity provider, we have to make sure the openid endpoint somehow
serves tenant specific metadata, to solve this puzzle we appended
oidc-provider ClientID which is the most granular identifier associated
with a tenant. Now oidc-provider knows the context of the incoming
request from Cognito and serves up the tenant specific keys from JWKS it
stores in secrets manager. The choice of using client ID gives
flexibility to extend this architecture to use-cases where a tenant may
have access to more than one SaaS app offered by the ISV. Cognito
requires that in federation use-cases UserPool app client has to be
mapped to an identity provider 1:1 and we did just that as shown in the
below diagram.

<img src="./resources/images/app_client_mapping.png" alt="drawing" width="800"/>

Figure. 12: Hybrid SaaS Identity Tenant mapping

A typical Authorization code flow, which is what we use in the SaaS app
in our solution, looks like the below diagram. Key point to note here is
that there are two additional hops in this flow compared to a typical
flow, 1\\ where Cognito federates into oidc-provider (Step-3) and 2\\
where oidc-provider reaches out to the backend IDP to get the AuthN
performed.

<img src="./resources/images/authorization_code_flow.png" alt="drawing" width="800"/>

Figure. 13: Hybrid SaaS Identity Authorization code flow

## Scaling

HSI uses a combination of AWS Services with decoupling achieved through
micro-services. All of the AWS services used in this solution are
serverless, so HSI inherits the benefit of scale out that serverless
brings forth. Taking a step further HSI can scale in a heterogenous
scale out fashion at individual service level. Let’s take a look at what
that means with few examples. Amazon Cognito can scale out in a
multi-tenant environment by sharding tenants to a new UserPool once the
current shard reached a set threshold. It is also possible to come up
with a different sharding strategy to distribute tenants to a set of
UserPools depending on a pre-established criterion like tenant type,
tier etc. Oidc-Provider is deployed onto Api Gateway, Lambda and
DynamoDB. Scaling with oidc-provider is similar to other serverless
API’s, where you can leverage Lambda features like provisioned
concurrency, reserved concurrency. Read more about function scaling
[here](https://docs.aws.amazon.com/lambda/latest/dg/invocation-scaling.html).
DynamoDB is the persistence layer for oidc-provider, designing it for
multi-tenancy is discussed at length in
[this](https://aws.amazon.com/blogs/apn/multi-tenant-storage-with-amazon-dynamodb/)
blog post.

<img src="./resources/images/sharding.png" alt="drawing" width="800"/>

Figure. 14: Hybrid SaaS Identity scaling

## Monitoring

### Monitor base infrastructure deployment
The way we have packaged HSI, most of the infrastructure is actually created as a result of the execution of the CodePipeline(s) that the bootstrap script creates. Hence, monitoring the CodePipeline execution to ensure successful completion is important before you proceed further.
Running the bootstrap script should have created a cloudformation stack called “HSI–Pipeline–Base”. Monitor this stack for successful completion. It will also create a codepipeline called “Hybrid-SaaS-Identity_CI-CD_pipeline”. Monitor that codepipeline for successful completion. This is a CDKPipeline, it will create more infrastructure as part of the codepipeline run, you should see more cloudformation stacks with name "Dev-AwsSaasFactoryHybridIdentityBaseStack*". Expect about 20 minutes for completion.
### Monitor Test Tenant infrastructure deployment
Running the test tenant script should have created three cloudformation stacks, TestStackApp, SimpleADStack, CognitoTestStack. CDK deploy command will wait for these stacks to finish, but feel free to monitor the cloudformation stacks as well. Expect about 10 minutes for completion.
Let all of these stacks run to completion, expect about 20 minutes overall for this step if the scripts were run in parallel using two terminal windows as suggested. Once done, what you will have is set of apis for onboarding tenants, and three tenant backend IDP’s that which you will use in the next section. Proceed to the next section once setting up environment is successfully completed.
### Monitor tenant provisioning
To monitor the setup of tenancy, open up AWS Step functions [console](https://console.aws.amazon.com/states/home), observe the status of the step function that starts with “TenantInfraStateMachine”. The Last step of the step function creates a A record in Route53 which will take some time to propagate. So, wait for few minutes and then proceed to check if the tenant subdomain resolves in your browser
### Monitor federation
To monitor the setup of federation, open up AWS Step functions [console](https://console.aws.amazon.com/states/home), observe the status of the step function that starts with “TenantFederationStateMachine”.

## Cleanup
While trying out this solution, there could be situations where you want to start over, so here are the most common scenarios and how you reset them.
### Delete tenant federation setting
To undo a specific tenants federation, run through the following steps.
1.	Delete Identity provider in federation Cognito UserPool.
2.	Delete tenant, client record from oidc-provider ddb table. Note the tenant UUID.
3.	Delete secrets from secrets mgr. 
    * /mysaasapp/${tenantSubDomain}/jwks 
    * /mysaasapp/${tenantSubDomain}/cookie-secrets 
    * /mysaasapp/${tenantSubDomain}/oidcappclientsecret
4.	Delete ssm parameters from systems mgr. 
    * /mysaasapp/${tenantSubDomain}/tenantOidcProviderAppClientUuid
5.	Update tenant record from tenants ddb table. Search for it using tenant sub domain. Set idp_identifier to Cognito.
6.	Delete the tenant specific oidc provider by deleting the stack from cloudformation. Stack will be suffixed with the tenant UUID.
### Delete tenant
To remove a tenant altogether, run through these steps. 
1. Delete Admin user from the federation Cognito Userpool. 
2. Delete Identity provider, App Client from federation Cognito UserPool. 
3. Delete tenant, client record from oidc-provider ddb table. 
4. Delete secrets from secrets manager. 
    * /mysaasapp/${tenantSubDomain}/jwks 
    * /mysaasapp/${tenantSubDomain}/cookie-secrets 
    * /mysaasapp/${tenantSubDomain}/oidcappclientsecret 
    * /mysaasapp/${tenantSubDomain}/federationclientsecret 
5. Delete ssm parameters from systems manager. 
    * /mysaasapp/${tenantSubDomain}/tenantOidcProviderAppClientUuid 
    * /mysaasapp/${tenantSubDomain}/tenantUuid 
    * /mysaasapp/${tenantSubDomain}/tenantEmailDomain 
    * /mysaasapp/${tenantSubDomain}/federationCognitoUserPoolAppClientId 
6. Delete tenant record from tenants ddb table. Search for it using tenant sub domain. 
7. Delete A-record from Route53 hosted zone for the tenant subdomain. 
8. Delete APIGW custom domain name ${tenantSubDomain}.${SaaSDomain}.${TLD} 
9. Delete ACM certificate for the tenant subdomain. Check if the cert is flagged as in use by cloudfront still, attempt deletion after some time.
### Delete HSI solution
Most of the infrastructure created in this solution is done using Codepipeline and step functions. So, destroying just the CDK stacks deployed will not delete everything. Run the below script that deletes all the custom domain mappings, secrets, parameters, certs and cloudformation stacks created by the HSI CodePipeline and Onboarding orchestrator before it proceeds to delete the base, oidc-provider CDK stacks. The prefix used by ssm parameters and secrets is “/mysaasapp” and this cleanup script greedily deletes all resources from secrets manager, parameter store with that prefix. 
> :information_source: This cleanup script will not delete the pre-requisite hostedzone, codecommit repo, please delete them manually via console or CLI.
```bash
chmod +x ./scripts/cleanup.sh
./scripts/cleanup.sh <hostedzoneid>
```
## Conclusion

You have now a good deep dive view of what HSI was built to solve, what went into building HSI and how various modules are stitched together. A key tenet of HSI reference solution was to encapsulate the SaaS identity in consumable, easily deployable package. We welcome any contributions for bug fixes, improvements and additional features including corrections, additions and feedback to this developer guide.
