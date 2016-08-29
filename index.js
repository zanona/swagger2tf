'use strict';
const EventEmitter = require('events');

function normalizeResourceName(path) {
  return path.replace(/^\/|[{}:]/g, '').replace(/\//g, '_');
}
function mergeParameters(target, params) {
  if (!params) return;
  target.parameters = target.parameters || [];
  params = Object.keys(params).map((k) => params[k]);
  target.parameters = target.parameters.concat(params).reduce((p, c) => {
    if (!p.filter((i) => i.name === c.name).length) p.push(c);
    return p;
  }, []);
}
function generateMethodParams(params) {
  if (!params) return;
  const p = {};
  params.forEach((param) => {
    if (param.in === 'query') param.in = 'querystring';
    p[`method.request.${param.in}.${param.name}`] = true;
  });
  return p;
}
function generateResponseHeaders(headers) {
  if (!headers) return;
  const h = {};
  for (const key in headers) h[`method.response.header.${key}`] = true;
  return h;
}
function getIntegrationResponseForStatusCode(responses, statusCode) {
  if (!responses) return;
  const key = Object.keys(responses).filter((ir) => {
    return responses[ir].statusCode.toString() === statusCode;
  })[0];
  if (key) {
    if (key !== 'default') responses[key].selectionPattern = key;
    return responses[key];
  }
}

function generateCORSResource() {
  const allowedHeaders = [
    'Content-Type',
    'X-Amz-Date',
    'Authorization',
    'X-Api-Key',
    'X-Amz-Security-Token'
  ];
  return {
    responses: {
      200: {
        headers: {
          'Access-Control-Allow-Methods': { type: 'string' },
          'Access-Control-Allow-Headers': { type: 'string' }
        }
      }
    },
    'x-amazon-apigateway-integration': {
      type: 'mock',
      responses: {
        default: {
          statusCode: 200,
          responseParameters: {
            'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
            'method.response.header.Access-Control-Allow-Headers': `'${allowedHeaders.join(',')}'`
          }
        }
      },
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
      passthroughBehavior: 'when_no_match'
    }
  };
}

function runParser(schema, opts) {
  opts = Object.assign({}, opts);
  const paths = schema.paths;

  for (const path in paths) {
    const resourceName = normalizeResourceName(path),
          pathItem = paths[path];

    this.emit('resource', resourceName, path, paths[path]);

    if (opts.enableCORS) paths[path]['options'] = generateCORSResource(opts.allowedOrigin);

    for (const method in pathItem) {
      if (!/^(get|post|put|patch|delete|options)$/.test(method)) continue;

      const methodItem = pathItem[method],
            iKey = opts.integrationKey,
            integrationItem = methodItem[iKey] || pathItem[iKey] || schema[iKey];

      mergeParameters(methodItem, pathItem.parameters);
      this.emit('method', resourceName, method, methodItem);

      if (integrationItem) {
        const copyIntegrationItem = Object.assign({}, integrationItem);
        //ONLY SEND THE INTEGRATION PART
        delete copyIntegrationItem.responses;
        this.emit('integration', resourceName, method, copyIntegrationItem);
      }

      for (const statusCode in methodItem.responses) {
        const responseItem = methodItem.responses[statusCode];

        if (opts.enableCORS) {
          const r = responseItem;
          r.headers = r.headers || {};
          r.headers['Access-Control-Allow-Origin'] = { type: 'string' };
          r.headers['Access-Control-Allow-Credentials'] = { type: 'string' };

        }
        this.emit('response', resourceName, method, statusCode, responseItem);

        /*eslint max-depth: [1,5]*/
        if (integrationItem.responses) {
          const integrationResponseItem = getIntegrationResponseForStatusCode(integrationItem.responses, statusCode);
          if (!integrationResponseItem) continue;
          if (opts.enableCORS) {
            const r = integrationResponseItem;
            r.responseParameters = r.responseParameters || {};
            r.responseParameters['method.response.header.Access-Control-Allow-Origin'] = `'${opts.allowedOrigin}'`;
            r.responseParameters['method.response.header.Access-Control-Allow-Credentials'] = "'true'";
          }
          this.emit('integrationResponse', resourceName, method, statusCode, integrationResponseItem);
        }
      }
    }
  }
  this.emit('end');
}
function parseResources(schema, opts) {
  const emitter = new EventEmitter();
  setTimeout(runParser.bind(emitter), 0, schema, opts);
  return emitter;
}

module.exports = (schema, opts) => {

  opts = Object.assign({
    enableCORS: true,
    integrationKey: 'x-amazon-apigateway-integration'
  }, opts);

  const PREFIX    = 'aws_api_gateway',
        API_NAME  = 'core',
        APIS      = `${PREFIX}_rest_api`,
        API_ID    = `\${${APIS}.${API_NAME}.id}`,
        RESOURCES = `${PREFIX}_resource`,
        METHODS   = `${PREFIX}_method`,
        RESPONSES = `${PREFIX}_method_response`,
        INTEGRATIONS = `${PREFIX}_integration`,
        INTEGRATION_RESPONSES = `${PREFIX}_integration_response`,
        base = {
          [APIS] :     { [API_NAME]: { name: API_NAME, description: schema.info.title }},
          [RESOURCES]: {},
          [METHODS]:   {},
          [RESPONSES]: {},
          [INTEGRATIONS]: {},
          [INTEGRATION_RESPONSES]: {}
        },
        parser = parseResources(schema, opts);

  function findParentResource(path) {
    const paths = path.split('/');
    paths.shift();
    paths.pop();
    path = normalizeResourceName(paths.join(''));
    if (!path) return `\${${APIS}.${[API_NAME]}.root_resource_id}`;
    return `\${${RESOURCES}.${path}.id}`;
  }

  parser
    .on('resource', (resourceName, path) => {
      base[RESOURCES][resourceName] = {
        rest_api_id: API_ID ,
        parent_id: findParentResource(path),
        path_part: path.split('/').pop()
      };
    })
    .on('method', (resourceName, method, resourceItem) => {
      base[METHODS][`${method}_${resourceName}`] = {
        rest_api_id: API_ID,
        resource_id: `\${${RESOURCES}.${resourceName}.id}`,
        http_method: method.toUpperCase(),
        authorization: 'NONE',
        request_parameters: generateMethodParams(resourceItem.parameters)
      };
    })
    .on('response', (resourceName, method, statusCode, responseItem) => {
      base[RESPONSES][`${method}_${resourceName}_${statusCode}`] = {
        rest_api_id: API_ID,
        resource_id: `\${${RESOURCES}.${resourceName}.id}`,
        http_method: `\${${METHODS}.${method}_${resourceName}.http_method}`,
        status_code: statusCode,
        response_parameters: generateResponseHeaders(responseItem.headers)
      };
    })
    .on('integration', (resourceName, method, integrationItem) => {

      if (integrationItem.type) {
        integrationItem.type = integrationItem.type.toUpperCase();
      }
      if (integrationItem.httpMethod) {
        integrationItem.httpMethod = integrationItem.httpMethod.toUpperCase();
      }
      if (integrationItem.passthroughBehavior) {
        integrationItem.passthroughBehavior = integrationItem.passthroughBehavior.toUpperCase();
      }

      base[INTEGRATIONS][`${method}_${resourceName}`] = {
        rest_api_id: API_ID,
        resource_id: `\${${RESOURCES}.${resourceName}.id}`,
        http_method: `\${${METHODS}.${method}_${resourceName}.http_method}`,
        type: integrationItem.type.toUpperCase(),
        uri: integrationItem.uri,
        credentials: integrationItem.credentials,
        integration_http_method: integrationItem.httpMethod,
        request_templates: integrationItem.requestTemplates,
        request_parameters: integrationItem.requestParameters,
        passthrough_behavior: integrationItem.passthroughBehavior
      };
    })
    .on('integrationResponse', (resourceName, method, statusCode, integrationResponseItem) => {
      base[INTEGRATION_RESPONSES][`${method}_${resourceName}_${statusCode}`] = {
        depends_on: [
          `${RESPONSES}.${method}_${resourceName}_${statusCode}`,
          `${INTEGRATIONS}.${method}_${resourceName}`
        ],
        rest_api_id: API_ID,
        resource_id: `\${${RESOURCES}.${resourceName}.id}`,
        http_method: `\${${METHODS}.${method}_${resourceName}.http_method}`,
        status_code: statusCode,
        selection_pattern: integrationResponseItem.selectionPattern,
        response_templates: integrationResponseItem.responseTemplates,
        response_parameters: integrationResponseItem.responseParameters
      };
    });

  return new Promise((resolve) => parser.on('end', () => resolve({resource: base})));
};
