# Hybrid SaaS identity reference solution using Amazon Cognito
- [Introduction](#Introduction)
- [Setting up the environment](#Setting-up-the-environment)
    - [Pre-requisites](#Pre-requisites)
    - [Bootstrapping](#Bootstrapping)
    - [Federation test infrastructure](#Federation-test-infrastructure)
- [Onboarding tenants](#Onboarding-tenants)
    - [Setting up tenancy](#Setting-up-tenancy)
        - [Tenant provisioning workflow](#Tenant-provisioning-workflow)
        - [Monitor tenant provisioning](#Monitor-tenant-provisioning)
    - [Setting up federation to backend IDP](#Setting-up-federation-to-backend-IDP)
        - [Federation workflow](#Federation-workflow)
        - [Monitor tenant federation](#Monitor-federation)
- [Tenant context - maintaining conformity in hybrid IDP environments](#Tenant-context---maintaining-conformity-in-hybrid-IDP-environments)
    - [Cognito User - Tenant-1,2](#Cognito-User---Tenant-12)
    - [LDAP User - Tenant-3](#LDAP-User---Tenant-3)
- [Conclusion](#Conclusion)

## Introduction
In a typical software-as-a-service (SaaS) environment, your SaaS application would rely on an identity provider (IDP) to authenticate a user’s access to the system within the context of a given tenant. This IDP accepts the authentication request, authenticates the user, and issues tokens that include the data about the user and its tenant context.

To support this experience, SaaS providers will often leverage one of the existing IDPs (Amazon Cognito, Okta, etc.) to implement their identity experience. This allows them to manage and control the entire footprint of their identity experience.
While this model maximizes control for the SaaS provider, there are instances where business or customer requirements may add some complexity to this approach. In some instances, customers may come to you that have existing IDPs. These customers may be unwilling to use your internally managed IDP for their solution.

While this may seem like a classic identity federation model, it presents some specific challenges for our SaaS environment. How do you onboard tenants with these external identity providers? How do you generate tenant-aware tokens when using external identity providers that have no tenant context? How do we make all this work seamlessly without impacting the downstream implementation of our services that rely on these tokens?

This is the precise focus of the solution that we’ve created. Our goal here is to outline an approach that supports a mix of internal and external identity providers without undermining our need to have a frictionless onboarding and authentication experience. The goal of this readme along with the developer guide is to give you, the SaaS builder, an experience at understanding the architecture of Hybrid SaaS Identity (HSI) by building the 4foundational constructs using a simple “Hello World” style SaaS App. We have used AWS CDK to build this solution and we will show snippets of code along the way to help illustrate the key design decisions made for multi-tenancy. The focus here is more on giving builders a view into the working elements of the solution without going to the extent of making a full, production-ready solution. Here is a quick visual on the steps that we will perform.


<img src="./resources/images/steps.png" alt="drawing" width="800"/>

Figure 1: Hybrid SaaS Identity Handson steps

Refer to the [developer guide](./developer-guide.md) at any point for a deep dive on HSI. Without further ado, let's deploy HSI and test it by onboarding few tenants.


## Setting up the environment

> :warning: This solution requires an external domain name for which you control DNS settings using Amazon Route53 HostedZone. If you don't currently own a domain name, and would like to purchase one, follow [this](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/domain-register.html) guide to get one on Amazon Route53. If you have a domain that you currently control elsewhere, follow [this](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-configuring.html) guide to use Amazon Route53 as your DNS service.

The base architecture of HSI includes a sample client, a sample resource that the client will access and authentication infrastructure that will in combination support tenant onboarding in the next step. Before we get to creating the base infrastrtuctre, we have few pre-requisites that we need to have in place. 

### Pre-requisites
Make sure you have the below in place to proceed further in consuming this solution.
1. Note down the hostedzone id by listing the hosted zones in your AWS account by following [this](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ListInfoOnHostedZone.html) guide. we need this because we will use subdomain to lookup the tenancy of incoming request.
2. AWS CLI [configured](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html) and AWS CDK CLI [bootstrapped](https://docs.aws.amazon.com/cdk/api/latest/docs/pipelines-readme.html#cdk-environment-bootstrapping) on your local machine where you are going to run the next steps from. We need this because HSI is packaged as a CDK App for deployment. For e.g. to bootstrap cdk against a particular aws account, aws region, open up your terminal and issue this command after replacing 123456789012 with your AWS account ID and us-east-1 with your AWS region: 
    ```shell
    env CDK_NEW_BOOTSTRAP=1 npx cdk bootstrap \
    --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess \
    'aws://123456789012/us-east-1'
    ```
3. Install git-remote-codecommit, follow this [link](https://docs.aws.amazon.com/codecommit/latest/userguide/setting-up-git-remote-codecommit.html).
4. [Increase](https://docs.aws.amazon.com/servicequotas/latest/userguide/request-quota-increase.html) Service Quota for AWS Codebuild "Maximum number of concurrent running builds" to atleast 11. Use this deep [link](https://console.aws.amazon.com/servicequotas/home/services/codebuild/quotas/L-75822022).
5. Postman, curl or any other API client.

### Bootstrapping
Run the bootstrap script which creates the baseline infrastructure for HSI. You will have to supply a name for the codecommit repository (replace codecommitreponame, script will create the actual codecommit repo if it does not exist) and the hosted zone id from step#1 pre-reqs (replace hostedzoneid). Accept all security related change approvals prompted by the CDK console.

```bash
git clone https://github.com/aws-samples/aws-saas-factory-hybrid-saas-identity.git
cd aws-saas-factory-hybrid-saas-identity
chmod +x ./scripts/bootstrap.sh
./scripts/bootstrap.sh <codecommitreponame> <hostedzoneid>
```
### Federation test infrastructure
For you to try out HSI, we packaged three backend IDP's into a AWS CDK app, and a shell script that deploys the CDK app and creaates test users. This shell script will create one Simple AD service in a VPC, and two Cognito userpools to represent backend IDP for three test tenants that you could use further. This script can run in parallel to the bootstrap scropt above, Open a new terminal window, and run the following command from the root of your project to deploy the stack. You have to provide a email address in the below command, it will be used to create the Cognito userpool users.

```bash
chmod +x ./scripts/tenantstack.sh
./scripts/tenantstack.sh <YOUR_EMAIL_ADDRESS>
```
The response from the execution of this script will be printed to console as well as this [file](./hsi.out/tenantstack.out). In that output you will find three JSON payload(s) that you have to use for executing the federation api calls in the [section](#Setting-up-federation-to-backend-IDP) for three tenants. The output from this script will look like below:

<img src="./resources/images/test_stack_output.png" alt="drawing" width="600"/>

Figure 2: Sample tenant stack script output

Before heading out to the next section, monitor the infrastructure creation following the developer guide.

## Onboarding tenants
Tenant onboarding is a unqiue tailored experience to each SaaS application. To keep the focus on the Identity layer, we will split up the onboarding into a two step process, where the first step will focus on setting up the tenancy, and the second step will be all about setting up federation into the backend IDP. Let's get started with step-1, i.e. setting up tenant. Infact, we will setup three tenants here.

### Setting up tenancy
Open up your favorite http client. Create a PUT request to the tenant service api endpoint with the example JSON payload below. Replace the values with valid test inputs, especially the emailId, which will be used to setup a Cognito User. A validation email will be sent to this email address with a temporary password that you have to reset on first log in.

Http method: PUT

API Endpoint to use: onboarding api output from executing this command: (Commands also available in [this](./hsi.out/basestack.out) file.)
```shell
# onboarding api
echo "$(aws ssm get-parameter --name /mysaasapp/tenantApiEndPoint --query Parameter.Value --output text)onboard"
```
API body to use: replace emailId with a valid email ID
```json
{
    "tenantEmailDomain":"thinkr.dev",
    "tenantName":"tenant-one",
    "tenantSubDomain":"tenant-1",
    "emailId":"tenant-1-admin@amazon.com"
}
```
This PUT request will respond back with done if the tenancy provisioning workflow has kicked off successfully.
```json
{
    "done": true
}
```
<img src="./resources/images/onboarding_payload_postman.png" alt="drawing" width="600"/>

Figure 3: Federation http PUT API call using Postman

repeat this to onboard two more tenants, tenantSubDomain has to be unique, so should the emailId for each tenant. As an example the JSON payloads for the next two tenants would be:
```json
{
    "tenantEmailDomain":"thinkr.dev",
    "tenantName":"tenant-two",
    "tenantSubDomain":"tenant-2",
    "emailId":"tenant-2-admin@amazon.com"
}
```
```json
{
    "tenantEmailDomain":"thinkr.dev",
    "tenantName":"tenant-three",
    "tenantSubDomain":"tenant-3",
    "emailId":"tenant-3-admin@amazon.com"
}
```


#### Tenant provisioning workflow
Here is a quick glance of the steps involved in provisioning, refer to [this](./developer-guide#Tenant-Onboarding) section in the developer guide for more detailed information about each step.

<img src="./resources/images/tenant_onboarding_example.png" alt="drawing" width="400"/>

Figure 4: Tenant provisioning workflow - step function

#### Obtaining the admin id token
Monitor for successful completion and then open up the admin page for the tenant you just created using a private browser window by going to the below url format. (with the above example it would be https://tenant-1.thinkr.dev/admin)
```
https://[tenantSubDomain].[SaaSdomain].[TLD]/admin
```
You will be prompted to enter the username / password. use the email address that you supplied above for [emailId] and the temporary password Cognito sent in an email to that email address. Go through the flow to setup the final password, and you will eventually be taken to a page where you will see the ID token.

Here is example of the webpage response for /admin showing the access token, id token in raw and decoded format. Copy the id_token value to some place you can retrieve when needed to set up federation next.

<img src="./resources/images/admin_id_token.png" alt="drawing" width="400"/>

Figure 5: Sample ID token as a result of an admin user login

### Setting up federation to backend IDP
To setup federation, similar to what we did to setup tenancy, we will execute a http PUT call. You would need two things for the /federation api call. 1/ the ID token of an Admin user. 2/ the JSON payload that has the IDP details. Open up your http client, we will use postman here, start a PUT request, with Authorization type as Bearer Token, paste the ID token you saved from [this](#Monitor-tenant-provisioning) previous step. Go to Body and copy paste the first JSON payload from [this](./hsi.out/tenantstack.out) file. Execute the http api call and you should get a "done" message as response.

Http method: PUT

API Endpoint to use: onboarding api output from executing this command: (Commands also available in [this](./hsi.out/basestack.out) file.)
```shell
# onboarding api
echo "$(aws ssm get-parameter --name /mysaasapp/tenantApiEndPoint --query Parameter.Value --output text)federation"
```
API body to use: get this from 
```json
{
    "tenantIDPType" : "cognito",
    "dynamodbTableName":"oidc-provider",
    "logLevel": "ERROR",
    "cognitoConfig" : {
        "userPoolClientId" : "1qtsaja074feikah5qo1i3dqv9",
        "userPoolId" : "us-east-1_nkg3dWz6c",
        "userPoolRegion" : "us-east-1",
    }
}
```
This PUT request will respond back with done if the federation setup has kicked off successfully.
```json
{
    "done": true
}
```

<img src="./resources/images/federation_payload_postman.png" alt="drawing" width="600"/>

Figure 6: Federation http PUT API call using Postman

For example, I will open up a private browser window and go to admin page of my first tenant available at https://tenant-1.thinkr.dev/admin ,log in using the email, password that I received in a verification email from Cognito. Complete the initial password reset flow. I will copy the ID token value from the browser and keep it handy. This token is valid for an hour by default. Next I will execute the ssm get-parameter aws cli command to retrieve the tenant api endpoint for federation. I will copy the url and keep it handy. Next, I will open my postman client, create a new basic http request, change method to PUT, enter federation api url that I saved earlier, I will go to Authorization tab, choose the type as bearer token and enter the ID token that I saved earlier as value. I will then proceed to the Body tab, paste in the first JSON payload from the [tenantstack.out](./hsi.out/tenantstack.out) file. I will hit Send next, if everything is correct, I will get a response "done". I will [monitor](#Monitor-federation) the federation step function to ensure it is completed successfully before proceeding to add federation to the remaining two tenants. I will open a private browser window each time to avoid cognito session re-use and go to the individual tenant admin page to get the ID token. I will repeat the same steps for tenant-2, tenant-3 by obtaining the corresponding ID token from the /admin page, as well as the corresponding JSON payload from the tenantstack.out file.

Once you are done adding federation to all three tenants, what you have is a SaaS application with three tenants, each with it's own backend IDP with users setup. As part of setting up the tenants you have already added a admin user for each of the tenant, this user resides in the SaaS providers Cognito UserPool and has the tenant UUID added as an attribute to the user record within the UserPool. Now it is time to log into the SaaS app with the backend user credentials and see if we can still obtain the tenant UUID in the ID token. This is where the cohesive experience of this solution will come to fruition. Head out to the [next](#Tenant-context---maintaining-conformity-in-hybrid-IDP-environments) section.

#### Federation workflow
Here is a quick glance of the steps involved in adding federation, refer to [this](./developer-guide#Tenant-Federation) section in the developer guide for more detailed information about each step.

<img src="./resources/images/tenant_federation_example.png" alt="drawing" width="400"/>

Figure 7: Tenant federation workflow - step function

## Tenant context - maintaining conformity in hybrid IDP environments
So far you have seen how to bootstrap HSI, onboard three tenants, setup federation for them. In that process you have already logged into the SaaS app as an admin user, you have seen the ID token, used it to setup federation as well. What you have also probably noticed in the /admin page response is the decoded ID token which has the custom:tenantid claim. The UUID value of this claim is the tenant UUID that HSI has assigned to that particular tenant while onboarding. This tenant UUID is a crucial piece of information that gives the consumer of this token, usually a backend micro-service,  a context to what they are about execute or process. This tenant context helps SaaS builders to build tenant specific isolation policies, scope down permissions and many other multi-tenant constructs. This is the core advantage of HSI where, it provides conformity in tenant context embedded in the id token regardless of the backend IDP type. HSI does this by maintaining a mapping between id token custom claims and AuthN/AuthZ attributes in both Cognito and OIDC Proxy tenant record. For more information on how this is implemented and how you can extend it to inject more information into the tenant context, check out the developer guide. Let's look at this in action in case of our three tenants that we have onboarded.
### Cognito User - Tenant-1,2
Open up the landing page for the first tenant, with Cognito as IDP backend, you created using a private browser session by going to the below url format. Login with your backend user credentials supplied by the test tenant stack output availble in [tenantstack.out](./hsi.out/tenantstack.out) file.
```
https://[tenantSubDomain].[yourdomain.TLD]/
```

For example I will go to https://tenant-1.thinkr.dev, use the email address and password from tenantstack.out file to log into the app, and would see ID token, Access token, presented on the screen, similar to what I saw before when I logged in as the admin for tenant-1.

<img src="./resources/images/tenant_1_id_token.png" alt="drawing" width="600"/>

Figure 8: Sample ID token as a result of an tenant-1 backend user login (Cognito)

Notice the "custom:tenantid" claim in the "id_token_payload", the value of this key is the tenant UUID that was established as part of onboard API call.

Similarly, open up the landing page for tenant-2 in a private browser session, and login with the backend credentials to notice the tenantid custom claim with a different UUID.
### LDAP User - Tenant-3
Just like we did for tenant-1,2, the login experience will be similar for tenant-3 as well. Note that the email domain for the backend users will be auth.tenant-3.com, not the email address you have supplied.
```
https://[tenantSubDomain].[yourdomain.TLD]/
```
In my case, I will go to https://tenant-3.thinkr.dev and login with user1@auth.tenant-3.com and the corresponding password from tenantstack.out file to obtain the ID token that looks like shown below.

<img src="./resources/images/tenant_3_id_token.png" alt="drawing" width="600"/>

Figure 9: Sample ID token as a result of an tenant-3 backend user login (LDAP)

Notice the same "custom:tenantid" claim in the "id_token_payload" and the same issuer "iss". Backend API resources who typically introspect the id token to extract tenant context can reliably use this custom claim to interpret the tenant of the request they are about to process. With this you have successfully deployed and tested HSI solution, before you close out, head to the [next](#Conclusion) section.
## Conclusion
In this Hybrid SaaS Identity hands-on SaaS solution, you have created base infrastructure, onboarded three tenants, added federation to backend IDP's. By visitng the root page of the tenant subdomain as well as the /admin page for, you observed that you could log in with either admin user or the backend IDP user belonging to Cognito or Simple Directory service and still get an ID token issued by Cognito with tenant context (tenant UUID as a custom claim). This is the conformity in experience that HSI is built for. Read the [developer guide](./developer-guide.md) for a detailed walkthrough of how HSI is built, functions and aspects like scaling. 
> :information_source: The resources you have created in this handson saas solution might be outside of the free tier limits, so please visit [cleanup](#Cleanup) in the developer guide.