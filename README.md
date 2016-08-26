# Swagger2TF

Easily convert swagger api definitions into Terraform's configuration for AWS
API Gateway.

You can easily utilize the comand line interface to
[de-reference](https://github.com/zanona/jschema-deref) a swagger file
and pipe the output to `swagger2tf` command, which will generate a JSON
Terraform configuration with all the resources set for creation.

    jsderef schema.yml | swagger2tf > schema.json.tf; terraform plan

This library will create all resources, methods, responses, integrations and
integration responses. Please check the example file (schema.yml) on this
repository for more information.

**Please note**: You will still need to create and attach roles to your lambda
functions as well as giving the necessary permissions to API Gateway for
executing your lambda functions. However, this can be easily achieved on a
separate `.tf` file.


